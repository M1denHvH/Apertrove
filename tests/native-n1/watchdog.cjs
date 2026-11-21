'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {startSupervisor,classifyOutcome}=require('./job-control.cjs');
const {superviseChild}=require('./supervised-process.cjs');

const root=path.resolve(__dirname,'../..');
const base=path.join(root,'qa','native-n2-admission','watchdog-tests');
const supervisorScript=path.join(__dirname,'job-supervisor.ps1');
const fixture=path.join(__dirname,'watchdog-fixture.cjs');
const controllerFixture=path.join(__dirname,'watchdog-controller-fixture.cjs');
const powershell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
const runId=crypto.randomUUID();
fs.mkdirSync(base,{recursive:true});

function folder(name){const dir=path.join(base,name+'-'+crypto.randomUUID());fs.mkdirSync(dir,{recursive:true});return dir;}
const active=new Set(),controllers=new Set();
const controllerTrees=[];
async function cleanup(){
  for(const s of active){
    if(!s.supervisor.failed){
      try{await s.supervisor.close();}catch{try{s.supervisor.terminateHostForTest();}catch{}}
    }
    await s.supervisor.waitForExit(3500).catch(()=>{try{s.supervisor.terminateHostForTest();}catch{}});
    if(s.child.exitCode===null&&s.child.signalCode===null){s.child.kill();await waitClose(s.child,3000).catch(()=>{});}
    for(const pid of s.descendants)assert.equal(await waitPidGone(pid,3500),true,'Generated descendant still running after job cleanup: '+pid);
    active.delete(s);
  }
  for(const controller of controllers){
    if(controller.exitCode===null&&controller.signalCode===null){controller.kill();await waitClose(controller,3000).catch(()=>{});}
    controllers.delete(controller);
  }
  for(const tree of controllerTrees.splice(0)){
    // The supervisor's own 10s bound remains responsible after controller death.
    assert.equal(await waitPidGone(tree.supervisorPid,14000),true,'Independent supervisor exceeded test bound');
    assert.equal(await waitPidGone(tree.hostPid,5000),true,'Detached supervisor host exceeded cleanup bound');
    assert.equal(await waitPidGone(tree.rootPid,5000),true,'Controller fixture root survived supervisor cleanup');
    assert.equal(await waitPidGone(tree.descendantPid,5000),true,'Controller fixture descendant survived cleanup');
  }
}
test.afterEach(cleanup);
test.after(cleanup);
async function start(mode,{testOnly=false,maxLifetimeMs=10000}={}){
  const dir=folder(mode),temp=path.join(dir,'temp'),profile=path.join(dir,'profile');
  fs.mkdirSync(temp);fs.mkdirSync(profile);
  const supervisor=await startSupervisor({powershell,script:supervisorScript,logPath:path.join(dir,'supervisor.jsonl'),tempPath:temp,maxLifetimeMs,testOnly});
  const child=spawn(process.execPath,['--no-addons',fixture,mode,'--test-marker='+runId],{
    cwd:dir,
    env:{SystemRoot:process.env.SystemRoot,WINDIR:process.env.SystemRoot,PATH:path.join(process.env.SystemRoot||'C:\\Windows','System32'),TEMP:temp,TMP:temp,APPDATA:profile,LOCALAPPDATA:profile,NODE_OPTIONS:'',NODE_PATH:'',N2_TEST_RUN_ID:runId},
    windowsHide:true,
    stdio:['ignore','ignore','pipe','ipc']
  });
  const descendants=new Set(),entry={dir,temp,profile,supervisor,child,descendants,stderr:()=>stderr};
  active.add(entry);
  let stderr='';
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString('utf8')).slice(-8192);});
  child.on('message',message=>{if(message?.run===runId&&message.event==='descendant-ready'&&Number.isInteger(message.pid))descendants.add(message.pid);});
  const ready=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('SYNTHETIC_CHILD_READY_TIMEOUT')),3000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.on('message',message=>{if(message?.run===runId&&message.event==='ready'){clearTimeout(timer);resolve(message);}});
  });
  try{await ready;}catch(error){child.kill();await supervisor.request('terminateTree');throw Error(error.message+' '+stderr);}
  const assigned=await supervisor.request('assign',{pid:child.pid,imagePath:process.execPath,expectedParentPid:process.pid,commandMarker:runId});
  if(!assigned.ok){child.kill();await supervisor.request('terminateTree');throw Error('SYNTHETIC_JOB_ASSIGN_FAILED: '+JSON.stringify(assigned));}
  return entry;
}
function waitClose(child,ms=4000){
  if(child.exitCode!==null||child.signalCode!==null)return Promise.resolve({code:child.exitCode,signal:child.signalCode});
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.removeListener('close',onClose);reject(Error('SYNTHETIC_CHILD_CLOSE_TIMEOUT'));},ms);
    const onClose=(code,signal)=>{clearTimeout(timer);resolve({code,signal});};
    child.once('close',onClose);
  });
}
async function state(supervisor){const response=await supervisor.request('status');assert.equal(response.ok,true);return response.state;}
async function shutdown(supervisor){const response=await supervisor.close();assert.equal(response?.ok,true);assert.equal(response?.result?.processTreeExitConfirmed,true);}
function send(child,action,extra={}){child.send({run:runId,action,...extra});}
function readEvents(file){return fs.readFileSync(file,'utf8').split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));}
async function descendant(s){
  const spawned=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{s.child.removeListener('message',receive);reject(Error('SYNTHETIC_DESCENDANT_READY_TIMEOUT'));},2500);
    function receive(message){if(message?.run===runId&&message.event==='descendant-ready'){clearTimeout(timer);s.child.removeListener('message',receive);resolve(message.pid);}}
    s.child.on('message',receive);
  });
  send(s.child,'spawn-descendant');
  const pid=await spawned;
  const observed=await state(s.supervisor);
  assert.equal(observed.querySucceeded,true);
  assert.ok(observed.activeProcesses>=2&&observed.processIds.includes(s.child.pid)&&observed.processIds.includes(pid));
  return pid;
}
async function waitPidGone(pid,ms=5000){
  const deadline=performance.now()+ms;
  while(performance.now()<deadline){
    try{process.kill(pid,0);}catch(error){if(error.code==='ESRCH')return true;}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  return false;
}

test('Synthetic worker clean exit is distinguished from a nonzero exit',async t=>{
  for(const code of [0,7])await t.test('exit '+code,async()=>{
    const s=await start('hold'),run=superviseChild({child:s.child,supervisor:s.supervisor,timeoutMs:2500});
    send(s.child,'exit',{code});
    const result=await run;
    assert.equal(result.disposition,code===0?'CLEAN_EXIT':'NONZERO_EXIT');
    assert.equal(result.processClosed,true);assert.equal(result.jobStatus.activeProcesses,0);
    await shutdown(s.supervisor);
  });
});

test('Synthetic immediate exception exits nonzero and is never a clean cycle',async()=>{
  const s=await start('exception'),run=superviseChild({child:s.child,supervisor:s.supervisor,timeoutMs:2500});
  send(s.child,'crash');
  const result=await run;
  assert.equal(result.processClosed,true);assert.notEqual(result.code,0);
  assert.equal(result.disposition,'NONZERO_EXIT');
  await shutdown(s.supervisor);
});

test('Timeout with child ignoring graceful stop forces and confirms process exit',async()=>{
  const s=await start('hold'),run=superviseChild({child:s.child,supervisor:s.supervisor,timeoutMs:250,rootGraceMs:1500,treeGraceMs:1500});
  send(s.child,'graceful-stop');
  const result=await run;
  assert.equal(result.timedOut,true);assert.equal(result.rootRequest?.requestAccepted,true);
  assert.equal(result.disposition,'TIMED_OUT_EXIT_CONFIRMED');assert.equal(result.jobStatus.activeProcesses,0);
  await shutdown(s.supervisor);
});

test('Child exit during descendant escalation is still classified as forced',async()=>{
  const s=await start('grandchild-exit-on-stop');
  const descendantPid=await descendant(s);
  send(s.child,'graceful-stop');
  const root=await waitClose(s.child);
  assert.equal(root.code,0);
  const afterRoot=await state(s.supervisor);
  assert.equal(afterRoot.rootSignaled,true);assert.equal(afterRoot.rootExitCode,0);
  // Windows console lifetime can also end the descendant before escalation.
  // We still request tree termination and verify actual zero process accounting.
  assert.ok(afterRoot.activeProcesses===0||afterRoot.processIds.includes(descendantPid));
  const kill=await s.supervisor.request('terminateTree');
  assert.equal(kill.requestAccepted,true);
  let afterTree=await state(s.supervisor);
  const deadline=performance.now()+3000;
  while(afterTree.querySucceeded&&afterTree.activeProcesses>0&&performance.now()<deadline){await new Promise(r=>setTimeout(r,100));afterTree=await state(s.supervisor);}
  assert.equal(afterTree.querySucceeded,true);assert.equal(afterTree.activeProcesses,0);
  assert.equal(classifyOutcome({processClosed:true,exitCode:0,signal:null,terminationRequested:true,jobStatus:afterTree}),'FORCED_TERMINATION_CONFIRMED');
  assert.equal(await waitPidGone(descendantPid),true);
  await shutdown(s.supervisor);
});

test('Root exit racing a timeout escalation is verified by superviseChild, never a clean cycle',async()=>{
  const s=await start('grandchild-exit-on-stop');
  const descendantPid=await descendant(s);
  let raced=false;
  const controlledRace={
    ...s.supervisor,
    async request(command,payload={},timeout){
      if(command==='terminateProcess'&&!raced){
        raced=true;
        // Delay the real termination request until a real OS exit occurs.
        // The actual supervisor still queries its retained process handle.
        send(s.child,'graceful-stop');
        await waitClose(s.child,2500);
      }
      return s.supervisor.request(command,payload,timeout);
    }
  };
  const result=await superviseChild({child:s.child,supervisor:controlledRace,timeoutMs:150,rootGraceMs:500,treeGraceMs:1000});
  assert.equal(raced,true);assert.equal(result.timedOut,true);
  assert.equal(result.processClosed,true);assert.equal(result.code,0);
  assert.equal(result.jobStatus.rootSignaled,true);assert.equal(result.jobStatus.rootExitCode,0);
  assert.equal(result.jobStatus.activeProcesses,0);
  assert.equal(result.disposition,'TIMED_OUT_EXIT_CONFIRMED');
  assert.equal(await waitPidGone(descendantPid),true);
  await shutdown(s.supervisor);
});

test('A failed process-tree query produces UNKNOWN even after root close',async()=>{
  const s=await start('hold',{testOnly:true,maxLifetimeMs:10000});
  send(s.child,'exit',{code:0});
  const closed=await waitClose(s.child);
  const fault=await s.supervisor.request('testFaultQuery');
  assert.equal(fault.ok,true);
  const observed=await state(s.supervisor);
  assert.equal(observed.querySucceeded,false);
  const result=await superviseChild({child:s.child,supervisor:s.supervisor,timeoutMs:100,rootGraceMs:200,treeGraceMs:200,handoffMs:1000});
  assert.equal(result.processClosed,true);assert.equal(result.code,closed.code);
  assert.equal(result.disposition,'UNKNOWN');assert.equal(result.jobStatus.querySucceeded,false);
  assert.equal(result.supervisorHandoff?.ok,true);
  const final=await s.supervisor.waitForExit(7000);
  assert.notEqual(final.code,0);
  const receipt=readEvents(s.supervisor.logPath).find(event=>event.kind==='final');
  assert.equal(receipt?.processTreeExitConfirmed,false);
  assert.equal(receipt?.disposition,'UNKNOWN_KILL_ON_JOB_CLOSE_REQUESTED');
});

test('Controller pipe interruption bounds cleanup of a synthetic descendant tree',async()=>{
  const s=await start('grandchild');
  const descendantPid=await descendant(s);
  s.supervisor.endControlPipe();
  const exits=await Promise.all([waitClose(s.child,5000),s.supervisor.waitForExit(7000)]);
  assert.equal(exits[1].code,0);
  const final=readEvents(path.join(s.dir,'supervisor.jsonl')).find(event=>event.kind==='final');
  assert.equal(final?.processTreeExitConfirmed,true);
  assert.equal(final?.finalState?.activeProcesses,0);
  assert.equal(await waitPidGone(descendantPid),true);
});

test('Killing the independent supervisor closes its job and its synthetic tree',async()=>{
  const s=await start('grandchild',{testOnly:true});
  const descendantPid=await descendant(s);
  const terminate=await s.supervisor.terminateSupervisorForTest();
  assert.equal(terminate?.requestAccepted,true);
  const exits=await Promise.all([s.supervisor.waitForExit(6000),waitClose(s.child,6000)]);
  assert.notEqual(exits[0].code,0);
  assert.equal(await waitPidGone(descendantPid),true);
  assert.equal(await waitPidGone(s.child.pid),true);
  // Unexpected supervisor death cannot provide a final job census.
  assert.equal(classifyOutcome({processClosed:true,exitCode:exits[1].code,signal:exits[1].signal,jobStatus:null,supervisorAvailable:false}),'UNKNOWN');
});

test('Abrupt controller process death leaves independent job cleanup operational',async()=>{
  const dir=folder('controller-interruption');
  const controller=spawn(process.execPath,['--no-addons',controllerFixture,dir],{
    cwd:dir,windowsHide:true,stdio:['ignore','ignore','pipe','ipc'],
    env:{SystemRoot:process.env.SystemRoot,WINDIR:process.env.SystemRoot,PATH:path.join(process.env.SystemRoot,'System32'),TEMP:dir,TMP:dir,NODE_OPTIONS:'',NODE_PATH:'',N2_TEST_RUN_ID:runId,N2_WATCHDOG_CONTROLLER:'synthetic-only'}
  });
  controllers.add(controller);
  let stderr='';
  controller.stderr.on('data',b=>{stderr=(stderr+b.toString('utf8')).slice(-8192);});
  const tree=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('SYNTHETIC_CONTROLLER_HANDSHAKE_TIMEOUT '+stderr)),5000);
    controller.once('error',reject);
    controller.on('message',m=>{
      if(m?.run===runId&&m.event==='controlled-tree-ready'){clearTimeout(timer);resolve(m);}
      else if(m?.event==='controller-error'){clearTimeout(timer);reject(Error(m.error+' '+stderr));}
    });
  });
  controllerTrees.push(tree);
  assert.equal(tree.controllerPid,controller.pid);
  assert.ok(tree.state.processIds.includes(tree.rootPid)&&tree.state.processIds.includes(tree.descendantPid));
  assert.equal(controller.kill(),true);
  await waitClose(controller,5000);
  assert.equal(await waitPidGone(tree.rootPid,7000),true);
  assert.equal(await waitPidGone(tree.descendantPid,7000),true);
  assert.equal(await waitPidGone(tree.supervisorPid,7000),true);
  assert.equal(await waitPidGone(tree.hostPid,7000),true);
  const events=readEvents(tree.logPath),final=events.find(event=>event.kind==='final');
  assert.ok(final,'Independent supervisor did not persist a final disposition');
  assert.equal(final.processTreeExitConfirmed,true);
  assert.equal(final.finalState.activeProcesses,0);
  const hostEvents=readEvents(tree.logPath+'.host.jsonl');
  assert.ok(hostEvents.some(event=>event.kind==='controller-input-ended'));
  assert.ok(hostEvents.some(event=>event.kind==='host-final'&&event.helperClosed===true));
});

test('An open idle control pipe cannot block the 10s monotonic hard deadline',async()=>{
  const started=performance.now();
  const s=await start('grandchild',{maxLifetimeMs:10000});
  const descendantPid=await descendant(s);
  // Leave the control pipe open and send no command until the deadline fires.
  const result=await Promise.all([s.supervisor.waitForExit(14000),waitClose(s.child,14000)]);
  const elapsed=performance.now()-started;
  assert.ok(elapsed>=8500&&elapsed<14000,'Hard deadline was not bounded: '+elapsed);
  assert.equal(result[0].code,0);
  const final=readEvents(s.supervisor.logPath).find(event=>event.kind==='final');
  assert.equal(final?.reason,'SUPERVISOR_HARD_DEADLINE');
  assert.equal(final?.processTreeExitConfirmed,true);
  assert.equal(final?.finalState?.activeProcesses,0);
  assert.equal(await waitPidGone(descendantPid),true);
});

test('All failure to confirm evidence is UNKNOWN, never clean',()=>{
  for(const state of [
    {querySucceeded:false,activeProcesses:0},
    {querySucceeded:true,activeProcesses:1},
    null
  ])assert.equal(classifyOutcome({processClosed:true,exitCode:0,signal:null,jobStatus:state}),'UNKNOWN');
});
