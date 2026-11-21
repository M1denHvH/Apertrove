const {test}=require('node:test'),assert=require('node:assert/strict');
const {createServoFocus}=require('../electron/servo-focus.cjs');
const {createCameraControl}=require('../electron/camera-control.cjs');
function rig(overrides={}){
  let mode=0,connected=true;const commands=[],writes=[],states=[];
  const io={ensure(){if(!connected)throw Error('disconnected');},get:()=>mode,set:(_id,value)=>{writes.push(value);mode=value;},
    refresh:()=>({properties:{afMode:{value:mode,writable:true,allowed:[0,1,2]}}}),isLive:()=>false,isCapturing:()=>false,canFocus:()=>true,
    command:(id,param)=>commands.push([id,param]),onState:s=>states.push(s),...overrides};
  return {control:createServoFocus(io),io,commands,writes,states,mode:()=>mode,changeMode:v=>mode=v,disconnect:()=>{connected=false;}};
}
test('AI Servo selects verified mode and holds AF without waiting for a focus result',()=>{
  const r=rig({focusState:()=>{throw Error('must not wait for acquisition');}});
  const result=r.control.set({enabled:true});assert.equal(result.enabled,true);assert.equal(result.trackingConfirmed,false);assert.equal(result.confirmation,'command-accepted');
  assert.deepEqual(r.commands,[[4,1]]);assert.deepEqual(r.writes,[1]);assert.equal(r.control.isBusy(),true);
  assert.equal(r.control.set({enabled:true}).enabled,true);assert.equal(r.commands.length,1);
  assert.equal(r.control.set({enabled:false}).enabled,false);assert.equal(r.mode(),0);assert.deepEqual(r.commands,[[4,1],[4,0]]);
  r.control.stop();assert.equal(r.commands.length,2);
});
test('live Servo uses the live AF command and keeps optical tracking unconfirmed',()=>{
  const r=rig({isLive:()=>true});r.changeMode(1);r.control.set({enabled:true});r.control.stop();assert.deepEqual(r.commands,[[0x102,1],[0x102,0]]);assert.deepEqual(r.writes,[]);
});
test('Servo validates descriptors and readback before starting a command',()=>{
  const unavailable=rig({refresh:()=>({properties:{afMode:{writable:false,allowed:[0]}}})});assert.throws(()=>unavailable.control.set({enabled:true}),/недоступен/);assert.deepEqual(unavailable.commands,[]);
  const stale=rig({get:()=>0});assert.throws(()=>stale.control.set({enabled:true}),/не подтвердила/);assert.deepEqual(stale.commands,[]);assert.equal(stale.control.isBusy(),false);
});
test('MF, capture, invalid input and a stopped restricted Live View reject before dispatch',()=>{
  for(const override of [{canFocus:()=>false},{isCapturing:()=>true},{requiresLiveFocus:()=>true}]){const r=rig(override);assert.throws(()=>r.control.set({enabled:true}));assert.deepEqual(r.commands,[]);}
  const r=rig();assert.throws(()=>r.control.set({enabled:1}));r.changeMode(3);assert.throws(()=>r.control.set({enabled:true}));assert.deepEqual(r.commands,[]);
});
test('failed ON always tries OFF and restores mode; failed OFF remains unknown and blocks restart',()=>{
  for(const offFails of [false,true]){
    let unknown=0;const commands=[],r=rig({command:(id,param)=>{commands.push([id,param]);if(param===1||offFails)throw Error(param?'ON failed':'OFF failed');},onUnknown:()=>unknown++});
    assert.throws(()=>r.control.set({enabled:true}),offFails?/OFF failed/:/ON failed/);assert.deepEqual(commands,[[4,1],[4,0]]);
    assert.equal(r.control.isBusy(),offFails);assert.equal(r.control.snapshot().enabled,offFails?null:false);assert.equal(unknown,offFails?1:0);
    if(offFails)assert.throws(()=>r.control.set({enabled:true}),/не подтверждена/);
  }
});
test('physical AF-mode changes are preserved and lost connection never invents successful stop',()=>{
  const r=rig();r.control.set({enabled:true});r.changeMode(2);r.control.stop();assert.equal(r.mode(),2);
  r.control.set({enabled:true});r.disconnect();const lost=r.control.disconnected();assert.equal(lost.enabled,null);assert.equal(lost.confirmation,'unknown');assert.equal(lost.status,'disconnected');
});
test('camera-control blocks one-shot/manual AF while Servo is held; a property change stops first',async()=>{
  const r=rig(),control=createCameraControl({...r.io,refresh:()=>({properties:{afMode:{writable:true,allowed:[0,1]},iso:{writable:true,allowed:[80]}}})});
  control.servo({enabled:true});await assert.rejects(control.autofocus(),/Дождитесь/);await assert.rejects(control.focus({direction:'near'}),/Дождитесь/);
  // The same fake register is sufficient to validate ordering of stop then write.
  await control.property({key:'iso',value:80});assert.deepEqual(r.commands,[[4,1],[4,0]]);assert.equal(control.isBusy(),false);
});
