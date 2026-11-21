const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createShutterInput}=require('../electron/shutter-input.cjs');
const {holdShutter}=require('../electron/shutter-latch.cjs');
const {createServoFocus}=require('../electron/servo-focus.cjs');
const {createShutterDiagnostics}=require('../electron/shutter-diagnostics.cjs');
const worker=fs.readFileSync(path.join(__dirname,'../electron/camera-worker.cjs'),'utf8');
const start=worker.indexOf('const operationHandlers='),end=worker.indexOf('const operations=',start);
const policy=worker.slice(start,end);assert.ok(start>=0&&end>start&&!/require\s*\(/.test(policy));
function rig({servo=true,legacy=false,pressError=false,releaseError=false}={}){
 let clock=0,sequence=0,latch=null,active=false,shots=0,captureReject;const commands=[],timers=new Map();
 const io={ensure(){},isLive:()=>false,get:()=>1,refresh:()=>({properties:{afMode:{value:1,writable:true,allowed:[0,1,2]}}}),command(){}};
 const focus=createServoFocus(io);if(servo)focus.set({enabled:true});
 const state={connected:true,servo:focus.snapshot()};
 const handlers={capture:()=>new Promise((resolve,reject)=>{
   shots++;active=true;captureReject=reject;
   try{latch=holdShutter({now:()=>clock,setTimer:(fn,ms)=>{timers.set(++sequence,{at:clock+ms,fn});return sequence;},clearTimer:id=>timers.delete(id),press:()=>{commands.push({value:3,at:clock});if(pressError)throw Error('press failed');},release:()=>focus.releaseAfterCapture(value=>{commands.push({value,at:clock});if(releaseError)throw Error('release failed');}),onReleased:()=>{active=false;if(!pressError&&!releaseError)resolve({confirmation:'UNVERIFIED'});},onError:reject},5000);}catch(error){active=false;reject(error);}
 }),burstStop:()=>{try{latch?.release();return {released:true};}catch(error){captureReject?.(error);throw error;}},status:()=>state};
 const context=vm.createContext({handlers,state,bulb:{isBusy:()=>false},focusHold:{isBusy:()=>false},currentOperation:null,controls:{isServoHeld:focus.isHeld},teardownUncertain:false,operationError:(code,message)=>Object.assign(Error(message),{code}),Object,Error},{codeGeneration:{strings:false,wasm:false}});
 let source=policy;if(legacy)source=source.replace("'capture','burstStop','servoStop'","'capture','servoStop'");
 new vm.Script(source+'\nthis.api=operationHandlers;').runInContext(context,{timeout:1000});
 const invoke=method=>context.api[method]({}, {operationId:'synthetic-'+(++sequence)});
 const advance=ms=>{clock+=ms;for(const [id,timer]of [...timers])if(timer.at<=clock){timers.delete(id);timer.fn();}};
 return {invoke,advance,commands,focus,state,active:()=>active,shots:()=>shots};
}
function inputRig(){const calls=[];let id=0;const owner=createShutterInput({newId:()=> 'input-'+(++id),start:input=>calls.push({phase:'press',...input}),stop:input=>calls.push({phase:'release',...input})});return {owner,calls};}

test('P0 reproduction: the previous actual worker guard rejects release while Servo owns AF, so watchdog releases at 5000ms',async()=>{
 const r=rig({legacy:true}),capture=r.invoke('capture');await assert.rejects(r.invoke('burstStop'),error=>error.code==='OPERATION_BUSY');
 assert.equal(r.commands.length,1);assert.equal(r.active(),true);r.advance(4999);assert.equal(r.commands.length,1);r.advance(1);await capture;assert.deepEqual(r.commands,[{value:3,at:0},{value:1,at:5000}]);
});
for(const servo of [false,true])test('actual worker release guard permits a short continuous-drive click with Servo '+(servo?'ON':'OFF'),async()=>{
 const r=rig({servo}),capture=r.invoke('capture');r.advance(40);await r.invoke('burstStop');await capture;
 assert.deepEqual(r.commands,[{value:3,at:0},{value:servo?1:0,at:40}]);assert.equal(r.shots(),1);r.advance(5000);assert.equal(r.commands.length,2);assert.equal(r.focus.snapshot().enabled,servo);
});
test('actual worker preserves a genuine held burst until release and never waits for watchdog on pointer-up',async()=>{
 const r=rig(),capture=r.invoke('capture');r.advance(1500);assert.equal(r.commands.length,1);await r.invoke('burstStop');await capture;assert.equal(r.commands[1].at,1500);
});
test('duplicate release/capture notifications do not send another full press or stop a subsequent input',async()=>{
 const r=rig();for(let i=0;i<2;i++){const capture=r.invoke('capture');r.advance(30);await r.invoke('burstStop');await r.invoke('burstStop');await capture;}
 assert.equal(r.shots(),2);assert.deepEqual(r.commands.map(item=>item.value),[3,1,3,1]);
});
test('a press error still invokes one safety release through the production latch',async()=>{
 const r=rig({pressError:true});await assert.rejects(r.invoke('capture'),/press failed/);assert.deepEqual(r.commands.map(item=>item.value),[3,1]);
});
test('a release error propagates and changes Servo to unknown instead of claiming successful completion',async()=>{
 const r=rig({releaseError:true}),capture=r.invoke('capture');await assert.rejects(r.invoke('burstStop'),/release failed/);await assert.rejects(capture,/release failed/);assert.equal(r.focus.snapshot().enabled,null);assert.equal(r.focus.snapshot().confirmation,'unknown');
});
test('safety burstStop remains admissible when Servo state becomes unknown after full press',async()=>{
 const r=rig(),capture=r.invoke('capture');r.state.servo={enabled:null,status:'error'};await r.invoke('burstStop');await capture;assert.equal(r.commands.length,2);
});
for(const reason of ['pointerup','pointercancel','lostpointercapture','blur','pagehide','hidden','unmount','disconnect'])test('input ownership sends one matching release on '+reason,()=>{
 const r=inputRig();assert.equal(r.owner.press('pointer',11),true);r.owner.release(reason,reason==='pointerup'?11:undefined);r.owner.release(reason);assert.deepEqual(r.calls.map(item=>item.phase),['press','release']);assert.equal(r.calls[0].inputId,r.calls[1].inputId);assert.equal(r.owner.snapshot(),null);
});
for(const key of ['Space','Enter'])test('keyboard '+key+' repeats neither create a second press nor consume a foreign key release',()=>{
 const r=inputRig();r.owner.press('keyboard',key);assert.equal(r.owner.press('keyboard',key),false);assert.equal(r.owner.release('keyup','Escape'),false);assert.ok(r.owner.snapshot());r.owner.release('keyup',key);assert.equal(r.calls.length,2);
});
test('input can finish before asynchronous start acknowledgement without leaving an owned press',async()=>{
 let acknowledge;const calls=[],owner=createShutterInput({newId:()=> 'delayed',start:()=>new Promise(resolve=>acknowledge=resolve),stop:input=>calls.push(input)});
 owner.press('pointer',1);owner.release('pointerup',1);acknowledge();await Promise.resolve();assert.equal(owner.snapshot(),null);assert.equal(calls.length,1);
});
test('component disposal releases active input once and cannot start after unmount; a new component is independent',()=>{
 const r=inputRig();r.owner.press('pointer',1);r.owner.dispose();r.owner.dispose();assert.equal(r.owner.press('pointer',1),false);assert.equal(r.calls.length,2);const next=inputRig();assert.equal(next.owner.press('pointer',1),true);next.owner.release();assert.equal(next.calls.length,2);
});
test('two quick clicks get different input IDs and exactly one release per press',()=>{
 const r=inputRig();for(let i=0;i<2;i++){r.owner.press('pointer',1);r.owner.release('pointerup',1);}assert.equal(new Set(r.calls.map(item=>item.inputId)).size,2);assert.deepEqual(r.calls.map(item=>item.phase),['press','release','press','release']);
});
test('diagnostics are opt-in, bounded, and discard private data while preserving operation correlation',()=>{
 const lines=[];const silent=createShutterDiagnostics({write:row=>lines.push(row)});silent('sdk-dispatch',{inputId:'id'});assert.equal(lines.length,0);
 const trace=createShutterDiagnostics({enabled:true,max:2,now:()=>100,write:row=>lines.push(row)});for(let i=0;i<4;i++)trace('sdk-dispatch',{inputId:'input-1',source:'pointer',operationId:'worker:operation:3',command:4,parameter:3,driveMode:1,serialNumber:'private',path:'C:/private/photo.jpg'});
 assert.equal(lines.length,2);assert.equal(lines[0].operationId,'worker:operation:3');assert.equal(lines[0].at,100);assert.equal('serialNumber'in lines[0],false);assert.equal('path'in lines[0],false);
});
