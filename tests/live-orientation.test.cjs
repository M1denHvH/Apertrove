const {test}=require('node:test'),assert=require('node:assert/strict');
const {ORIENTATION,confirmedOrientationModel,orientationRuntimeSupported,decodeOrientation,createLiveOrientation}=require('../electron/live-orientation.cjs');
const packet=(position,status=2)=>{const data=Buffer.alloc(16);data.writeInt32LE(status);data.writeInt32LE(position,4);data.writeInt32LE(-9000,8);data.writeInt32LE(2500,12);return data;};
function rig(overrides={}) {
  const calls=[],states=[];let clock=1000,body=packet(0);
  const control=createLiveOrientation({now:()=>clock,enable:()=>{calls.push('enable');return 0;},
    start:()=>{calls.push('start');return 0;},stop:()=>{calls.push('stop');return 0;},
    read:ref=>{calls.push(['read',ref]);return {code:0,buffer:body};},onState:s=>states.push(s),...overrides});
  return {control,calls,states,body:value=>body=value,tick:ms=>clock+=ms,
    prepare:()=>control.prepare({model:'Canon EOS R6',version:'3.18.40.0'})};
}

test('only Canon-confirmed families and documented runtime range can enable orientation',()=>{
  for(const model of ['Canon EOS R','EOS RP','EOS Ra','Canon EOS R6 Mark II','EOS R50','EOS R100','EOS-1D X Mark III','EOS 5D Mark IV','EOS 80D','EOS M50','EOS Kiss M2','EOS Rebel T8i','EOS 850D'])assert.equal(confirmedOrientationModel(model),true,model);
  for(const model of ['EOS 2000D','EOS Rebel T7','EOS 5D Mark III','EOS 90D','EOS M6','EOS Rebel','unknown',''])assert.equal(confirmedOrientationModel(model),false,model);
  for(const version of ['3.18.40.0','13.20.11','13.11.10'])assert.equal(orientationRuntimeSupported(version),true,version);
  for(const version of [null,'','3.11.9','2.15.0','3.9.10','future'])assert.equal(orientationRuntimeSupported(version),false,String(version));
  const r=rig();r.control.prepare({model:'EOS 2000D',version:'3.18.40.0'});r.control.start();r.control.sample('evf');
  r.control.prepare({model:'EOS R',version:'2.15.0'});assert.deepEqual(r.calls,[]);
});

test('current valid EVF posture becomes automatic capability and updates without restart',()=>{
  const r=rig();assert.equal(r.prepare().available,false);assert.equal(r.control.start().status,'starting');
  for(const [posture,degrees] of [[0,0],[1,90],[4,180],[2,270]]){
    r.body(packet(posture));const s=r.control.sample('owned-evf-ref');
    assert.deepEqual(s,{available:true,status:'active',rotation:degrees,source:'camera',reason:null});
  }
  assert.deepEqual(r.calls.filter(value=>typeof value==='string'),['enable','start']);
  assert.equal(r.calls.filter(Array.isArray).length,4);
  const count=r.states.length;r.control.sample('owned-evf-ref');assert.equal(r.states.length,count,'same posture does not flood status IPC');
});

test('unknown, transitional, truncated and failed samples clear automatic orientation',()=>{
  for(const invalid of [packet(3),packet(0,0),packet(0,1),packet(99),Buffer.alloc(15),Buffer.alloc(17)]){
    const r=rig();r.prepare();r.control.start();assert.equal(r.control.sample('evf').available,true);r.body(invalid);
    const s=r.control.sample('evf');assert.equal(s.available,false);assert.equal(s.rotation,null);assert.equal(s.source,null);
    r.body(packet(2));assert.equal(r.control.sample('evf').rotation,270);
  }
  for(const read of [()=>({code:0x50}),()=>{throw Error('synthetic read failure');}]){
    const r=rig({read});r.prepare();r.control.start();assert.equal(r.control.sample('evf').reason,'ORIENTATION_READ_FAILED');
  }
  assert.equal(decodeOrientation(null),null);assert.equal(decodeOrientation(packet(0)).rotation,0);
});

test('stale or stopped stream cannot retain a current automatic claim',()=>{
  const r=rig();r.prepare();r.control.start();r.control.sample('evf');r.tick(ORIENTATION.maximumAgeMs);assert.equal(r.control.expire().available,true);
  r.tick(1);assert.equal(r.control.expire().reason,'ORIENTATION_SAMPLE_STALE');
  assert.equal(r.control.sample('evf').available,true);assert.equal(r.control.stop().available,false);assert.equal(r.control.snapshot().rotation,null);
  const reads=r.calls.length;r.control.sample('evf');assert.equal(r.calls.length,reads);
  r.control.start();assert.equal(r.control.sample('evf').available,true);r.control.stop();r.control.stop();assert.equal(r.calls.filter(x=>x==='stop').length,2);
});

test('enable/start/stop failures keep manual fallback and retry owed output stop',()=>{
  const disabled=rig({enable:()=>0x7});disabled.prepare();disabled.control.start();assert.equal(disabled.control.snapshot().reason,'ORIENTATION_ENABLE_FAILED');assert.deepEqual(disabled.calls,[]);
  for(const start of [()=>0x7,()=>{throw Error('dispatch unknown');}]){
    const r=rig({start});r.prepare();assert.equal(r.control.start().reason,'ORIENTATION_START_FAILED');assert.equal(r.calls.at(-1),'stop');assert.equal(r.control.snapshot().available,false);
  }
  let count=0;const r=rig({stop:()=>++count===1?0x81:0});r.prepare();r.control.start();r.control.sample('evf');
  assert.equal(r.control.stop().reason,'ORIENTATION_STOP_UNCONFIRMED');const reads=r.calls.length;r.control.sample('evf');assert.equal(r.calls.length,reads);assert.equal(r.control.snapshot().available,false);assert.equal(r.control.start().reason,'ORIENTATION_STOP_UNCONFIRMED');assert.equal(r.prepare().reason,'ORIENTATION_STOP_UNCONFIRMED');
  assert.equal(r.control.stop().available,false);assert.equal(count,2);assert.equal(r.prepare().status,'ready');
});

test('disconnect drops stale EVF refs and reconnect requires fresh preparation and sample',()=>{
  const r=rig();r.prepare();r.control.start();r.control.sample('old-ref');assert.equal(r.control.disconnected().status,'disconnected');
  const before=r.calls.length;r.control.sample('old-ref');r.control.start();assert.equal(r.calls.length,before);
  r.prepare();r.control.start();assert.equal(r.control.snapshot().available,false);r.body(packet(4));assert.equal(r.control.sample('new-ref').rotation,180);
});

// Exercise actual worker source with synthetic SDK ports. Loading Koffi or a
// native library is deliberately impossible in these bounded VM contexts.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const worker=fs.readFileSync(path.join(__dirname,'../electron/camera-worker.cjs'),'utf8');
function section(start,end){const a=worker.indexOf(start),b=worker.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,start);return worker.slice(a,b);}
function load(source,ports,exports){const context=vm.createContext(ports,{codeGeneration:{strings:false,wasm:false}});new vm.Script(source+'\n'+exports.map(name=>'this.'+name+'='+name+';').join('\n')).runInContext(context,{timeout:1000});return context;}

test('worker orientation adapter uses exact documented buffer/command shapes and no EXIF ref',()=>{
  const calls=[],ref={opaque:'camera'},evf={opaque:'evf'},state={capabilities:{}};
  const context=load(section('function orientationCall(','\nconst bulb='),{
    createLiveOrientation,ORIENTATION,state,Buffer,camera:ref,live:true,status:()=>{},isUnsupportedCommand:code=>[1,7,0x2005].includes(code),
    observed:(_method,phase,fn)=>{calls.push(phase);return fn();},sdk:{
      set:(camera,property,param,size,data)=>{assert.equal(camera,ref);assert.equal(property,0x01000000);assert.equal(param,0x05b3740d);assert.equal(size,4);assert.equal(data.readUInt32LE(),0x01000544);return 0;},
      command:(camera,command,param)=>{assert.equal(camera,ref);assert.equal(command,0x109);assert.ok([0,1].includes(param));return 0;},
      get:(image,property,param,size,data)=>{assert.equal(image,evf);assert.equal(property,0x01000544);assert.equal(param,0);assert.equal(size,16);packet(1).copy(data);return 0;}
    }
  },['liveOrientation']);
  context.liveOrientation.prepare({model:'EOS R6',version:'3.18.40.0'});context.liveOrientation.start();context.liveOrientation.sample(evf);
  assert.equal(state.capabilities.liveOrientation,true);assert.equal(state.liveOrientation.rotation,90);
  context.liveOrientation.stop();assert.equal(state.capabilities.liveOrientation,false);
  assert.deepEqual(calls,['orientation-enable','orientation-start','orientation-frame','orientation-stop']);
});

test('optional sensor rejections retain fallback without suppressing unexpected native failures',()=>{
  const observed=[],context=load(section('function orientationCall(','\nconst liveOrientation='),{
    isUnsupportedCommand:code=>[1,7,0x2005].includes(code),
    observed:(method,phase,fn)=>{observed.push({method,phase});return fn();}
  },['orientationCall']);
  for(const code of [1,7,0x2005,0x50,0x60,0x81,0xa102])assert.equal(context.orientationCall('EdsGetPropertyData','orientation-frame',()=>code),code);
  assert.equal(observed.length,0,'expected unavailable telemetry never emits a quarantine observation');
  for(const code of [0,0x1234,null,-1,0x100000000])assert.equal(context.orientationCall('EdsGetPropertyData','orientation-frame',()=>code),code);
  assert.equal(observed.length,5);
  assert.throws(()=>context.orientationCall('EdsGetPropertyData','orientation-frame',()=>{throw Error('binding exception');}),/binding exception/);assert.equal(observed.length,6);
});

test('worker enables posture only before a fresh non-diagnostic OpenSession',async()=>{
  for(const [model,readOnly,enabled] of [['EOS R6',false,true],['EOS R6',true,false],['EOS 2000D',false,false]]){
    const calls=[],selected={id:'synthetic',model};
    const orientation=createLiveOrientation({enable:()=>{calls.push('orientation-enable');return 0;}});
    const context=load(section('async function connect(','\nfunction clearCard'),{
      camera:null,sdk:{list:out=>{out[0]='list';return 0;},count:(_ref,out)=>{out[0]=1;return 0;},child:(_ref,_i,out)=>{out[0]='camera';return 0;},info:()=>0},
      destination:'',sessionEpoch:0,evidence:{},state:{sdkPath:'synthetic.dll'},restricted:false,teardownUncertain:false,captureWait:null,
      controls:{isBusy:()=>false,servoConnected:()=>{}},transferProducer:{drain:async()=>{}},setDeliveryRoute:()=>{},load:()=>{},
      listCameras:()=>[selected],selectCamera:()=>selected,describeCamera:()=>selected,releaseRef:()=>true,check:code=>assert.equal(code,0),
      openCameraSession:()=>calls.push('open'),textProperty:()=>model,modelCapabilities:()=>({capture:true}),log:()=>{},refresh:()=>({}),prepareWorkingSession:()=>({}),disconnect:()=>{},
      fileVersion:async()=>{calls.push('file-version');return '3.18.40.0';},liveOrientation:orientation,status:()=>({})
    },['connect']);
    await context.connect({cameraId:'synthetic',readOnly,folder:'synthetic'});
    assert.equal(calls.includes('orientation-enable'),enabled);
    if(enabled)assert.ok(calls.indexOf('orientation-enable')<calls.indexOf('open'));
    if(readOnly)assert.deepEqual(calls,['open'],'diagnostic connections never prepare or start sensor output');
  }
});

test('worker starts angle output after live activation and stops it before EVF restoration',()=>{
  const calls=[],values=new Map([[0x500,1],[0x501,0]]);let context;
  const orientation=createLiveOrientation({enable:()=>0,start:()=>{assert.equal(context.live,true);calls.push('angle-start');return 0;},stop:()=>{assert.equal(context.live,true);calls.push('angle-stop');return 0;}});
  orientation.prepare({model:'EOS R6',version:'3.18.40.0'});
  context=load(section('function restoreLiveView()','\nfunction readFocus'),{
    liveOrientation:orientation,state:{capabilities:{liveView:true}},evfRestore:null,live:false,captureWait:null,controls:{stopServo:()=>{},isBusy:()=>false},ensureWorking:()=>{},
    get:id=>values.get(id),set:(id,value)=>{calls.push(['set',id,value]);values.set(id,value);},status:()=>{},releaseEvf:()=>{},performance:{now:()=>0},statsAt:0,statsFrames:0,statsBytes:0
  },['liveView']);
  context.liveView({enabled:true});context.liveView({enabled:false});
  assert.deepEqual(calls,[['set',0x501,1],['set',0x500,3],'angle-start','angle-stop',['set',0x500,1],['set',0x501,0]]);
});
