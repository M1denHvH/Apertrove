'use strict';
// Actual production functions with synthetic SDK ports; never imports a native module.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createCameraControl}=require('../../electron/camera-control.cjs');
const {modelCapabilities}=require('../../electron/camera-discovery.cjs');
const {PROPS}=require('../../electron/camera-values.cjs');
const root=path.resolve(__dirname,'../..'),worker=fs.readFileSync(path.join(root,'electron/camera-worker.cjs'),'utf8'),main=fs.readFileSync(path.join(root,'electron/main.cjs'),'utf8');
function section(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,start);return source.slice(a,b);}
function load(source,ports,exports){const context=vm.createContext(ports,{codeGeneration:{strings:false,wasm:false}});new vm.Script(source+'\n'+exports.map(name=>'this.'+name+'='+name+';').join('\n')).runInContext(context,{timeout:1000});return context;}
const fault=(code,message)=>Object.assign(Error(message),{code});

test('control-only preparation enables controls without SaveTo, Capacity or event registration',()=>{
  const reads=[],state={working:false,model:'Canon EOS 2000D'},context=load(section(worker,'function prepareControlSession()','\nasync function connect('),{
    sessionEventsRegistered:false,state,get:id=>{reads.push(id);return id===0x500?1:0;},modelCapabilities,refresh:()=>state
  },['prepareControlSession']);
  context.prepareControlSession();assert.deepEqual(reads,[0x500,0x501]);
  assert.equal(state.working,true);assert.equal(state.controlsOnly,true);assert.equal(state.eventsRegistered,false);assert.equal(state.saveTo,null);
  assert.equal(state.capabilities.capture,false);assert.equal(state.capabilities.import,false);assert.equal(state.capabilities.liveView,true);
  context.sessionEventsRegistered=true;assert.throws(()=>context.prepareControlSession(),/Отключите/);
});

test('worker connect cannot switch a capture session into control-only or upgrade it implicitly',async()=>{
  const effects=[],context=load(section(worker,'async function connect(','\nfunction clearCard'),{
    camera:{},state:{cameraId:'synthetic',working:true,controlsOnly:false},operationError:fault,
    setDeliveryRoute:()=>effects.push('route'),prepareControlSession:()=>effects.push('controls'),refresh:()=>effects.push('refresh')
  },['connect']);
  await assert.rejects(context.connect({cameraId:'synthetic',controlsOnly:true}),/Отключите/);assert.deepEqual(effects,[]);
  context.state.controlsOnly=true;await assert.rejects(context.connect({cameraId:'synthetic'}),/Отключите/);assert.deepEqual(effects,[]);
  await context.connect({cameraId:'synthetic',controlsOnly:true});assert.deepEqual(effects,['route','controls']);
});

test('main control-only connection skips flash/WIA probing and default preference persistence',async()=>{
  const calls=[],state={connected:false},source=section(main,'  const connectCamera=','  const handlers=');
  const context=load(source,{
    withRuntime:fn=>fn('synthetic-sdk'),call:async(method,args)=>{calls.push({method,args});return method==='listCameras'?[{id:'synthetic',model:'Canon EOS 2000D'}]:{connected:true,cameraId:'synthetic',controlsOnly:true};},
    emit:()=>{},store:{settings:{}},camera:state,flashBridge:{probe:()=>{throw Error('WIA must not run');}},persist:()=>{throw Error('normal connection preference must not persist');},quitting:false
  },['connectCamera']);
  await context.connectCamera({cameraId:'synthetic',controlsOnly:true});assert.equal(calls.length,2);assert.equal(calls[1].method,'connect');assert.equal(calls[1].args.controlsOnly,true);
});

test('control-only writes are restricted to exposure and explicit EVF properties',()=>{
  const calls=[],context=load(section(worker,'function set(id,value)','\nfunction probeData'),{Buffer,PROPS,state:{controlsOnly:true},sdk:{set:(_camera,id)=>{calls.push(id);return 0;}},camera:{},check:code=>assert.equal(code,0)},['set']);
  for(const id of [0xb,PROPS.whiteBalance,PROPS.colorTemperature,PROPS.afMode,0x400])assert.throws(()=>context.set(id,1),/недоступно/);
  assert.deepEqual(calls,[]);for(const id of [PROPS.iso,PROPS.shutter,PROPS.aperture,PROPS.compensation,0x500,0x501])context.set(id,1);
  assert.equal(calls.length,6);
});

function evfRig({output=1,mode=0,restoreMismatch=false}={}){
  const values=new Map([[0x500,output],[0x501,mode]]),writes=[],events=[],failures=[],state={controlsOnly:true,capabilities:{liveView:true}};
  const context=load(section(worker,'function restoreLiveView()','\nfunction readFocus'),{
    state,evfRestore:null,live:false,captureWait:null,controls:{isBusy:()=>false},ensureWorking:()=>{},
    get:id=>restoreMismatch&&context.evfRestore&&writes.length>=2?99:values.get(id),
    set:(id,value)=>{writes.push([id,value]);values.set(id,value);},status:()=>state,refresh:()=>state,releaseEvf:()=>{},
    performance:{now:()=>0},statsAt:0,statsFrames:0,statsBytes:0,teardownUncertain:false,currentOperation:null,
    observations:{failure:value=>failures.push(value)},send:value=>events.push(value),operationError:fault
  },['restoreLiveView','liveView']);
  return {context,values,writes,events,failures};
}

test('Live View requires both original properties and restores mode/output with exact read-back',()=>{
  for(const mode of [0,1]){
    const r=evfRig({output:1,mode});r.context.liveView({enabled:true});assert.equal(r.context.live,true);
    assert.equal(r.values.get(0x500),3);r.context.liveView({enabled:false});assert.equal(r.context.live,false);
    assert.equal(r.values.get(0x500),1);assert.equal(r.values.get(0x501),mode);assert.equal(r.context.evfRestore,null);
    assert.equal(r.context.state.evfState.output,1);assert.equal(r.context.state.evfState.mode,mode);
  }
  const missing=evfRig({mode:null});assert.throws(()=>missing.context.liveView({enabled:true}),/исходные/);assert.deepEqual(missing.writes,[]);assert.equal(missing.context.evfRestore,null);
});

test('failed EVF restoration preserves its original capsule and quarantines the native outcome',()=>{
  const r=evfRig({restoreMismatch:true});r.context.evfRestore={output:1,mode:0};
  assert.throws(()=>r.context.restoreLiveView(),error=>error.code==='OPERATION_UNKNOWN_TERMINATION');
  assert.equal(r.context.evfRestore.output,1);assert.equal(r.context.evfRestore.mode,0);assert.equal(r.context.teardownUncertain,true);
  assert.equal(r.events[0].data.classification,'UNKNOWN');assert.equal(r.failures.length,1);
});

test('control-only Live View stop reads actual AF state after restore and keeps persistent changes visible',()=>{
  const {choices,WHITE_BALANCE_COLOR_TEMPERATURE}=require('../../electron/camera-values.cjs');
  const stageSource=fs.readFileSync(path.join(root,'tests/native-hardware/h2-stages.cjs'),'utf8');
  const comparison=section(stageSource,'  const propertiesRestored=','\n  try{');
  for(const finalAF of [2,0]){
    const actions=[],values=new Map([[0x500,0],[0x501,1],[0x400,3],[PROPS.iso,88],[PROPS.shutter,123],[PROPS.aperture,80],[PROPS.whiteBalance,0],[PROPS.liveAfMode,0]]);
    const state={working:true,controlsOnly:true,model:'synthetic',properties:{},capabilities:{liveView:true}};let context,started=false;
    const source=section(worker,'function refresh()','\nfunction listCameras(')+section(worker,'const status =','\nconst errors=')+section(worker,'function restoreLiveView()','\nfunction readFocus')+comparison;
    context=load(source,{
      state,camera:{},restricted:false,PROPS,choices,WHITE_BALANCE_COLOR_TEMPERATURE,live:false,evfRestore:null,
      get:id=>{const value=id===PROPS.afMode?(context.live?0:started?finalAF:2):(values.get(id)??0);actions.push({kind:'read',id,value});return value;},
      set:(id,value)=>{assert.notEqual(id,PROPS.afMode);actions.push({kind:'write',id,value});values.set(id,value);if(id===0x500&&(value&2))started=true;},
      readData:()=>null,textProperty:()=>'',sdk:{desc:(_camera,_id,out)=>{out.values=[0,1,2];out.count=3;return 0;}},
      captureWait:null,controls:{isBusy:()=>false},ensureWorking:()=>{},releaseEvf:()=>actions.push({kind:'release'}),send:()=>{},
      performance:{now:()=>0},statsAt:0,statsFrames:0,statsBytes:0,teardownUncertain:false,currentOperation:null,observations:{failure:()=>{}},operationError:fault
    },['refresh','liveView','propertiesRestored']);
    // Both models start with AI Focus=2, then report One Shot=0 while EVF is on.
    const initial={camera:JSON.parse(JSON.stringify(context.refresh()))};assert.equal(initial.camera.properties.afMode.value,2);
    context.liveView({enabled:true});context.refresh();assert.equal(state.properties.afMode.value,0);
    const stopped=context.liveView({enabled:false});assert.equal(stopped.properties.afMode.value,finalAF);
    const lastRestore=actions.findLastIndex(item=>item.kind==='write'&&item.id===0x501);
    const release=actions.findLastIndex(item=>item.kind==='release');
    const finalRead=actions.findLastIndex(item=>item.kind==='read'&&item.id===PROPS.afMode);
    assert.ok(finalRead>release&&release>lastRestore,'AF must be read after EVF restoration and ref release');
    assert.equal(context.propertiesRestored(initial,{camera:stopped}),finalAF===2,'A persistent AF difference must still fail the unchanged baseline guard');
    assert.equal(actions.some(item=>item.kind==='write'&&item.id===PROPS.afMode),false);
  }
});

test('control-only FocusInfo never allocates or decodes an unqualified output buffer',()=>{
  const context=load(section(worker,'function readFocus()','\nfunction frame('),{state:{controlsOnly:true},sdk:{propertySize:()=>{throw Error('unqualified output');}}},['readFocus']);
  context.readFocus();
});

test('read-only status keeps every property unwritable despite cached descriptors',()=>{
  const context=load(section(worker,'const status =','\nconst errors='),{state:{working:false,properties:{iso:{writable:true,value:88}}},live:false,send:()=>{}},['status']);
  assert.equal(context.status().properties.iso.writable,false);
});

test('control-only capture and card traversal stop before SDK/file effects',async()=>{
  const ports={state:{controlsOnly:true,capabilities:{capture:false,reason:'disabled'}},ensure:()=>{},ensureWorking:()=>{},operationError:fault};
  const context=load(section(worker,'function capture(','\nfunction stopBurst'),ports,['capture']);assert.throws(()=>context.capture({}),/disabled/);
  const card=load(section(worker,'async function listCard()','\nconst controls='),ports,['listCard']);await assert.rejects(card.listCard(),/отключена/);
  for(const [name,end] of [['importCard','\n  producerFence:'],['destination',',status:']]){
    const source=section(worker,name+':async',end),context=load('const handler=({'+source+'}).'+name+';',{...ports},['handler']);
    await assert.rejects(context.handler({ids:['synthetic'],folder:'synthetic'},{}),error=>error.code==='OPERATION_ADMISSION_CLOSED');
  }
});

test('control-only AF requires live and returns only UNVERIFIED after one bounded live-AF pulse',async()=>{
  const commands=[],waits=[],logs=[];let live=false,elapsed=0;
  const control=createCameraControl({ensure:()=>{},isCapturing:()=>false,canFocus:()=>true,requiresLiveFocus:()=>true,focusConfirmationAvailable:()=>false,
    isLive:()=>live,now:()=>elapsed,wait:async ms=>{waits.push(ms);elapsed+=ms;},get:()=>0,
    command:(id,param)=>commands.push([id,param]),log:(level,message)=>logs.push({level,message}),focusState:()=>({sequence:0,status:'unknown'}),previewFocus:()=>{throw Error('implicit preview');}});
  await assert.rejects(control.autofocus(),/Live View/);await assert.rejects(control.focus({direction:'near'}),/Live View/);assert.deepEqual(commands,[]);
  live=true;const result=await control.autofocus();assert.deepEqual(commands,[[0x102,1],[0x102,0]]);assert.deepEqual(waits,[1000]);
  assert.equal(result.status,'unverified');assert.equal(result.confirmed,false);assert.equal(result.reason,'FOCUS_METADATA_UNQUALIFIED');
  assert.equal(logs.some(row=>row.level==='success'||row.message.includes('резкость подтверждена')),false);
  await control.focus({direction:'near',step:1});await control.focus({direction:'far',step:1});assert.deepEqual(commands.slice(2),[[0x103,1],[0x103,0x8001]]);
});

test('AF always attempts one owed OFF after a possibly dispatched ON exception or stopped live stream',async()=>{
  for(const onThrows of [true,false]){
    const commands=[];let live=true;
    const control=createCameraControl({ensure:()=>{},isCapturing:()=>false,canFocus:()=>true,requiresLiveFocus:()=>true,focusConfirmationAvailable:()=>false,
      isLive:()=>live,now:()=>0,wait:async()=>{live=false;},get:()=>0,
      command:(id,param)=>{commands.push([id,param]);if(param===1&&onThrows)throw Error('possibly dispatched ON');}});
    await assert.rejects(control.autofocus(),onThrows?/possibly dispatched ON/:/Live View/);
    assert.deepEqual(commands,[[0x102,1],[0x102,0]]);assert.equal(control.isBusy(),false);
  }
});

test('worker permits only the owed AF stop after Live View stops, never a shutter or lens command',()=>{
  const commands=[],source=section(worker,'  command:(id,param,action)=>','\n});');
  const context=load('const command=({'+source+'}).command;',{
    state:{controlsOnly:true},live:true,controlAfStopPending:false,ensure:()=>{},camera:{},get:id=>id===0x500?2:1,observed:(_name,_phase,fn)=>fn(),
    check:code=>assert.equal(code,0),sdk:{command:(_camera,id,param)=>{commands.push([id,param]);return 0;}}
  },['command']);
  context.command(0x102,1);context.live=false;
  for(const [id,param] of [[4,1],[0x103,1],[0x102,1]])assert.throws(()=>context.command(id,param),/разрешён/);
  context.command(0x102,0);assert.throws(()=>context.command(0x102,0),/разрешён/);
  assert.deepEqual(commands,[[0x102,1],[0x102,0]]);
});

test('EVF copies only a positive position bounded by a fresh GetLength result',()=>{
  function run(position,available){
    const copied=[],events=[],reads=[];const context=load(section(worker,'function frame(publish=true)','\nasync function previewFocus'),{
      state:{controlsOnly:true},camera:{},evfStream:{},evfImage:{},live:true,statsAt:0,statsFrames:0,statsBytes:0,totalFrames:0,evidence:{},
      sdk:{seek:()=>0,evf:()=>0,pointer:(_ref,out)=>{out[0]={opaque:true};return 0;},position:(_ref,out)=>{out[0]=position;return 0;},length:(_ref,out)=>{reads.push('length');out[0]=available;return 0;}},
      check:code=>assert.equal(code,0),readFocus:()=>{},copyNativeBuffer:(_ptr,size)=>{copied.push(size);return Buffer.alloc(size);},
      send:value=>events.push(value),performance:{now:()=>0},Date:{now:()=>0},restoreLiveView:()=>{},releaseEvf:()=>{},status:()=>{},log:()=>{},
      teardownUncertain:false,observations:{failure:()=>{}}
    },['frame']);
    context.frame();return {context,copied,reads,events};
  }
  const invalid=run(20,16);assert.deepEqual(invalid.reads,['length'],invalid.context.state.error);assert.deepEqual(invalid.copied,[]);assert.match(invalid.context.state.error,/границы/);
  assert.equal(invalid.context.teardownUncertain,true);assert.equal(invalid.events[0].data.classification,'UNKNOWN');
  const valid=run(8,16);assert.deepEqual(valid.reads,['length']);assert.deepEqual(valid.copied,[8]);assert.equal(valid.events[0].event,'frame');
});
