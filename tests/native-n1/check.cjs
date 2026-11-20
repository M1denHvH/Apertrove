'use strict';
// N1 source-only tests. Never import the worker or a native addon.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {spawnSync}=require('node:child_process');
const {root,files,sha,inspect,validate}=require('./manifest.cjs');
const fixture=path.join(root,'qa','native-n2-admission','fixtures',require('node:crypto').randomUUID());fs.mkdirSync(fixture,{recursive:true});
// Minimal parser fixture, deliberately not executable native code.
const pe=Buffer.alloc(1024);pe.write('MZ');pe.writeUInt32LE(64,60);pe.writeUInt32LE(0x4550,64);pe.writeUInt16LE(0x8664,68);pe.writeUInt16LE(1,70);pe.writeUInt16LE(240,84);pe.writeUInt16LE(0x20b,88);pe.writeUInt32LE(4096,200);pe.writeUInt32LE(512,344);pe.writeUInt32LE(4096,340);pe.writeUInt32LE(512,348);pe.writeUInt32LE(2,536);pe.writeUInt32LE(4160,544);pe.writeUInt32LE(4192,576);pe.writeUInt32LE(4224,580);pe.write('EdsInitializeSDK\0',608);pe.write('EdsTerminateSDK\0',640);
const runtime=path.join(fixture,'EDSDK.dll'),addon=path.join(fixture,'koffi.node'),reference=path.join(fixture,'reference.txt');
fs.writeFileSync(runtime,pe,{flag:'wx'});fs.writeFileSync(addon,pe,{flag:'wx'});fs.writeFileSync(reference,'Synthetic parser fixture; not vendor evidence.',{flag:'wx'});
function manifest(){return {schema:2,purpose:'N2_INIT_TERMINATE_ONLY',node:{path:process.execPath,sha256:sha(fs.readFileSync(process.execPath))},harness:Object.fromEntries(files.map(f=>[f,sha(fs.readFileSync(path.join(root,f)))])),runtime:{path:runtime,sha256:sha(pe)},koffi:{path:addon,sha256:sha(pe),version:'2.16.3',reviewed:false},dependencies:[{path:runtime,sha256:sha(pe)}],reference:{path:reference,sha256:sha(fs.readFileSync(reference))},vendorReview:{status:'UNKNOWN'},dependencyReview:{status:'UNKNOWN',dynamicObservation:'NOT_RUN'},safetyReview:{status:'UNKNOWN',runtimeObservation:'NOT_RUN'}};}
test('N2 manifest denies absent inputs before any native load',()=>{
  assert.throws(()=>validate({}),/MANIFEST_SCHEMA_DENIED/);
  assert.throws(()=>inspect('relative.dll'),/ABSOLUTE_PATH_REQUIRED/);
  assert.throws(()=>inspect(path.join(root,'package.json')),/INVALID_PE/);
});
test('Default CI scripts contain no N2 entrypoint or wildcard discovery',()=>{
  const scripts=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).scripts;
  assert.ok(!scripts.test.includes('*'));assert.ok(!Object.values(scripts).some(x=>x.includes('native-n1')));
});
test('Fresh manifests pin their generator and write outside historical N1 evidence',()=>{
  assert.ok(files.includes('tests/native-n1/prepare.cjs'));
  assert.ok(fs.readFileSync(path.join(__dirname,'prepare.cjs'),'utf8').includes("path.join(root,'qa','native-n2-admission'"));
  assert.ok(fs.readFileSync(path.join(__dirname,'run.cjs'),'utf8').includes("path.join(root,'qa','native-n2-admission','n2-runs'"));
  for(const source of ['job-supervisor.ps1','job-control.cjs','supervised-process.cjs','observe-n2.ps1'])assert.ok(files.includes('tests/native-n1/'+source));
});
test('Watchdog keeps child supervision until process close is confirmed',()=>{
  const source=fs.readFileSync(path.join(__dirname,'run.cjs'),'utf8');
  assert.ok(source.includes('superviseChild('));
  assert.ok(source.includes('supervisorHandoff'));
  assert.ok(source.indexOf("supervisor.request('assign'")<source.indexOf("child.send({nonce,manifest"));
});
test('Valid read-only identities still deny execution without vendor/dependency/effect reviews',()=>{
  const m=manifest(),r=validate(m);assert.equal(r.ready,false);assert.equal(r.blockers.length,5);
  assert.throws(()=>validate(m,{execute:true}),/N2_NOT_QUALIFIED/);
  m.runtime.sha256='0'.repeat(64);assert.throws(()=>validate(m),/RUNTIME_HASH_MISMATCH/);
});
test('Actual addon-free parent dry-run succeeds and unauthorized execution fails before spawning native child',()=>{
  const file=path.join(fixture,'manifest.json');fs.writeFileSync(file,JSON.stringify(manifest()),{flag:'wx'});
  const run=args=>spawnSync(process.execPath,['--no-addons','--max-old-space-size=192',path.join(__dirname,'run.cjs'),...args],{env:{...process.env,NODE_OPTIONS:'',NODE_PATH:''},encoding:'utf8',windowsHide:true,timeout:5000});
  const dry=run(['--dry-run','--manifest',file]);assert.equal(dry.status,0,dry.stderr);const result=JSON.parse(dry.stdout);assert.equal(result.nativeLoaded,false);assert.equal(result.ready,false);
  const unauthorized=run(['--execute','--manifest',file]);assert.equal(unauthorized.status,2);assert.match(unauthorized.stderr,/EXPLICIT_N2_AUTHORIZATION_REQUIRED/);
  // The bytes are NOT executable; these flags must still stop at vendor admission.
  const blocked=run(['--execute','--manifest',file,'--authorize-native-n2','--camera-disconnected','--canon-apps-closed','--acknowledge-canon-terms']);assert.equal(blocked.status,2);assert.match(blocked.stderr,/N2_NOT_QUALIFIED/);
});

test('Preflight decisions preserve NOT_RUN observations and pin dependency/plan evidence',()=>{
  const m=manifest(),record={path:reference,sha256:sha(fs.readFileSync(reference))};
  m.vendorReview={status:'VERIFIED_LIFECYCLE_SUBSET',initSuccessRequiresTerminate:true,initFailureMustNotTerminate:true,evidence:'Synthetic admission fixture only'};
  m.koffi.reviewed=true;
  const systemDll=path.join(process.env.SystemRoot,'System32','kernel32.dll');
  m.dependencyReview={status:'STATIC_PATHS_REVIEWED',dynamicObservation:'NOT_RUN',evidence:record,systemFiles:[{path:systemDll,sha256:sha(fs.readFileSync(systemDll))}]};
  m.safetyReview={status:'INITIALIZATION_PLAN_REVIEWED',runtimeObservation:'NOT_RUN',containment:'WINDOWS_JOB_KILL_ON_CLOSE_TESTED',evidence:record,supervisionEvidence:record};
  const r=validate(m);
  assert.equal(r.ready,true);
  assert.deepEqual(r.runtimeObservations,{dynamicDependencies:'NOT_RUN',initializationEffects:'NOT_RUN',nativeLifecycle:'NOT_RUN'});
  m.dependencyReview.systemFiles[0].sha256='0'.repeat(64);
  assert.throws(()=>validate(m),/SYSTEM_DEPENDENCY_CHANGED/);
  m.dependencyReview.systemFiles[0].sha256=sha(fs.readFileSync(systemDll));
  m.safetyReview.evidence={path:reference,sha256:'0'.repeat(64)};
  assert.ok(validate(m).blockers.includes('INITIALIZATION_PLAN_AND_CONTAINMENT_REVIEW_REQUIRED'));
  m.safetyReview.evidence=record;m.safetyReview.runtimeObservation='PASS';
  assert.equal(validate(m).ready,false);
  m.schema=1;assert.throws(()=>validate(m),/MANIFEST_SCHEMA_DENIED/);
});

test('Observation review flags untrusted module locations and unexpected effects',()=>{
  const {review}=require('./observation-review.cjs');
  const m=manifest(),dir=path.join(fixture,'observations');fs.mkdirSync(dir);
  const before={phase:'Before',runtime:{sha256:'known'},canonProcesses:{status:'SNAPSHOT',items:[]},services:{items:[{name:'CanonExample',state:'Stopped'}]},cameraDevices:{items:[]},network:{tcp:{items:[]},udp:{items:[]}},sectionErrors:[]};
  const during={atUtc:'synthetic',targetProcesses:[{pid:123,status:'VISIBLE',moduleStatus:'READ',modulesTruncated:false,modules:[{name:'outside.dll',path:path.join(dir,'outside.dll')}]}],sectionErrors:[]};
  const after={...before,phase:'After',canonProcesses:{status:'SNAPSHOT',items:[{pid:999,creationUtc:'synthetic'}]},services:{items:[{name:'CanonExample',state:'Running'}]}};
  const b=path.join(dir,'before.jsonl'),d=path.join(dir,'during.jsonl'),a=path.join(dir,'after.jsonl');
  for(const [file,value] of [[b,before],[d,during],[a,after]])fs.writeFileSync(file,JSON.stringify(value)+'\n',{flag:'wx'});
  const result=review({beforeFile:b,duringFile:d,afterFile:a,manifest:m,rootPid:123,systemRoot:process.env.SystemRoot});
  assert.equal(result.disposition,'REVIEW_REQUIRED');
  assert.ok(result.findings.includes('UNEXPECTED_MODULE_LOCATION'));
  assert.ok(result.findings.includes('PERSISTENT_NEW_CANON_PROCESS'));
  assert.ok(result.findings.includes('CANON_SERVICE_STATE_CHANGED'));
  assert.equal(result.nativeCleanup,'NOT_ESTABLISHED_BY_SNAPSHOTS');
  const trust={status:'REVIEWED_PROTECTED',signature:{status:'Valid',thumbprint:'synthetic'},paths:[{path:runtime,aclSha256:'synthetic'}]};
  before.runtimeTrust=trust;after.runtimeTrust=trust;
  before.services.items=[{name:'Removed',state:'Running'}];after.services.items=[];
  before.cameraDevices={items:[{instanceIdSha256:'removed',status:'OK'}]};after.cameraDevices={items:[]};
  during.targetProcesses=[];
  for(const [file,value] of [[b,before],[d,during],[a,after]])fs.writeFileSync(file,JSON.stringify(value)+'\n');
  const missing=review({beforeFile:b,duringFile:d,afterFile:a,manifest:m,rootPid:123,systemRoot:process.env.SystemRoot});
  assert.ok(missing.incomplete.includes('NO_READABLE_ROOT_MODULE_SAMPLE'));
  assert.ok(missing.findings.includes('CANON_SERVICE_STATE_CHANGED'));
  assert.ok(missing.findings.includes('CAMERA_DEVICE_STATE_CHANGED'));
});
test('Production SDK discovery remains byte-only and rejects x86 as x64',()=>{
  const source=fs.readFileSync(path.join(root,'electron/sdk-environment.cjs'),'utf8'),loads=[];
  const fakeFs={openSync:()=>1,closeSync:()=>{},readSync(_fd,b,_offset,n,position){if(position===0){b.write('MZ');b.writeUInt32LE(64,60);}else{b.writeUInt32LE(0x4550);b.writeUInt16LE(0x14c,4);}return n;}};
  const module={exports:{}};const sandbox={module,exports:module.exports,Buffer,process:{env:{}},require(name){loads.push(name);if(name==='node:fs')return fakeFs;if(name==='node:path')return path;if(name==='node:child_process')return {execFile(){throw Error('EXECUTION_DENIED');}};if(name==='node:util')return {promisify:fn=>fn};throw Error('IMPORT_DENIED');}};
  vm.runInNewContext(source,sandbox,{timeout:1000});
  assert.equal(module.exports.peArchitecture('fixture'),'x86');
  assert.ok(!loads.includes('koffi'));
});
test('PE parser rejects x86 and dependency byte changes',()=>{
  const x86=Buffer.from(pe);x86.writeUInt16LE(0x14c,68);const file=path.join(fixture,'x86.bin');fs.writeFileSync(file,x86,{flag:'wx'});assert.throws(()=>inspect(file),/X64_PE_REQUIRED/);
  const m=manifest();m.dependencies[0].sha256='0'.repeat(64);assert.throws(()=>validate(m),/DEPENDENCY_IDENTITY_MISMATCH/);
});
test('PE export directory can legitimately contain no named exports',()=>{
  const empty=Buffer.from(pe);empty.writeUInt32LE(0,536);empty.writeUInt32LE(0,544);
  const file=path.join(fixture,'no-named-exports.bin');fs.writeFileSync(file,empty,{flag:'wx'});
  assert.deepEqual(inspect(file).exports,[]);
});
test('Actual worker directory binding preserves full Win32 BOOL nonzero semantics',()=>{
  const source=fs.readFileSync(path.join(root,'electron/camera-worker.cjs'),'utf8');
  const start=source.indexOf('function loadCandidate(file) {'),end=source.indexOf('  if(!com){',start);
  assert.ok(start>=0&&end>start);const body=source.slice(start,end)+'\n}';
  for(const result of [0,1,256,-1]){
    let signature;const context=vm.createContext({nativeStarted:false,dllDirectory:null,path,koffi:{load:()=>({func:s=>{signature=s;return()=>result;}})}});
    vm.runInContext(body,context,{timeout:1000});
    if(result===0)assert.throws(()=>context.loadCandidate('fixture.dll'),/Windows/);else context.loadCandidate('fixture.dll');
    assert.equal(signature,'int32 __stdcall SetDllDirectoryW(str16 path)');assert.equal(context.dllDirectory('fixture'),result!==0);
  }
});
