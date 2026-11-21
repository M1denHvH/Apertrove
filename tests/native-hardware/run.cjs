'use strict';
// Addon-free controller. Native authorization never follows from dry-run readiness.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {root,sha,validate}=require('./manifest.cjs');
const {performance}=require('node:perf_hooks');
const approvals='--authorize-h1a --camera-connected --canon-apps-closed';
const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
async function main(){
  const args=process.argv.slice(2),mode=args.shift();
  if(!['--dry-run','--execute'].includes(mode)||args.shift()!=='--manifest')throw Error('USAGE: run.cjs --dry-run|--execute --manifest <absolute JSON> ['+approvals+']');
  const file=args.shift(),execute=mode==='--execute';
  if(args.join(' ')!==(execute?approvals:''))throw Error('EXPLICIT_H1A_AUTHORIZATION_REQUIRED');
  if(!path.isAbsolute(file||'')||fs.statSync(file).size>256*1024)throw Error('INVALID_MANIFEST_PATH');
  if(!process.execArgv.includes('--no-addons')||process.execArgv.some(a=>!['--no-addons','--max-old-space-size=192'].includes(a)))throw Error('ADDON_FREE_PARENT_REQUIRED');
  const bytes=fs.readFileSync(file),manifest=JSON.parse(bytes),admission=validate(manifest,{execute});
  const summary={
    mode:execute?'H1A_NATIVE':'H1A_ADMISSION_DRY_RUN',
    manifestSha256:sha(bytes),runtimeSha256:admission.dll.sha256,
    ready:admission.ready,blockers:admission.blockers,
    nativeLoaded:false,nativeResult:'NOT_RUN',
    runtimeObservations:admission.runtimeObservations,
    authorization:execute?'EXPLICIT_FLAGS_PROVIDED':'NOT_GRANTED',
    expectedBoundary:'one exact native child assigned to a separate kill-on-close Windows Job Object before manifest delivery; 15s lifecycle deadline; bounded root/tree escalation; no retry, session, property, callbacks or capture operation'
  };
  if(!execute){console.log(JSON.stringify(summary,null,2));return;}
  const output=path.join(root,'qa','native-hardware','h1a-runs',crypto.randomUUID());fs.mkdirSync(output,{recursive:true});
  for(const name of ['temp','profile'])fs.mkdirSync(path.join(output,name));
  summary.output=output;summary.nativeResult='UNKNOWN';
  const system=process.env.SystemRoot;if(!system||!path.isAbsolute(system))throw Error('SYSTEM_ROOT_REQUIRED');
  const powershell=path.join(system,'System32','WindowsPowerShell','v1.0','powershell.exe');
  const nonce=crypto.randomBytes(24).toString('hex'),tempPath=path.join(output,'temp');
  const env={SystemRoot:system,WINDIR:system,PATH:path.join(system,'System32'),TEMP:tempPath,TMP:tempPath,APPDATA:path.join(output,'profile'),LOCALAPPDATA:path.join(output,'profile'),NODE_OPTIONS:'',NODE_PATH:'',APERTROVE_H1A_NONCE:nonce};
  const {spawn}=require('node:child_process');
  const {startSupervisor}=require('../native-n1/job-control.cjs');
  const {superviseChild}=require('../native-n1/supervised-process.cjs');
  const {runSnapshot,startMonitor}=require('../native-n1/observe-control.cjs');
  const {review:reviewObservations}=require('../native-n1/observation-review.cjs');
  const pidsPath=path.join(output,'pids.json'),stopPath=path.join(output,'observer.stop');
  const observer={powershell,script:path.join(__dirname,'../native-n1/observe-n2.ps1'),runtimePath:admission.dll.path,pidsPath,stopPath,tempPath,env};
  let supervisor=null,child=null,monitor=null,poll=null,manifestDelivered=false,ready=false;
  let messages=0,stderrBytes=0;
  const knownPids=new Set();
  const remember=state=>{
    for(const pid of state?.processIds||[])if(Number.isInteger(pid)&&pid>0)knownPids.add(pid);
    const temp=pidsPath+'.next';write(temp,{pids:[...knownPids]});fs.renameSync(temp,pidsPath);
  };
  remember(null);
  write(path.join(output,'admission.json'),summary);
  try{
    summary.before=await runSnapshot({...observer,phase:'Before',outputPath:path.join(output,'before.jsonl')});
    if(summary.before.confirmed!==true||summary.before.ready!==true||summary.before.sectionErrors?.length)throw Error('H1A_BASELINE_OBSERVATION_FAILED');
    const baseline=fs.readFileSync(path.join(output,'before.jsonl'),'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse).at(-1);
    if(baseline?.runtime?.sha256!==admission.dll.sha256)throw Error('H1A_OBSERVED_RUNTIME_IDENTITY_CHANGED');
    const dependencyEvidence=JSON.parse(fs.readFileSync(manifest.baseAdmission.dependencyReview.evidence.path,'utf8'));
    if(baseline.runtimeTrust?.status!=='REVIEWED_PROTECTED'||baseline.runtimeTrust.signature?.status!=='Valid')throw Error('H1A_RUNTIME_TRUST_CHANGED');
    const trustedPaths=new Map(dependencyEvidence.runtimeTrust.paths.map(item=>[item.path.toLowerCase(),item.aclSha256]));
    if(baseline.runtimeTrust.paths.length!==trustedPaths.size||baseline.runtimeTrust.paths.some(item=>trustedPaths.get(item.path.toLowerCase())!==item.aclSha256))throw Error('H1A_RUNTIME_DACL_CHANGED');
    if(baseline?.canonProcesses?.status!=='SNAPSHOT'||baseline.canonProcesses.truncated)throw Error('CANON_PROCESS_BASELINE_INCOMPLETE');
    if(baseline.canonProcesses.items.length)throw Error('CANON_APPLICATION_PRESENT');
    if(baseline.cameraDevices?.status!=='PASSIVE_PNP_SNAPSHOT'||baseline.cameraDevices.truncated||!baseline.cameraDevices.items.some(item=>/\bEOS\s*2000D\b/i.test(item.friendlyName||'')))throw Error('EOS_2000D_PASSIVE_IDENTIFICATION_REQUIRED');
    summary.passiveCameraNames=baseline.cameraDevices.items.map(item=>item.friendlyName);
    write(path.join(output,'executed-manifest.json'),manifest);
    supervisor=await startSupervisor({powershell,script:path.join(__dirname,'../native-n1/job-supervisor.ps1'),logPath:path.join(output,'job-supervisor.jsonl'),tempPath,env,maxLifetimeMs:60000});
    summary.supervisorPid=supervisor.pid;summary.supervisorHostPid=supervisor.hostPid;summary.supervisorLog=supervisor.logPath;
    child=spawn(process.execPath,['--max-old-space-size=128',path.join(__dirname,'worker.cjs'),'--h1a-worker',nonce],{cwd:output,env,windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});
    summary.pid=child.pid;
    child.on('error',error=>{summary.spawnError=error.code;});
    child.on('message',message=>{
      if(++messages>12){summary.protocolError='MESSAGE_LIMIT';void supervisor.request('terminateTree').catch(()=>{});return;}
      if(message?.nonce!==nonce){summary.protocolError='NONCE_MISMATCH';void supervisor.request('terminateTree').catch(()=>{});return;}
      if(message.type==='ready'&&message.pid===child.pid)ready=true;
      else if(message.type==='result')summary.receipt=message.receipt;
    });
    child.stderr.on('data',chunk=>{stderrBytes+=chunk.length;if(stderrBytes<=8192)fs.appendFileSync(path.join(output,'child-stderr.txt'),chunk);else{summary.protocolError='STDERR_LIMIT';void supervisor.request('terminateTree').catch(()=>{});}});
    const readyDeadline=performance.now()+1000;
    while(!ready&&performance.now()<readyDeadline)await new Promise(resolve=>setTimeout(resolve,25));
    if(!ready||child.exitCode!==null||child.signalCode!==null||supervisor.failed)throw Error('H1A_WORKER_HANDSHAKE_NOT_READY');
    const assignment=await supervisor.request('assign',{pid:child.pid,imagePath:process.execPath,expectedParentPid:process.pid,commandMarker:nonce});
    summary.assignment=assignment;
    if(!assignment.ok||!assignment.state?.querySucceeded||!assignment.state.processIds.includes(child.pid))throw Error('H1A_JOB_ASSIGNMENT_NOT_CONFIRMED');
    remember(assignment.state);
    monitor=await startMonitor({...observer,outputPath:path.join(output,'during.jsonl'),durationMs:30000,intervalMs:250});
    if(!monitor.info?.ready)throw Error('H1A_OBSERVER_NOT_READY');
    if(!ready||child.exitCode!==null||supervisor.failed)throw Error('H1A_WORKER_HANDSHAKE_NOT_READY');
    validate(manifest,{execute:true});
    manifestDelivered=true;summary.nativeLoaded='UNKNOWN';
    summary.runtimeObservations={dynamicDependencies:'UNKNOWN_IN_PROGRESS',initializationEffects:'UNKNOWN_IN_PROGRESS',cameraEnumeration:'UNKNOWN_IN_PROGRESS'};
    child.send({nonce,manifest,manifestSha256:sha(bytes)},error=>{if(error){summary.protocolError='MANIFEST_DELIVERY_FAILED';void supervisor.request('terminateTree').catch(()=>{});}});
    let querying=false;
    poll=setInterval(async()=>{
      if(querying)return;querying=true;
      try{
        const reply=await supervisor.request('status',{},1000);
        if(reply.ok){
          remember(reply.state);
          if(reply.state.processIds.some(pid=>pid!==child.pid)){
            summary.unexpectedDescendants=reply.state.processIds.filter(pid=>pid!==child.pid);
            summary.protocolError='UNEXPECTED_DESCENDANT_PROCESS';
            await supervisor.request('terminateTree',{},1000);
          }
          if(reply.state.totalProcesses>1){
            summary.protocolError='UNEXPECTED_DESCENDANT_HISTORY';
            await supervisor.request('terminateTree',{},1000);
          }
        }
      }catch(error){summary.jobQueryError=error.message;summary.protocolError='JOB_STATUS_QUERY_FAILED';void supervisor.request('terminateTree').catch(()=>{});}finally{querying=false;}
    },500);
    summary.process=await superviseChild({child,supervisor,timeoutMs:15000,rootGraceMs:1000,treeGraceMs:2000,handoffMs:20000});
    clearInterval(poll);poll=null;
    remember(summary.process.jobStatus);
    if(summary.process.jobStatus?.totalProcesses>1)summary.protocolError='UNEXPECTED_DESCENDANT_HISTORY';
    if(summary.process.supervisorHandoff){
      summary.cleanupDisposition='UNKNOWN_WITH_EXPLICIT_BOUNDED_SUPERVISOR_HANDOFF';
      summary.runtimeObservations={dynamicDependencies:'INCOMPLETE_OR_UNKNOWN',initializationEffects:'INCOMPLETE_OR_UNKNOWN',cameraEnumeration:'INCOMPLETE_OR_UNKNOWN'};
      summary.observer={path:path.join(output,'during.jsonl'),independentDeadlineMs:30000,afterSnapshot:'NOT_RUN_DUE_TO_BOUNDED_HANDOFF'};
      summary.limitations='UNKNOWN exit 3 with acknowledged bounded supervisor ownership. Process-tree termination is not confirmed. Observer stops at its own deadline. Do not start another native attempt.';
      write(path.join(output,'result.json'),summary);console.log(JSON.stringify(summary,null,2));
      // External supervisor has acknowledged exact job/PID ownership and a bounded final deadline.
      process.exit(3);
    }
    if(summary.process.disposition==='UNKNOWN')throw Error('H1A_PROCESS_TREE_EXIT_NOT_CONFIRMED');
    const shutdown=await supervisor.close();supervisor=null;summary.supervisorShutdown=shutdown;
    if(shutdown?.result?.processTreeExitConfirmed!==true)throw Error('H1A_JOB_CLEANUP_NOT_CONFIRMED');
    const r=summary.receipt;
    summary.nativeLoaded=r?.nativeLoaded??'UNKNOWN';
    if(summary.process.disposition==='CLEAN_EXIT'&&!summary.protocolError&&!summary.jobQueryError&&!summary.process.terminationRequested&&r?.outcome==='H1A_COUNT_RECORDED'&&r?.initialize===0&&r?.list===0&&r?.count===0&&r?.release===0&&r?.terminate===0&&r?.unloaded===true&&r?.comBalanced===true&&Number.isInteger(r.cameraCount))summary.nativeResult='H1A_COUNT_RECORDED';
    else if(summary.process.disposition==='NONZERO_EXIT'&&!summary.protocolError&&!summary.jobQueryError&&!summary.process.terminationRequested&&r?.outcome==='FAILED'&&r?.cleanup==='SOURCE_ZERO'&&r?.unloaded===true&&r?.comBalanced===true)summary.nativeResult='FAILED';
    summary.runtimeObservations={dynamicDependencies:'SAMPLED_REVIEW_REQUIRED',initializationEffects:'SAMPLED_REVIEW_REQUIRED',cameraEnumeration:r?'RECEIPT_RECORDED':'UNKNOWN'};
  }catch(error){
    summary.error=error.message;
  }finally{
    if(poll)clearInterval(poll);
    if(child&&!manifestDelivered)child.kill();
    if(supervisor){
      try{summary.supervisorShutdown=await supervisor.close();}catch(error){
        summary.supervisorError=error.message;
        summary.supervisorHostKillRequested=supervisor.terminateHost();
        try{summary.supervisorExit=await supervisor.waitForExit(2000);}catch{}
      }
    }
    if(monitor)summary.observerStop=await monitor.stop().catch(error=>({confirmed:false,error:error.message}));
    try{summary.after=await runSnapshot({...observer,phase:'After',outputPath:path.join(output,'after.jsonl')});}catch(error){summary.after={confirmed:false,error:error.message};}
    if(monitor&&summary.after?.ready){
      try{
        summary.observationReview=reviewObservations({beforeFile:path.join(output,'before.jsonl'),duringFile:path.join(output,'during.jsonl'),afterFile:path.join(output,'after.jsonl'),manifest:manifest.baseAdmission,rootPid:child?.pid,systemRoot:system});
        write(path.join(output,'observation-review.json'),summary.observationReview);
        if(summary.observationReview.disposition==='REVIEW_REQUIRED')summary.nativeResult='UNKNOWN';
      }catch(error){summary.observationReview={disposition:'UNKNOWN',error:error.message};summary.nativeResult='UNKNOWN';}
    }
    summary.stderrBytes=stderrBytes;
    summary.limitations='Sampled user-mode module/process/handle/thread, Canon-service, endpoint and passive device snapshots can miss brief events and cannot certify kernel/device or vendor-internal cleanup. A Job Object does not contain existing external services.';
    if(summary.error||summary.after?.confirmed!==true||summary.after?.ready!==true||summary.observerStop?.confirmed!==true||summary.observerStop?.ready!==true||summary.after?.sectionErrors?.length||summary.observerStop?.observation?.sectionErrors?.length||summary.supervisorError)summary.nativeResult='UNKNOWN';
    write(path.join(output,'result.json'),summary);
  }
  console.log(JSON.stringify(summary,null,2));
  if(child&&child.exitCode===null&&child.signalCode===null){
    console.error('UNKNOWN: exact native PID '+child.pid+' remains unconfirmed. Job termination was requested; see '+output);
    process.exit(3);
  }
  process.exitCode=summary.nativeResult==='H1A_COUNT_RECORDED'?0:1;
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=2;});
module.exports={main,approvals};
