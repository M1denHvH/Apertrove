'use strict';
// Trusted synthetic controller for abrupt-parent-exit tests. Built-ins and the
// reviewed Job Object protocol only; no worker.cjs, Koffi, or Canon entrypoints.
const fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process');
const {startSupervisor}=require('./job-control.cjs');

async function main(){
  const dir=process.argv[2],run=process.env.N2_TEST_RUN_ID;
  if(!process.send||!process.execArgv.includes('--no-addons')||!run||!path.isAbsolute(dir||'')||process.env.N2_WATCHDOG_CONTROLLER!=='synthetic-only')throw Error('SYNTHETIC_CONTROLLER_ADMISSION_DENIED');
  if(!dir.startsWith(path.resolve(__dirname,'../../qa/native-n2-admission/watchdog-tests')+path.sep))throw Error('SYNTHETIC_CONTROLLER_DIRECTORY_DENIED');
  const powershell=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  const log=path.join(dir,'supervisor.jsonl');
  const supervisor=await startSupervisor({powershell,script:path.join(__dirname,'job-supervisor.ps1'),logPath:log,tempPath:dir,maxLifetimeMs:10000});
  const child=spawn(process.execPath,['--no-addons',path.join(__dirname,'watchdog-fixture.cjs'),'grandchild','--test-marker='+run],{
    cwd:dir,windowsHide:true,stdio:['ignore','ignore','ignore','ipc'],
    env:{SystemRoot:process.env.SystemRoot,WINDIR:process.env.SystemRoot,PATH:path.join(process.env.SystemRoot,'System32'),NODE_OPTIONS:'',NODE_PATH:'',N2_TEST_RUN_ID:run}
  });
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('CONTROLLER_CHILD_READY_TIMEOUT')),2500);
    child.once('error',reject);
    child.on('message',m=>{if(m?.run===run&&m.event==='ready'){clearTimeout(timer);resolve();}});
  });
  const assign=await supervisor.request('assign',{pid:child.pid,imagePath:process.execPath,expectedParentPid:process.pid,commandMarker:run});
  if(!assign.ok)throw Error('CONTROLLER_CHILD_ASSIGN_FAILED');
  const descendant=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('CONTROLLER_DESCENDANT_READY_TIMEOUT')),2500);
    child.on('message',m=>{if(m?.run===run&&m.event==='descendant-ready'){clearTimeout(timer);resolve(m.pid);}});
  });
  child.send({run,action:'spawn-descendant'});
  const descendantPid=await descendant;
  const state=(await supervisor.request('status')).state;
  if(!state.querySucceeded||!state.processIds.includes(child.pid)||!state.processIds.includes(descendantPid))throw Error('CONTROLLER_DESCENDANT_NOT_CONTAINED');
  const receipt={run,event:'controlled-tree-ready',controllerPid:process.pid,supervisorPid:supervisor.pid,hostPid:supervisor.hostPid,rootPid:child.pid,descendantPid,logPath:log,state};
  fs.writeFileSync(path.join(dir,'controller-tree.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
  process.send(receipt);
  // Test parent kills this process after the evidence handshake. The independent
  // supervisor observes EOF and closes/terminates its job without our cooperation.
  setInterval(()=>{},1000);
}
main().catch(error=>{try{process.send({event:'controller-error',error:error.message});}catch{}process.exitCode=1;});
