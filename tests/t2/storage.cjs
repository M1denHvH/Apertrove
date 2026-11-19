// Named T2 only. Trusted fixture/report I/O surrounds the reviewed production VM.
if(require.main!==module||process.argv.slice(2).join('\n')!=='--tier\nT2\n--scope\nsynthetic'){
  console.error(JSON.stringify({status:'REFUSED',code:'T2_ENTRYPOINT_OR_SCOPE_DENIED'}));process.exitCode=2;
}else if(process.env.NODE_OPTIONS||process.env.NODE_PATH||!process.execArgv.includes('--no-addons')){
  console.error(JSON.stringify({status:'REFUSED',code:'T2_STARTUP_ENV_DENIED'}));process.exitCode=2;
}else{
  main().catch(error=>{console.error(String(error.stack||error));process.exitCode=1;});
}

async function main(){
  const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
  const {createProductionGuard}=require('./guard.cjs');
  const repoRoot=path.resolve(__dirname,'..','..'),qa=path.join(repoRoot,'qa','integration');
  const fixtures=path.join(qa,'fixtures');
  // Trusted setup also rejects existing aliases before the first fixture/report write.
  const canonicalRepo=fs.realpathSync(repoRoot);
  for(const relative of ['qa',path.join('qa','integration'),path.join('qa','integration','fixtures')]){
    const candidate=path.join(repoRoot,relative);
    try{assert.equal(fs.lstatSync(candidate).isSymbolicLink(),false,'fixture ancestor must not be a link');const real=fs.realpathSync(candidate),rest=path.relative(canonicalRepo,real);assert.ok(rest!== '..'&&!rest.startsWith('..'+path.sep)&&!path.isAbsolute(rest),'fixture ancestor escapes worktree');}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  fs.mkdirSync(fixtures,{recursive:true});
  const fixtureRoot=fs.mkdtempSync(path.join(fixtures,'storage-'));
  const guard=createProductionGuard({repoRoot,fixtureRoot});
  const output=path.join(qa,'storage-results.json');
  const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
  const original=path.join(fixtureRoot,'synthetic-original.bin');
  const originalBytes=Buffer.from('APERTROVE_SYNTHETIC_ORIGINAL_V1\n');
  const originalExpected='a01421a55579302609ec92ecf9dc3a028f67a73e525192298b2c5a9245ff0e8d';
  fs.writeFileSync(original,originalBytes);assert.equal(sha(fs.readFileSync(original)),originalExpected);
  const report={tier:'T2',scope:'synthetic',entrypoint:'tests/t2/storage.cjs',sourceCommit:readHead(),
    command:'node --no-addons tests/t2/storage.cjs --tier T2 --scope synthetic',
    environment:{platform:process.platform,node:process.version,noAddons:true,nodeOptions:false,nodePath:false},
    fixtureRoot,fixturesRetained:true,admission:[],results:[],
    original:{path:original,expectedSha256:originalExpected,beforeSha256:sha(fs.readFileSync(original))},
    resourceBudget:{totalDeadlineMs:25000,caseDeadlineMs:3000,maxCases:24,maxFixtureFiles:128},
    verifiedScope:'Actual shared filesystem adapter + bootstrap + session migration + onboardingState + shared boot application; no Electron/IPC/React runtime.',
    residualRisks:['Windows ACL and path-alias races are not certified.','No application, camera worker, Sharp, Canon SDK, WIA or hardware execution.','Main local full prepareLibrary and actual native service constructors are outside this suite.','Fault cases use owned synthetic blockers or explicitly labelled deferred callbacks.']};
  let finished=false;
  function save(exitCode){
    report.guard=guard.evidence();report.original.afterSha256=sha(fs.readFileSync(original));
    report.original.unchanged=report.original.afterSha256===originalExpected;
    report.sourceHashes={...report.guard.sourceHashes,
      'tests/t2/storage.cjs':sha(fs.readFileSync(__filename)),
      'tests/t2/guard.cjs':sha(fs.readFileSync(path.join(__dirname,'guard.cjs')))};
    report.pass=report.results.filter(result=>result.status==='PASS').length;
    report.fail=report.results.filter(result=>result.status==='FAIL').length;
    report.notRun=report.results.filter(result=>result.status==='NOT_RUN').length;
    report.exitCode=exitCode;
    fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  }
  const deadline=setTimeout(()=>{
    if(finished)return;
    report.results.push({name:'total deadline',status:'FAIL',error:'T2_RESOURCE_BUDGET'});
    save(1);console.error('FAIL T2 total deadline');process.exit(1);
  },report.resourceBudget.totalDeadlineMs);
  try{
    for(const request of ['electron','koffi','sharp','exifr','node:child_process','child_process','node:worker_threads','node:http','node:net','node:dgram',
      '../../electron/camera-worker.cjs','../../electron/sdk-environment.cjs','../../electron/native-buffer.cjs','../../electron/camera-discovery.cjs','../../tests/t2/unknown-entry.cjs']){
      report.admission.push({name:'import '+request,...guard.expectDeniedImport(request)});
    }
    const outside=path.join(qa,'outside-production-facade.json');
    for(const operation of ['readFile','mkdir','writeFile','rename source','rename destination'])report.admission.push({name:'outside '+operation,...guard.expectDeniedPath(operation,outside)});
    report.admission.push({name:'relative path',...guard.expectDeniedPath('writeFile','relative-library.json')});
    assert.equal(guard.evidence().counters.operations,0,'admission probes must fail before physical adapter I/O');
    guard.assertNoUnexpected();

    const storage=guard.load('electron/library-storage.cjs');
    const {createLibraryBootstrap}=guard.load('electron/library-bootstrap.cjs');
    const {migrateSessions}=guard.load('electron/sessions.cjs');
    const {onboardingState}=guard.load('electron/onboarding.cjs');
    const {createBootApplication}=guard.load('electron/boot-application.cjs');
    const cases=[];
    const add=(name,run)=>cases.push({name,run});
    const readHash=file=>sha(fs.readFileSync(file));
    function fixture(name,bytes){
      assert.match(name,/^[a-z0-9-]+$/);
      const dir=path.join(fixtureRoot,name);fs.mkdirSync(dir);const file=path.join(dir,'library.json');
      if(bytes!==undefined)fs.writeFileSync(file,bytes);
      return {dir,file};
    }
    function valid(dir,version=2){
      const value={version,sessionId:'s',sessions:[{id:'s',name:'Synthetic session',extraSession:true}],
        photos:[{id:'photo',path:original,name:'synthetic-original.bin',sessionId:'s',rating:4,metadata:{synthetic:true}}],
        settings:{captureFolder:path.join(dir,'captures'),customSetting:'retained'},
        presets:[{id:'p',name:'Synthetic preset',values:{iso:100},extraPreset:true}],unknownRoot:{retained:true}};
      if(version===undefined)delete value.version;return value;
    }
    function makeBoot(f,options={}){
      const counts={reads:0,writes:0,prepares:0,fresh:0};
      const bootstrap=createLibraryBootstrap({
        readText:async()=>{counts.reads++;return options.readText?options.readText():storage.readLibraryText(f.file);},
        writeStore:async value=>{counts.writes++;if(options.writeStore)return options.writeStore(value);return storage.writeLibraryStore(f.file,value);},
        createFresh:()=>{counts.fresh++;return options.createFresh?options.createFresh():{version:2,photos:[],sessions:[],presets:[],settings:{captureFolder:path.join(f.dir,'captures')}};},
        prepare:async(value,meta)=>{counts.prepares++;if(options.prepare)return options.prepare(value,meta);migrateSessions(value,path.join(f.dir,'Pictures'));value.settings.onboarding=onboardingState(value.settings.onboarding,meta.established);return value;}
      });return {bootstrap,counts};
    }
    function committed(f,result){
      assert.equal(result.kind,'VALID');assert.equal(result.store.version,2);
      const bytes=fs.readFileSync(f.file);assert.equal(sha(bytes),sha(Buffer.from(JSON.stringify(result.store,null,2))));
      assert.equal(JSON.parse(bytes).version,2);
      assert.equal(fs.readdirSync(f.dir).filter(name=>name.endsWith('.tmp')).length,0);
      return {afterSha256:sha(bytes),physicalBytes:bytes.length};
    }
    function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
    function appFor(bootstrap,overrides={}){
      const calls={accept:0,initialize:0,appearance:0,public:0};let accepted;
      const app=createBootApplication({bootstrap,isQuitting:()=>false,
        acceptStore:value=>{calls.accept++;accepted=value;},initializeServices:()=>{calls.initialize++;},
        applyAppearance:()=>{calls.appearance++;},publicState:()=>{calls.public++;return {...accepted,bootFailure:null};},
        locale:()=> 'en-US',...overrides});return {app,calls};
    }

    add('first run: missing physical library commits before ready and preserves onboarding',async()=>{
      const f=fixture('missing'),b=makeBoot(f);const result=await b.bootstrap.boot();
      assert.equal(result.established,false);assert.equal(result.store.settings.onboarding.completed,false);assert.equal(b.bootstrap.isReady(),true);
      assert.equal(JSON.stringify(b.counts),JSON.stringify({reads:1,writes:1,prepares:1,fresh:1}));
      return {assertions:['actual ENOENT only triggers fresh','persist before ready','onboarding not completed'],...committed(f,result),counts:b.counts};
    });
    for(const [name,version] of [['versionless',null],['v1',1],['v2',2]])add('existing '+name+': real migration, atomic persistence and cached boot',async()=>{
      const f=fixture('valid-'+name),input=valid(f.dir,version===null?1:version);if(version===null)delete input.version;
      fs.writeFileSync(f.file,JSON.stringify(input));const before=readHash(f.file),b=makeBoot(f),result=await b.bootstrap.boot();
      assert.equal(result.established,true);assert.equal(result.store.photos[0].path,original);assert.equal(result.store.photos[0].rating,4);
      assert.equal(result.store.settings.customSetting,'retained');assert.equal(result.store.unknownRoot.retained,true);
      assert.equal(result.store.sessions[0].extraSession,true);assert.equal(result.store.presets[0].extraPreset,true);
      assert.equal(result.store.settings.onboarding.completed,true);
      const again=await b.bootstrap.boot();assert.equal(again.store,result.store);assert.equal(b.counts.reads,1);assert.equal(b.counts.writes,1);
      return {beforeSha256:before,...committed(f,result),counts:b.counts,assertions:['photo identity/path/rating preserved','unknown fields retained','established onboarding retained','ready boot performs no additional I/O']};
    });
    for(const [name,bytes,kind] of [
      ['corrupt',Buffer.from('{'),'CORRUPT'],['empty',Buffer.alloc(0),'CORRUPT'],['truncated',Buffer.from('{"version":2,'),'CORRUPT'],
      ['invalid-shape',Buffer.from('{"version":2,"photos":{},"settings":{}}'),'CORRUPT'],
      ['future',Buffer.from('{"version":3,"photos":[],"settings":{}}'),'UNSUPPORTED_VERSION'],
      ['invalid-utf8',Buffer.from([0xc3,0x28]),'UNREADABLE']
    ])add(name+': refuses physical bytes without overwrite or false success',async()=>{
      const f=fixture(name,bytes),before=readHash(f.file),b=makeBoot(f),a=appFor(b.bootstrap),result=await a.app();
      assert.equal(result.bootFailure.kind,kind);assert.equal(b.bootstrap.isReady(),false);
      assert.equal(b.counts.writes,0);assert.equal(b.counts.prepares,0);assert.equal(b.counts.fresh,0);assert.equal(readHash(f.file),before);
      assert.equal(JSON.stringify(a.calls),JSON.stringify({accept:0,initialize:0,appearance:0,public:0}));
      return {beforeSha256:before,afterSha256:readHash(f.file),expectedKind:kind,counts:b.counts,assertions:['raw library unchanged','no fresh fallback','no services or public success']};
    });
    add('unreadable directory: actual OS error remains recovery',async()=>{
      const f=fixture('directory');fs.mkdirSync(f.file);const b=makeBoot(f),result=await b.bootstrap.boot();
      assert.equal(result.kind,'UNREADABLE');assert.ok(['EISDIR','EACCES','EPERM'].includes(result.code));assert.equal(b.counts.fresh,0);assert.equal(b.counts.writes,0);assert.ok(fs.statSync(f.file).isDirectory());
      return {expectedKind:'UNREADABLE',actualOsCode:result.code,counts:b.counts,assertions:['directory not replaced','actual filesystem refusal; not an ACL simulation']};
    });
    for(const existing of [true,false])add((existing?'existing':'first-run')+' failed persist: real capture-folder blocker, then retry',async()=>{
      const f=fixture(existing?'persist-existing':'persist-fresh'),blocker=path.join(f.dir,'capture-blocker');fs.writeFileSync(blocker,'owned blocker');
      const value=valid(f.dir);value.settings.captureFolder=path.join(blocker,'captures');if(existing)fs.writeFileSync(f.file,JSON.stringify(value));
      const before=existing?readHash(f.file):null,b=makeBoot(f,{createFresh:()=>value});
      const failed=await b.bootstrap.boot();assert.equal(failed.kind,'PERSIST_FAILED');assert.ok(['ENOTDIR','EEXIST','ENOENT'].includes(failed.code));assert.equal(b.bootstrap.isReady(),false);
      if(existing)assert.equal(readHash(f.file),before);else assert.equal(fs.existsSync(f.file),false);
      fs.unlinkSync(blocker);const success=await b.bootstrap.boot();assert.equal(b.counts.reads,2);assert.equal(b.counts.writes,2);
      return {beforeSha256:before,failedOsCode:failed.code,...committed(f,success),counts:b.counts,assertions:['real mkdir failure before atomic write','failure never ready','owned fixture repaired then retry commits']};
    });
    add('persistent corruption retry: unchanged twice, repaired fixture succeeds',async()=>{
      const f=fixture('retry-corrupt','{'),before=readHash(f.file),b=makeBoot(f);
      assert.equal((await b.bootstrap.boot()).kind,'CORRUPT');assert.equal((await b.bootstrap.boot()).kind,'CORRUPT');
      assert.equal(readHash(f.file),before);assert.equal(b.counts.writes,0);assert.equal(b.counts.reads,2);
      fs.writeFileSync(f.file,JSON.stringify(valid(f.dir)));const fixedBefore=readHash(f.file),result=await b.bootstrap.boot();
      assert.equal(b.counts.reads,3);assert.equal(b.counts.writes,1);
      return {corruptBeforeSha256:before,corruptAfterTwoRetriesSha256:before,repairedInputSha256:fixedBefore,...committed(f,result),counts:b.counts};
    });
    add('concurrent boot: one real read and one commit',async()=>{
      const f=fixture('concurrent'),gate=deferred(),entered=deferred();
      const b=makeBoot(f,{prepare:async value=>{migrateSessions(value,path.join(f.dir,'Pictures'));entered.resolve();await gate.promise;return value;}});
      const first=b.bootstrap.boot(),second=b.bootstrap.boot();assert.equal(first,second);await entered.promise;gate.resolve();
      const result=await first;assert.equal((await second).store,result.store);assert.equal(b.counts.reads,1);assert.equal(b.counts.writes,1);
      return {...committed(f,result),counts:b.counts};
    });
    add('migration exception: detached mutation cannot overwrite physical source',async()=>{
      const f=fixture('migration-failure');fs.writeFileSync(f.file,JSON.stringify(valid(f.dir)));const before=readHash(f.file);
      const b=makeBoot(f,{prepare:value=>{value.photos[0].rating=0;throw Error('controlled migration fault');}}),result=await b.bootstrap.boot();
      assert.equal(result.kind,'MIGRATION_FAILED');assert.equal(b.counts.writes,0);assert.equal(readHash(f.file),before);
      return {beforeSha256:before,afterSha256:readHash(f.file),fault:'controlled prepare exception; actual source filesystem',counts:b.counts};
    });
    add('shutdown before writer: cancelled retry has zero physical write',async()=>{
      const f=fixture('shutdown-before');fs.writeFileSync(f.file,JSON.stringify(valid(f.dir)));const before=readHash(f.file),gate=deferred(),entered=deferred();
      const b=makeBoot(f,{prepare:async value=>{migrateSessions(value,path.join(f.dir,'Pictures'));entered.resolve();await gate.promise;return value;}});
      const pending=b.bootstrap.boot();await entered.promise;b.bootstrap.dispose();gate.resolve();
      assert.equal((await pending).kind,'CANCELLED');assert.equal((await b.bootstrap.boot()).kind,'CANCELLED');assert.equal(b.counts.writes,0);assert.equal(b.bootstrap.isReady(),false);assert.equal(readHash(f.file),before);
      return {beforeSha256:before,afterSha256:readHash(f.file),counts:b.counts,gate:'controlled prepare continuation after real read'};
    });
    add('shutdown with active writer: completed file never publishes ready',async()=>{
      const f=fixture('shutdown-active'),gate=deferred(),entered=deferred();
      const b=makeBoot(f,{writeStore:async value=>{await storage.writeLibraryStore(f.file,value);entered.resolve();await gate.promise;}});
      const pending=b.bootstrap.boot();await entered.promise;b.bootstrap.dispose();gate.resolve();const result=await pending;
      assert.equal(result.kind,'CANCELLED');assert.equal(b.bootstrap.isReady(),false);assert.equal((await b.bootstrap.boot()).kind,'CANCELLED');assert.equal(JSON.parse(fs.readFileSync(f.file)).version,2);
      return {afterSha256:readHash(f.file),counts:b.counts,assertions:['physical write deliberately finishes before release','cancelled boot never publishes ready; no claim of filesystem rollback']};
    });
    add('shared boot application: partial services failure retries without duplicate storage commit',async()=>{
      const f=fixture('partial-services'),b=makeBoot(f);let store,quitting=false,first=true,inspector=false,remote=false,worker=false;
      const counts={accepted:0,attempts:0,inspector:0,remote:0,worker:0,appearance:0,public:0};
      const app=createBootApplication({bootstrap:b.bootstrap,isQuitting:()=>quitting,acceptStore:value=>{counts.accepted++;store=value;},
        initializeServices:()=>{counts.attempts++;if(!inspector){inspector=true;counts.inspector++;}if(first){first=false;throw Error('controlled service constructor failure');}if(!remote){remote=true;counts.remote++;}if(!worker){worker=true;counts.worker++;}},
        applyAppearance:()=>{counts.appearance++;},publicState:()=>{counts.public++;return {...store,bootFailure:null};},locale:()=> 'en-US'});
      assert.equal((await app()).bootFailure.kind,'RUNTIME_FAILED');assert.equal(counts.appearance,0);assert.equal(counts.public,0);
      const result=await app();assert.equal(result.bootFailure,null);assert.equal(counts.inspector,1);assert.equal(counts.remote,1);assert.equal(counts.worker,1);assert.equal(b.counts.writes,1);
      quitting=true;assert.equal((await app()).bootFailure.kind,'CANCELLED');assert.equal(counts.attempts,2);
      return {storageCounts:b.counts,serviceCounts:counts,afterSha256:readHash(f.file),assertions:['actual shared orchestration','controlled service stubs only','failure does not publish success','retry reuses committed bootstrap']};
    });
    assert.ok(cases.length<=report.resourceBudget.maxCases);
    for(let i=0;i<cases.length;i++){
      const current=cases[i],before=readHash(original);let timer;
      try{
        const detail=await Promise.race([current.run(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('T2 case deadline exceeded')),report.resourceBudget.caseDeadlineMs);})]);
        guard.assertNoUnexpected();assert.equal(readHash(original),originalExpected);
        report.results.push({name:current.name,status:'PASS',originalBeforeSha256:before,originalAfterSha256:readHash(original),...detail});console.log('PASS '+current.name);
      }catch(error){
        report.results.push({name:current.name,status:'FAIL',error:String(error.stack||error)});console.error('FAIL '+current.name+'\n'+String(error.stack||error));
        if(guard.evidence().attempts.some(attempt=>!attempt.expected)||/deadline/.test(error.message)){
          for(const remaining of cases.slice(i+1))report.results.push({name:remaining.name,status:'NOT_RUN',reason:'stop condition after forbidden attempt or deadline'});
          break;
        }
      }finally{clearTimeout(timer);}
    }
    guard.assertNoUnexpected();assert.equal(readHash(original),originalExpected);
    const files=countFiles(fixtureRoot);assert.ok(files<=report.resourceBudget.maxFixtureFiles);report.fixtureFileCount=files;
    save(report.results.some(result=>result.status!=='PASS')?1:0);
    console.log(JSON.stringify({tier:'T2',pass:report.pass,fail:report.fail,notRun:report.notRun,exitCode:report.exitCode,report:output}));process.exitCode=report.exitCode;
  }catch(error){
    report.results.push({name:'admission or suite invariant',status:'FAIL',error:String(error.stack||error)});save(1);throw error;
  }finally{finished=true;clearTimeout(deadline);}

  function countFiles(dir){let count=0;for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);assert.equal(entry.isSymbolicLink(),false);count+=entry.isDirectory()?countFiles(file):1;}return count;}
  function readHead(){
    const gitEntry=path.join(repoRoot,'.git');let gitDir=gitEntry;
    if(fs.statSync(gitEntry).isFile()){const pointer=fs.readFileSync(gitEntry,'utf8').trim();assert.match(pointer,/^gitdir: /);gitDir=path.resolve(repoRoot,pointer.slice(8));}
    const head=fs.readFileSync(path.join(gitDir,'HEAD'),'utf8').trim();if(/^[0-9a-f]{40}$/.test(head))return head;
    assert.match(head,/^ref: refs\//);const ref=head.slice(5);let common=gitDir;
    try{common=path.resolve(gitDir,fs.readFileSync(path.join(gitDir,'commondir'),'utf8').trim());}catch(error){if(error.code!=='ENOENT')throw error;}
    for(const base of [gitDir,common]){try{const value=fs.readFileSync(path.join(base,ref),'utf8').trim();assert.match(value,/^[0-9a-f]{40}$/);return value;}catch(error){if(error.code!=='ENOENT')throw error;}}
    const packed=fs.readFileSync(path.join(common,'packed-refs'),'utf8').split(/\r?\n/).find(line=>line.endsWith(' '+ref));assert.ok(packed,'HEAD ref must resolve without spawning Git');return packed.slice(0,40);
  }
}
