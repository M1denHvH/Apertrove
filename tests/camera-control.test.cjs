const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createCameraControl}=require('../electron/camera-control.cjs');
const {valueLabel}=require('../electron/camera-values.cjs');
test('White balance labels follow Canon EDSDK enum values',()=>{
  assert.equal(valueLabel('whiteBalance',2),'Облачно');assert.equal(valueLabel('whiteBalance',3),'Лампа накаливания');assert.equal(valueLabel('whiteBalance',4),'Люминесцентный');assert.equal(valueLabel('whiteBalance',5),'Вспышка');assert.equal(valueLabel('whiteBalance',6),'Ручной WB');assert.equal(valueLabel('whiteBalance',8),'Тень');
});
function rig(overrides={}){
  const writes=[],commands=[],values=new Map();let capturing=false,live=true,elapsed=0,sample=0;
  const io={ensure:()=>{},isCapturing:()=>capturing,isLive:()=>live,now:()=>elapsed,wait:async ms=>{elapsed+=ms;},focusState:()=>({sequence:++sample,status:'focused'}),
    refresh:()=>({properties:Object.fromEntries(['shutter','aperture','iso','compensation','whiteBalance','pictureStyle'].map(key=>[key,{writable:true,allowed:[0x70,0x30,0x48,0,1,0x81]}]))}),
    get:id=>values.get(id),set:(id,value)=>{writes.push([id,value]);values.set(id,value);},
    command:(id,param)=>commands.push([id,param]),...overrides};
  return {control:createCameraControl(io),writes,commands,values,setCapturing:v=>capturing=v,setLive:v=>live=v};
}
test('Exposure settings address the Canon Tv, Av and ISO properties and verify read-back',async()=>{
  const r=rig();for(const [key,value,id] of [['shutter',0x70,0x406],['aperture',0x30,0x405],['iso',0x48,0x402],['compensation',0,0x407],['whiteBalance',1,0x106],['pictureStyle',0x81,0x114]]){await r.control.property({key,value});assert.deepEqual(r.writes.at(-1),[id,value]);}
});
test('The UI receives failure when a camera accepts the call but does not apply the value',async()=>{
  const r=rig({get:()=>0x60});await assert.rejects(r.control.property({key:'shutter',value:0x70}),/не подтвердила/);
});
test('Equivalent Canon 1/2 and 1/3 EV encodings use a supported value instead of rejecting a preset',async()=>{
  const r=rig({refresh:()=>({properties:{aperture:{writable:true,allowed:[0x15]}}})});await r.control.property({key:'aperture',value:0x14});assert.deepEqual(r.writes,[[0x405,0x15]]);
});
test('Read-only and unsupported values are blocked before any SDK write',async()=>{
  const r=rig({refresh:()=>({properties:{aperture:{writable:false,allowed:[0x30]}}})});await assert.rejects(r.control.property({key:'aperture',value:0x30}),/недоступен/);assert.equal(r.writes.length,0);
  const t=rig();await assert.rejects(t.control.property({key:'shutter',value:0xffff}),/недоступен/);assert.equal(t.writes.length,0);
});
test('Bulb readback is labelled without offering a host property write or an ordinary shutter pulse',async()=>{
  assert.equal(valueLabel('shutter',0x0c),'Bulb');
  const r=rig({refresh:()=>({properties:{shutter:{writable:true,allowed:[0x0c]}}})});
  await assert.rejects(r.control.property({key:'shutter',value:0x0c}),/BULB недоступен/);assert.deepEqual(r.writes,[]);
});
test('Manual focus uses DriveLensEvf 0x103 with all six near/far step encodings',async()=>{
  const r=rig();for(const direction of ['near','far'])for(const step of [1,2,3])await r.control.focus({direction,step});
  assert.deepEqual(r.commands,[[0x103,1],[0x103,2],[0x103,3],[0x103,0x8001],[0x103,0x8002],[0x103,0x8003]]);
});
test('Focus guards reject no Live View, invalid direction and invalid step',async()=>{
  const r=rig();r.setLive(false);await assert.rejects(r.control.focus({direction:'near',step:1}),/Live View/);r.setLive(true);
  await assert.rejects(r.control.focus({direction:'invalid',step:1}),/направление/);await assert.rejects(r.control.focus({direction:'far',step:4}),/шаг/);assert.equal(r.commands.length,0);
});
test('Autofocus uses its distinct 0x102 command and releases it even after interruption',async()=>{
  const r=rig();await r.control.autofocus();assert.deepEqual(r.commands,[[0x102,1],[0x102,0]]);
  const t=rig({wait:async()=>{throw Error('interrupted');}});await assert.rejects(t.control.autofocus(),/interrupted/);assert.deepEqual(t.commands,[[0x102,1],[0x102,0]]);
});
test('SDK failures propagate and concurrent camera operations are blocked',async()=>{
  const r=rig({command:()=>{throw Error('Canon: device busy');}});await assert.rejects(r.control.focus({direction:'near'}),/device busy/);
  let release,elapsed=0,first=true;const t=rig({now:()=>elapsed,wait:async()=>{elapsed+=1000;if(first){first=false;await new Promise(r=>release=r);}}});const pending=t.control.autofocus();assert.equal(t.control.isBusy(),true);await assert.rejects(t.control.property({key:'iso',value:0x48}),/Дождитесь/);release();await pending;
  t.setCapturing(true);await assert.rejects(t.control.focus({direction:'near'}),/Дождитесь/);
});

test('AF holds beyond the old 450ms pulse and waits for consecutive fresh confirmation',async()=>{
  let elapsed=0,sequence=0;const states=[];
  const r=rig({now:()=>elapsed,wait:async ms=>{elapsed+=ms;},focusState:()=>({sequence:++sequence,status:elapsed>=2300?'focused':'unknown'}),onAutofocus:s=>states.push(s)});
  const result=await r.control.autofocus();assert.equal(result.confirmed,true);assert.ok(result.durationMs>=2400);assert.deepEqual(r.commands,[[0x102,1],[0x102,0]]);assert.equal(states.at(-1).status,'focused');
});
test('Stale metadata never confirms AF and timeout always releases the lens',async()=>{
  const r=rig({focusState:()=>({sequence:1,status:'focused'})});await assert.rejects(r.control.autofocus(),/12 секунд/);assert.deepEqual(r.commands,[[0x102,1],[0x102,0]]);assert.equal(r.control.isBusy(),false);
});
test('Failed acquisition is reported honestly and frame streaming remains available during AF',async()=>{
  let elapsed=0,sequence=0;const r=rig({now:()=>elapsed,wait:async ms=>{assert.equal(r.control.canStream(),true);elapsed+=ms;},focusState:()=>({sequence:++sequence,status:'failed'})});await assert.rejects(r.control.autofocus(),/не смогла/);assert.equal(r.commands.at(-1)[1],0);
});
test('An SDK failure while releasing AF clears busy state and never leaves a false focusing/success status',async()=>{
  const states=[];const r=rig({command:(id,param)=>{if(param===0)throw Error('release failed');},onAutofocus:state=>states.push(state)});
  await assert.rejects(r.control.autofocus(),/release failed/);assert.equal(r.control.isBusy(),false);assert.equal(r.control.canStream(),true);assert.equal(states.at(-1).status,'failed');
});
test('A physical MF switch blocks autofocus and lens drive before sending a camera command',async()=>{const r=rig({canFocus:()=>false});await assert.rejects(r.control.autofocus(),/MF/);await assert.rejects(r.control.focus({direction:'near'}),/MF/);assert.equal(r.commands.length,0);});
