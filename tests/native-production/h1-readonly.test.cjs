'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'../..');
const worker=fs.readFileSync(path.join(root,'electron/camera-worker.cjs'),'utf8');
const main=fs.readFileSync(path.join(root,'electron/main.cjs'),'utf8');

function section(source,startMarker,endMarker){
  const start=source.indexOf(startMarker);
  const end=source.indexOf(endMarker,start+startMarker.length);
  assert.ok(start>=0&&end>start,'missing source section '+startMarker);
  return source.slice(start,end);
}

test('cameraDiagnose refuses to turn a working session into a read-only claim',()=>{
  const source=section(main,'cameraDiagnose:async','cameraWorking:async');
  assert.match(source,/camera\.connected&&camera\.working!==false/);
  assert.match(source,/readOnly:true/);
  assert.match(source,/diagnoseCamera/);
  assert.match(source,/workerState\?\.issue/);
  assert.match(source,/OPERATION_UNKNOWN_TERMINATION/);
});

test('read-only connect never enters working SaveTo or capacity setup',()=>{
  const source=section(worker,'async function connect(','\nfunction clearCard');
  assert.match(source,/readOnly/);
  assert.match(source,/return readOnly\?refresh\(\):prepareWorkingSession/);
  assert.doesNotMatch(source,/readOnly\s*&&\s*prepareWorkingSession/);
  assert.doesNotMatch(source,/sdk\.set\(|sdk\.capacity|sdk\.command|capture\(/);
  const working=worker.slice(worker.indexOf('function prepareWorkingSession('),worker.indexOf('\nasync function connect('));
  assert.match(working,/set\(0xb/);
  assert.match(working,/sdk\.capacity/);
});

test('read-only connect opens one session without registering native event handlers',async()=>{
  const source=section(worker,'async function connect(','\nfunction clearCard');
  const calls=[];
  const selected={id:'synthetic-camera',model:'EOS synthetic'};
  const context=vm.createContext({
    camera:null,sdk:{list(out){out[0]='list';return 0;},count(_ref,out){out[0]=1;return 0;},child(_ref,_index,out){out[0]='camera';return 0;},info(){return 0;},
      objectHandler(){calls.push('objectHandler');return 0;},propertyHandler(){calls.push('propertyHandler');return 0;},stateHandler(){calls.push('stateHandler');return 0;}},
    destination:'',sessionEpoch:0,evidence:{},state:{},restricted:false,teardownUncertain:false,captureWait:null,
    controls:{isBusy:()=>false,servoConnected:()=>calls.push('servo-session-reset')},transferProducer:{drain:async()=>{}},setDeliveryRoute:()=>{},load:()=>{},
    listCameras:()=>[selected],selectCamera:()=>selected,describeCamera:()=>selected,
    releaseRef:()=>true,check(code){assert.equal(code,0);},openCameraSession(){calls.push('open');},
    textProperty:()=>selected.model,modelCapabilities:()=>({capture:true}),log:()=>{},
    refresh(){calls.push('refresh');return {connected:true};},
    prepareWorkingSession(){calls.push('prepareWorkingSession');},disconnect(){calls.push('disconnect');},
    status:()=>({}),operationError:(code,message)=>Object.assign(Error(message),{code})
  });
  new vm.Script(source+'\nthis.connect=connect;').runInContext(context);
  await context.connect({cameraId:selected.id,readOnly:true,folder:'synthetic'});
  assert.deepEqual(calls,['open','servo-session-reset','refresh']);
  assert.equal(context.state.working,false);
  assert.equal(context.state.eventsRegistered,false);
  assert.equal(context.state.saveTo,null);
});

test('working event registrations are idempotent and H1 reports them as untested',()=>{
  const source=section(worker,'function registerWorkingEvents(','\nfunction prepareWorkingSession');
  const calls=[];
  const context=vm.createContext({sessionEventsRegistered:false,camera:'camera',callbacks:['object','property','state'],state:{},
    sdk:Object.fromEntries(['objectHandler','propertyHandler','stateHandler'].map(name=>[name,()=>{calls.push(name);return 0;}])),check:code=>assert.equal(code,0)});
  new vm.Script(source+'\nthis.registerWorkingEvents=registerWorkingEvents;').runInContext(context);
  context.registerWorkingEvents();context.registerWorkingEvents();
  assert.deepEqual(calls,['objectHandler','propertyHandler','stateHandler']);
  assert.equal(context.state.eventsRegistered,true);
  const {capabilityReport}=require('../../electron/camera-capabilities.cjs');
  const rows=capabilityReport({state:{properties:{},eventsRegistered:false},read:()=>({code:0x50}),storage:{volumes:[],unverifiedLayout:true},exports:{},restricted:false});
  assert.equal(rows.find(row=>row.id==='events').status,'unknown');
  assert.match(rows.find(row=>row.id==='transfer').detail,/Диагностика не принимает файлы/);
});

test('diagnoseCamera is a read-only report path',()=>{
  const source=section(worker,'async function diagnoseCamera(','\nfunction prepareWorkingSession');
  assert.match(source,/refresh\(\)/);
  assert.match(source,/cameraStorage\(\)/);
  assert.match(source,/capabilityReport/);
  assert.doesNotMatch(source,/sdk\.set\(/);
  assert.doesNotMatch(source,/sdk\.capacity/);
  assert.doesNotMatch(source,/sdk\.command/);
});

test('H1 capability diagnosis does not invoke the ABI-unverified VolumeInfo struct',()=>{
  const source=section(worker,'function cameraStorage()','\nasync function diagnoseCamera');
  assert.doesNotMatch(source,/sdk\.volume/);
  assert.match(source,/unverifiedLayout:'EdsGetVolumeInfo'/);
  const report=section(fs.readFileSync(path.join(root,'electron/camera-capabilities.cjs'),'utf8'),'function capabilityReport(','\nmodule.exports');
  assert.match(report,/storage\.unverifiedLayout/);
  assert.match(report,/EdsGetVolumeInfo layout is not qualified/);
});

test('all native reference releases pass through the sentinel-aware helper',()=>{
  const direct=worker.match(/sdk\.release\(/g)||[];
  assert.equal(direct.length,1,'only releaseRef may call EdsRelease directly');
  assert.match(worker,/count===0xffffffff/);
  assert.match(worker,/OPERATION_UNKNOWN_TERMINATION/);
  assert.match(main,/channel\.nativeIssue\)throw Object\.assign\(Error\(t\('operation\.unknown'\)\)/);
});

test('EdsRelease zero is valid and sentinel is UNKNOWN',()=>{
  const start=worker.indexOf('function releaseRef(');
  const end=worker.indexOf('\nfunction openCameraSession',start);
  const source=worker.slice(start,end);
  const observations={failures:[],failure(input){this.failures.push(input);}};
  const events=[];
  const context=vm.createContext({
    sdk:{release:()=>0},teardownUncertain:false,currentOperation:null,quarantinedNativeRefs:new Set(),observations,send:e=>events.push(e),
    observed:(method,phase,fn,kind)=>{const code=fn();if(kind==='reference-count'&&code===0xffffffff){observations.failure({method,phase,code});events.push({data:{code}});}return code;}
  });
  new vm.Script(source+'\nthis.releaseRef=releaseRef;').runInContext(context);
  assert.equal(context.releaseRef('ref','h1-release'),true);
  assert.equal(context.teardownUncertain,false);
  context.sdk.release=()=>0xffffffff;
  assert.equal(context.releaseRef('ref','h1-release'),false);
  assert.equal(context.teardownUncertain,true);
  assert.ok(context.quarantinedNativeRefs.has('ref'));
  assert.equal(observations.failures.length,1);
  assert.equal(events[0].data.code,0xffffffff);
});

test('OpenSession binding exception preserves UNKNOWN while a returned EdsError is a normal failed open',()=>{
  const start=worker.indexOf('function openCameraSession(');
  const end=worker.indexOf('\nconst transferProducer=',start);
  const source=worker.slice(start,end);
  const operationError=(code,message)=>Object.assign(Error(message),{code});
  const run=sdk=>{
    const observations={failures:[],failure(input){this.failures.push(input);}};
    const events=[];
    const context=vm.createContext({sdk,camera:{},teardownUncertain:false,sessionOpened:false,observations,currentOperation:null,send:event=>events.push(event),
      check(code){if(code)throw Object.assign(Error('EdsOpenSession failed'),{code});},
      operationError});
    new vm.Script(source+'\nthis.openCameraSession=openCameraSession;').runInContext(context);
    return {context,observations,events};
  };
  const failed=run({open:()=>0x1});
  assert.throws(()=>failed.context.openCameraSession(),error=>error.code===1);
  assert.equal(failed.context.teardownUncertain,false);
  assert.equal(failed.observations.failures.length,0);
  const thrown=run({open:()=>{throw Error('binding exception');}});
  assert.throws(()=>thrown.context.openCameraSession(),error=>error.code==='OPERATION_UNKNOWN_TERMINATION');
  assert.equal(thrown.context.teardownUncertain,true);
  assert.equal(thrown.observations.failures.length,1);
  assert.equal(thrown.events.length,1);
  const ok=run({open:()=>0});
  ok.context.openCameraSession();
  assert.equal(ok.context.sessionOpened,true);
  assert.equal(ok.context.teardownUncertain,false);
});

test('transfer retain sentinel is rejected before scheduling a download',()=>{
  const {createTransferProducer}=require('../../electron/transfer-producer.cjs');
  const issues=[],scheduled=[];
  const producer=createTransferProducer({
    contexts:{admit:()=>({transferId:'h1',sessionEpoch:1,destination:'synthetic'})},
    getEpoch:()=>1,getSdk:()=>({retain:()=>0xffffffff,release:()=>0}),
    isConnected:()=>true,download:()=>{},schedule:job=>scheduled.push(job),onIssue:value=>issues.push(value)
  });
  assert.throws(()=>producer.admit('camera-ref'),error=>error.code==='OPERATION_UNKNOWN_TERMINATION');
  assert.equal(scheduled.length,0);
  assert.equal(producer.snapshot().accepted,0);
  assert.equal(producer.snapshot().failed,1);
  assert.equal(issues[0].code,'TRANSFER_REFERENCE_RETAIN_FAILED');
});

test('H1 diagnostics retain the existing end-diagnostics ownership guard',()=>{
  const start=main.indexOf('cameraEndDiagnostics:');
  assert.ok(start>=0);
  const source=main.slice(start,start+140);
  assert.match(source,/camera\.connected&&camera\.working===false/);
  assert.match(source,/disconnect/);
});

test('IC01 smoke provenance distinguishes tested HEAD from baseline',()=>{
  const smoke=fs.readFileSync(path.join(root,'tests/ic01/smoke.cjs'),'utf8');
  assert.match(smoke,/testedHead=cp\.execFileSync\('git',\['rev-parse','HEAD'\]/);
  assert.match(smoke,/APERTROVE_SOURCE_COMMIT\.toLowerCase\(\),testedHead/);
  assert.match(smoke,/baselineCommit/);
  assert.match(smoke,/sourceCommit:testedHead/);
});
