'use strict';
// Named T1: execute only extracted capture functions with JavaScript SDK ports.
// Never evaluate/import the worker module, Koffi, Electron, filesystem or native DLLs in the VM.
if(require.main!==module||process.argv.slice(2).join(' ')!=='--tier T1 --scope synthetic'||!process.execArgv.includes('--no-addons')||process.env.NODE_OPTIONS||process.env.NODE_PATH||!/^[a-f0-9]{40}$/i.test(process.env.APERTROVE_SOURCE_COMMIT||'')){
  console.error('S2C_CAPTURE_ADMISSION_REFUSED');process.exitCode=2;
}else main().catch(error=>{console.error(error.stack);process.exitCode=1;});
async function main(){
  const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
  const root=path.resolve(__dirname,'../..'),files=['electron/camera-worker.cjs','electron/shutter-latch.cjs','electron/native-observations.cjs','tests/s2c/worker-capture.cjs'];
  assert.equal(path.resolve(process.cwd()),root);assert.ok(process.execArgv.every(flag=>flag==='--no-addons'||flag==='--max-old-space-size=192'));
  const sources=Object.fromEntries(files.map(file=>[file,fs.readFileSync(path.join(root,file),'utf8')]));
  const sourceHashes=Object.fromEntries(files.map(file=>[file,crypto.createHash('sha256').update(sources[file]).digest('hex')]));
  function segment(from,to){const a=sources[files[0]].indexOf(from),b=sources[files[0]].indexOf(to,a+from.length);assert.ok(a>=0&&b>a);return sources[files[0]].slice(a,b);}
  const slice=segment('function failCapture(','function disconnect(')+segment('function capture(','async function listCard(');
  assert.ok(!/\brequire\s*\(|\bprocess\b|\bkoffi\b|\bfs\s*\.|\beval\s*\(|\bFunction\s*\(/.test(slice));
  const results=[];let expired=false;const watchdog=setTimeout(()=>{expired=true;console.error('S2C_CAPTURE_BUDGET');process.exit(1);},10000);
  function fixture({press=0,release=0,burst=false}={}){
    let now=0,next=0;const timers=new Map(),commands=[],events=[],settlements=[];
    const clock={setTimeout(fn,ms){const id=++next;timers.set(id,{at:now+ms,fn});return id;},clearTimeout(id){timers.delete(id);}};
    const operationError=(code,message)=>Object.assign(Error(message),{code});
    const sandbox={...clock,console:undefined,module:{exports:{}},camera:{fake:true},captureWait:null,sessionEpoch:1,destination:'synthetic',controls:{isBusy:()=>false},state:{capabilities:{capture:true}},
      ensureWorking(){},setDeliveryRoute(){},get:id=>id===0x401?(burst?1:0):0,quietPeriod:()=>650,
      isUnsupportedCommand:code=>code===7,operationError,
      check(code){if(code)throw Object.assign(Error('Synthetic primary failure'),{code});},
      transfers:{noteCapture(){},settleCapture(id,result){settlements.push({id,...result});}},send:event=>events.push(event),
      sdk:{command(_camera,id,value){commands.push({id,value});const outcome=id===4&&value===0?release:press;if(outcome instanceof Error)throw outcome;return outcome;}}
    };
    const context=vm.createContext(sandbox,{codeGeneration:{strings:false,wasm:false}});
    new vm.Script(sources['electron/native-observations.cjs']+'\nthis.observations=module.exports.createNativeObservations();').runInContext(context,{timeout:1000});
    new vm.Script(sources['electron/shutter-latch.cjs']+'\nthis.holdShutter=(io,ms)=>module.exports.holdShutter({...io,now:()=>clockNow(),setTimer:setTimeout,clearTimer:clearTimeout},ms);').runInContext(context,{timeout:1000});
    context.clockNow=()=>now;
    context.observed=(method,phase,fn)=>{try{const code=fn();context.observations.observe({operation:'capture',operationId:'synthetic:operation:1',method,phase,code});return code;}catch(error){context.observations.failure({operation:'capture',method,phase,error});throw error;}};
    new vm.Script(slice+'\nthis.api={capture,stopBurst,settleCapture};').runInContext(context,{timeout:1000});
    function advance(ms){const end=now+ms;let steps=0;while(true){const due=[...timers].filter(([,job])=>job.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;assert.ok(++steps<30);now=due[1].at;timers.delete(due[0]);due[1].fn();}now=end;}
    const start=()=>{const promise=context.api.capture({autofocus:true,folder:'synthetic',burstMs:burst?100:0,captureId:'synthetic:capture:1'},{operationId:'synthetic:operation:1'});promise.catch(()=>{});return promise;};
    return {context,commands,events,settlements,timers,advance,start,transfer(){assert.ok(context.captureWait);context.captureWait.observedTransfers++;context.api.settleCapture();}};
  }
  async function test(name,run){try{await run();results.push({name,status:'PASS'});}catch(error){results.push({name,status:'FAIL',message:String(error.message)});}}
  try{
    await test('primary shutter failure remains first with acknowledged release',async()=>{const f=fixture({press:129});await assert.rejects(f.start(),error=>error.code===129);assert.equal(f.context.observations.snapshot().primaryFailure.code,129);assert.equal(f.context.captureWait,null);assert.equal(f.timers.size,0);});
    await test('primary plus thrown release quarantines ownership without erasing primary',async()=>{const f=fixture({press:129,release:Error('Synthetic binding failure')});await assert.rejects(f.start(),error=>error.code==='OPERATION_UNKNOWN_TERMINATION');const report=f.context.observations.snapshot();assert.equal(report.primaryFailure.code,129);assert.ok(report.cleanupFailures.some(item=>item.method==='EdsSendCommand'));assert.equal(f.settlements[0].outcome,'UNKNOWN_TERMINATION');});
    await test('manual burst release throw cannot quiet-complete capture',async()=>{const f=fixture({burst:true,release:Error('Synthetic binding failure')}),p=f.start();f.transfer();assert.throws(()=>f.context.api.stopBurst(),error=>error.code==='OPERATION_UNKNOWN_TERMINATION');await assert.rejects(p,error=>error.code==='OPERATION_UNKNOWN_TERMINATION');f.advance(1000);assert.equal(f.context.captureWait,null);assert.equal(f.timers.size,0);assert.equal(f.settlements[0].outcome,'UNKNOWN_TERMINATION');});
    await test('timer burst release fault has explicit UNKNOWN terminal',async()=>{const f=fixture({burst:true,release:Error('Synthetic binding failure')}),p=f.start();f.transfer();f.advance(100);await assert.rejects(p,error=>error.code==='OPERATION_UNKNOWN_TERMINATION');assert.equal(f.timers.size,0);});
    await test('manual quiet receipt never guarantees a complete RAW JPEG capture',async()=>{const f=fixture(),p=f.start();f.transfer();f.advance(650);const receipt=await p;assert.equal(receipt.confirmation,'UNVERIFIED');assert.equal(receipt.nativeQuiescence,'UNKNOWN');assert.equal(receipt.shots,0);assert.equal(receipt.files.length,0);assert.equal(receipt.observedTransfers,1);});
    await test('producer capture deadline is UNKNOWN rather than safe completion',async()=>{const f=fixture(),p=f.start();f.advance(75000);await assert.rejects(p,error=>error.code==='OPERATION_UNKNOWN_TERMINATION');assert.equal(f.settlements[0].outcome,'UNKNOWN_TERMINATION');});
    await test('normal manual burst release preserves press release and unverified receipt',async()=>{const f=fixture({burst:true}),p=f.start();f.transfer();f.context.api.stopBurst();f.advance(650);assert.equal((await p).confirmation,'UNVERIFIED');assert.equal(f.commands.length,2);assert.equal(f.commands[1].value,0);assert.equal(f.events.filter(event=>event.event==='burstReleased').length,1);});
    await test('unsupported press fallback preserves source native command order',async()=>{const f=fixture({press:7}),p=f.start();await assert.rejects(p,error=>error.code===7);assert.deepEqual(f.commands.map(item=>item.id),[4,0,4]);assert.equal(f.commands[2].value,0);});
  }finally{clearTimeout(watchdog);}
  const pass=results.filter(row=>row.status==='PASS').length,fail=results.length-pass;
  const report={sourceCommit:process.env.APERTROVE_SOURCE_COMMIT,testLevel:'T1',scope:'source-extracted capture functions + fake JavaScript SDK only',pass,fail,sourceHashes,results,expired,limitations:['No worker module evaluation or Koffi/native DLL/ABI/callback execution','Extracted functions do not certify Electron transport or hardware shutter behavior']};
  fs.mkdirSync(path.join(root,'qa/s2c'),{recursive:true});fs.writeFileSync(path.join(root,'qa/s2c/worker-capture-results.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({pass,fail,report:'qa/s2c/worker-capture-results.json'}));if(fail)process.exitCode=1;
}
