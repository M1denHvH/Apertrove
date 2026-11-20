'use strict';
// T1: reviewed lifecycle modules in a closed VM, synthetic RPC and memory only.
// Never imports/evaluates main.cjs, camera-worker.cjs, Electron, Koffi or a DLL.
if(require.main!==module||process.argv.slice(2).join(' ')!=='--tier T1 --scope synthetic'||
  !process.execArgv.includes('--no-addons')||process.execArgv.some(flag=>!['--no-addons','--max-old-space-size=192'].includes(flag))||process.env.NODE_OPTIONS||process.env.NODE_PATH){
  console.error('NATIVE_PRODUCTION_RETIREMENT_ADMISSION_REFUSED');process.exitCode=2;
}else main().catch(error=>{console.error(error.stack);process.exitCode=1;});
async function main(){
  const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
  const root=path.resolve(__dirname,'../..'),files=['runtime-replacement','shutdown-coordinator','operation-lifecycle','transfer-consumer'].map(name=>'electron/'+name+'.cjs');
  assert.equal(path.resolve(process.cwd()),root);
  const sources=new Map(),cache=new Map(),graph=[],denials=[];let expected=false;
  const clone=value=>JSON.parse(JSON.stringify(value));
  function denied(request){denials.push({request,expected});throw Object.assign(Error('NATIVE_PRODUCTION_IMPORT_DENIED'),{code:'NATIVE_PRODUCTION_IMPORT_DENIED'});}
  function resolve(request,parent){const target=typeof request==='string'&&request.startsWith('.')?path.posix.normalize(path.posix.join(path.posix.dirname(parent),request)):null;return files.includes(target)?target:denied(request);}
  for(const file of files){
    const filename=fs.realpathSync(path.join(root,file));assert.equal(filename.toLowerCase(),path.resolve(root,file).toLowerCase());
    const bytes=fs.readFileSync(filename),source=bytes.toString('utf8');
    assert.ok(!/\bimport\s*(?:\(|['"{*])|\beval\s*\(|\bnew\s+Function\s*\(/.test(source));
    const imports=[...source.matchAll(/\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g)];assert.equal((source.match(/\brequire\s*\(/g)||[]).length,imports.length);
    for(const item of imports)graph.push({from:file,request:item[2],target:resolve(item[2],file)});
    sources.set(file,{source,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
  }
  for(const request of ['electron','koffi','node:fs','node:child_process','node:http','node:worker_threads','./camera-worker.cjs','./sdk-environment.cjs']){
    expected=true;assert.throws(()=>resolve(request,files[0]),error=>error.code==='NATIVE_PRODUCTION_IMPORT_DENIED');expected=false;
  }
  const context=vm.createContext({},{codeGeneration:{strings:false,wasm:false}});
  function load(file){if(cache.has(file))return cache.get(file).exports;const module={exports:{}};cache.set(file,module);new vm.Script('(function(require,module,exports){\n'+sources.get(file).source+'\n})',{filename:file}).runInContext(context,{timeout:1000})(request=>load(resolve(request,file)),module,module.exports);return module.exports;}
  const {createWorkerRetirement}=load(files[0]),{createOperationClient,createOperationHost}=load(files[2]),{createTransferConsumer}=load(files[3]);
  const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
  const flush=async()=>{for(let index=0;index<60;index++)await Promise.resolve();};
  function clock(){
    let now=0,next=0;const timers=new Map();
    return {now:()=>now,setTimeout(run,ms){const id=++next;timers.set(id,{run,at:now+Math.max(0,ms)});return id;},clearTimeout:id=>timers.delete(id),size:()=>timers.size,
      async advance(ms){const end=now+ms;await flush();let count=0;for(;;){const due=[...timers].filter(([,job])=>job.at<=end).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];if(!due)break;assert.ok(++count<200);now=due[1].at;timers.delete(due[0]);due[1].run();await flush();}now=end;await flush();}};
  }
  let generation=0;
  function fixture(options={}){
    const time=clock(),trace=[],diagnostics=[],unknowns=[],registrations=[],exit=deferred(),pendingRegistration=options.registrationGate;
    const name='production-synthetic-'+(++generation),channel={generation:name,exited:false,exitCode:null,exitPromise:exit.promise},proof=options.proof||'synthetic';
    let sequence=0,host,retirement,kills=0,starts=0,persistence=0;
    function end(code=0){if(channel.exited)return;channel.exited=true;channel.exitCode=code;channel.rpc.terminate();exit.resolve(code);trace.push('exit:'+code);}
    channel.process={kill(){kills++;trace.push('kill');if(!options.killHangs)end(23);return true;}};
    channel.consumer=createTransferConsumer({generation:name,register:async(file,route)=>{trace.push('register:start');if(pendingRegistration)await pendingRegistration.promise;registrations.push({file,route:clone(route)});trace.push('register:done');return {errors:[]};}});
    function photo(label='original'){
      return channel.consumer.accept({generation:name,photoSequence:++sequence,data:{path:'/synthetic/'+label+'.jpg',capture:false,context:{transferId:name+':'+sequence,sessionId:'session-old',destination:'/synthetic',attribution:'EXTERNAL',correlation:'UNCONFIRMED'}}});
    }
    channel.rpc=createOperationClient({generation:name,clock:time,getSessionEpoch:()=>0,send:message=>host.receive(message)});
    host=createOperationHost({generation:name,getSessionEpoch:()=>0,send:message=>{
      channel.rpc.receive(message);
      if(message.kind==='terminal'&&message.method==='finalizeShutdown'&&message.state==='COMPLETED'&&!options.exitHangs)end(options.exitCode??0);
    },handlers:{
      burstStop:()=>{trace.push('cancel');return {released:true};},
      producerFence:async()=>{trace.push('fence');host.stopAdmission();if(options.fenceGate)await options.fenceGate.promise;return {drained:true,lastPhotoSequence:sequence,proof,nativeStarted:proof==='unknown',transfers:{failed:options.producerFailure?1:0,issues:[]}};},
      finalizeShutdown:async()=>{
        trace.push('finalize');if(options.finalizeGate)await options.finalizeGate.promise;
        if(options.latePhoto)void photo('late-original');
        return {closed:true,lastPhotoSequence:sequence,proof,nativeStarted:proof==='unknown',observations:{hasFailures:options.observationFailure===true},transfers:{failed:0,issues:[]}};
      }
    }});
    retirement=createWorkerRetirement({channel,clock:time,budgetMs:100,diagnosticMs:7,
      drainConsumers:async()=>{trace.push('consumers');if(options.drainFailure)throw Object.assign(Error('synthetic drain failure'),{code:'DRAIN_FAILED'});if(options.drainUnacknowledged)return {drained:false};},
      persist:()=>{trace.push('persist');persistence++;if(options.persistFailure)throw Object.assign(Error('synthetic persistence failure'),{code:'PERSIST_FAILED'});return !(options.persistUnacknowledgedAfter&&persistence>=options.persistUnacknowledgedAfter);},
      recordDiagnostic:value=>{trace.push('diagnostic');diagnostics.push(clone(value));},onUnknown:value=>{trace.push('unknown');unknowns.push(clone(value));}});
    function replace(){return retirement.close().then(receipt=>{if(receipt.outcome==='CLOSED'){starts++;trace.push('fresh-generation');return {receipt,generation:name+':replacement'};}return {receipt,generation:null};});}
    return {time,trace,channel,host,retirement,diagnostics,unknowns,registrations,photo,end,replace,get kills(){return kills;},get starts(){return starts;},get persistence(){return persistence;}};
  }
  const results=[];async function test(name,run){try{await run();results.push({name,status:'PASS'});}catch(error){results.push({name,status:'FAIL',message:String(error.stack||error)});}}
  const watchdog=setTimeout(()=>{console.error('NATIVE_PRODUCTION_RETIREMENT_BUDGET');process.exit(1);},12000);
  try{
    await test('proved synthetic retirement starts a fresh generation only after old exit and final persistence',async()=>{
      const x=fixture(),result=await x.replace();assert.equal(result.receipt.outcome,'CLOSED');assert.notEqual(result.generation,x.channel.generation);assert.equal(x.starts,1);assert.equal(x.kills,0);assert.equal(x.diagnostics.length,0);assert.equal(x.channel.retiring,true);assert.equal(x.channel.finalizing,true);
      assert.deepEqual(x.trace,['cancel','fence','consumers','persist','finalize','exit:0','consumers','persist','fresh-generation']);assert.equal(x.time.size(),0);
    });
    await test('one retirement object is singleflight and never repeats completion or teardown',async()=>{
      const gate=deferred(),x=fixture({registrationGate:gate});void x.photo();const first=x.retirement.close(),second=x.retirement.close();assert.equal(first,second);await flush();gate.resolve();const receipt=await first;assert.equal(x.retirement.close(),first);assert.equal(await second,receipt);assert.equal(x.trace.filter(value=>value==='finalize').length,1);assert.equal(x.channel.retirementReceipt.outcome,'CLOSED');
    });
    await test('native-not-started proof remains eligible without claiming vendor quiescence',async()=>{
      const x=fixture({proof:'native-not-started'}),receipt=await x.retirement.close();assert.equal(receipt.outcome,'CLOSED');assert.equal(receipt.fence.nativeStarted,false);assert.equal(receipt.worker.proof,'native-not-started');
    });
    await test('unknown native proof never becomes CLOSED even after acknowledged exit zero',async()=>{
      const x=fixture({proof:'unknown'}),result=await x.replace();assert.equal(result.receipt.outcome,'UNKNOWN_TERMINATION');assert.equal(result.generation,null);assert.equal(x.starts,0);assert.equal(x.kills,0);assert.equal(x.channel.exitCode,0);assert.equal(x.unknowns.length,1);assert.equal(x.diagnostics.length,1);assert.equal(x.retirement.getState().quarantined,true);assert.ok(result.receipt.errors.some(error=>error.code==='PRODUCER_PROOF_UNKNOWN'));assert.ok(result.receipt.errors.some(error=>error.code==='WORKER_PROOF_UNKNOWN'));await x.retirement.close();assert.equal(x.unknowns.length,1);
    });
    await test('pending old-generation registration blocks persistence and worker finalization',async()=>{
      const gate=deferred(),x=fixture({registrationGate:gate}),registration=x.photo();const closing=x.retirement.close();await flush();assert.equal(x.channel.consumer.snapshot().pending,1);assert.ok(x.trace.includes('fence'));assert.equal(x.trace.includes('persist'),false);assert.equal(x.trace.includes('finalize'),false);gate.resolve();await registration;assert.equal((await closing).outcome,'CLOSED');assert.equal(x.registrations.length,1);assert.equal(x.registrations[0].route.sessionId,'session-old');assert.equal(x.registrations[0].route.captureId,null);assert.ok(x.trace.indexOf('register:done')<x.trace.indexOf('persist'));
    });
    await test('a late post-fence photo is registered and persisted but keeps retirement UNKNOWN',async()=>{
      const x=fixture({latePhoto:true}),result=await x.replace();assert.equal(result.receipt.outcome,'UNKNOWN_TERMINATION');assert.equal(x.starts,0);assert.equal(x.registrations.length,1);assert.equal(x.channel.consumer.snapshot().pending,0);assert.ok(x.channel.consumer.snapshot().issues.includes('PHOTO_AFTER_PRODUCER_FENCE'));assert.ok(x.persistence>=2);assert.equal(x.unknowns.length,1);
    });
    await test('producer transfer uncertainty is not discarded during forced retirement',async()=>{
      const x=fixture({producerFailure:true}),result=await x.replace();assert.equal(result.receipt.outcome,'UNKNOWN_TERMINATION');assert.equal(result.receipt.forced,true);assert.equal(x.kills,1);assert.equal(x.starts,0);assert.ok(result.receipt.errors.some(error=>error.code==='TRANSFER_PRODUCER_UNKNOWN'));assert.ok(x.trace.includes('consumers'));assert.ok(x.trace.includes('persist'));
    });
    await test('a missing producer acknowledgement forces only the owned generation',async()=>{
      const gate=deferred(),x=fixture({fenceGate:gate});const closing=x.replace();await x.time.advance(100);const result=await closing;assert.equal(result.receipt.outcome,'UNKNOWN_TERMINATION');assert.equal(x.kills,1);assert.equal(x.starts,0);assert.equal(x.channel.exited,true);assert.equal(x.unknowns.length,1);assert.equal(x.channel.rpc.snapshot().operations.length,0);const oldHistory=clone(x.channel.rpc.snapshot().history);assert.ok(oldHistory.some(row=>row.method==='producerFence'&&row.state==='UNKNOWN_TERMINATION'));gate.resolve();await flush();assert.deepEqual(clone(x.channel.rpc.snapshot().history),oldHistory);assert.equal(x.retirement.getState().quarantined,true);
    });
    await test('finalize timeout cannot acknowledge successful cleanup or repeat native completion',async()=>{
      const gate=deferred(),x=fixture({finalizeGate:gate});const closing=x.retirement.close();await x.time.advance(100);const receipt=await closing;assert.equal(receipt.outcome,'UNKNOWN_TERMINATION');assert.equal(receipt.forced,true);assert.equal(x.kills,1);assert.equal(x.trace.filter(value=>value==='finalize').length,1);assert.equal(x.unknowns.length,1);gate.resolve();await flush();assert.equal(x.channel.rpc.snapshot().history.filter(row=>row.method==='finalizeShutdown').length,1);assert.equal(x.channel.rpc.snapshot().history.find(row=>row.method==='finalizeShutdown').releases,1);
    });
    await test('missing exit acknowledgement remains bounded UNKNOWN after a forced kill attempt',async()=>{
      const x=fixture({exitHangs:true,killHangs:true}),closing=x.replace();await x.time.advance(107);const result=await closing;assert.equal(result.receipt.outcome,'UNKNOWN_TERMINATION');assert.equal(x.kills,1);assert.equal(x.starts,0);assert.equal(x.channel.exited,false);assert.ok(result.receipt.elapsedMs<=107);assert.equal(x.unknowns.length,1);assert.equal(x.time.size(),0);
    });
    await test('unexpected old worker exit cannot be mistaken for an unused clean worker',async()=>{
      const x=fixture();x.end(23);const result=await x.replace();assert.equal(result.receipt.outcome,'UNKNOWN_TERMINATION');assert.equal(x.starts,0);assert.equal(x.kills,0);assert.equal(x.trace.includes('finalize'),false);assert.ok(result.receipt.errors.some(error=>error.code==='WORKER_EXIT_UNFENCED'));assert.equal(x.unknowns.length,1);
    });
    await test('nonzero exit and native observation failures each remain UNKNOWN',async()=>{
      for(const option of [{exitCode:23},{observationFailure:true}]){const x=fixture(option),result=await x.replace();assert.equal(result.receipt.outcome,'UNKNOWN_TERMINATION');assert.equal(x.starts,0);assert.ok(result.receipt.errors.some(error=>error.code==='WORKER_CLOSE_UNKNOWN'));assert.equal(x.unknowns.length,1);}
    });
    await test('persistence failure remains primary while independent worker cleanup still runs',async()=>{
      const x=fixture({persistFailure:true}),result=await x.replace();assert.equal(result.receipt.outcome,'UNKNOWN_TERMINATION');assert.equal(result.receipt.primaryFailure.code,'PERSIST_FAILED');assert.ok(x.trace.includes('finalize'));assert.equal(x.channel.exited,true);assert.equal(x.starts,0);assert.equal(x.unknowns.length,1);
    });
    await test('consumer failure still attempts persistence and never grants replacement',async()=>{
      const x=fixture({drainFailure:true}),result=await x.replace();assert.equal(result.receipt.outcome,'UNKNOWN_TERMINATION');assert.equal(result.receipt.primaryFailure.code,'DRAIN_FAILED');assert.ok(x.persistence>=2);assert.equal(x.starts,0);assert.equal(x.channel.exited,true);
    });
    await test('an explicitly unacknowledged consumer barrier cannot be promoted to drained',async()=>{
      const x=fixture({drainUnacknowledged:true}),result=await x.replace();assert.equal(result.receipt.outcome,'UNKNOWN_TERMINATION');assert.equal(result.receipt.primaryFailure.code,'CONSUMERS_NOT_DRAINED');assert.equal(x.starts,0);assert.ok(x.persistence>=2);
    });
    await test('an unacknowledged post-exit persistence cannot permit a fresh worker',async()=>{
      const x=fixture({persistUnacknowledgedAfter:2}),result=await x.replace();assert.equal(result.receipt.outcome,'UNKNOWN_TERMINATION');assert.ok(result.receipt.errors.some(error=>error.code==='PERSIST_NOT_ACKNOWLEDGED'));assert.equal(x.channel.exitCode,0);assert.equal(x.starts,0);
    });
    assert.equal(denials.some(item=>!item.expected),false);
  }finally{clearTimeout(watchdog);}
  const pass=results.filter(result=>result.status==='PASS').length,fail=results.length-pass;
  console.log(JSON.stringify({tier:'T1',scope:'synthetic-memory',entrypoint:'tests/native-production/runtime-replacement.cjs',pass,fail,
    sourceHashes:Object.fromEntries([...sources].map(([file,value])=>[file,value.sha256])),graph,denials,results,
    limitations:['No production main/worker module execution, Electron, Koffi, DLLs, hardware or native-quiescence proof','No real files, profiles, libraries, registration destinations or photo originals are modified']},null,2));
  if(fail)process.exitCode=1;
}
