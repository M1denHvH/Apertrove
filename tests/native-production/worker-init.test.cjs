'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createSdkInitializationGate}=require('../../electron/sdk-initialization.cjs');

const workerSource=fs.readFileSync(path.join(__dirname,'../../electron/camera-worker.cjs'),'utf8');

test('a successful worker initialization cannot be invoked twice',()=>{
  const gate=createSdkInitializationGate();let calls=0;
  assert.equal(gate.run(()=>++calls),1);
  assert.equal(gate.attempted,true);
  assert.throws(()=>gate.run(()=>++calls),error=>error.code==='SDK_INIT_ALREADY_ATTEMPTED');
  assert.equal(calls,1);
});

test('a rejected or thrown initialization remains consumed',()=>{
  for(const initialize of [
    ()=>{throw Object.assign(Error('synthetic SDK failure'),{code:0x1});},
    ()=>{throw Error('synthetic binding exception');}
  ]){
    const gate=createSdkInitializationGate();
    assert.throws(()=>gate.run(initialize));
    assert.equal(gate.attempted,true);
    assert.throws(()=>gate.run(()=>assert.fail('second native attempt')),error=>error.code==='SDK_INIT_ALREADY_ATTEMPTED');
  }
});

test('worker candidate loop stops after its first attempted SDK initialization',()=>{
  const start=workerSource.indexOf('function load(custom) {');
  const end=workerSource.indexOf('\nfunction loadCandidate(',start);
  assert.ok(start>=0&&end>start);
  const loadSource=workerSource.slice(start,end);
  const loadCandidateStart=workerSource.indexOf('initializationGate.run(()=>check(sdk.init()',end);
  assert.ok(loadCandidateStart>=end,'the actual worker marks the attempt through the sticky gate immediately before EdsInitializeSDK');
  let attempts=0,cleans=0;
  const context=vm.createContext({
    operationError:(code,message)=>Object.assign(Error(message),{code}),
    sdkCandidates:()=>[{file:'first.dll',architecture:'x64',result:'candidate'},{file:'second.dll',architecture:'x64',result:'candidate'}],
    process:{arch:'x64'},environmentChecks:[],initializationGate:{attempted:false,run(fn){this.attempted=true;return fn();}},
    initialized:false,teardownUncertain:false,sdk:null,
    loadCandidate(file){
      attempts++;
      if(file==='first.dll')context.initializationGate.run(()=>{context.sdk={};throw Error('synthetic init failure');});
      else assert.fail('Fallback must require a new worker');
    },
    releaseSdk(){cleans++;context.sdk=null;return true;}
  },{codeGeneration:{strings:false,wasm:false}});
  new vm.Script(loadSource+'\nthis.load=load;').runInContext(context,{timeout:1000});
  assert.throws(()=>context.load(),/Не удалось загрузить SDK Canon/);
  assert.throws(()=>context.load(),/Не удалось загрузить SDK Canon/);
  assert.equal(attempts,1);
  assert.equal(cleans,1);
  assert.equal(context.environmentChecks[0].result,'error');
  assert.equal(context.environmentChecks[1].result,'candidate');
});

test('a worker recheck is rejected before any SDK runtime work',async()=>{
  const start=workerSource.indexOf('async function sdkEnvironment(');
  const end=workerSource.indexOf('\nfunction cameraStorage(',start);
  assert.ok(start>=0&&end>start);
  const context=vm.createContext({
    operationError:(code,message)=>Object.assign(Error(message),{code}),
    load(){assert.fail('recheck must not reload in this worker');},
    teardownUncertain:false,sdk:null,camera:null,state:{sdkPath:null},environmentChecks:[],
    process:{arch:'x64'},fileVersion:async()=>null
  },{codeGeneration:{strings:false,wasm:false}});
  new vm.Script(workerSource.slice(start,end)+'\nthis.sdkEnvironment=sdkEnvironment;').runInContext(context,{timeout:1000});
  await assert.rejects(context.sdkEnvironment({sdkDir:'synthetic',recheck:true}),error=>error.code==='OPERATION_ADMISSION_CLOSED');
});
