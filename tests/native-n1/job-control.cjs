'use strict';
// Protocol client for the separate PowerShell 5.1 Windows Job Object supervisor.
// This module is safe to import in addon-free tests; it never loads Canon or Koffi.
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

function classifyOutcome({processClosed=false,exitCode=null,signal=null,terminationRequested=false,jobStatus=null,supervisorAvailable=true}={}){
  if(!supervisorAvailable||!processClosed||!jobStatus?.querySucceeded||jobStatus.activeProcesses!==0||jobStatus.rootAssigned!==true||jobStatus.rootQuerySucceeded!==true||jobStatus.rootSignaled!==true)return 'UNKNOWN';
  if(terminationRequested)return 'FORCED_TERMINATION_CONFIRMED';
  if(exitCode===0&&signal===null)return 'CLEAN_EXIT';
  return 'NONZERO_EXIT';
}

function startSupervisor({powershell,script,logPath,tempPath,maxLifetimeMs=45000,env=process.env,hideWindow=true,testOnly=false}={}){
  for(const [name,value] of Object.entries({powershell,script,logPath,tempPath}))if(typeof value!=='string'||!path.isAbsolute(value))throw Error('SUPERVISOR_ABSOLUTE_PATH_REQUIRED: '+name);
  if(![10000,30000,45000,60000].includes(maxLifetimeMs))throw Error('SUPERVISOR_BOUND_INVALID');
  fs.mkdirSync(path.dirname(logPath),{recursive:true});
  const nonce=crypto.randomBytes(24).toString('hex');
  const hostScript=path.join(__dirname,'supervisor-host.cjs');
  const args=['--no-addons','--max-old-space-size=128',hostScript,powershell,script,logPath,String(maxLifetimeMs),testOnly?'test-only':'normal'];
  const supervisor=spawn(process.execPath,args,{
    cwd:path.dirname(logPath),
    env:{SystemRoot:env.SystemRoot,WINDIR:env.SystemRoot,PATH:path.join(env.SystemRoot,'System32'),TEMP:tempPath,TMP:tempPath,APERTROVE_N2_SUPERVISOR_NONCE:nonce},
    windowsHide:hideWindow,
    detached:true,
    stdio:['pipe','pipe','pipe']
  });
  let buffered='',stderrBytes=0,failed=null,nextId=0,exitInfo=null,resolveExit;
  const exitPromise=new Promise(resolve=>{resolveExit=resolve;});
  const pending=new Map(),eventHandlers=new Set();
  const ready=new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{supervisor.kill();reject(Error('JOB_SUPERVISOR_START_TIMEOUT'));},5000);
    supervisor.stdin.on('error',()=>{});
    supervisor.once('error',error=>{clearTimeout(timeout);reject(error);});
    supervisor.stdout.on('data',chunk=>{
      buffered+=chunk.toString('utf8');
      if(buffered.length>256*1024){failed=Error('JOB_SUPERVISOR_OUTPUT_LIMIT');for(const item of pending.values())item.reject(failed);pending.clear();return;}
      for(;;){
        const n=buffered.indexOf('\n');if(n<0)break;
        const line=buffered.slice(0,n).trim();buffered=buffered.slice(n+1);if(!line)continue;
        let message;try{message=JSON.parse(line);}catch{failed=Error('JOB_SUPERVISOR_INVALID_JSON');continue;}
        if(message.kind==='ready'){
          clearTimeout(timeout);
          if(message.status==='READY'&&message.jobPolicy==='JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE'&&message.inheritedConsoleDetached===true&&Number.isInteger(message.supervisorProcessId))resolve(message);
          else reject(Error('JOB_SUPERVISOR_NOT_READY'));
        }else if(message.kind==='response'){
          const item=pending.get(message.id);if(item){pending.delete(message.id);clearTimeout(item.timer);item.resolve(message);}
        }else for(const handler of eventHandlers)handler(message);
      }
    });
    supervisor.stderr.on('data',chunk=>{stderrBytes+=chunk.length;if(stderrBytes>8192&&supervisor.pid)supervisor.kill();});
    supervisor.on('close',(code,signal)=>{
      exitInfo={code,signal};
      resolveExit(exitInfo);
      const error=Error('JOB_SUPERVISOR_CLOSED: '+code+'/'+signal);
      if(!failed)failed=error;
      for(const item of pending.values()){clearTimeout(item.timer);item.reject(error);}pending.clear();
    });
  });
  function request(command,payload={},timeoutMs=3000){
    if(failed)return Promise.reject(failed);
    if(!supervisor.stdin.writable)return Promise.reject(Error('JOB_SUPERVISOR_PIPE_CLOSED'));
    const id='q'+(++nextId),record={...payload,id,command};
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(Error('JOB_SUPERVISOR_REQUEST_TIMEOUT: '+command));},timeoutMs);
      pending.set(id,{resolve,reject,timer});
      supervisor.stdin.write(JSON.stringify(record)+'\n',error=>{if(error){clearTimeout(timer);pending.delete(id);reject(error);}});
    });
  }
  return ready.then(info=>({
    pid:info.supervisorProcessId,
    hostPid:supervisor.pid,
    supervisorPid:info.supervisorProcessId,
    runId:info.runId,
    logPath,
    request,
    get failed(){return failed;},
    waitForExit(timeoutMs=5000){
      if(exitInfo)return Promise.resolve(exitInfo);
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(Error('JOB_SUPERVISOR_EXIT_TIMEOUT')),timeoutMs);
        exitPromise.then(info=>{clearTimeout(timer);resolve(info);});
      });
    },
    endControlPipe(){if(supervisor.stdin.writable)supervisor.stdin.end();},
    onEvent(handler){eventHandlers.add(handler);return()=>eventHandlers.delete(handler);},
    async close(){
      let response=null;
      try{response=await request('shutdown',{},7000);}finally{
        if(supervisor.stdin.writable)supervisor.stdin.end();
      }
      await new Promise((resolve,reject)=>{
      if(exitInfo){resolve();return;}
        const timer=setTimeout(()=>reject(Error('JOB_SUPERVISOR_SHUTDOWN_TIMEOUT')),5000);
        exitPromise.then(()=>{clearTimeout(timer);resolve();});
      });
      return response;
    },
    async handoff(durationMs=25000){
      const response=await request('handoff',{durationMs},2500);
      if(!response?.ok)return response;
      // The supervisor owns cleanup until its bounded handoff deadline.
      supervisor.stdin.end();supervisor.stdout.destroy();supervisor.stderr.destroy();supervisor.unref();
      return response;
    },
    terminateSupervisorForTest(){
      if(!testOnly)return Promise.reject(Error('TEST_ONLY_COMMAND_DENIED'));
      return request('testTerminateSupervisor',{},1500);
    },
    terminateHost(){return supervisor.kill();},
    terminateHostForTest(){return supervisor.kill();}
  }));
}

module.exports={classifyOutcome,startSupervisor};
