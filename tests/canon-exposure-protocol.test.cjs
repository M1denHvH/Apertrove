const {test}=require('node:test'),assert=require('node:assert/strict');
const {profileByFingerprint,createCanonBulbAdapter,bulbExposureSeconds,createFlashPopupControl}=require('../electron/canon-exposure-protocol.cjs');
const {createBulbControl}=require('../electron/bulb-control.cjs');
const fingerprint={sha256:'35c5fd7564cf8eee3bc41004a0ab21d96caccb36ea1a1ddb512caf7b1c046627',architecture:'x64',version:'3.18.40.0'};
const profile=profileByFingerprint(fingerprint);
function bulbRig(route='dedicated',overrides={}){
  const calls=[];
  const adapter=createCanonBulbAdapter({profile,route,cameraQualified:true,io:{ensure:()=>calls.push('ensure'),sendCommand:async(id,parameter)=>{calls.push(['command',id,parameter]);return 0;},sendStatus:async(id,parameter)=>{calls.push(['status',id,parameter]);return 0;},...overrides}});
  return {calls,adapter,control:createBulbControl(adapter)};
}
test('only the verified x64 runtime fingerprint admits the statically proven protocol',()=>{
  assert.ok(profile);assert.equal(Object.isFrozen(profile),true);assert.equal(Object.isFrozen(profile.command),true);
  for(const change of [{sha256:'0'.repeat(64)},{architecture:'x86'},{version:'3.18.50.0'},{version:undefined}])assert.equal(profileByFingerprint({...fingerprint,...change}),null);
  assert.equal(profileByFingerprint({...fingerprint,sha256:fingerprint.sha256.toUpperCase()}),profile);
});
test('BULB adapter requires separately qualified camera routing and exact native ports before dispatch',async()=>{
  let count=0;
  for(const options of [{profile:null,route:'dedicated',cameraQualified:true},{profile:{...profile},route:'dedicated',cameraQualified:true},{profile,route:'guess',cameraQualified:true},{profile,route:'dedicated',cameraQualified:false}]){
    const adapter=createCanonBulbAdapter({...options,io:{ensure:()=>count++,sendCommand:()=>count++,sendStatus:()=>count++}});
    assert.equal(adapter.qualified,false);await assert.rejects(createBulbControl(adapter).start(),error=>error.code==='BULB_PROTOCOL_UNQUALIFIED');
  }
  assert.equal(count,0);
});
test('dedicated BULB maps real start/end, lock/unlock and camera exposure events through the existing lifecycle',async()=>{
  const r=bulbRig();await r.control.start();assert.equal(r.control.snapshot().status,'exposing');assert.equal(r.adapter.eventId,0x310);
  assert.equal(r.control.snapshot().elapsedSeconds,null);assert.equal(r.control.event(bulbExposureSeconds(0x310,4)),true);assert.equal(r.control.snapshot().elapsedSeconds,4);
  await r.control.stop();assert.deepEqual(r.calls,['ensure',['status',0,0],['command',2,0],['command',3,0],['status',1,0]]);
  assert.equal(r.control.snapshot().status,'idle');await r.control.stop();assert.equal(r.calls.length,5);
});
test('the independently selected Canon press-shutter BULB route uses held full/off, with explicit AF choice',async()=>{
  for(const autofocus of [false,true]){const r=bulbRig('press-shutter');await r.control.start({autofocus});await r.control.stop();assert.deepEqual(r.calls,['ensure',['status',0,0],['command',4,autofocus?3:0x10003],['command',4,0],['status',1,0]]);}
});
test('camera event decoder accepts only the proven event and unsigned 32-bit seconds',()=>{
  for(const value of [0,5,0xffffffff])assert.equal(bulbExposureSeconds(0x310,value),value);
  for(const [event,value]of [[0x311,5],[0x310,-1],[0x310,0x100000000],[0x310,1.5],[0x310,NaN],[0x310,'5']])assert.equal(bulbExposureSeconds(event,value),null);
});
test('failed dedicated start attempts end and unlock; end failure remains unknown after unlock',async()=>{
  const calls=[];const startFailure=bulbRig('dedicated',{sendCommand:async(id,parameter)=>{calls.push([id,parameter]);return id===2?0x81:0;}});
  await assert.rejects(startFailure.control.start(),error=>error.code===0x81);assert.deepEqual(calls,[[2,0],[3,0]]);assert.equal(startFailure.calls.at(-1)[1],1);assert.equal(startFailure.control.isBusy(),false);
  const failedEnd=bulbRig('dedicated',{sendCommand:async id=>id===3?0x81:0});await failedEnd.control.start();await assert.rejects(failedEnd.control.stop());assert.equal(failedEnd.calls.at(-1)[1],1);assert.equal(failedEnd.control.snapshot().confirmation,'unknown');assert.equal(failedEnd.control.isBusy(),true);
});
test('adapter cleanup remains callable after a start-only mode guard changes',async()=>{
  let allowed=true;const r=bulbRig('dedicated',{ensure:()=>{if(!allowed)throw Error('wrong mode');}});await r.control.start();allowed=false;await r.control.stop();assert.equal(r.control.snapshot().status,'idle');
  await assert.rejects(r.control.start(),/wrong mode/);assert.equal(r.calls.filter(item=>item[0]==='command').length,2);
});
function flashRig(overrides={},options={}){
  const calls=[];const io={ensure:()=>calls.push('ensure'),sendCommand:async(id,parameter)=>{calls.push([id,parameter]);return 0;},...overrides};
  const controller=createFlashPopupControl({profile,cameraQualified:true,io,...options});return {controller,calls,io};
}
test('qualified flash popup dispatches exact command106/0 and reports acceptance without claiming mechanical success',async()=>{
  const r=flashRig();const result=await r.controller.popup();assert.deepEqual(r.calls,['ensure',[0x106,0]]);assert.equal(result.accepted,true);assert.equal(result.raised,null);assert.equal(result.confirmation,'command-accepted');assert.equal(r.controller.isBusy(),false);
});
test('unqualified flash runtime or camera never calls a native port',async()=>{
  for(const options of [{profile:null},{cameraQualified:false},{profile:{...profile}}]){const r=flashRig({},options);assert.equal(r.controller.snapshot().available,false);await assert.rejects(r.controller.popup(),error=>error.code==='FLASH_POPUP_PROTOCOL_UNQUALIFIED');assert.deepEqual(r.calls,[]);}
});
test('flash rejection for capture, BULB, Servo or disconnect changes no state and never cycles Live View',async()=>{
  for(const reason of ['capture','bulb','servo','disconnect']){let live=true;const r=flashRig({ensure:()=>{throw Error(reason);},stopLive:()=>live=false,startLive:()=>live=true});const previous=r.controller.snapshot();await assert.rejects(r.controller.popup(),new RegExp(reason));assert.deepEqual(r.controller.snapshot(),previous);assert.deepEqual(r.calls,[]);assert.equal(live,true);}
});
test('unsupported flash response disables only this session feature; busy is retryable',async()=>{
  for(const code of [1,7,0x2005]){const r=flashRig({sendCommand:()=>code});await assert.rejects(r.controller.popup(),error=>error.code===code);assert.equal(r.controller.snapshot().available,false);assert.equal(r.controller.snapshot().confirmation,'command-rejected');assert.equal(r.controller.snapshot().raised,null);await assert.rejects(r.controller.popup());assert.equal(r.calls.length,1);}
  let first=true;const busy=flashRig({sendCommand:()=>{if(first){first=false;return 0x81;}return 0;}});await assert.rejects(busy.controller.popup(),error=>error.code===0x81);assert.equal(busy.controller.snapshot().available,true);assert.equal((await busy.controller.popup()).accepted,true);
});
test('native exceptions and malformed flash results remain unknown and never report raised',async()=>{
  for(const outcome of [()=>undefined,()=>-1,()=>0x100000000,()=>{throw Error('binding exception');}]){let unknown=0;const r=flashRig({sendCommand:outcome,onUnknown:()=>unknown++});await assert.rejects(r.controller.popup());assert.equal(unknown,1);assert.equal(r.controller.snapshot().confirmation,'unknown');assert.equal(r.controller.snapshot().raised,null);assert.equal(r.controller.snapshot().accepted,false);}
});
test('only one flash command may be pending; no duplicate command is dispatched',async()=>{
  let finish;const calls=[],r=flashRig({sendCommand:(...args)=>{calls.push(args);return new Promise(resolve=>finish=resolve);}});const first=r.controller.popup();assert.equal(r.controller.isBusy(),true);await assert.rejects(r.controller.popup(),error=>error.code==='OPERATION_BUSY');assert.equal(calls.length,1);finish(0);await first;assert.equal(r.controller.isBusy(),false);
});
test('disconnect invalidates a delayed flash completion; a new session needs a fresh qualified controller',async()=>{
  let finish;const r=flashRig({sendCommand:()=>new Promise(resolve=>finish=resolve)}),pending=r.controller.popup();
  r.controller.disconnected();finish(0);await assert.rejects(pending,error=>error.code==='OPERATION_STALE_SESSION');
  assert.equal(r.controller.snapshot().accepted,false);assert.equal(r.controller.snapshot().status,'disconnected');assert.equal(r.controller.snapshot().available,false);assert.equal(r.controller.snapshot().confirmation,'unknown');await assert.rejects(r.controller.popup());
  const fresh=flashRig();assert.equal((await fresh.controller.popup()).accepted,true);
});
