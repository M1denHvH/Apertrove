const {test}=require('node:test'),assert=require('node:assert/strict');
const {createCameraControl}=require('../electron/camera-control.cjs');
function rig(overrides={}){let af=1,elapsed=0,sequence=0;const commands=[],settings=[],states=[];const io={ensure(){},isCapturing:()=>false,isLive:()=>false,canFocus:()=>true,now:()=>elapsed,wait:async ms=>{elapsed+=ms;},get:()=>af,set:(id,value)=>{settings.push(id);af=value;},refresh:()=>({properties:{afMode:{allowed:[0,1],writable:true}}}),focusState:()=>({sequence:++sequence,status:'focused',boxes:[]}),command:(...args)=>commands.push(args.slice(0,2)),onAutofocus:state=>states.push(state),...overrides};return {control:createCameraControl(io),commands,settings,states,af:()=>af,changeAF:value=>{af=value;}};}
test('Native AF uses only a half press and restores AI Servo even when preview changes AF mode',async()=>{
  let previews=0;const r=rig({previewFocus:async(_drive,sample)=>{assert.equal(sample.status,'focused');previews++;r.changeAF(0);}});
  const result=await r.control.autofocus();assert.equal(result.confirmed,true);assert.equal(result.method,'viewfinder');assert.deepEqual(r.commands,[[4,1],[4,0]]);assert.equal(r.af(),1);assert.equal(previews,1);assert.ok(r.settings.every(id=>id===0x404));assert.equal(r.control.isBusy(),false);
});
test('Native AF timeout releases the half press and restores AF mode without taking a photo',async()=>{
  const r=rig({focusState:()=>({sequence:1,status:'focused'})});await assert.rejects(r.control.autofocus(),/Фокус не подтверждён/);assert.deepEqual(r.commands,[[4,1],[4,0]]);assert.equal(r.af(),1);assert.equal(r.control.isBusy(),false);
});
test('Preview errors retain the real AF result and still restore the camera mode',async()=>{
  const r=rig({previewFocus:async()=>{r.changeAF(0);throw Error('preview unavailable');}});const result=await r.control.autofocus();assert.equal(result.confirmed,true);assert.equal(result.previewError,'preview unavailable');assert.equal(r.af(),1);
});
test('Lens steps outside Live View execute inside a temporary preview operation',async()=>{
  let previews=0;const r=rig({previewFocus:async drive=>{previews++;await drive();}});await r.control.focus({direction:'far',step:2});assert.equal(previews,1);assert.deepEqual(r.commands,[[0x103,0x8002]]);
});
test('Disabling the AF preview performs native AF and restores its mode without starting EVF',async()=>{
  let previews=0;const r=rig({previewFocus:async()=>{previews++;}});
  const result=await r.control.autofocus({preview:false});assert.equal(result.confirmed,true);assert.equal(previews,0);assert.equal(result.previewReceived,undefined);assert.equal(r.af(),1);assert.deepEqual(r.commands,[[4,1],[4,0]]);
});
test('The preview preference does not start a temporary EVF session during live AF or on AF failure',async()=>{
  let previews=0;const live=rig({isLive:()=>true,previewFocus:async()=>{previews++;}});await live.control.autofocus({preview:true});assert.equal(previews,0);assert.deepEqual(live.commands,[[0x102,1],[0x102,0]]);
  const failed=rig({focusState:()=>({sequence:1,status:'focused'}),previewFocus:async()=>{previews++;}});await assert.rejects(failed.control.autofocus({preview:true}),/Фокус не подтверждён/);assert.equal(previews,0);
});
