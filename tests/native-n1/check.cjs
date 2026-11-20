'use strict';
// N1 source-only tests. Never import the worker or a native addon.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {spawnSync}=require('node:child_process');
const {root,files,sha,inspect,validate}=require('./manifest.cjs');
const fixture=path.join(root,'qa','native-n1','fixtures',require('node:crypto').randomUUID());fs.mkdirSync(fixture,{recursive:true});
// Minimal parser fixture, deliberately not executable native code.
const pe=Buffer.alloc(1024);pe.write('MZ');pe.writeUInt32LE(64,60);pe.writeUInt32LE(0x4550,64);pe.writeUInt16LE(0x8664,68);pe.writeUInt16LE(1,70);pe.writeUInt16LE(240,84);pe.writeUInt16LE(0x20b,88);pe.writeUInt32LE(4096,200);pe.writeUInt32LE(512,344);pe.writeUInt32LE(4096,340);pe.writeUInt32LE(512,348);pe.writeUInt32LE(2,536);pe.writeUInt32LE(4160,544);pe.writeUInt32LE(4192,576);pe.writeUInt32LE(4224,580);pe.write('EdsInitializeSDK\0',608);pe.write('EdsTerminateSDK\0',640);
const runtime=path.join(fixture,'EDSDK.dll'),addon=path.join(fixture,'koffi.node'),reference=path.join(fixture,'reference.txt');
fs.writeFileSync(runtime,pe,{flag:'wx'});fs.writeFileSync(addon,pe,{flag:'wx'});fs.writeFileSync(reference,'Synthetic parser fixture; not vendor evidence.',{flag:'wx'});
function manifest(){return {schema:1,purpose:'N2_INIT_TERMINATE_ONLY',node:{path:process.execPath,sha256:sha(fs.readFileSync(process.execPath))},harness:Object.fromEntries(files.map(f=>[f,sha(fs.readFileSync(path.join(root,f)))])),runtime:{path:runtime,sha256:sha(pe)},koffi:{path:addon,sha256:sha(pe),version:'2.16.3',reviewed:false},dependencies:[{path:runtime,sha256:sha(pe)}],reference:{path:reference,sha256:sha(fs.readFileSync(reference))},vendorReview:{status:'UNKNOWN'},dependencyReview:{status:'UNKNOWN'},safetyReview:{initializationEffectsReviewed:false}};}
test('N2 manifest denies absent inputs before any native load',()=>{
  assert.throws(()=>validate({}),/MANIFEST_SCHEMA_DENIED/);
  assert.throws(()=>inspect('relative.dll'),/ABSOLUTE_PATH_REQUIRED/);
  assert.throws(()=>inspect(path.join(root,'package.json')),/INVALID_PE/);
});
test('Default CI scripts contain no N2 entrypoint or wildcard discovery',()=>{
  const scripts=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).scripts;
  assert.ok(!scripts.test.includes('*'));assert.ok(!Object.values(scripts).some(x=>x.includes('native-n1')));
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
  const blocked=run(['--execute','--manifest',file,'--authorize-native-n2','--camera-disconnected']);assert.equal(blocked.status,2);assert.match(blocked.stderr,/N2_NOT_QUALIFIED/);
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
