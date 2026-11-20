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
