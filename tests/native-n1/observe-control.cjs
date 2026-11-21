'use strict';
// Passive observations only. No Canon/Koffi load, camera API or application entrypoint.
const {spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function validate(options){
  for(const name of ['powershell','script','runtimePath','pidsPath','outputPath','stopPath','tempPath'])if(typeof options[name]!=='string'||!path.isAbsolute(options[name]))throw Error('N2_OBSERVER_ABSOLUTE_PATH_REQUIRED: '+name);
  if(!options.env?.SystemRoot||!path.isAbsolute(options.env.SystemRoot))throw Error('N2_OBSERVER_SYSTEM_ROOT_REQUIRED');
  if(fs.existsSync(options.outputPath))throw Error('N2_OBSERVER_OUTPUT_EXISTS');
  fs.mkdirSync(path.dirname(options.outputPath),{recursive:true});
}
function launch(options,mode,phase){
  const {powershell,script,runtimePath,pidsPath,outputPath,stopPath,tempPath,env,durationMs=30000,intervalMs=350}=options;
  validate(options);
  const args=['-NoLogo','-NoProfile','-NonInteractive','-File',script,'-Mode',mode,'-Phase',phase,'-RuntimePath',runtimePath,'-PidsPath',pidsPath,'-OutputPath',outputPath,'-StopPath',stopPath];
  if(mode==='Monitor')args.push('-DurationMs',String(durationMs),'-IntervalMs',String(intervalMs));
  const proc=spawn(powershell,args,{cwd:tempPath,env:{SystemRoot:env.SystemRoot,WINDIR:env.SystemRoot,PATH:path.join(env.SystemRoot,'System32'),TEMP:tempPath,TMP:tempPath},windowsHide:true,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='',closed=null,spawnError=null,invalidOutput=false;
  const messages=[];
  const exitPromise=new Promise(resolve=>{
    proc.on('error',error=>{spawnError=error.message;});
    proc.on('close',(code,signal)=>{closed={code,signal};resolve(closed);});
  });
  proc.stdout.on('data',chunk=>{
    stdout+=chunk.toString('utf8');
    if(stdout.length>32768){invalidOutput=true;proc.kill();return;}
    for(;;){
      const n=stdout.indexOf('\n');if(n<0)break;
      const line=stdout.slice(0,n).trim();stdout=stdout.slice(n+1);if(!line)continue;
      try{if(messages.length>=4){invalidOutput=true;proc.kill();break;}messages.push(JSON.parse(line));}catch{invalidOutput=true;}
    }
  });
  proc.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString('utf8')).slice(-8192);});
  async function wait(ms){
    if(closed)return closed;
    return new Promise(resolve=>{
      const timer=setTimeout(()=>resolve(null),ms);
      exitPromise.then(value=>{clearTimeout(timer);resolve(value);});
    });
  }
  async function terminate(reason){
    let killRequested=false;if(!closed)try{killRequested=proc.kill();}catch{}
    const ended=await wait(1200);
    return {confirmed:!!ended,...(ended||{code:null,signal:null}),reason,killRequested,observerPid:proc.pid??null,stderr};
  }
  return {proc,messages,wait,terminate,get closed(){return closed;},get invalidOutput(){return invalidOutput;},get spawnError(){return spawnError;},get stderr(){return stderr;}};
}
function summarizeFile(outputPath){
  try{
    const bytes=fs.readFileSync(outputPath);
    if(bytes.length>9*1024*1024)return {status:'LIMIT_EXCEEDED',frames:0};
    const records=bytes.toString('utf8').trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
    const errors=[...new Set(records.flatMap(item=>item.sectionErrors||[]))];
    return {status:records.length?'RECORDED':'EMPTY',frames:records.length,sectionErrors:errors,firstUtc:records[0]?.atUtc??null,lastUtc:records.at(-1)?.atUtc??null};
  }catch(error){return {status:'UNREADABLE_OR_PARTIAL',frames:0,error:error.message};}
}
async function runSnapshot(options={}){
  options={env:process.env,...options};
  const phase=options.phase||'Before';
  if(!['Before','After','Synthetic'].includes(phase))throw Error('N2_OBSERVER_PHASE_INVALID');
  const child=launch(options,'Snapshot',phase),closed=await child.wait(15000);
  if(!closed){const stopped=await child.terminate('SNAPSHOT_DEADLINE');return {...stopped,ready:false,phase,output:options.outputPath,observation:summarizeFile(options.outputPath)};}
  const message=child.messages.at(-1);
  return {...closed,confirmed:true,ready:closed.code===0&&!child.invalidOutput&&message?.ready===true,phase,output:options.outputPath,sectionErrors:message?.sectionErrors||[],observerPid:child.proc.pid??null,spawnError:child.spawnError,stderr:child.stderr,observation:summarizeFile(options.outputPath)};
}
async function startMonitor(options={}){
  options={env:process.env,...options};
  const {durationMs=30000,intervalMs=350}=options;
  if(!Number.isInteger(durationMs)||durationMs<1000||durationMs>45000||!Number.isInteger(intervalMs)||intervalMs<100||intervalMs>1000)throw Error('N2_OBSERVER_BOUND_INVALID');
  const child=launch(options,'Monitor','During');
  let startInfo=null;
  const startupDeadline=performance.now()+5000;
  while(performance.now()<startupDeadline&&!child.closed&&!child.invalidOutput){startInfo=child.messages.find(message=>message.ready===true);if(startInfo)break;await delay(25);}
  if(!startInfo){const result=await child.terminate('MONITOR_START_FAILED');const error=Error('N2_OBSERVER_START_FAILED');error.observation={...result,spawnError:child.spawnError,outputPath:options.outputPath};throw error;}
  let stopPromise=null;
  async function finish(reason){
    if(!child.closed&&!fs.existsSync(options.stopPath))fs.writeFileSync(options.stopPath,'stop\n',{flag:'wx'});
    const closed=await child.wait(1500);
    const termination=closed?{confirmed:true,...closed}:await child.terminate(reason);
    return {...termination,ready:termination.confirmed&&termination.code===0&&!child.invalidOutput,observerPid:child.proc.pid,stderr:child.stderr,outputPath:options.outputPath,observation:summarizeFile(options.outputPath)};
  }
  const hardDeadline=setTimeout(()=>{if(!stopPromise)stopPromise=finish('MONITOR_DEADLINE');},durationMs+1500);
  child.proc.once('close',()=>clearTimeout(hardDeadline));
  return {pid:child.proc.pid,info:startInfo,outputPath:options.outputPath,stop(){clearTimeout(hardDeadline);if(!stopPromise)stopPromise=finish('MONITOR_STOP_ESCALATION');return stopPromise;},killForTest(){return child.proc.kill();}};
}
module.exports={startMonitor,runSnapshot};
