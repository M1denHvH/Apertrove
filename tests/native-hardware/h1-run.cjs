'use strict';
// Addon-free parent. --prepare and --dry-run do not launch Electron or native code.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const base=require('../native-n1/manifest.cjs'),h1a=require('./manifest.cjs');
const {allowed}=require('./h1-guard.cjs');
const root=path.resolve(__dirname,'../..'),ownFiles=['h1-run.cjs','h1-entry.cjs','h1-worker-entry.cjs','h1-guard.cjs','h1-guard.test.cjs'].map(file=>'tests/native-hardware/'+file);
const approvals='--authorize-h1 --camera-connected --canon-apps-closed';
const hash=file=>base.sha(fs.readFileSync(file)),read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const sourceCommit=()=>cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true,timeout:3000}).trim();
const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const within=(directory,file)=>{const relative=path.relative(directory,file);return !path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep);};
function hashes(directory,filter=()=>true){
  const values={};function scan(folder){for(const item of fs.readdirSync(folder,{withFileTypes:true})){const file=path.join(folder,item.name);if(item.isSymbolicLink())throw Error('H1_SYMLINK_DENIED');if(item.isDirectory())scan(file);else if(filter(file))values[path.relative(directory,file).replaceAll('\\','/')]=hash(file);}}scan(directory);return values;
}
function sourceHashes(){
  const values={};for(const directory of ['electron','dist'])for(const [file,digest] of Object.entries(hashes(path.join(root,directory))))values[directory+'/'+file]=digest;
  for(const file of [...ownFiles,'package.json','package-lock.json','node_modules/playwright-core/lib/coreBundle.js'])values[file]=hash(path.join(root,file));
  if(!values['dist/index.html'])throw Error('H1_BUILT_RENDERER_REQUIRED');return values;
}
function validate(manifest,{execute=false}={}){
  if(manifest?.schema!==1||manifest.purpose!=='H1_REAL_ELECTRON_READ_ONLY'||JSON.stringify(manifest.allowedCanonCalls)!==JSON.stringify(allowed))throw Error('H1_MANIFEST_SCOPE_DENIED');
  const admission=h1a.validate(manifest.h1aManifest,{execute});
  if(admission.ready!==true||!Array.isArray(admission.blockers)||admission.blockers.length!==0)throw Error('H1_BASE_ADMISSION_NOT_READY');
  if(hash(manifest.h1aResult.path)!==manifest.h1aResult.sha256)throw Error('H1A_EVIDENCE_CHANGED');
  const previous=read(manifest.h1aResult.path);
  if(previous.nativeResult!=='H1A_COUNT_RECORDED'||previous.receipt?.cameraCount!==1||previous.process?.disposition!=='CLEAN_EXIT'||previous.supervisorShutdown?.result?.processTreeExitConfirmed!==true)throw Error('H1A_ONE_CAMERA_CLEAN_PASS_REQUIRED');
  if(previous.runtimeSha256!==admission.dll.sha256)throw Error('H1A_RUNTIME_MISMATCH');
  if(JSON.stringify(sourceHashes())!==JSON.stringify(manifest.sourceHashes))throw Error('H1_SOURCE_IDENTITY_MISMATCH');
  if(sourceCommit()!==manifest.sourceCommit)throw Error('H1_SOURCE_COMMIT_CHANGED');
  if(hash(path.join(root,manifest.abiEvidence.path))!==manifest.abiEvidence.sha256)throw Error('H1_ABI_EVIDENCE_CHANGED');
  const electron=manifest.electron;
  if(electron.version!=='45.3.2'||read(path.join(root,'package.json')).devDependencies.electron!==electron.version||hash(electron.path)!==electron.sha256||!within(path.join(root,'qa/integration-candidate/runtime'),electron.path))throw Error('H1_ELECTRON_IDENTITY_MISMATCH');
  if(JSON.stringify(hashes(path.dirname(electron.path)))!==JSON.stringify(electron.files))throw Error('H1_ELECTRON_RUNTIME_FILES_CHANGED');
  for(const name of allowed)if(!admission.dll.exports.includes(name))throw Error('H1_REQUIRED_EXPORT_MISSING: '+name);
  return admission;
}
async function prepare(args){
  if(args.length!==4||args[0]!=='--manifest'||args[2]!=='--h1a-result'||!path.isAbsolute(args[1])||!path.isAbsolute(args[3]))throw Error('USAGE: h1-run.cjs --prepare --manifest <H1A manifest> --h1a-result <clean H1A result>');
  const h1aManifest=read(args[1]),electron=read(path.join(root,'qa/integration-candidate/runtime/admission.json'));
  const manifest={schema:1,purpose:'H1_REAL_ELECTRON_READ_ONLY',allowedCanonCalls:allowed,sourceCommit:sourceCommit(),h1aManifest,h1aResult:{path:fs.realpathSync(args[3]),sha256:hash(args[3])},sourceHashes:sourceHashes(),electron:{path:electron.binary.path,sha256:electron.binary.sha256,version:electron.version,files:hashes(path.dirname(electron.binary.path))},abiEvidence:{path:'docs/HARDWARE_ABI_QUALIFICATION.md',sha256:hash(path.join(root,'docs/HARDWARE_ABI_QUALIFICATION.md'))}};
  const admission=validate(manifest);if(!admission.ready)throw Error('H1_BASE_ADMISSION_BLOCKED');
  const output=path.join(root,'qa/native-hardware/h1-manifest-'+crypto.randomUUID()+'.json');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({manifest:output,sha256:hash(output),ready:true,nativeLoaded:false,authorization:'NOT_GRANTED'}));
}
async function execute(manifest,manifestFile,admission){
  const output=path.join(root,'qa/native-hardware/h1-runs',crypto.randomUUID());fs.mkdirSync(output,{recursive:true});
  for(const folder of ['profile','photos','temp','artifacts','environment'])fs.mkdirSync(path.join(output,folder));
  for(const name of ['USERPROFILE','APPDATA','LOCALAPPDATA'])fs.mkdirSync(path.join(output,'environment',name));
  const nonce=crypto.randomBytes(24).toString('hex'),gate=path.join(output,'grant.json'),configPath=path.join(output,'config.json'),system=process.env.SystemRoot;
  const env={SystemRoot:system,WINDIR:system,PATH:path.join(system,'System32'),TEMP:path.join(output,'temp'),TMP:path.join(output,'temp'),NODE_OPTIONS:'',NODE_PATH:'',FOCAL_TEST_DATA:path.join(output,'profile'),FOCAL_TEST_ONBOARDING:'0',APERTROVE_H1_NONCE:nonce,APERTROVE_H1_CONFIG:configPath};
  for(const name of ['USERPROFILE','APPDATA','LOCALAPPDATA'])env[name]=path.join(output,'environment',name);
  const at=new Date().toISOString();write(path.join(output,'profile/library.json'),{version:2,sessionId:'h1-empty-session',sessions:[{id:'h1-empty-session',name:'H1 read-only validation',captureFolder:path.join(output,'photos'),created:at,updated:at,presetQueue:[]}],photos:[],presets:[],settings:{language:'en-US',theme:'light',showSplashes:false,performanceMode:true,autoSelect:false,captureFolder:path.join(output,'photos'),watchFolder:'',sdkDir:path.dirname(admission.dll.path),onboarding:{completed:true,step:'ready'}}});
  write(configPath,{kind:'H1_REAL_ELECTRON_READ_ONLY',output,nonce,gate,runtime:{path:admission.dll.path,sha256:admission.dll.sha256},addon:{path:admission.addon.path,sha256:admission.addon.sha256},sourceHashes:manifest.sourceHashes});
  const summary={mode:'H1_NATIVE_REAL_ELECTRON',output,sourceCommit:manifest.sourceCommit,manifest:manifestFile,manifestSha256:hash(manifestFile),runtimeSha256:admission.dll.sha256,nativeResult:'BLOCKED',nativeLoaded:false,ready:true,blockers:[],allowedCanonCalls:allowed};
  write(path.join(output,'executed-manifest.json'),manifest);write(path.join(output,'admission.json'),summary);
  const powershell=path.join(system,'System32/WindowsPowerShell/v1.0/powershell.exe');
  const {startSupervisor}=require('../native-n1/job-control.cjs'),{superviseChild}=require('../native-n1/supervised-process.cjs');
  const {runSnapshot,startMonitor}=require('../native-n1/observe-control.cjs');
  const pidsPath=path.join(output,'pids.json'),stopPath=path.join(output,'observer.stop'),knownPids=new Set();
  const remember=state=>{for(const pid of state?.processIds||[])knownPids.add(pid);const next=pidsPath+'.next';write(next,{pids:[...knownPids]});fs.renameSync(next,pidsPath);};remember(null);
  const observer={powershell,script:path.join(root,'tests/native-n1/observe-n2.ps1'),runtimePath:admission.dll.path,pidsPath,stopPath,tempPath:env.TEMP,env};
  let supervisor=null,monitor=null,poll=null,child=null,app=null,grantReleased=false,diagnosticTimer=null,assignmentPromise=null,launching=false;
  const rawSpawn=cp.spawn;let pendingQuery=false;
  try{
    summary.before=await runSnapshot({...observer,phase:'Before',outputPath:path.join(output,'before.jsonl')});
    if(!summary.before.ready||summary.before.sectionErrors?.length)throw Error('H1_PASSIVE_BASELINE_FAILED');
    const baseline=readFrames(path.join(output,'before.jsonl')).at(-1);
    if(baseline.runtime?.sha256!==admission.dll.sha256||baseline.canonProcesses?.status!=='SNAPSHOT'||baseline.canonProcesses.truncated||baseline.canonProcesses.items.length)throw Error('H1_RUNTIME_OR_CANON_CLIENT_BASELINE_BLOCKED');
    const dependencies=read(manifest.h1aManifest.baseAdmission.dependencyReview.evidence.path),trusted=new Map(dependencies.runtimeTrust.paths.map(item=>[item.path.toLowerCase(),item.aclSha256]));
    if(baseline.runtimeTrust?.status!=='REVIEWED_PROTECTED'||baseline.runtimeTrust.signature?.status!=='Valid'||baseline.runtimeTrust.paths.length!==trusted.size||baseline.runtimeTrust.paths.some(item=>trusted.get(item.path.toLowerCase())!==item.aclSha256))throw Error('H1_RUNTIME_TRUST_CHANGED');
    if(baseline.cameraDevices?.status!=='PASSIVE_PNP_SNAPSHOT'||baseline.cameraDevices.truncated||!baseline.cameraDevices.items.some(item=>/\bEOS\s*2000D\b/i.test(item.friendlyName||'')))throw Error('H1_EOS_2000D_PASSIVE_IDENTIFICATION_REQUIRED');
    supervisor=await startSupervisor({powershell,script:path.join(root,'tests/native-n1/job-supervisor.ps1'),logPath:path.join(output,'job-supervisor.jsonl'),tempPath:env.TEMP,env,maxLifetimeMs:60000});
    summary.supervisorPid=supervisor.pid;summary.supervisorHostPid=supervisor.hostPid;
    const entry=path.join(__dirname,'h1-entry.cjs'),argv=['--inspect=0','--remote-debugging-port=0',entry,'--h1-config='+configPath,'--h1-nonce='+nonce];
    cp.spawn=function(command,args,options){
      if(!launching)return rawSpawn.apply(this,arguments);
      const expected=[manifest.electron.path,...argv].map(value=>'"'+value+'"').join(' ');
      if(command!==expected||args?.length||options?.shell!==true||child)throw Error('H1_UNEXPECTED_ELECTRON_SPAWN');
      // Bypass only Playwright's known Windows cmd.exe wrapper, preserving stdout/inspector protocol.
      child=rawSpawn.call(this,manifest.electron.path,argv,{...options,shell:false,windowsHide:true});summary.pid=child.pid;
      child.stdout?.on('data',bytes=>fs.appendFileSync(path.join(output,'electron-stdout.txt'),bytes));child.stderr?.on('data',bytes=>fs.appendFileSync(path.join(output,'electron-stderr.txt'),bytes));
      assignmentPromise=(async()=>{
        const until=Date.now()+8000;while(!fs.existsSync(path.join(output,'entry-ready.json'))&&Date.now()<until&&child.exitCode===null)await wait(25);
        const ready=read(path.join(output,'entry-ready.json'));if(ready.pid!==child.pid||ready.parentPid!==process.pid||ready.nonce!==nonce||ready.productionLoaded!==false)throw Error('H1_ENTRY_HANDSHAKE_FAILED');
        const assignment=await supervisor.request('assign',{pid:child.pid,imagePath:manifest.electron.path,expectedParentPid:process.pid,commandMarker:nonce});summary.assignment=assignment;
        if(!assignment.ok||!assignment.state?.querySucceeded||!assignment.state.processIds.includes(child.pid))throw Error('H1_JOB_ASSIGNMENT_FAILED');remember(assignment.state);
        monitor=await startMonitor({...observer,outputPath:path.join(output,'during.jsonl'),durationMs:45000,intervalMs:250});
        if(!monitor.info?.ready)throw Error('H1_OBSERVER_START_FAILED');
        validate(manifest,{execute:true});
        fs.writeFileSync(manifestFile+'.used',JSON.stringify({output,atUtc:new Date().toISOString(),nonce}),{flag:'wx'});
        const finalState=await supervisor.request('status',{},1500);if(!finalState.ok||!finalState.state?.querySucceeded)throw Error('H1_FINAL_JOB_QUERY_FAILED');remember(finalState.state);
        write(gate,{nonce,pid:child.pid,jobAssigned:true,jobPids:finalState.state.processIds});grantReleased=true;summary.nativeResult='UNKNOWN';summary.nativeLoaded='UNKNOWN';
        poll=setInterval(async()=>{if(pendingQuery)return;pendingQuery=true;try{const reply=await supervisor.request('status',{},1000);if(!reply.ok||!reply.state?.querySucceeded)throw Error('H1_JOB_QUERY_FAILED');remember(reply.state);}catch(error){summary.jobQueryError=error.message;void supervisor.request('terminateTree').catch(()=>{});}finally{pendingQuery=false;}},400);
      })();
      assignmentPromise.catch(error=>{summary.assignmentError=error.message;void supervisor.request('terminateTree').catch(()=>{});});return child;
    };
    const {_electron}=require('playwright');launching=true;
    try{app=await _electron.launch({executablePath:manifest.electron.path,args:[entry,'--h1-config='+configPath,'--h1-nonce='+nonce],cwd:root,env,chromiumSandbox:true,artifactsDir:path.join(output,'artifacts'),timeout:18000});}finally{launching=false;cp.spawn=rawSpawn;}
    await assignmentPromise;if(!grantReleased||child.pid!==app.process().pid)throw Error('H1_PROCESS_OWNERSHIP_FAILED');
    const page=await app.firstWindow({timeout:8000});const pageErrors=[];page.on('pageerror',error=>pageErrors.push(String(error.message)));
    await page.waitForFunction(()=>typeof window.focal?.boot==='function',{timeout:6000});
    const call=(method,args)=>page.evaluate(async({method,args})=>window.focal[method](args),{method,args});
    summary.boot=await call('boot');if(summary.boot.bootFailure||summary.boot.photos.length||summary.boot.camera.connected)throw Error('H1_ISOLATED_BOOT_FAILED');
    summary.electron=await app.evaluate(()=>globalThis.__h1.info());if(summary.electron.versions.electron!==manifest.electron.version)throw Error('H1_ACTUAL_ELECTRON_VERSION_MISMATCH');
    summary.diagnosticStartedUtc=new Date().toISOString();
    diagnosticTimer=setTimeout(()=>{summary.diagnosticDeadlineExceeded=true;void supervisor.request('terminateTree').catch(()=>{});},15000);
    summary.report=await call('cameraDiagnose');write(path.join(output,'camera-diagnostics.json'),summary.report);
    if(summary.report.working!==false||!/EOS\s*2000D/i.test(summary.report.model||''))throw Error('H1_READ_ONLY_EOS_2000D_REPORT_REQUIRED');
    summary.connected=await call('boot');
    if(summary.connected.camera.working!==false||summary.connected.camera.eventsRegistered===true||summary.connected.camera.live||summary.connected.camera.saveTo!==null)throw Error('H1_READ_ONLY_INVARIANT_FAILED');
    await page.screenshot({path:path.join(output,'electron-main.png')});
    summary.disconnected=await call('cameraEndDiagnostics');
    summary.afterDisconnect=await call('boot');if(summary.afterDisconnect.camera.connected)throw Error('H1_DISCONNECT_NOT_CONFIRMED');
    summary.beforeClose=await app.evaluate(()=>globalThis.__h1.info());
    await call('window',{action:'close'}).catch(error=>{if(!/closed|destroyed|disposed|exited/i.test(error.message))throw error;});
    summary.process=await superviseChild({child,supervisor,timeoutMs:6000,rootGraceMs:1000,treeGraceMs:2000,handoffMs:20000});
    clearTimeout(diagnosticTimer);diagnosticTimer=null;clearInterval(poll);poll=null;remember(summary.process.jobStatus);summary.pageErrors=pageErrors;
    if(summary.process.disposition!=='CLEAN_EXIT'||summary.diagnosticDeadlineExceeded||summary.jobQueryError||pageErrors.length)throw Error('H1_CLEAN_ELECTRON_EXIT_REQUIRED');
    summary.worker=read(path.join(output,'native-worker.json'));summary.entry=read(path.join(output,'electron-entry.json'));
    const trace=readFrames(path.join(output,'native-trace.jsonl'));summary.nativeLoaded=trace.some(row=>row.phase==='library-load-after'&&row.library==='Canon');
    summary.nativeExceptions=trace.filter(row=>['throw','uncaughtException'].includes(row.phase));
    const pendingCalls=new Map();for(const row of trace){if(!['before','after','throw'].includes(row.phase))continue;const key=row.library+':'+row.name;pendingCalls.set(key,(pendingCalls.get(key)||0)+(row.phase==='before'?1:-1));}
    summary.unmatchedNativeCalls=[...pendingCalls].filter(([,count])=>count!==0).map(([name,count])=>({name,count}));
    summary.nativeCodes=trace.filter(row=>row.phase==='after'&&row.library==='Canon').map(({name,result,resultHex})=>({name,result,resultHex}));
    summary.systemCodes=trace.filter(row=>row.phase==='after'&&['SetDllDirectoryW','CoInitializeEx','CoUninitialize'].includes(row.name)).map(({name,result,resultHex})=>({name,result,resultHex}));
    const directoryResults=summary.systemCodes.filter(row=>row.name==='SetDllDirectoryW'),comResults=summary.systemCodes.filter(row=>row.name==='CoInitializeEx');
    const systemCleanupValid=directoryResults.length===2&&directoryResults.every(row=>Number.isInteger(row.result)&&row.result!==0)&&comResults.length===1&&Number.isInteger(comResults[0].result)&&comResults[0].result>=0&&comResults[0].result<=0x7fffffff&&summary.systemCodes.filter(row=>row.name==='CoUninitialize').length===1;
    summary.unexpectedNativeCodes=summary.nativeCodes.filter(row=>!Number.isInteger(row.result)||row.result<0||row.result>0xffffffff||(row.name==='EdsRelease'?row.result===0xffffffff:!['EdsGetPropertySize','EdsGetPropertyData','EdsGetPropertyDesc'].includes(row.name)&&row.result!==0));
    const zero=name=>summary.nativeCodes.filter(row=>row.name===name).length===1&&summary.nativeCodes.find(row=>row.name===name).result===0;
    const owned=new Map();let malformedOwnership=false;
    for(const row of trace){if(row.phase!=='after'||row.library!=='Canon')continue;
      if(['EdsGetCameraList','EdsGetChildAtIndex'].includes(row.name)&&row.result===0){const ref=row.outputs?.at(-1)?.[0]?.opaqueRef;if(!ref)malformedOwnership=true;else owned.set(ref,(owned.get(ref)||0)+1);}
      if(row.name==='EdsRelease'){const ref=row.outputs?.[0]?.opaqueRef;if(!ref||!(owned.get(ref)>0))malformedOwnership=true;else owned.set(ref,owned.get(ref)-1);}
    }
    summary.nativeCleanup={comBalanced:summary.worker.counts.CoInitializeEx===1&&summary.worker.counts.CoUninitialize===1,callbackTrampolinesAllocated:trace.filter(row=>row.phase==='callback-trampoline-allocation').length,callbackTrampolinesReleased:trace.filter(row=>row.phase==='callback-trampoline-release').length,ownedReferences:[...owned].map(([ref,remaining])=>({ref,remaining})),ownershipBalanced:!malformedOwnership&&[...owned.values()].every(count=>count===0)};
    if(!['EdsInitializeSDK','EdsTerminateSDK','EdsOpenSession','EdsCloseSession'].every(zero)||!systemCleanupValid||summary.nativeExceptions.length||summary.unmatchedNativeCalls.length||!summary.nativeCleanup.comBalanced||!summary.nativeCleanup.ownershipBalanced||summary.nativeCleanup.callbackTrampolinesAllocated!==summary.nativeCleanup.callbackTrampolinesReleased||summary.unexpectedNativeCodes.length||summary.worker.denials.length||summary.entry.observations.denials.length||summary.entry.observations.workers.length!==1||summary.entry.observations.workers[0].exited!==true||summary.entry.observations.workers[0].exitCode!==0||!trace.some(row=>row.phase==='unload-after'&&path.resolve(row.file).toLowerCase()===admission.dll.path.toLowerCase()))throw Error('H1_NATIVE_CLEANUP_RECEIPTS_FAILED');
    summary.nativeResult='H1_READ_ONLY_RECORDED';
  }catch(error){summary.error=String(error.stack||error);}
  finally{
    cp.spawn=rawSpawn;if(diagnosticTimer)clearTimeout(diagnosticTimer);if(poll)clearInterval(poll);
    if(supervisor){try{summary.supervisorShutdown=await supervisor.close();}catch(error){summary.supervisorError=error.message;supervisor.terminateHost();try{summary.supervisorExit=await supervisor.waitForExit(2000);}catch{}}}
    if(monitor)summary.observerStop=await monitor.stop().catch(error=>({confirmed:false,error:error.message}));
    try{summary.after=await runSnapshot({...observer,phase:'After',outputPath:path.join(output,'after.jsonl')});}catch(error){summary.after={ready:false,error:error.message};}
    if(monitor){try{summary.modules=moduleObservations(path.join(output,'during.jsonl'),manifest);write(path.join(output,'module-observations.json'),summary.modules);}catch(error){summary.moduleError=error.message;}}
    if(summary.error||summary.supervisorError||summary.supervisorShutdown?.result?.processTreeExitConfirmed!==true||summary.after?.ready!==true||summary.observerStop?.ready!==true||summary.modules?.unexpectedLocations?.length||summary.moduleError)summary.nativeResult=grantReleased?'UNKNOWN':'BLOCKED';
    summary.limitations='Real main/preload/renderer and production camera utility worker under one external kill-on-close Job; Chromium descendants expected. Invocation fence is test instrumentation, not an OS security sandbox. Passive samples may miss transient module/service/device/network activity. H2/H3 are not authorized by this run.';
    write(path.join(output,'result.json'),summary);
    if(app)await app.close().catch(()=>{});
  }
  console.log(JSON.stringify(summary,null,2));process.exitCode=summary.nativeResult==='H1_READ_ONLY_RECORDED'?0:summary.nativeResult==='BLOCKED'?2:3;
}
function readFrames(file){const bytes=fs.readFileSync(file);if(bytes.length>32*1024*1024)throw Error('H1_EVIDENCE_SIZE_LIMIT');return bytes.toString('utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);}
function moduleObservations(file,manifest){
  const modules=new Map(),incomplete=[];for(const frame of readFrames(file)){for(const error of frame.sectionErrors||[])incomplete.push(error);for(const proc of frame.targetProcesses||[]){if(proc.status!=='VISIBLE')continue;if(proc.moduleStatus!=='READ'||proc.modulesTruncated)incomplete.push('MODULE_SAMPLE_INCOMPLETE:'+proc.pid);for(const mod of proc.modules||[]){if(!mod.path)continue;const key=mod.path.toLowerCase();if(!modules.has(key))modules.set(key,{...mod,pids:[]});const entry=modules.get(key);if(!entry.pids.includes(proc.pid))entry.pids.push(proc.pid);}}}
  const known=new Set([manifest.electron.path,manifest.h1aManifest.baseAdmission.koffi.path,...manifest.h1aManifest.baseAdmission.dependencies.map(item=>item.path)].map(value=>path.resolve(value).toLowerCase()));
  const permitted=file=>known.has(path.resolve(file).toLowerCase())||within(path.dirname(manifest.electron.path),file)||within(path.join(root,'node_modules'),file)||path.dirname(path.resolve(file)).toLowerCase()===path.join(process.env.SystemRoot,'System32').toLowerCase()||within(path.join(process.env.SystemRoot,'WinSxS'),file);
  return {modules:[...modules.values()],unexpectedLocations:[...modules.values()].filter(mod=>!permitted(mod.path)),incomplete:[...new Set(incomplete)],qualification:'SAMPLED_LOCATIONS_REVIEWED_ONLY; vendor internal unloading is not certified'};
}
async function main(){
  if(process.platform!=='win32'||process.arch!=='x64'||process.env.NODE_OPTIONS||process.env.NODE_PATH||!process.execArgv.includes('--no-addons')||process.execArgv.some(arg=>!['--no-addons','--max-old-space-size=192'].includes(arg)))throw Error('H1_ADDON_FREE_PARENT_REQUIRED');
  const args=process.argv.slice(2),mode=args.shift();if(mode==='--prepare')return prepare(args);
  if(!['--dry-run','--execute'].includes(mode)||args.shift()!=='--manifest')throw Error('USAGE: h1-run.cjs --dry-run|--execute --manifest <H1 JSON> ['+approvals+']');
  const manifestFile=args.shift(),executeMode=mode==='--execute';if(!path.isAbsolute(manifestFile||'')||args.join(' ')!==(executeMode?approvals:''))throw Error('H1_EXPLICIT_AUTHORIZATION_REQUIRED');
  if(fs.existsSync(manifestFile+'.used'))throw Error('H1_MANIFEST_ATTEMPT_ALREADY_CONSUMED');
  const manifest=read(manifestFile),admission=validate(manifest,{execute:executeMode});
  if(!executeMode){console.log(JSON.stringify({mode:'H1_ADMISSION_DRY_RUN',ready:admission.ready,blockers:admission.blockers,manifestSha256:hash(manifestFile),runtimeSha256:admission.dll.sha256,nativeLoaded:false,electronLaunched:false,authorization:'NOT_GRANTED'},null,2));return;}
  await execute(manifest,manifestFile,admission);
}
if(require.main===module)main().catch(error=>{console.error(String(error.stack||error));process.exitCode=2;});
module.exports={main,validate,allowed,sourceHashes,moduleObservations};
