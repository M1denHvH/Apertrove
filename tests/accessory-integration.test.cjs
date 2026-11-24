const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const protocol=require('../electron/canon-exposure-protocol.cjs'),{cameraAccessorySupport}=require('../electron/camera-accessory-support.cjs'),{createBulbControl}=require('../electron/bulb-control.cjs');
const worker=fs.readFileSync(path.join(__dirname,'../electron/camera-worker.cjs'),'utf8'),main=fs.readFileSync(path.join(__dirname,'../electron/main.cjs'),'utf8');
const section=(source,a,b)=>{const start=source.indexOf(a),end=source.indexOf(b,start);assert.ok(start>=0&&end>start);return source.slice(start,end);};
const source=section(worker,'function accessoryCapabilities()','function listCameras(');
const fingerprint='35c5fd7564cf8eee3bc41004a0ab21d96caccb36ea1a1ddb512caf7b1c046627';
function rig({modelId=0x80000432,working=true,controlsOnly=false,restricted=false,hash=fingerprint}={}){
  const calls=[],settled=[],reference={},values=new Map([[0x400,3],[0x406,0x0c]]);let modeGuard=false;
  const ports={...protocol,createBulbControl,cameraAccessorySupport,process:{arch:'x64'},fs:{readFileSync:()=>Buffer.from('synthetic')},createHash:()=>({update:()=>({digest:()=>hash})}),fileVersion:async()=> '3.18.40.0',
    state:{connected:true,working,controlsOnly,saveTo:3,capabilities:{capture:true},sdkPath:'synthetic.dll'},camera:reference,restricted,sessionEpoch:1,accessoryEpoch:null,sessionEventsRegistered:!controlsOnly&&working,
    accessorySupport:{bulb:false,flashPopup:false},bulb:createBulbControl(),flashControl:protocol.createFlashPopupControl(),bulbCaptureOperation:null,captureWait:null,focusHold:{stop:async()=>{}},focusRestore:null,
    controls:{isBusy:()=>false,isServoHeld:()=>modeGuard},ensureWorking(){if(!ports.state.connected||!ports.state.working)throw Error('Not working');},
    sdk:{command:(_camera,id,param)=>{calls.push(['command',id,param]);return 0;},statusCommand:(_camera,id,param)=>{calls.push(['status',id,param]);return 0;}},
    PROPS:{shutter:0x406},get:id=>values.get(id),status:()=>ports.state,setDeliveryRoute:args=>calls.push(['route',args.route]),
    transfers:{noteCapture:args=>calls.push(['capture-intent',args.operationId]),settleCapture:(id,outcome)=>settled.push({id,...outcome})},
    operationError:(code,message)=>Object.assign(Error(message),{code}),isUnsupportedCommand:code=>[1,7,0x2005].includes(code&0xffff),observed:(_method,_phase,fn)=>fn(),
    failCapture:()=>calls.push(['capture-failed']),disconnect:()=>{ports.bulb.disconnected();calls.push(['disconnect']);ports.state.connected=false;return ports.state;}
  };
  const context=vm.createContext(ports,{codeGeneration:{strings:false,wasm:false}});new vm.Script(source+'\nthis.api={prepareAccessories,accessoryCapabilities,startBulb,stopBulb,closeCamera};').runInContext(context,{timeout:1000});
  return {context,calls,settled,values,servo:value=>modeGuard=value,prepare:()=>context.api.prepareAccessories(modelId),start:()=>context.api.startBulb({autofocus:false,captureId:'synthetic',route:{sessionId:'session-A',destination:'synthetic'}},{operationId:'synthetic-operation'})};
}
test('actual worker accessory preparation is read-only and fingerprint/model-gated before any actuation',async()=>{
  for(const options of [{},{hash:'0'.repeat(64)},{modelId:0xdeadbeef},{controlsOnly:true}]){const r=rig(options);await r.prepare();assert.deepEqual(r.calls,[]);const cap=r.context.api.accessoryCapabilities();assert.equal(cap.bulb,!options.hash&&!options.modelId&&!options.controlsOnly);assert.equal(cap.flashPopup,cap.bulb);}
});

test('import-only session restrictions override a known model and qualified accessory profile',async()=>{
  const r=rig({restricted:true});await r.prepare();
  assert.equal(r.context.api.accessoryCapabilities().bulb,false);assert.equal(r.context.api.accessoryCapabilities().flashPopup,false);
  await assert.rejects(r.start(),error=>error.code==='BULB_PROTOCOL_UNQUALIFIED');
  await assert.rejects(r.context.flashControl.popup(),error=>error.code==='FLASH_POPUP_PROTOCOL_UNQUALIFIED');
  assert.deepEqual(r.calls,[]);
});

test('BULB requires confirmed capture delivery while flash remains independent of the save destination',async()=>{
  const r=rig();await r.prepare();r.context.state.saveTo=null;r.context.state.capabilities.capture=false;
  assert.equal(r.context.api.accessoryCapabilities().bulb,false);assert.equal(r.context.api.accessoryCapabilities().flashPopup,true);
  await assert.rejects(r.start(),/сохранение на ПК/);assert.deepEqual(r.calls,[]);
});

test('an owed BULB end remains available after the capture destination becomes unavailable',async()=>{
  const r=rig();await r.prepare();await r.start();r.context.state.saveTo=null;r.context.state.capabilities.capture=false;
  await r.context.api.stopBulb();assert.deepEqual(r.calls.slice(-2),[['command',4,0],['status',1,0]]);assert.equal(r.context.state.bulb.status,'idle');
});
test('actual worker BULB pins transfer intent, maps proven camera route, and pairs end/unlock',async()=>{
  const r=rig();await r.prepare();await r.start();assert.equal(r.context.state.bulb.status,'exposing');assert.equal(r.context.state.bulb.elapsedSeconds,null);
  assert.deepEqual(r.calls.map(call=>call[0]),['route','capture-intent','status','command']);assert.deepEqual(r.calls.at(-1),['command',4,0x10003]);
  await r.context.api.stopBulb();assert.deepEqual(r.calls.slice(-2),[['command',4,0],['status',1,0]]);assert.equal(r.context.state.bulb.status,'idle');assert.equal(r.settled[0].id,'synthetic-operation');
});
test('actual worker dedicated bodies use dedicated 2/3 with the same lock lifecycle',async()=>{
  const r=rig({modelId:0x80000169});await r.prepare();await r.start();await r.context.api.stopBulb();assert.deepEqual(r.calls.filter(call=>call[0]==='command'),[['command',2,0],['command',3,0]]);
});
test('BULB wrong mode, active Servo and unqualified runtime reject before transfer intent or native effects',async()=>{
  for(const setting of ['mode','servo','runtime']){const r=rig(setting==='runtime'?{hash:'0'.repeat(64)}:{});await r.prepare();if(setting==='mode')r.values.set(0x406,0x70);if(setting==='servo')r.servo(true);await assert.rejects(r.start());assert.deepEqual(r.calls,[]);}
});

test('known focus and missing-card refusals unwind BULB without quarantining the native runtime',async()=>{
  for(const refusal of [0x8d01,0x8d06]){
    const r=rig(),observations=[];await r.prepare();const send=r.context.sdk.command;
    r.context.observed=(method,phase,fn)=>{const code=fn();if(code!==0)observations.push({method,phase,code});return code;};
    r.context.sdk.command=(camera,id,param)=>id===4&&param!==0?refusal:send(camera,id,param);
    await assert.rejects(r.start(),error=>error.code===refusal);assert.equal(r.context.bulb.isBusy(),false);
    assert.deepEqual(observations,[]);assert.deepEqual(r.calls.slice(-2),[['command',4,0],['status',1,0]]);
    r.context.sdk.command=send;await r.start();await r.context.api.stopBulb();assert.equal(r.context.state.bulb.status,'idle');
  }
});
test('manual disconnect orders end then unlock before closing, while physical loss preserves unknown exposure',async()=>{
  const r=rig();await r.prepare();await r.start();await r.context.api.closeCamera();assert.deepEqual(r.calls.slice(-3),[['command',4,0],['status',1,0],['disconnect']]);
  const lost=rig();await lost.prepare();await lost.start();const before=lost.calls.length;await lost.context.api.closeCamera({lost:true});assert.equal(lost.context.state.bulb.confirmation,'unknown');assert.equal(lost.calls.slice(before).some(call=>call[0]==='command'),false);
});
test('failed end unlocks but prevents session close and restart; explicit end retry can recover',async()=>{
  const r=rig();await r.prepare();await r.start();const original=r.context.sdk.command;r.context.sdk.command=(_camera,_id,param)=>param===0?0x81:0;
  await assert.rejects(r.context.api.closeCamera(),error=>error.code===0x81);assert.equal(r.context.state.bulb.confirmation,'unknown');assert.equal(r.calls.some(call=>call[0]==='disconnect'),false);assert.deepEqual(r.calls.at(-1),['status',1,0]);await assert.rejects(r.start());
  r.context.sdk.command=original;await r.context.api.closeCamera();assert.equal(r.calls.at(-1)[0],'disconnect');
});
test('a fresh verified session recreates controllers without treating old disconnected exposure as complete',async()=>{
  const r=rig();await r.prepare();await r.start();await r.context.api.closeCamera({lost:true});const old=r.context.bulb;assert.equal(old.snapshot().confirmation,'unknown');
  r.context.sessionEpoch=3;r.context.camera={};r.context.state.connected=true;r.context.state.working=true;await r.prepare();assert.equal(r.context.bulb.snapshot().status,'idle');assert.equal(old.snapshot().confirmation,'unknown');
});
test('qualified flash stays inside worker, does not cycle EVF, and remains physically unconfirmed',async()=>{
  const r=rig();await r.prepare();const result=await r.context.flashControl.popup();assert.deepEqual(r.calls,[['command',0x106,0]]);assert.equal(result.accepted,true);assert.equal(result.raised,null);
});
test('worker uses exact EdsSendStatusCommand scalar ABI and camera event parameter contract',()=>{
  assert.match(worker,/statusCommand:fn\('EdsSendStatusCommand','uint32',\['void \*','uint32','int32'\]\)/);
  assert.match(worker,/koffi\.register\(\(event,parameter\)=>handleCameraState\(event,parameter,epoch\)/);assert.match(worker,/bulbExposureSeconds\(event,parameter\)/);
});
test('qualified Tv Bulb writes retain descriptor/readback checks',async()=>{
  const {createCameraControl}=require('../electron/camera-control.cjs'),writes=[];let value=0x70;
  const c=createCameraControl({ensure(){},isCapturing:()=>false,canBulb:()=>true,refresh:()=>({properties:{shutter:{writable:true,allowed:[0x0c]}}}),get:()=>value,set:(id,next)=>{writes.push([id,next]);value=next;}});
  await c.property({key:'shutter',value:0x0c});assert.deepEqual(writes,[[0x406,0x0c]]);
});
function flashConditionsRig({modelId=0x80000432,connected=true,values=new Map([[0x400,3],[0x01000422,0],[0x0100043d,0]])}={}){
  const reads=[],context=vm.createContext({camera:connected?{}:null,state:{connected,modelId},cameraAccessorySupport,get:id=>{reads.push(id);const value=values.get(id);if(value instanceof Error)throw value;return value;}},{codeGeneration:{strings:false,wasm:false}});
  new vm.Script(section(worker,'function readFlashPopupConditions()','async function diagnoseCamera(')+'\nthis.read=readFlashPopupConditions;').runInContext(context,{timeout:1000});
  return {read:()=>context.read(),reads};
}
test('flash conditions diagnosis reads the three proven properties without actuation or mode writes',()=>{
  const r=flashConditionsRig(),result=r.read();assert.deepEqual(r.reads,[0x400,0x01000422,0x0100043d]);
  assert.equal(result.status,'ready');assert.equal(result.allowed,true);assert.equal(result.aEMode,3);assert.equal(result.movieSwStatus,0);assert.equal(result.hiIsoNoiseReduction,0);assert.deepEqual([...result.reasons],[]);
  assert.match(section(worker,'async function diagnoseCamera(','function handleCameraState('),/flashConditions:readFlashPopupConditions\(\)/);
});
test('unqualified or disconnected models do not trigger flash condition property probes',()=>{
  for(const options of [{connected:false},{modelId:0xdeadbeef},{modelId:0x80000437}]){const r=flashConditionsRig(options),result=r.read();assert.equal(result.status,'unavailable');assert.equal(result.allowed,null);assert.deepEqual(r.reads,[]);}
});
test('unavailable or malformed camera condition values remain unknown rather than an allowed popup',()=>{
  for(const missing of [undefined,null,-1,0x100000000,1.5,Error('synthetic read failure')]){
    const r=flashConditionsRig({values:new Map([[0x400,3],[0x01000422,0],[0x0100043d,missing]])}),result=r.read();
    assert.equal(result.status,'unknown');assert.equal(result.allowed,null);assert.equal(result.hiIsoNoiseReduction,null);
  }
});
test('Canon scene/movie/multi-shot noise reduction conditions reject popup availability without changing them',()=>{
  for(const [mode,movie,nr,reason] of [[9,0,0,'SCENE_MODE'],[67,0,0,'SCENE_MODE'],[20,0,0,'MOVIE_MODE'],[3,1,0,'MOVIE_MODE'],[3,0,4,'MULTI_SHOT_NOISE_REDUCTION']]){
    const r=flashConditionsRig({values:new Map([[0x400,mode],[0x01000422,movie],[0x0100043d,nr]])}),result=r.read();
    assert.equal(result.status,'ready');assert.equal(result.allowed,false);assert.equal(result.reasons.includes(reason),true);assert.equal(r.reads.length,3);
  }
});
function mainRig(){
  const calls=[],route={sessionId:'session-A',destination:'synthetic-A'};let settle,rejectStart;
  const channel={nativeEpoch:8,exited:false,consumer:{drain:async()=>calls.push(['drain'])}};
  const context=vm.createContext({requireSession:()=>{},cameraIdle:()=>{},bulbInputOwner:null,store:{settings:{captureFolder:'synthetic-A',autofocus:false}},workerState:channel,camera:{},bulbStarting:null,bulbStopping:null,
    transferRoute:()=>({...route}),crypto:{randomUUID:()=> 'synthetic-capture'},t:key=>key,
    cameraCommand:(method,args)=>{calls.push([method,args]);return new Promise((resolve,reject)=>{settle=resolve;rejectStart=reject;});},call:async method=>{calls.push([method]);return {status:'idle',confirmation:'command-accepted'};},Object,Error
  },{codeGeneration:{strings:false,wasm:false}});
  new vm.Script(section(main,'function startBulbFromControl()','function sessionIdle(')+'\nthis.api={startBulbFromControl,stopBulbFromControl};').runInContext(context,{timeout:1000});
  return {context,calls,route,settle:()=>settle({status:'exposing'}),fail:()=>rejectStart(Object.assign(Error('Synthetic start and cleanup rejection'),{code:0x81}))};
}
test('main pins BULB session/destination and bounds explicit end to the start acknowledgement',async()=>{
  const r=mainRig(),starting=r.context.api.startBulbFromControl(),stopping=r.context.api.stopBulbFromControl();
  assert.equal(r.calls.length,1);assert.equal(r.calls[0][0],'bulbStart');assert.deepEqual({...r.calls[0][1].route},{sessionId:'session-A',destination:'synthetic-A'});assert.equal(r.calls[0][1].captureId,'synthetic-capture');assert.equal(r.calls[0][1].autofocus,false);
  r.route.sessionId='session-B';r.route.destination='synthetic-B';r.settle();await starting;const result=await stopping;
  assert.deepEqual(r.calls.slice(1),[['bulbStop'],['drain']]);assert.equal(result.confirmation,'command-accepted');assert.equal(r.calls[0][1].route.sessionId,'session-A');
});
test('main coalesces repeated BULB end requests and refuses to replay into a changed native session',async()=>{
  const r=mainRig(),starting=r.context.api.startBulbFromControl(),first=r.context.api.stopBulbFromControl(),second=r.context.api.stopBulbFromControl();assert.equal(first,second);
  r.context.workerState.nativeEpoch++;r.settle();await starting;await assert.rejects(first,error=>error.code==='OPERATION_STALE_SESSION');assert.equal(r.calls.some(call=>call[0]==='bulbStop'),false);
});

test('an early explicit BULB stop survives start rejection and retries cleanup only after settlement',async()=>{
  const r=mainRig(),starting=r.context.api.startBulbFromControl(),failed=assert.rejects(starting,error=>error.code===0x81),stopping=r.context.api.stopBulbFromControl();
  assert.equal(r.calls.length,1);r.fail();await failed;await stopping;assert.deepEqual(r.calls.slice(1),[['bulbStop'],['drain']]);
});

test('a rejected BULB start still cannot replay its pending stop into a different session',async()=>{
  const r=mainRig(),starting=r.context.api.startBulbFromControl(),failed=assert.rejects(starting),stopping=r.context.api.stopBulbFromControl(),stale=assert.rejects(stopping,error=>error.code==='OPERATION_STALE_SESSION');
  r.context.workerState.nativeEpoch++;r.fail();await failed;await stale;assert.equal(r.calls.length,1);
});

test('hold identity prevents a stale desktop or remote release from ending another BULB input',async()=>{
  const r=mainRig(),starting=r.context.api.startBulbFromControl({inputId:'current'});r.settle();await starting;
  assert.equal((await r.context.api.stopBulbFromControl({inputId:'old'})).released,false);assert.equal(r.calls.length,1);
  await r.context.api.stopBulbFromControl({inputId:'current'});assert.deepEqual(r.calls.slice(1),[['bulbStop'],['drain']]);
});

test('a rejected competing BULB start cannot steal the input owner or stop an existing exposure',async()=>{
  const r=mainRig(),starting=r.context.api.startBulbFromControl({inputId:'desktop'});r.settle();await starting;
  r.context.cameraIdle=()=>{throw Error('Camera already exposing');};assert.throws(()=>r.context.api.startBulbFromControl({inputId:'remote'}),/exposing/);
  assert.equal((await r.context.api.stopBulbFromControl({inputId:'remote'})).released,false);assert.equal(r.calls.length,1);
  await r.context.api.stopBulbFromControl({inputId:'desktop'});assert.deepEqual(r.calls.slice(1),[['bulbStop'],['drain']]);
});
test('camera exposure callbacks are session-scoped and ignore queued time before accepted start',()=>{
  const received=[],context=vm.createContext({sessionEpoch:3,sessionEventsRegistered:true,bulbExposureSeconds:protocol.bulbExposureSeconds,state:{working:true,bulb:{status:'starting'}},bulb:{event:value=>received.push(value)},setImmediate:()=>{},camera:{},sdk:{command:()=>0}},{codeGeneration:{strings:false,wasm:false}});
  new vm.Script(section(worker,'function handleCameraState(','function registerWorkingEvents(')+'\nthis.api={handleCameraState,registerStateCallback};').runInContext(context,{timeout:1000});
  context.api.handleCameraState(0x310,50,2);context.api.handleCameraState(0x310,50,3);assert.deepEqual(received,[]);
  context.state.bulb.status='exposing';context.api.handleCameraState(0x310,1,3);context.api.handleCameraState(0x310,99,2);assert.deepEqual(received,[1]);
  context.sessionEpoch=4;context.api.handleCameraState(0x310,100,3);assert.deepEqual(received,[1]);
});
test('per-session native callbacks retain closures until SDK close and refuse unbounded registrations',()=>{
  const epochs=[],pointers=[],ports={sessionEpoch:1,callbacks:['object','property'],bindings:{StateEvent:'proto'},koffi:{pointer:value=>value,register:callback=>{pointers.push(callback);return callback;}},handleCameraState:(_event,_parameter,epoch)=>epochs.push(epoch),operationError:(code,message)=>Object.assign(Error(message),{code})};
  const context=vm.createContext(ports,{codeGeneration:{strings:false,wasm:false}});new vm.Script(section(worker,'function registerStateCallback(','function registerWorkingEvents(')+'\nthis.register=registerStateCallback;').runInContext(context,{timeout:1000});
  const old=context.register(1),fresh=context.register(2);old(0x310,99);fresh(0x310,1);assert.deepEqual(epochs,[1,2]);assert.equal(ports.callbacks.includes(old),true);assert.equal(ports.callbacks.includes(fresh),true);
  ports.callbacks.length=128;assert.throws(()=>context.register(3),error=>error.code==='OPERATION_ADMISSION_CLOSED');assert.equal(pointers.length,2);
});
