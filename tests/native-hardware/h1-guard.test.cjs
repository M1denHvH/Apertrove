'use strict';
// Entirely synthetic invocation tests: never imports Koffi, Electron or Canon.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createGuard,allowed}=require('./h1-guard.cjs');
function fixture({throwName=null,tracePath=null}={}){
  const calls=[],runtimePath=path.resolve('synthetic','EDSDK.dll');let callback;
  const koffi={load:file=>({func:(...signature)=>{const name=signature.length===1?signature[0].match(/([A-Za-z_]\w*)\s*\(/)[1]:signature[1];return(...args)=>{calls.push({file,name,args});if(name===throwName)throw Error('synthetic native binding exception');if(name==='EdsGetChildAtIndex')args[2][0]=Object.freeze({opaqueSynthetic:true});return name==='EdsGetPropertyDesc'?0x50:0;};},unload:()=>calls.push({unload:file})}),register:fn=>{callback=fn;return Object.freeze({trampoline:true});},unregister:()=>{}};
  const guard=createGuard({koffi,runtimePath,tracePath});return {guard,calls,runtimePath,deliver:()=>callback()};
}
test('H1 binds optional exports but denies every mutating invocation before the real function',()=>{
  const {guard,calls,runtimePath}=fixture(),lib=guard.koffi.load(runtimePath);
  for(const name of ['EdsSetPropertyData','EdsSetCapacity','EdsSendCommand','EdsSetObjectEventHandler','EdsSetPropertyEventHandler','EdsSetCameraStateEventHandler','EdsDownloadCancel','EdsDownload','EdsDownloadComplete','EdsCreateEvfImageRef','EdsDownloadEvfImage','EdsGetDirectoryItemInfo','EdsGetVolumeInfo'])assert.throws(()=>lib.func('__stdcall',name,'uint32',[])(),/H1_NATIVE_DENIED/);
  assert.equal(calls.length,0);assert.equal(guard.evidence().denials.length,13);assert.ok(allowed.includes('EdsGetPropertyData'));
});
test('H1 passes the exact opaque output and original call arguments without pointer coercion',()=>{
  const {guard,calls,runtimePath}=fixture(),lib=guard.koffi.load(runtimePath),parent=Object.freeze({opaqueParent:true}),out=[null];
  assert.equal(lib.func('__stdcall','EdsGetChildAtIndex','uint32',[])(parent,0,out),0);
  assert.equal(calls[0].args[0],parent);assert.equal(calls[0].args[2],out);assert.deepEqual(out[0],{opaqueSynthetic:true});
  assert.equal(lib.func('__stdcall','EdsRelease','uint32',[])(out[0]),0);assert.equal(calls[1].args[0],out[0]);
});
test('H1 enforces a single init/open/close/terminate cycle and retains raw property errors',()=>{
  const {guard,calls,runtimePath}=fixture(),lib=guard.koffi.load(runtimePath);
  for(const name of ['EdsInitializeSDK','EdsOpenSession','EdsCloseSession','EdsTerminateSDK']){const fn=lib.func('__stdcall',name,'uint32',[]);assert.equal(fn(null),0);assert.throws(()=>fn(null),/single-cycle budget/);}
  assert.equal(lib.func('__stdcall','EdsGetPropertyDesc','uint32',[])(null,1,{}),0x50);assert.equal(calls.length,5);
});
test('H1 blocks alternate DLL, native memcpy, unknown pointer primitives and delivered callbacks',()=>{
  const {guard,calls,runtimePath,deliver}=fixture();assert.throws(()=>guard.koffi.load(path.resolve('alternate','EDSDK.dll')),/library load/);
  const crt=guard.koffi.load('msvcrt.dll');assert.throws(()=>crt.func('void *memcpy(void *dest, const void *src, size_t count)')(null,null,10),/system invocation/);
  assert.throws(()=>guard.koffi.call(),/unadmitted Koffi primitive/);guard.koffi.register(()=>{},{});assert.throws(deliver,/unexpected callback delivery/);assert.equal(calls.length,0);
});
test('H1 rejects oversized property buffers and mismatched STA or dependency search paths',()=>{
  const {guard,calls,runtimePath}=fixture(),lib=guard.koffi.load(runtimePath),fn=lib.func('__stdcall','EdsGetPropertyData','uint32',[]);
  assert.throws(()=>fn(null,1,0,300000,Buffer.alloc(1)),/property output bound/);assert.throws(()=>fn(null,1,0,4,Buffer.alloc(8)),/property output bound/);
  assert.equal(fn(null,1,0,4,Buffer.alloc(4)),0);
  assert.throws(()=>guard.koffi.load('ole32.dll').func('int32 __stdcall CoInitializeEx(void *reserved, uint32 flags)')(null,0),/COM apartment/);
  assert.throws(()=>guard.koffi.load('kernel32.dll').func('int32 __stdcall SetDllDirectoryW(str16 path)')(path.resolve('alternate')),/DLL search directory/);assert.equal(calls.length,1);
});
test('H1 retains a thrown binding call as an explicit trace exception without inventing a return code',t=>{
  const fs=require('node:fs'),os=require('node:os'),folder=fs.mkdtempSync(path.join(os.tmpdir(),'apertrove-h1-fence-')),tracePath=path.join(folder,'trace.jsonl');
  t.after(()=>{fs.unlinkSync(tracePath);fs.rmdirSync(folder);});
  const {guard,runtimePath}=fixture({throwName:'EdsGetPropertyData',tracePath}),fn=guard.koffi.load(runtimePath).func('__stdcall','EdsGetPropertyData','uint32',[]);
  assert.throws(()=>fn(null,1,0,4,Buffer.alloc(4)),/synthetic native binding exception/);
  const rows=fs.readFileSync(tracePath,'utf8').trim().split('\n').map(JSON.parse).filter(row=>row.name==='EdsGetPropertyData');
  assert.deepEqual(rows.map(row=>row.phase),['before','throw']);assert.equal(Object.hasOwn(rows[1],'result'),false);
});

function entryFixture({grantAfterMs=40,grantPatch={},sourceChanged=false,startupPids=[]}={}){
  const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto'),{EventEmitter}=require('node:events');
  const entry=path.join(__dirname,'h1-entry.cjs'),root=path.resolve(__dirname,'../..'),output=path.join(root,'qa/native-hardware/h1-runs/synthetic-vm'),configPath=path.join(output,'config.json'),gate=path.join(output,'grant.json'),nonce='a'.repeat(48),calls=[],writes=new Map();
  let now=0,mainLoaded=false;const content=Buffer.from('synthetic pinned source');
  const config={nonce,kind:'H1_REAL_ELECTRON_READ_ONLY',output,gate,sourceHashes:{'electron/main.cjs':crypto.createHash('sha256').update(content).digest('hex')}};
  const grant={nonce,pid:123,jobAssigned:true,jobPids:[123],...grantPatch};
  const fakeFs={mkdirSync:file=>calls.push(['mkdir',file]),existsSync:file=>file===gate&&now>=grantAfterMs,writeFileSync:(file,value)=>{writes.set(path.basename(file),String(value));calls.push(['write',path.basename(file)]);},readFileSync:file=>{if(file===configPath)return JSON.stringify(config);if(file===gate)return JSON.stringify(grant);if(file===path.join(root,'electron/main.cjs'))return sourceChanged?Buffer.from('changed'):content;throw Error('UNEXPECTED_VM_READ: '+file);}};
  const app=new EventEmitter();Object.assign(app,{setPath:(key,value)=>calls.push(['setPath',key,value]),setAppPath:value=>calls.push(['setAppPath',value]),setAppLogsPath:value=>calls.push(['setAppLogsPath',value]),getPath:()=>output,isReady:()=>startupPids.length>0,getAppMetrics:()=>startupPids.map(pid=>({pid,type:'synthetic'})),exit:code=>{throw Object.assign(Error('VM_EXIT_'+code),{exitCode:code});}});
  const electron={app,utilityProcess:{fork:()=>{throw Error('SYNTHETIC_WORKER_DENIED');}},ipcMain:{handle:()=>{}},session:{},shell:{},dialog:{}};
  const processStub={argv:['electron',entry,'--h1-config='+configPath,'--h1-nonce='+nonce],env:{FOCAL_TEST_DATA:path.join(output,'profile'),NODE_OPTIONS:'',NODE_PATH:''},pid:123,ppid:456,versions:{electron:'synthetic'},on:()=>{}};
  const sandbox={__dirname,__filename:entry,process:processStub,URL,Int32Array,SharedArrayBuffer,Date:class extends Date{static now(){return now;}},Atomics:{wait:(_array,_index,_value,ms)=>{assert.equal(mainLoaded,false);assert.ok(calls.some(row=>row[0]==='write'&&row[1]==='entry-ready.json'));now+=ms;}},setInterval:()=>{throw Error('ASYNC_GATE_DENIED');},setTimeout:()=>({unref:()=>{}}),require:request=>{if(request==='node:fs')return fakeFs;if(request==='node:path')return path;if(request==='node:crypto')return crypto;if(request==='electron')return electron;if(request==='../../electron/main.cjs'){assert.ok(now>=grantAfterMs);assert.ok(now<15000);mainLoaded=true;calls.push(['main']);return {};}throw Error('UNEXPECTED_VM_IMPORT: '+request);}};
  let error=null;try{vm.runInNewContext(fs.readFileSync(entry,'utf8'),sandbox,{filename:entry,timeout:1000});}catch(value){error=value;}
  return {error,mainLoaded,now,calls,writes,output};
}
test('H1 entry sets confined Electron paths and synchronously waits for Job grant before main',()=>{
  const f=entryFixture();assert.equal(f.error,null);assert.equal(f.mainLoaded,true);assert.equal(f.now,40);
  const paths=f.calls.filter(row=>row[0]==='setPath');assert.equal(paths.length,5);for(const [,key,value]of paths){assert.ok(!path.relative(f.output,value).startsWith('..'),key);assert.ok(f.calls.indexOf(paths.find(row=>row[1]===key))<f.calls.findIndex(row=>row[0]==='write'&&row[1]==='entry-ready.json'));}
  assert.ok(f.calls.findIndex(row=>row[0]==='setAppLogsPath')<f.calls.findIndex(row=>row[0]==='main'));
});
test('H1 entry denies invalid nonce/source, uncontained startup child and missing Job grant',()=>{
  for(const [options,detail]of [[{grantPatch:{nonce:'b'.repeat(48)}},'H1_GATE_INVALID'],[{sourceChanged:true},'H1_ENTRY_SOURCE_CHANGED'],[{startupPids:[123,999]},'H1_STARTUP_CHILD_NOT_IN_JOB']]){const f=entryFixture(options);assert.equal(f.mainLoaded,false);assert.equal(f.error.exitCode,98);assert.match(f.writes.get('bootstrap-error.json'),new RegExp(detail));}
  const timeout=entryFixture({grantAfterMs:Infinity});assert.equal(timeout.mainLoaded,false);assert.equal(timeout.now,15000);assert.equal(timeout.error.exitCode,96);
});
