const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
// Execute only the real main-process admission functions with JavaScript ports.
// Importing Electron/main or a native camera worker is deliberately unnecessary.
const main=fs.readFileSync(path.join(__dirname,'../electron/main.cjs'),'utf8');
const source=main.slice(main.indexOf('const servoActive='),main.indexOf('function sessionIdle('));
assert.ok(source&&!/require\s*\(/.test(source));
function fixture(){
  const calls=[],pending=[];let shots=0;
  const channel={nativeEpoch:7,exited:false,rpc:{hasOutstanding:()=>pending.some(item=>item.method==='servo'),snapshot:()=>({admissionOpen:true})}};
  const port={shutterInput:value=>value||{},shutterTrace:()=>{},camera:{connected:true,servo:{enabled:false,status:'off'},properties:{driveMode:{value:1}}},
    worker:{},workerState:channel,quitting:false,runtimeQuarantined:false,interval:null,captureActive:false,sessionTransition:false,accessoryBusy:false,controlBusy:false,servoTransition:null,captureQueued:false,pendingBurstStart:null,burst:null,
    store:{sessionId:'session',sessions:[{id:'session'}]},burstActive:()=>false,seriesActive:()=>false,t:key=>key,remote:{publishState(){}},crypto:{randomUUID:()=> 'synthetic-burst'},emit(){},log(){},importQueue:Promise.resolve(),trackApplication:job=>job,
    call(method,args){
      calls.push({method,args});
      return new Promise((resolve,reject)=>pending.push({method,resolve(value){pending.splice(pending.indexOf(this),1);resolve(value);},reject(error){pending.splice(pending.indexOf(this),1);reject(error);}}));
    },
    async capture(args){calls.push({method:'capture',args});shots++;return {confirmation:'UNVERIFIED',observedTransfers:1,shots:0};}
  };
  const context=vm.createContext(port,{codeGeneration:{strings:false,wasm:false}});
  new vm.Script(source+'\nthis.api={setServo,captureFromControl,burstFromControl};').runInContext(context,{timeout:1000});
  return {context,calls,shots:()=>shots,settle(enabled,error){assert.equal(pending.length,1);if(error){context.camera.servo={enabled:false,status:'error'};pending[0].reject(error);}else{context.camera.servo={enabled,status:enabled?'running':'off'};pending[0].resolve({...context.camera.servo});}}};
}
test('manual capture is serialized behind a finite Servo ON and does not stop the accepted hold',async()=>{
  const f=fixture(),toggling=f.context.api.setServo(true),capture=f.context.api.captureFromControl();
  assert.equal(f.shots(),0);assert.equal(f.context.controlBusy,true);f.settle(true);await toggling;await capture;
  assert.deepEqual(f.calls.map(item=>item.method),['servo','capture']);assert.equal(f.context.camera.servo.enabled,true);assert.equal(f.context.controlBusy,false);assert.equal(f.context.captureQueued,false);
});
test('manual capture during Servo OFF waits for the acknowledged stop',async()=>{
  const f=fixture();f.context.camera.servo={enabled:true,status:'running'};
  const stopping=f.context.api.setServo(false),capture=f.context.api.captureFromControl();assert.equal(f.shots(),0);
  f.settle(false);await stopping;await capture;assert.deepEqual(f.calls.map(item=>item.method),['servoStop','capture']);assert.equal(f.context.camera.servo.enabled,false);
});
test('a failed toggle rejects the queued shutter intent and releases its queue slot',async()=>{
  const f=fixture(),toggling=f.context.api.setServo(true),capture=f.context.api.captureFromControl();
  const failedToggle=assert.rejects(toggling,/synthetic transition failed/),failedCapture=assert.rejects(capture,/synthetic transition failed/);
  f.settle(false,Error('synthetic transition failed'));await Promise.all([failedToggle,failedCapture]);
  assert.equal(f.shots(),0);assert.equal(f.context.captureQueued,false);assert.equal(f.context.servoTransition,null);assert.equal(f.context.controlBusy,false);
  await f.context.api.captureFromControl();assert.equal(f.shots(),1);
});
test('a shutter intent is bounded and cannot move into a new session or worker',async()=>{
  for(const change of ['epoch','worker']){
    const f=fixture(),toggling=f.context.api.setServo(true),capture=f.context.api.captureFromControl();
    await assert.rejects(f.context.api.captureFromControl(),/Предыдущий кадр/);
    if(change==='epoch')f.context.workerState.nativeEpoch++;else f.context.workerState={...f.context.workerState};
    const rejected=assert.rejects(capture,error=>error.code==='OPERATION_STALE_SESSION');f.settle(true);await toggling;await rejected;
    assert.equal(f.shots(),0);assert.equal(f.context.captureQueued,false);
  }
});
test('an unknown Servo outcome never reaches capture admission',async()=>{
  const f=fixture();f.context.camera.servo={enabled:null,status:'error'};
  await assert.rejects(f.context.api.captureFromControl(),/Состояние AI Servo/);assert.equal(f.shots(),0);
});
test('a burst requested during Servo ON starts after the transition and keeps Servo running',async()=>{
  const f=fixture(),toggling=f.context.api.setServo(true),starting=f.context.api.burstFromControl({seconds:1});assert.equal(f.shots(),0);
  f.settle(true);await toggling;assert.equal((await starting).status,'holding');assert.equal(f.shots(),1);assert.equal(f.context.camera.servo.enabled,true);
  assert.equal(f.calls.find(item=>item.method==='capture').args.burstMs,1000);assert.equal(f.context.pendingBurstStart,null);
});
test('releasing a queued burst prevents a later shutter hold after the Servo transition',async()=>{
  const f=fixture(),toggling=f.context.api.setServo(true),starting=f.context.api.burstFromControl({seconds:5});
  f.context.pendingBurstStart.released=true;f.settle(true);await toggling;assert.equal((await starting).status,'cancelled');
  assert.equal(f.shots(),0);assert.equal(f.context.camera.servo.enabled,true);assert.equal(f.context.pendingBurstStart,null);assert.equal(f.context.captureQueued,false);
});
