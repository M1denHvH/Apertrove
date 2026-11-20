'use strict';
// Addon-free detached Node bridge for Windows PowerShell 5.1 supervision.
// libuv kills non-detached children when their Node parent exits. This bridge
// survives controller exit, keeps PowerShell's Job Object owner alive until
// bounded cleanup, and keeps its own durable event log beside the job log.
const fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process');
const {performance}=require('node:perf_hooks');

const args=process.argv.slice(2);
let writer=null,helper=null,closing=false,helperClosed=false,outputLost=false,totalOutput=0,totalInput=0,inputBuffer='';
const start=performance.now();
function log(event){
  if(!writer)return;
  try{fs.writeSync(writer,JSON.stringify({atUtc:new Date().toISOString(),elapsedMs:Math.round(performance.now()-start),hostPid:process.pid,...event})+'\n');}catch{}
}
function complete(code,reason){
  if(closing)return;
  closing=true;log({kind:'host-final',reason,helperClosed,helperPid:helper?.pid??null,code,outputLost});
  if(writer!==null){try{fs.closeSync(writer);}catch{}writer=null;}
  process.exitCode=code;
  process.stdin.destroy();
  if(outputLost){process.exit(code);return;}
  // Preserve the helper's last protocol response until the pipe flushes, but
  // do not let an unread controller pipe turn host shutdown into a new hang.
  const flushBound=setTimeout(()=>process.exit(code),750);
  let pending=2;
  const flushed=()=>{if(--pending===0){clearTimeout(flushBound);process.exit(code);}};
  try{process.stdout.end(flushed);}catch{flushed();}
  try{process.stderr.end(flushed);}catch{flushed();}
}
function forward(stream,chunk){
  totalOutput+=chunk.length;
  if(totalOutput>1024*1024){log({kind:'host-error',reason:'HELPER_OUTPUT_LIMIT'});helper?.kill();return;}
  if(outputLost)return;
  try{stream.write(chunk);}catch{outputLost=true;}
}
try{
  if(process.platform!=='win32'||process.arch!=='x64'||process.execArgv.join(' ')!=='--no-addons --max-old-space-size=128')throw Error('SUPERVISOR_HOST_RUNTIME_DENIED');
  if(process.env.NODE_OPTIONS||process.env.NODE_PATH||!/^[a-f0-9]{48}$/.test(process.env.APERTROVE_N2_SUPERVISOR_NONCE||''))throw Error('SUPERVISOR_HOST_ENV_DENIED');
  if(args.length!==5||!['normal','test-only'].includes(args[4]))throw Error('SUPERVISOR_HOST_ARGUMENTS_DENIED');
  const [powershell,script,logPath,lifetimeText,mode]=args;
  if(![powershell,script,logPath].every(p=>path.isAbsolute(p)))throw Error('SUPERVISOR_HOST_ABSOLUTE_PATH_REQUIRED');
  const expectedPS=path.join(process.env.SystemRoot||'','System32','WindowsPowerShell','v1.0','powershell.exe');
  const expectedScript=path.join(__dirname,'job-supervisor.ps1');
  if(fs.realpathSync(powershell).toLowerCase()!==fs.realpathSync(expectedPS).toLowerCase()||fs.realpathSync(script).toLowerCase()!==fs.realpathSync(expectedScript).toLowerCase())throw Error('SUPERVISOR_HOST_HELPER_IDENTITY_DENIED');
  const lifetime=Number(lifetimeText);
  if(![10000,30000,45000,60000].includes(lifetime))throw Error('SUPERVISOR_HOST_BOUND_DENIED');
  const realLogDirectory=fs.realpathSync(path.dirname(logPath)),realCwd=fs.realpathSync(process.cwd());
  if(realLogDirectory.toLowerCase()!==realCwd.toLowerCase()||path.extname(logPath)!=='.jsonl')throw Error('SUPERVISOR_HOST_LOG_DIRECTORY_DENIED');
  writer=fs.openSync(logPath+'.host.jsonl','wx');
  log({kind:'host-start',helper:powershell,script,lifetimeMs:lifetime,controllerPid:process.ppid,policy:'detached addon-free Node host; PowerShell non-detached inside host libuv Job Object'});
  const command=['-NoLogo','-NoProfile','-NonInteractive','-File',script,'-LogPath',logPath,'-MaxLifetimeMs',String(lifetime)];
  if(mode==='test-only')command.push('-TestOnly');
  helper=spawn(powershell,command,{cwd:realCwd,env:process.env,windowsHide:true,stdio:['pipe','pipe','pipe']});
  log({kind:'helper-started',helperPid:helper.pid??null});
  const hardTimer=setTimeout(()=>{
    log({kind:'host-hard-deadline',helperPid:helper.pid??null});
    try{helper.kill();}catch{}
    // Exiting this bridge also closes libuv's kill-on-close job handle. A kill
    // request remains UNKNOWN without the PowerShell job receipt and OS census.
    setTimeout(()=>complete(3,'HOST_HARD_DEADLINE_UNCONFIRMED'),500);
  },65000);
  helper.once('error',error=>{log({kind:'helper-error',error:error.message});clearTimeout(hardTimer);complete(2,'HELPER_START_FAILED');});
  helper.once('close',(code,signal)=>{
    helperClosed=true;clearTimeout(hardTimer);
    log({kind:'helper-close',helperPid:helper.pid,code,signal});
    complete(code===0?0:typeof code==='number'&&code>0&&code<256?code:3,'HELPER_CLOSE_CONFIRMED');
  });
  helper.stdout.on('data',chunk=>forward(process.stdout,chunk));
  helper.stderr.on('data',chunk=>forward(process.stderr,chunk));
  helper.stdin.on('error',error=>{log({kind:'helper-input-error',error:error.code||error.message});});
  process.stdout.on('error',error=>{outputLost=true;log({kind:'controller-output-closed',error:error.code||error.message});});
  process.stderr.on('error',error=>{outputLost=true;log({kind:'controller-error-output-closed',error:error.code||error.message});});
  process.stdin.on('data',chunk=>{
    totalInput+=chunk.length;
    if(totalInput>256*1024){log({kind:'controller-input-limit'});process.stdin.destroy();if(helper.stdin.writable)helper.stdin.end();return;}
    inputBuffer+=chunk.toString('utf8');
    for(;;){
      const newline=inputBuffer.indexOf('\n');if(newline<0)break;
      const line=inputBuffer.slice(0,newline);inputBuffer=inputBuffer.slice(newline+1);
      let request;try{request=JSON.parse(line);}catch{}
      if(mode==='test-only'&&request?.command==='testTerminateSupervisor'){
        // Only the test host may request abrupt PS termination. ChildProcess
        // retains the exact helper process handle, avoiding a fresh PID lookup.
        const accepted=helper.kill();
        log({kind:'test-helper-termination',requestAccepted:accepted,helperPid:helper.pid});
        forward(process.stdout,Buffer.from(JSON.stringify({kind:'response',id:request.id,ok:accepted,command:request.command,requestAccepted:accepted,hostPid:process.pid})+'\n'));
      }else if(helper.stdin.writable)helper.stdin.write(line+'\n');
    }
  });
  process.stdin.on('end',()=>{log({kind:'controller-input-ended'});if(helper.stdin.writable)helper.stdin.end(inputBuffer);inputBuffer='';});
  process.stdin.on('error',error=>{log({kind:'controller-input-error',error:error.code||error.message});if(helper.stdin.writable)helper.stdin.end();});
  process.stdin.resume();
}catch(error){
  log({kind:'host-admission-error',error:error.message});
  try{process.stderr.write(error.message+'\n');}catch{}
  if(helper)try{helper.kill();}catch{}
  complete(2,'HOST_ADMISSION_DENIED');
}
