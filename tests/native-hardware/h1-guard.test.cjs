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
