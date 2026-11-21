'use strict';
// All native symbols below are JavaScript fakes; VM supplies opaque pointer predicates.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function fixture(){
  const pointers=new WeakSet(),ptr=()=>{const p={opaque:true};pointers.add(p);return p;},calls=[],values=new Map([[0x402,88],[0x405,80],[0x406,123],[0x500,0],[0x501,0],[0xb,2]]);
  let control={nonce:'test',ticket:0,phase:'snapshot'},busy=null,throwName=null;const runtimePath=path.resolve('synthetic/EDSDK.dll');
  const koffi={load:file=>({unload:()=>{},func:(...signature)=>{const name=signature.length===1?signature[0].match(/([A-Za-z_]\w*)\s*\(/)[1]:signature[1];return(...args)=>{calls.push({name,args});if(name===throwName)throw Error('synthetic binding throw');if(name===busy)return 0x81;if(name==='EdsGetPropertyData')args[4].writeUInt32LE(values.get(args[1])??0);if(name==='EdsGetPropertyDesc')Object.assign(args[2],{form:0,access:0,count:3,values:[80,88,96]});if(['EdsGetCameraList','EdsGetChildAtIndex'].includes(name))args.at(-1)[0]=ptr();if(['EdsCreateMemoryStream','EdsCreateEvfImageRef','EdsGetPointer'].includes(name))args[1][0]=ptr();if(name==='EdsGetLength'||name==='EdsGetPosition')args[1][0]=100n;return 0;};}}),register:fn=>fn,unregister:()=>{}};
  const sandbox={module:{exports:{}},require:name=>name==='node:util'?{types:{isExternal:value=>pointers.has(value)}}:require(name),process,Buffer,Date,Map,Set,WeakMap,Proxy};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'h2-guard.cjs'),'utf8'),sandbox);
  const guard=sandbox.module.exports.createGuard({koffi,runtimePath,nonce:'test',readControl:()=>control});
  const lib=guard.koffi.load(runtimePath),fn=name=>lib.func('__stdcall',name,'uint32',[]),get=id=>{const b=Buffer.alloc(4);fn('EdsGetPropertyData')(null,id,0,4,b);return b.readUInt32LE();},desc=id=>fn('EdsGetPropertyDesc')(null,id,{}),write=(id,value)=>{const b=Buffer.alloc(4);b.writeUInt32LE(value);return fn('EdsSetPropertyData')(null,id,0,4,b);};
  let camera;const activate=()=>{const l=[null],c=[null];fn('EdsGetCameraList')(l);fn('EdsGetChildAtIndex')(l[0],0,c);camera=c[0];fn('EdsOpenSession')(camera);for(const [id,value]of [[0x500,2],[0x501,1],[0x416,1],[0x404,0]]){values.set(id,value);get(id);}return camera;};
  return {guard,calls,fn,get,desc,write,activate,phase:(phase,extra={})=>{control={nonce:'test',ticket:control.ticket+1,phase,...extra};},busy:name=>{busy=name;},throws:name=>{throwName=name;}};
}
test('H2 mutation fence rejects shutter, SaveTo, Capacity, camera file download, handlers and FocusInfo',()=>{
  for(const action of [f=>f.fn('EdsSendCommand')(null,4,1),f=>{f.phase('exposure',{write:{id:0xb,value:3}});f.write(0xb,3);},f=>f.fn('EdsSetCapacity')(),f=>f.fn('EdsDownload')(),f=>f.fn('EdsDownloadCancel')(),f=>f.fn('EdsSetObjectEventHandler')(),f=>f.fn('EdsGetPropertySize')(null,0x104,0,[0],[0])]){const f=fixture();assert.throws(()=>action(f),/H2_NATIVE_DENIED/);assert.equal(f.calls.length,0);}
});
test('H2 exposure requires observed descriptor alternative and restoration exactly to initial scalar',()=>{
  const f=fixture();assert.equal(f.get(0x402),88);f.desc(0x402);f.phase('exposure',{write:{id:0x402,value:96}});assert.equal(f.write(0x402,96),0);f.phase('restore',{write:{id:0x402,value:88}});assert.equal(f.write(0x402,88),0);
  const bad=fixture();bad.get(0x402);bad.desc(0x402);bad.phase('exposure',{write:{id:0x402,value:0x999}});assert.throws(()=>bad.write(0x402,0x999),/descriptor target/);
  const restore=fixture();restore.get(0x402);restore.phase('restore',{write:{id:0x402,value:96}});assert.throws(()=>restore.write(0x402,96),/restore must equal original/);
});
test('H2 permits one AF on/off and one small near/far step; rejects repetition and off before on',()=>{
  const f=fixture(),camera=f.activate();f.phase('af');assert.equal(f.fn('EdsSendCommand')(camera,0x102,1),0);assert.equal(f.fn('EdsSendCommand')(camera,0x102,0),0);f.phase('lens',{direction:'near'});assert.equal(f.fn('EdsSendCommand')(camera,0x103,1),0);f.phase('lens',{direction:'far'});assert.equal(f.fn('EdsSendCommand')(camera,0x103,0x8001),0);f.phase('af');assert.throws(()=>f.fn('EdsSendCommand')(camera,0x102,1),/one AF/);
  const bad=fixture(),badCamera=bad.activate();bad.phase('af');assert.throws(()=>bad.fn('EdsSendCommand')(badCamera,0x102,0),/one AF/);
});
function frame(f){const s=[null],im=[null],p=[null],position=[0],length=[0];f.fn('EdsCreateMemoryStream')(2*1024*1024,s);f.fn('EdsCreateEvfImageRef')(s[0],im);f.phase('live');f.fn('EdsSeek')(s[0],0,0);f.fn('EdsDownloadEvfImage')(null,im[0]);f.fn('EdsGetPointer')(s[0],p);f.fn('EdsGetPosition')(s[0],position);return {s,im,p,position,length};}
test('H2 memcpy requires fresh EVF pointer AND actual stream length; borrowed pointer copied once',()=>{
  const f=fixture(),v=frame(f),copy=f.guard.koffi.load('msvcrt.dll').func('void *memcpy(void *dest, const void *src, size_t count)');f.fn('EdsGetLength')(v.s[0],v.length);assert.equal(copy(Buffer.alloc(100),v.p[0],100),0);assert.throws(()=>copy(Buffer.alloc(100),v.p[0],100),/bounds\/freshness/);
  const noLength=fixture(),n=frame(noLength);assert.throws(()=>noLength.guard.koffi.load('msvcrt.dll').func('void *memcpy(void *dest, const void *src, size_t count)')(Buffer.alloc(100),n.p[0],100),/bounds\/freshness/);
  const between=fixture();frame(between);assert.throws(()=>between.get(0x402),/between pointer and copy/);
});
test('H2 BUSY stops subsequent mutations, retaining raw native result and permitting shutdown',()=>{
  const f=fixture();f.busy('EdsGetEvent');assert.throws(()=>f.fn('EdsGetEvent')(),/H2_NATIVE_STOP/);assert.equal(f.guard.evidence().stopped,true);assert.throws(()=>f.get(0x402),/stopped series/);assert.equal(f.fn('EdsTerminateSDK')(),0);
});
test('H2 binding exception stops series but permits precisely one owed AF OFF without retry',()=>{
  const f=fixture(),camera=f.activate();f.phase('af');f.throws('EdsSendCommand');assert.throws(()=>f.fn('EdsSendCommand')(camera,0x102,1),/synthetic binding throw/);f.throws(null);assert.equal(f.fn('EdsSendCommand')(camera,0x102,0),0);assert.throws(()=>f.fn('EdsSendCommand')(camera,0x102,0),/stopped series/);assert.equal(f.guard.evidence().counts.AF_OFF,1);
});
test('H2 new tickets cannot repeat exposure or restoration for a property',()=>{
  const f=fixture();f.get(0x402);f.desc(0x402);f.phase('exposure',{write:{id:0x402,value:96}});f.write(0x402,96);f.phase('exposure',{write:{id:0x402,value:80}});assert.throws(()=>f.write(0x402,80),/one exposure\/restore attempt/);
});
test('H2 rejects a different SDK camera model before any property or Live View mutation',async()=>{
  const calls=[],camera={connected:true,working:true,controlsOnly:true,model:'Different Canon camera',saveTo:null,eventsRegistered:false,capabilities:{capture:false}},files=new Map();
  const fakeFs={existsSync:()=>false,writeFileSync:(file,value)=>files.set(file,value),renameSync:(from,to)=>{files.set(to,files.get(from));files.delete(from);},readFileSync:()=>''};
  const sandbox={module:{exports:{}},require:name=>name==='node:fs'?fakeFs:require(name),setTimeout};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'h2-stages.cjs'),'utf8'),sandbox);
  const result=await sandbox.module.exports.runStages({app:{},page:{evaluate:async(_fn,{method})=>{calls.push(method);if(method==='boot')return {camera};if(method==='cameraWorking')return camera;if(method==='disconnect')return {connected:false};throw Error('UNEXPECTED_MUTATION: '+method);}},output:path.resolve('synthetic'),nonce:'test',controlPath:path.resolve('synthetic/control.json'),record:()=>{}});
  assert.match(result.error,/H2_EXACT_CAMERA_MODEL_REQUIRED/);assert.notEqual(result.completed,true);
  assert.deepEqual(calls,['cameraWorking','boot','disconnect']);
});
