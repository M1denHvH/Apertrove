// Named T1 model suite: actual committer with in-memory persistence ports only.
if(require.main!==module||process.argv.slice(2).join('\n')!=='--tier\nT1\n--scope\nsynthetic'){
  console.error('REFUSED: named T1 synthetic entrypoint required');process.exitCode=2;
}else if(process.env.NODE_OPTIONS||process.env.NODE_PATH||!process.execArgv.includes('--no-addons')||!/^[a-f0-9]{40}$/i.test(process.env.APERTROVE_SOURCE_COMMIT||'')){
  console.error('REFUSED: clean Node preload environment, --no-addons and exact source commit required');process.exitCode=2;
}else main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});

async function main(){
  const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
  const root=path.resolve(__dirname,'../..'),files=['electron/library-commits.cjs','electron/library-schema.cjs'];
  const sources=new Map(files.map(file=>[file,fs.readFileSync(path.join(root,file),'utf8')]));
  const sha=value=>crypto.createHash('sha256').update(value).digest('hex'),clone=value=>JSON.parse(JSON.stringify(value));
  const sourceHashes=Object.fromEntries([...files,'tests/s2a/registration.cjs'].map(file=>[file,sha(fs.readFileSync(path.join(root,file)))]));
  const cache=new Map(),graph=[],denied=[];let expected=false;
  function deny(request){const error=Error('T1_REGISTRATION_IMPORT_DENIED');error.code='T1_REGISTRATION_IMPORT_DENIED';denied.push({request,expected});throw error;}
  function resolve(request,parent){const target=typeof request==='string'&&request.startsWith('.')?path.posix.normalize(path.posix.join(path.posix.dirname(parent),request)):null;return files.includes(target)?target:deny(request);}
  function scan(file,seen=new Set()){
    if(seen.has(file))return;seen.add(file);const source=sources.get(file);
    assert.ok(!/\bimport\s*\(|\beval\s*\(|\bnew\s+Function\s*\(/.test(source),'Dynamic code is outside the reviewed graph');
    const imports=[...source.matchAll(/\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g)];assert.equal((source.match(/\brequire\s*\(/g)||[]).length,imports.length);
    for(const item of imports){const target=resolve(item[2],file);graph.push({from:file,request:item[2],target});scan(target,seen);}
  }
  for(const request of ['electron','sharp','koffi','node:fs/promises','node:child_process','node:http','node:worker_threads','./camera-worker.cjs']){
    expected=true;assert.throws(()=>resolve(request,'electron/library-commits.cjs'),error=>error.code==='T1_REGISTRATION_IMPORT_DENIED');expected=false;
  }
  scan(files[0]);
  const context=vm.createContext({},{codeGeneration:{strings:false,wasm:false}});
  function load(file){
    if(cache.has(file))return cache.get(file).exports;
    const module={exports:{}};cache.set(file,module);
    const fn=new vm.Script('(function(require,module,exports){\n'+sources.get(file)+'\n})',{filename:file}).runInContext(context,{timeout:1000});
    fn(request=>load(resolve(request,file)),module,module.exports);return module.exports;
  }
  const {createLibraryCommitter}=load(files[0]);
  const tests=[],results=[],add=(name,run)=>tests.push({name,run});
  const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
  const original=Buffer.from('APERTROVE_REGISTRATION_MODEL_ORIGINAL_V1\n'),originalHash=sha(original);
  const record=(id='p1',file='/synthetic/p1.jpg',fingerprint='a'.repeat(64))=>({id,path:file,name:id+'.jpg',fingerprint,rating:0,metadata:{model:true}});
  function model({photos=[],writer,ready=true}={}){
    const live={version:2,sessionId:'s1',sessions:[{id:'s1',name:'Synthetic'}],photos:clone(photos),presets:[],settings:{theme:'light',extra:'retained'}};
    const state={ready,durable:clone(live),writes:[]};
    const api=createLibraryCommitter({getStore:()=>live,isReady:()=>state.ready,writeSnapshot:async candidate=>{
      state.writes.push(clone(candidate));if(writer)await writer(candidate,state);state.durable=clone(candidate);
    }});return {api,live,state};
  }
  add('delayed acknowledgement never publishes a staged record into live state',async()=>{
    const entered=deferred(),release=deferred(),m=model({writer:async()=>{entered.resolve();await release.promise;}});
    const pending=m.api.registerPhoto(record());await entered.promise;
    assert.equal(m.live.photos.length,0);assert.equal(m.state.durable.photos.length,0);assert.equal(m.state.writes[0].photos.length,1);
    release.resolve();const result=await pending;assert.equal(result.added,true);assert.equal(m.live.photos.length,1);assert.equal(m.state.durable.photos.length,1);
    return {assertions:['live/index untouched before ack','candidate is staged separately','ack precedes live append']};
  });
  add('caller staging is detached before waiting behind an exclusive operation',async()=>{
    const entered=deferred(),release=deferred(),m=model();
    const held=m.api.runExclusive(async()=>{entered.resolve();await release.promise;});await entered.promise;
    const input=record(),pending=m.api.registerPhoto(input);input.id='changed';input.path='/synthetic/changed.jpg';input.metadata.model=false;
    release.resolve();await held;const result=await pending;
    assert.equal(result.photo.id,'p1');assert.equal(result.photo.path,'/synthetic/p1.jpg');assert.equal(result.photo.metadata.model,true);assert.equal(m.state.durable.photos[0].id,'p1');
  });
  add('failed registration never leaks into the next unrelated persistence',async()=>{
    let first=true;const fault=Error('controlled write rejection'),m=model({writer:async()=>{if(first){first=false;throw fault;}}});
    await assert.rejects(m.api.registerPhoto(record()),error=>error===fault);
    assert.equal(m.live.photos.length,0);assert.equal(m.state.durable.photos.length,0);
    m.live.settings.theme='dark';await m.api.persist();assert.equal(m.state.durable.photos.length,0);assert.equal(m.state.durable.settings.theme,'dark');assert.equal(m.live.photos.length,0);
  });
  add('unrelated queued edit survives a registration write failure',async()=>{
    const entered=deferred(),release=deferred();let first=true;
    const m=model({writer:async()=>{if(first){first=false;entered.resolve();await release.promise;throw Error('controlled failure');}}});
    const pending=m.api.registerPhoto(record());await entered.promise;
    m.live.settings.theme='dark';m.live.settings.unrelated={value:42};const save=m.api.persist();release.resolve();
    await assert.rejects(pending,/controlled failure/);await save;
    assert.equal(m.live.photos.length,0);assert.equal(m.state.durable.photos.length,0);assert.equal(m.state.durable.settings.theme,'dark');assert.equal(m.state.durable.settings.unrelated.value,42);
  });
  add('successful append preserves concurrent existing-photo edits and queued save order',async()=>{
    const entered=deferred(),release=deferred();let first=true;
    const old=record('old','/synthetic/old.jpg','b'.repeat(64));old.rating=2;
    const m=model({photos:[old],writer:async()=>{if(first){first=false;entered.resolve();await release.promise;}}});
    const pending=m.api.registerPhoto(record());await entered.promise;m.live.photos[0].rating=5;m.live.settings.theme='dark';const save=m.api.persist();
    assert.equal(m.state.writes[0].photos[0].rating,2,'writer snapshot must not alias live objects');release.resolve();await pending;await save;
    assert.equal(m.live.photos[0].rating,5);assert.equal(m.live.photos.length,2);assert.equal(m.state.durable.photos[0].rating,5);assert.equal(m.state.durable.settings.theme,'dark');
    assert.deepEqual(m.state.writes.map(value=>value.photos.length),[2,2]);
  });
  add('duplicate detection is rechecked inside the queue after an earlier commit',async()=>{
    const entered=deferred(),release=deferred();let first=true;
    const m=model({writer:async()=>{if(first){first=false;entered.resolve();await release.promise;}}});
    const one=m.api.registerPhoto(record());await entered.promise;const two=m.api.registerPhoto(record('p2','/synthetic/p2.jpg'));
    release.resolve();assert.equal((await one).added,true);assert.equal((await two).added,false);assert.equal(m.live.photos.length,1);assert.equal(m.state.writes.length,1);
  });
  add('camera-style identical bytes at distinct paths remain distinct registrations',async()=>{
    const m=model();assert.equal((await m.api.registerPhoto(record(),{cameraTransfer:true})).added,true);
    assert.equal((await m.api.registerPhoto(record('p2','/synthetic/p2.jpg'),{cameraTransfer:true})).added,true);
    assert.equal((await m.api.registerPhoto(record('unused','/synthetic/p2.jpg'),{cameraTransfer:true})).added,false);
    assert.equal(m.live.photos.length,2);assert.equal(m.state.writes.length,2);
    assert.equal((await m.api.registerPhoto(record('ordinary','/synthetic/elsewhere.jpg'))).added,false,'ordinary import still deduplicates by content');
  });
  add('duplicate photo ID with different content is refused before the writer',async()=>{
    const m=model({photos:[record()]});const invalid=record('p1','/synthetic/other.jpg','c'.repeat(64));
    await assert.rejects(m.api.registerPhoto(invalid),error=>error.code==='LIBRARY_COMMIT_INVALID');assert.equal(m.state.writes.length,0);assert.equal(m.live.photos.length,1);
  });
  add('invalid photo identity is refused without poisoning a later valid registration',async()=>{
    const m=model();await assert.rejects(m.api.registerPhoto({...record(),id:42}),error=>error.code==='LIBRARY_COMMIT_INVALID');
    assert.equal(m.state.writes.length,0);assert.equal(m.live.photos.length,0);assert.equal((await m.api.registerPhoto(record())).added,true);
  });
  add('future or corrupt live snapshot is not written by ordinary persist',async()=>{
    for(const corrupt of [value=>{value.version=3;},value=>{value.photos={};}]){
      const m=model();corrupt(m.live);await assert.rejects(m.api.persist(),error=>error.code==='LIBRARY_COMMIT_INVALID');assert.equal(m.state.writes.length,0);
    }
  });
  add('exclusive failure does not poison the shared queue and operations remain ordered',async()=>{
    const trace=[],m=model({writer:async candidate=>{trace.push('write:'+candidate.photos.length);}});
    const failed=m.api.runExclusive(async()=>{trace.push('exclusive');throw Error('exclusive rejection');});
    const saved=m.api.persist(),registered=m.api.registerPhoto(record());await assert.rejects(failed,/exclusive rejection/);await saved;await registered;
    assert.deepEqual(trace,['exclusive','write:0','write:1']);assert.equal(m.state.durable.photos.length,1);
  });
  add('readiness barrier refuses every operation before side effects and permits later retry',async()=>{
    let entered=0;const m=model({ready:false});
    await assert.rejects(m.api.persist(),error=>error.code==='LIBRARY_COMMIT_INVALID');
    await assert.rejects(m.api.registerPhoto(record()),error=>error.code==='LIBRARY_COMMIT_INVALID');
    await assert.rejects(m.api.runExclusive(()=>{entered++;}),error=>error.code==='LIBRARY_COMMIT_INVALID');
    assert.equal(entered,0);assert.equal(m.state.writes.length,0);assert.equal(m.live.photos.length,0);m.state.ready=true;await m.api.persist();assert.equal(m.state.writes.length,1);
  });
  add('writer rejection followed by retry commits once without stale fingerprint state',async()=>{
    let fail=true;const m=model({writer:async()=>{if(fail)throw Error('retryable writer failure');}});
    await assert.rejects(m.api.registerPhoto(record()),/retryable writer failure/);fail=false;
    assert.equal((await m.api.registerPhoto(record())).added,true);assert.equal((await m.api.registerPhoto(record())).added,false);
    assert.equal(m.live.photos.length,1);assert.equal(m.state.durable.photos.length,1);assert.equal(m.state.writes.length,2);
  });
  const started=Date.now(),report={tier:'T1',scope:'synthetic',sourceCommit:process.env.APERTROVE_SOURCE_COMMIT,sourceCommitProvenance:'launcher-provided40hex; independently checked by root execution ledger',
    command:'node --no-addons tests/s2a/registration.cjs --tier T1 --scope synthetic',sourceHashes,graph,denied,results,
    environment:{node:process.version,platform:process.platform,execArgv:process.execArgv},limits:{totalMs:15000,caseMs:1000,maxCases:16},
    original:{kind:'memory-only oracle, not a physical photograph',beforeSha256:originalHash},
    boundaries:['Actual library-commits and schema JavaScript in closed VM; persistence ports are in-memory models.','No main/Electron/Sharp/importer/native/SDK/network execution.','Actual importer counters/copy/restart evidence belongs to the separate reviewed filesystem suite.','Application Promise acknowledgement is modelled; physical power-loss durability is not claimed.','This reviewed-source VM loader is not an OS sandbox.']};
  function save(exitCode){
    report.pass=results.filter(item=>item.status==='PASS').length;report.fail=results.filter(item=>item.status==='FAIL').length;report.exitCode=exitCode;
    report.elapsedMs=Date.now()-started;report.original.afterSha256=sha(original);assert.equal(report.original.afterSha256,originalHash);
    const qa=path.join(root,'qa','s2a'),canonical=fs.realpathSync(root);
    for(const relative of ['qa',path.join('qa','s2a')]){
      const candidate=path.join(root,relative);try{assert.equal(fs.lstatSync(candidate).isSymbolicLink(),false);const inside=path.relative(canonical,fs.realpathSync(candidate));assert.ok(inside!=='..'&&!inside.startsWith('..'+path.sep)&&!path.isAbsolute(inside));}catch(error){if(error.code!=='ENOENT')throw error;}
    }
    fs.mkdirSync(qa,{recursive:true});fs.writeFileSync(path.join(qa,'registration-results.json'),JSON.stringify(report,null,2)+'\n');
  }
  const deadline=setTimeout(()=>{results.push({name:'total deadline',status:'FAIL',error:'REGISTRATION_MODEL_BUDGET'});save(1);process.exit(1);},15000);
  try{
    assert.ok(tests.length<=report.limits.maxCases);
    for(const test of tests){let timer;try{const detail=await Promise.race([Promise.resolve().then(test.run),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('registration case deadline')),1000);})]);results.push({name:test.name,status:'PASS',...detail});console.log('PASS '+test.name);}
      catch(error){results.push({name:test.name,status:'FAIL',error:String(error.stack||error)});console.error('FAIL '+test.name+'\n'+String(error.stack||error));if(/deadline/.test(error.message))break;}
      finally{clearTimeout(timer);}}
    assert.equal(denied.filter(item=>!item.expected).length,0);save(results.some(item=>item.status!=='PASS')?1:0);
    console.log(JSON.stringify({tier:'T1',pass:report.pass,fail:report.fail,exitCode:report.exitCode}));process.exitCode=report.exitCode;
  }finally{clearTimeout(deadline);}
}
