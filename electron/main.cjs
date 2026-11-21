const {app,BrowserWindow,ipcMain,dialog,shell,utilityProcess,protocol,net,nativeTheme,clipboard}=require('electron');
const integration=require('./integration-composition.cjs').consume();
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const chokidar=require('chokidar');
const sharp=require('sharp');
const L=require('./library.cjs');
const {VALUES}=require('./camera-values.cjs');
const {normalize:normalizeAppearance,windowOptions:appearanceWindowOptions}=require('./remote/appearance.js');
const {createRemoteServer,localInterfaces}=require('./remote-server.cjs');
const QRCode=require('qrcode');
const {migrateSessions,cleanSession,newSession}=require('./sessions.cjs');
const {deleteSession}=require('./session-delete.cjs');
const {deletePhotos}=require('./photo-delete.cjs');
const {prepareSeries,runSeries}=require('./preset-series.cjs');
const {equipmentCards,loadProduct,identify}=require('./equipment.cjs');
const {productMedia}=require('./product-media.cjs');
const {createFlashBridge,flashAvailability}=integration?.flash||require('./flash-bridge.cjs');
const flashBridge=createFlashBridge();
const {composition:normalizeComposition,workspace:normalizeWorkspace}=require('./workspace-settings.cjs');
const {readMetadata}=require('./metadata.cjs');
const {createShotInspector}=require('./shot-inspector.cjs');
const {onboardingState,inspectFolder}=require('./onboarding.cjs');
const {createLibraryBootstrap,selectDataFolder}=require('./library-bootstrap.cjs');
const {readLibraryText,writeLibraryStore}=require('./library-storage.cjs');
const {createBootApplication}=require('./boot-application.cjs');
const {frontendTarget,denyPermissions,copyHexColor}=require('./frontend-policy.cjs');
const {createLibraryCommitter}=require('./library-commits.cjs');
const {createPhotoImporter}=require('./photo-import.cjs');
const {createProtectedExport}=require('./protected-export.cjs');
const {createExportService}=require('./export-service.cjs');
const {previousPath}=require('./library-recovery.cjs');
const {createOperationClient}=require('./operation-lifecycle.cjs');
const {createTransferConsumer}=require('./transfer-consumer.cjs');
const {createShutdownCoordinator}=require('./shutdown-coordinator.cjs');
const {createWorkerRetirement}=require('./runtime-replacement.cjs');
const metadataCache=new Map();
const previewTasks=new Set();
app.setName('Apertrove');
const legacyData=path.join(app.getPath('appData'),'Focal Studio');
const dataFolder=integration?.dataFolder||process.env.FOCAL_TEST_DATA||selectDataFolder({legacy:legacyData,current:path.join(app.getPath('appData'),'Apertrove'),probe:folder=>require('node:fs').statSync(path.join(folder,'library.json'))});
app.setPath('userData',dataFolder);
if(!process.env.FOCAL_TEST_DATA){
  if(!app.requestSingleInstanceLock())app.quit();
  app.on('second-instance',()=>{if(win&&!win.isDestroyed()){if(win.isMinimized())win.restore();win.show();win.focus();}});
}
protocol.registerSchemesAsPrivileged([{scheme:'focal-asset',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
let win,worker,store,storePath,cacheDir,watcher,interval=null,sequence=0,quitting=false,captureActive=false,camera={connected:false,properties:{}},logs=[];
let shotInspector;
let libraryBootstrap,servicesReady=false;
let remote,remoteInfo={running:false,clients:0},commandRoutes,knownCameras=[],remoteStateTimer,desktopFrameInFlight=false,pendingDesktopFrame=null;
let importQueue=Promise.resolve(),workerState=null;const assets=new Map(),applicationTasks=new Set(),workerChannels=new Set();
let consumerRevision=0,importFailures=0;
const lifecycleIssues=new Set();let diagnosticTail=Promise.resolve(),runtimeQuarantined=false;
function lifecycleIssue(code){if(lifecycleIssues.size<32)lifecycleIssues.add(code);}
let burst=null,series=null,sessionTransition=false,captureMetadata=null,focusPreview=null,accessoryBusy=false,controlBusy=false,servoTransition=null,captureQueued=false,pendingBurstStart=null;
const burstActive=()=>burst&&['holding','transferring'].includes(burst.status);
const seriesActive=()=>series&&['running','stopping','restoring'].includes(series.status);
const servoActive=()=>camera.connected&&(camera.servo?.enabled===true||camera.servo?.enabled===null||['starting','running','stopping'].includes(camera.servo?.status));
const servoCaptureBlocked=()=>servoActive()&&!(camera.servo?.enabled===true&&camera.servo?.status==='running');
const bulbActive=()=>['starting','exposing','stopping'].includes(camera.bulb?.status)||camera.bulb?.status==='error'&&camera.bulb?.confirmation==='unknown';
function requireSession(){if(!store.sessions.some(s=>s.id===store.sessionId))throw Error('Создайте или откройте фотосессию.');}
function nativeOwned(){return !!workerState&&!workerState.exited&&(workerState.rpc.hasOutstanding()||!workerState.rpc.snapshot().admissionOpen);}
function cameraIdle({allowServo=false}={}){if(runtimeQuarantined)throw Error(t('operation.unknown'));if(quitting||nativeOwned()||bulbActive()||!allowServo&&servoActive()||seriesActive()||burstActive()||interval||captureActive||sessionTransition||accessoryBusy||controlBusy)throw Error('Дождитесь окончания текущей команды камеры.');}
async function cameraCommand(method,args){cameraIdle({allowServo:['servo','live','property'].includes(method)});controlBusy=true;remote?.publishState();try{return await call(method,args);}finally{controlBusy=false;remote?.publishState();}}
function setServo(enabled){
  if(typeof enabled!=='boolean')throw Error('Некорректное состояние AI Servo.');
  if(servoTransition){if(servoTransition.enabled===enabled)return servoTransition.promise;throw Error('Дождитесь переключения AI Servo.');}
  if(!enabled&&(captureActive||controlBusy))throw Error('Дождитесь окончания текущей команды камеры.');
  const channel=workerState,epoch=channel?.nativeEpoch;
  const promise=enabled?cameraCommand('servo',{enabled:true}):(async()=>{
    controlBusy=true;remote?.publishState();try{return worker?await call('servoStop'):camera;}finally{controlBusy=false;remote?.publishState();}
  })();
  const transition={enabled,channel,epoch,promise};servoTransition=transition;
  const settled=()=>{if(servoTransition===transition)servoTransition=null;};promise.then(settled,settled);
  return promise;
}
async function withShutterControl(command){
  if(captureQueued)throw Error('Предыдущий кадр ещё ожидает завершения команды камеры.');
  captureQueued=true;
  try{
    const transition=servoTransition;
    if(transition){
      // Keep a shutter intent behind the finite toggle request. It is never
      // admitted concurrently to the SDK, nor replayed into a new session.
      await transition.promise;
      if(workerState!==transition.channel||workerState?.nativeEpoch!==transition.epoch)throw Object.assign(Error(t('operation.stale')),{code:'OPERATION_STALE_SESSION'});
    }
    cameraIdle({allowServo:true});
    if(servoCaptureBlocked())throw Error('Состояние AI Servo не подтверждено. Остановите AI Servo или отключите камеру.');
    if(interval)throw Error('Сначала остановите интервальную съёмку.');
    return await command();
  }finally{captureQueued=false;}
}
function captureFromControl(){return withShutterControl(()=>capture());}
function burstFromControl({seconds=5}={}){
  if(pendingBurstStart)throw Error('Камера занята.');
  const intent={released:false};pendingBurstStart=intent;
  return withShutterControl(()=>{
    // Pointer/key release can precede completion of a queued Servo toggle.
    // That released intent must never start a later five-second shutter hold.
    if(intent.released)return {status:'cancelled',shots:0};
    requireSession();if(captureActive)throw Error('Камера занята.');
    if(![1,4,5].includes(camera.properties.driveMode?.value))throw Error('Выберите серийный режим камеры.');
    seconds=Number(seconds);if(!Number.isFinite(seconds)||seconds<.1||seconds>5)throw Error('Удержание: от 0.1 до 5 секунд.');
    burst={id:crypto.randomUUID(),status:'holding',shots:0,seconds,startedAt:Date.now()};emit('burst',{...burst});
    trackApplication(capture({burstMs:Math.round(seconds*1000)},{burstId:burst.id}).then(async result=>{
      await importQueue;burst={...burst,status:result.confirmation==='CONFIRMED'?'completed':'unconfirmed',shots:result.confirmation==='CONFIRMED'?result.shots:0,observedTransfers:result.observedTransfers||0};emit('burst',burst);
    }).catch(error=>{burst={...burst,status:'failed',error:error.message};emit('burst',burst);log('error',error.message);}));
    return {...burst};
  }).finally(()=>{if(pendingBurstStart===intent)pendingBurstStart=null;});
}
function sessionIdle(allowWatcher=false){if(quitting||nativeOwned()||bulbActive()||servoActive()||accessoryBusy||controlBusy||seriesActive()||burstActive()||interval||captureActive||watcher&&!allowWatcher||sessionTransition)throw Error('Остановите текущую съёмку и автоимпорт перед сменой фотосессии.');}
const sessionsRoot=()=>path.join(process.env.FOCAL_TEST_DATA?path.join(process.env.FOCAL_TEST_DATA,'Pictures'):app.getPath('pictures'),'Apertrove');
const {languages, supportedLocales, resolve: resolveLocale, migrate: migrateLanguage, register, setLocale, legacy:ltext, t, starterPresetLabel}=require('./i18n/runtime.js');
for(const locale of supportedLocales)register(locale,require('./i18n/locales/'+locale+'.json'));
const currentLocale=()=>resolveLocale(store?.settings.language||'system',app.getPreferredSystemLanguages());
const currentAppearance=()=>normalizeAppearance(store?.settings||{},nativeTheme.shouldUseDarkColors);
const emit=(type,data)=>{if(quitting&&['photo','photoUpdated','burst','series','interval'].includes(type))return;if((type==='settings'||type==='appearance')&&win&&!win.isDestroyed())win.setBackgroundColor(appearanceWindowOptions(currentAppearance()).backgroundColor);if(win&&!win.isDestroyed())win.webContents.send('focal:event',{type,data,...(type==='settings'?{appearance:currentAppearance(),locale:currentLocale()}: {})});if(type==='photo'&&data.cameraTransfer)shotInspector?.photoChanged();if(type==='settings')shotInspector?.publish();if(remote&&['camera','photo','photoUpdated','settings','state','presets','interval','series','burst','captureState','operationState','cameras','focusPreview'].includes(type)){clearTimeout(remoteStateTimer);remoteStateTimer=setTimeout(()=>remote.publishState(),30);}};
const log=(level,message)=>{const entry={level,message,time:new Date().toISOString()};logs=[...logs.slice(-199),entry];emit('log',entry);};
const commits=createLibraryCommitter({getStore:()=>store,writeSnapshot:snapshot=>writeLibraryStore(storePath,snapshot),isReady:()=>!!libraryBootstrap?.isReady()});
const exporter=createProtectedExport({getRegistry:()=>({files:[...store.photos.map(photo=>photo.path),storePath,previousPath(storePath)],directories:[path.dirname(storePath)]}),serialize:operation=>commits.runExclusive(operation)});
const importer=createPhotoImporter({getStore:()=>store,commits,extensions:L.EXTENSIONS,uniquePath:L.uniquePath,buildPhoto:file=>L.buildPhoto(file,cacheDir),beforeRead:file=>exporter.waitForPath(file),onPhoto:entry=>{emit('photo',publicPhoto(entry));if(entry.transfer?.sessionAssociation?.status==='AMBIGUOUS')log('error',t('import.session_ambiguous',{name:entry.name}));else if(entry.sessionAssociation?.status==='SESSION_REMOVED')log('error',t('import.session_removed',{name:entry.name}));},onError:item=>log('error',item.retainedPath?t('import.retained',{name:item.name,path:item.retainedPath,message:item.message}):`${item.name}: ${item.message}`),onComplete:result=>log(result.errors.length?'error':'success',`Импорт: ${result.added}; пропущено: ${result.skipped}; ошибок: ${result.errors.length}.`)});
const exportsService=createExportService({exporter,showSaveDialog:options=>dialog.showSaveDialog(win,options),getPhoto:photo,getPresets:()=>store.presets,readMetadata,renderEditedBuffer:L.renderEditedBuffer,cleanEdits,localize:ltext,t,onPhotoExport:output=>log('success',`Экспорт: ${output}`)});
function persist(){return commits.persist();}
function exportTask(operation){if(sessionTransition)throw Error('Дождитесь окончания операции с библиотекой.');const job=Promise.resolve().then(operation);previewTasks.add(job);return job.finally(()=>previewTasks.delete(job));}
function photo(id){const p=store.photos.find(p=>p.id===id);if(!p)throw Error('Снимок не найден.');return p;}
function asset(file){if(!file)return null;const id=crypto.createHash('sha256').update(file).digest('hex');assets.set(id,file);return `focal-asset://image/${id}`;}
function publicPhoto(p){return {...p,thumb:asset(p.thumbPath),preview:asset(p.previewPath)};}
const operationState=()=>({busy:nativeOwned(),ledger:workerState?.rpc.snapshot()||null});
const lastReceivedPhotoId=()=>store.photos.findLast(photo=>photo.cameraTransfer===true)?.id??null;
const publicState=()=>({...store,lastReceivedPhotoId:lastReceivedPhotoId(),locale:currentLocale(),appearance:currentAppearance(),showOnboarding:!store.settings.onboarding.completed&&(!process.env.FOCAL_TEST_DATA||process.env.FOCAL_TEST_ONBOARDING==='1'),photos:store.photos.map(publicPhoto),camera,cameras:knownCameras,remote:remoteInfo,interfaces:localInterfaces(),logs,interval,series,burst,focusPreview,captureState:{active:captureActive},operationState:operationState(),values:VALUES,watching:!!watcher,bootFailure:null});
function remoteState(){const session=store.sessions.find(s=>s.id===store.sessionId);return {locale:currentLocale(),appearance:currentAppearance(),camera:Object.fromEntries(['connected','live','model','mode','battery','properties','cameraId','connectedAt','capabilities','saveTo','liveStats','autofocus','servo','bulb','focusInfo','error'].map(key=>[key,camera[key]])),cameras:knownCameras,session:{name:session?.name,queueLength:session?.presetQueue?.length||0,count:session?store.photos.filter(p=>p.sessionId===session.id).length:0},presets:store.presets.map(p=>({id:p.id,name:starterPresetLabel(p,'name')})),interval,series,burst,focusPreview:camera.live?null:focusPreview,composition:store.settings.composition,busy:nativeOwned()||servoCaptureBlocked()||bulbActive()||captureActive||!!seriesActive()||accessoryBusy||controlBusy||sessionTransition};}
function flushDesktopFrame(){if(desktopFrameInFlight||!pendingDesktopFrame||!win||win.isDestroyed())return;const frame=pendingDesktopFrame;pendingDesktopFrame=null;desktopFrameInFlight=true;win.webContents.send('focal:frame',frame);}
function publishFrame(bytes){remote?.publishFrame(bytes);pendingDesktopFrame=bytes;flushDesktopFrame();}
function trackApplication(value){const job=Promise.resolve(value);applicationTasks.add(job);job.then(()=>applicationTasks.delete(job),()=>applicationTasks.delete(job));return job;}
function transferRoute(destination=store.settings.captureFolder,sessionId=store.sessionId){return {sessionId,destination};}
function call(method,args={},options={}){
  const channel=workerState;
  if(!channel||channel.exited)return Promise.reject(Error('Модуль камеры не запущен.'));
  const timeoutMs=options.timeoutMs??integration?.requestTimeoutMs(method)??(method==='capture'?(camera.properties.driveMode?.value===7?920000:85000):method==='importCard'?180000:['autofocus','focus'].includes(method)?30000:20000);
  if(['connect','destination','capture','importCard'].includes(method)&&!args.route)args={...args,route:transferRoute(args.folder??store.settings.captureFolder)};
  return channel.rpc.call(method,args,{timeoutMs}).then(result=>{
    if(channel.nativeIssue)throw Object.assign(Error(t('operation.unknown')),{code:'OPERATION_UNKNOWN_TERMINATION'});
    return result;
  }).catch(error=>{
    if(error.code==='OPERATION_UNKNOWN_TERMINATION'){runtimeQuarantined=true;lifecycleIssue('NATIVE_RESULT_UNKNOWN');}
    const key=error.code==='OPERATION_TIMEOUT'?'operation.timeout_draining':error.code==='OPERATION_BUSY'?'operation.busy':error.code==='OPERATION_STALE_SESSION'?'operation.stale':error.code==='OPERATION_UNKNOWN_TERMINATION'?'operation.unknown':error.code==='OPERATION_ADMISSION_CLOSED'?'operation.closed':null;
    if(key)error.message=t(key);throw error;
  });
}
function stopInterval(reason){if(interval){interval.cancelled=true;interval=null;emit('interval',null);if(reason)log('info',reason);}}
function startWorker(){
  if(quitting)throw Error(t('operation.closed'));
  if(runtimeQuarantined||workerChannels.size>=16)throw Error(t('operation.unknown'));
  const generation=crypto.randomUUID(),provider=integration?.camera,source=utilityProcess.fork(provider?.entrypoint||path.join(__dirname,'camera-worker.cjs'),provider?provider.argsFor(generation):['--apertrove-generation='+generation],{serviceName:'Apertrove Camera',stdio:'pipe',env:{...process.env,APERTROVE_RECOVERY_DESTINATION:path.join(app.getPath('userData'),'unattributed-transfers'),...(provider?provider.envFor(generation):{})}});
  let exited;const channel={generation,process:source,nativeEpoch:0,sdkDir:store?.settings?.sdkDir??'',exited:false,exitPromise:new Promise(resolve=>{exited=resolve;})};
  channel.rpc=createOperationClient({generation,send:message=>source.postMessage(message),getSessionEpoch:()=>channel.nativeEpoch,onChange:()=>emit('operationState',operationState())});
  channel.consumer=createTransferConsumer({generation,register:(file,context,cameraTransfer)=>queueImport([file],false,cameraTransfer,{sessionId:context.sessionId,dest:context.destination,transfer:context}),onIssue:code=>{lifecycleIssue(code);log('error',t('operation.transfer_issue'));}});
  worker=source;workerState=channel;workerChannels.add(channel);
  integration?.onWorker(source,channel);
  source.stdout?.on('data',d=>log('info',String(d).trim()));source.stderr?.on('data',d=>log('error',String(d).trim()));
  source.on('message',m=>{
    if(!m)return;if(m.generation!==generation){if(m.event==='photo')void channel.consumer.accept(m);return;}
    if(m.type==='operation'){const accepted=channel.rpc.receive(m);if(accepted&&Number.isSafeInteger(m.nativeSessionEpoch))channel.nativeEpoch=Math.max(channel.nativeEpoch,m.nativeSessionEpoch);return;}
    // A late saved file remains accounted for even if its session/worker is old.
    if(m.event==='photo'){void channel.consumer.accept(m);return;}
    if(m.event==='nativeObservation'||m.event==='transferIssue'){channel.issue=true;if(m.event==='nativeObservation'){channel.nativeIssue=true;runtimeQuarantined=true;lifecycleIssue('NATIVE_RESULT_UNKNOWN');}else lifecycleIssue('TRANSFER_RESULT_UNKNOWN');log('error',t('operation.transfer_issue'));return;}
    if(!['status','burstReleased','burstProgress','focusInfo','focusPreview','frame','log'].includes(m.event))return;
    if(source!==worker||!Number.isSafeInteger(m.sessionEpoch)||m.sessionEpoch<channel.nativeEpoch)return;
    channel.nativeEpoch=m.sessionEpoch;
    if(m.event==='status'){camera=m.data;if(!camera.connected&&!accessoryBusy&&focusPreview){focusPreview=null;emit('focusPreview',null);}emit('camera',camera);if(!camera.connected&&seriesActive())series.cancelled=true;if(!camera.connected)stopInterval('Интервальная съёмка остановлена: камера отключена.');}
    else if(m.event==='burstReleased'){if(burstActive()){burst.status='transferring';emit('burst',{...burst});}}
    else if(m.event==='burstProgress'){if(burstActive()){burst.shots=m.data.shots;emit('burst',{...burst});}}
    else if(m.event==='focusInfo'){camera.focusInfo=m.data;if(win&&!win.isDestroyed())win.webContents.send('focal:focus',m.data);remote?.publishFocus(m.data);}
    else if(m.event==='focusPreview'){const bytes=Buffer.from(m.data.bytes);focusPreview={image:`data:image/jpeg;base64,${bytes.toString('base64')}`,at:m.data.at,focusInfo:m.data.focusInfo};emit('focusPreview',focusPreview);remote?.publishState();}
    else if(m.event==='frame'){const bytes=Buffer.isBuffer(m.data)?m.data:Buffer.from(m.data.buffer,m.data.byteOffset,m.data.byteLength);publishFrame(bytes);}
    else if(m.event==='log')log(m.data.level,m.data.message);
  });
  source.on('exit',code=>{
    channel.exited=true;channel.exitCode=code;channel.rpc.terminate();exited(code);
    if(!channel.finalizing&&!channel.retiring){
      runtimeQuarantined=true;lifecycleIssue('WORKER_EXIT_UNFENCED');
      void writeLifecycleDiagnostic({outcome:'UNKNOWN_TERMINATION',phase:'WORKER_EXIT'}).catch(()=>{});
    }
    if(worker!==source)return;
    worker=null;camera={connected:false,properties:{},error:runtimeQuarantined||code?t('operation.unknown'):null};
    emit('camera',camera);emit('operationState',operationState());stopInterval();
    if(!quitting&&camera.error)log('error',camera.error);
  });
}
async function prepareRuntime(sdkDir,{recheck=false}={}){
  const previous=workerState;
  if(worker&&(recheck||previous.sdkDir!==undefined&&previous.sdkDir!==sdkDir)){
    if(camera.connected)throw Error(t('operation.busy'));
    previous.retirement??=createWorkerRetirement({
      channel:previous,drainConsumers:drainTransferConsumers,
      persist:async()=>{if(libraryBootstrap?.isReady())await persist();return true;},
      recordDiagnostic:writeLifecycleDiagnostic,
      onUnknown:()=>{
        runtimeQuarantined=true;lifecycleIssue('RUNTIME_REPLACEMENT_UNKNOWN');
        camera={...camera,error:t('operation.unknown')};emit('camera',camera);
      }
    });
    previous.retirementPromise??=previous.retirement.close();
    const receipt=await previous.retirementPromise;
    if(receipt.outcome!=='CLOSED')throw Error(t('operation.unknown'));
    knownCameras=[];emit('cameras',knownCameras);
  }
  if(quitting)throw Error(t('operation.closed'));
  if(!worker)startWorker();
  workerState.sdkDir=sdkDir;
}
async function withRuntime(command,{recheck=false}={}){
  cameraIdle();controlBusy=true;remote?.publishState();
  try{
    const sdkDir=store.settings.sdkDir;
    await prepareRuntime(sdkDir,{recheck});
    if(quitting)throw Error(t('operation.closed'));
    return await command(sdkDir);
  }finally{controlBusy=false;remote?.publishState();}
}
async function addFiles(files,copy=true,context){
  return importer.addFiles(files,copy,context);
}
function queueImport(files,copy=true,cameraTransfer=false,explicitContext){
  const context=JSON.parse(JSON.stringify(explicitContext?{...explicitContext,cameraTransfer}:{sessionId:store.sessionId,dest:store.settings.captureFolder,equipment:{camera:camera.model,lens:camera.equipment?.lensName},cameraTransfer}));
  consumerRevision++;const job=importQueue.catch(()=>{}).then(()=>addFiles(files,copy,context));importQueue=job;
  job.then(result=>{if(result.errors?.length)importFailures++;},()=>{importFailures++;});return job;
}
function capture(args={},metadata=null){return trackApplication(captureOnce(args,metadata));}
async function captureOnce(args={},metadata=null){
  if(quitting)throw Error(t('operation.closed'));
  requireSession();if(!store.settings.captureFolder)throw Error('Выберите папку съёмки.');if(captureActive)throw Error('Предыдущий кадр ещё сохраняется.');
  const delivery=Object.freeze(transferRoute()),captureId=crypto.randomUUID();
  const equipment={camera:camera.model,lens:camera.equipment?.lensName};
  captureActive=true;captureMetadata=metadata;emit('captureState',{active:true});
  try{
    const source=workerState,result=await call('capture',{autofocus:store.settings.autofocus,...args,folder:delivery.destination,captureId,route:delivery});
    await source.consumer.drain();
    if(source.consumer.snapshot().issues.includes('TRANSFER_REGISTRATION_FAILED'))throw Error(t('operation.transfer_issue'));
    if(result.confirmation==='CONFIRMED'){store.equipmentStats??={};for(const key of [`camera:${equipment.camera}`,`lens:${equipment.lens}`])store.equipmentStats[key]=(store.equipmentStats[key]||0)+(result.shots||0);}
    else log('info',t('operation.capture_unverified'));
    const session=store.sessions.find(s=>s.id===delivery.sessionId);if(session)session.updated=new Date().toISOString();await persist();return result;
  }finally{captureMetadata=null;captureActive=false;emit('captureState',{active:false});}
}
async function activateSession(target,destinationReady=false){
  await fs.mkdir(target.captureFolder,{recursive:true});
  if(camera.connected&&!destinationReady)await call('destination',{folder:target.captureFolder,route:transferRoute(target.captureFolder,target.id)});
  store.sessionId=target.id;store.settings.captureFolder=target.captureFolder;store.settings.autofocus=target.autofocus!==false;store.settings.composition=normalizeComposition(target.composition,target.grid);store.settings.grid=store.settings.composition.grid!=='off';
  target.updated=new Date().toISOString();await persist();emit('state',publicState());return publicState();
}
async function sessionAction(fn,{allowWatcher=false}={}){sessionIdle(allowWatcher);sessionTransition=true;remote?.publishState();try{await importQueue.catch(()=>{});await Promise.allSettled([...previewTasks]);return await fn();}finally{sessionTransition=false;remote?.publishState();shotInspector?.publish();}}
function seriesProgress(job){Object.assign(series,job);if(job.phase==='restoring'&&job.status==='running')series.status='restoring';emit('series',{...series});}
async function startSeries({ids}={}){
  cameraIdle();requireSession();if(captureActive)throw Error('Дождитесь сохранения кадра.');
  const current=await call('status');cameraIdle();if(captureActive)throw Error('Камера занята.');
  const queue=ids||store.sessions.find(s=>s.id===store.sessionId)?.presetQueue;
  const plan=prepareSeries(queue,store.presets,current);const currentAutofocus=store.settings.autofocus;
  series={id:crypto.randomUUID(),status:'running',startedAt:new Date().toISOString(),phase:'preparing',done:0,count:plan.steps.length,index:0,current:'',cancelled:false,restoreErrors:[]};
  emit('series',{...series});
  trackApplication(runSeries(plan,{property:args=>call('property',args),capture:metadata=>capture({autofocus:currentAutofocus},metadata),waitImports:()=>importQueue,progress:seriesProgress},series).then(job=>log(job.status==='completed'?'success':job.status==='unconfirmed'||job.status==='cancelled'?'info':'error',job.status==='unconfirmed'?t('operation.capture_unverified'):job.error||`Серия пресетов: ${job.done} из ${job.count}. Исходные параметры восстановлены.`)).catch(e=>{series={...series,status:'failed',error:e.message};emit('series',series);log('error',e.message);}));
  return {...series};
}

async function choose(properties=['openDirectory'],title='Выберите папку'){const res=await dialog.showOpenDialog(win,{title:ltext(title),properties});return res.canceled?null:res.filePaths[0];}
function validatePreset(p){
  if(!p||typeof p.name!=='string'||!p.name.trim()||p.name.length>80)throw Error('Имя пресета должно содержать от 1 до 80 символов.');
  const values={};for(const key of Object.keys(VALUES)){if(p.values?.[key]!==undefined){const v=Number(p.values[key]);if(!Number.isInteger(v)||v<0||v>0xffffffff)throw Error('Некорректный параметр пресета.');values[key]=v;}}
  if(!Object.keys(values).length)throw Error('В пресете нет параметров камеры.');
  return {id:typeof p.id==='string'?p.id:crypto.randomUUID(),name:p.name.trim(),description:String(p.description||'').slice(0,300),color:['sage','sand','blue','rose'].includes(p.color)?p.color:'sage',values};
}
function installHandlers(){
  const saveOnboarding=async patch=>{
    store.settings.onboarding=onboardingState({...store.settings.onboarding,...patch});
    await persist();
    emit('settings',store.settings);
    return store.settings.onboarding;
  };
  const chooseSdkFolder=async()=>{
    cameraIdle();
    if(camera.connected)throw Error(t('onboarding.camera_is_busy'));
    controlBusy=true;remote?.publishState();
    try{
      const dir=await choose(['openDirectory','createDirectory'],t('desktop.choose_sdk_folder'));
      if(dir){store.settings.sdkDir=dir;await persist();emit('settings',store.settings);}
      return dir;
    }finally{controlBusy=false;remote?.publishState();}
  };
  const connectCamera=({cameraId,readOnly=false,controlsOnly=false,savePreference,reconfigure=false}={})=>withRuntime(async sdkDir=>{
      knownCameras=await call('listCameras',{sdkDir});emit('cameras',knownCameras);
      const selected=cameraId||knownCameras.find(c=>c.id===store.settings.preferredCameraId)?.id;
      const entry=knownCameras.find(c=>c.id===selected)||(knownCameras.length===1?knownCameras[0]:null);
      if(entry&&camera.connected&&camera.cameraId!==entry.id)await call('disconnect');
      if(quitting)throw Error(t('operation.closed'));
      if(quitting)throw Error('Приложение закрывается.');
      const result=await call('connect',{sdkDir,folder:store.settings.captureFolder,cameraId:selected,
        readOnly,controlsOnly,reconfigure,savePreference:savePreference??store.settings.savePreference});
      if(result.connected&&!readOnly&&!controlsOnly){store.settings.preferredCameraId=result.cameraId;await persist();}
      return result;
  });
  const handlers={
    boot:()=>bootApplication(),
    listCameras:()=>withRuntime(async sdkDir=>{knownCameras=await call('listCameras',{sdkDir});emit('cameras',knownCameras);return knownCameras;}),
    connect:({cameraId}={})=>connectCamera({cameraId}),
    disconnect:()=>{cameraIdle({allowServo:true});return call('disconnect');},live:a=>cameraCommand('live',a),property:a=>cameraCommand('property',a),focus:a=>cameraCommand('focus',a),autofocus:()=>{cameraIdle();focusPreview=null;emit('focusPreview',null);return cameraCommand('autofocus',{preview:store.settings.focusPreviewOnSuccess!==false});},
    servo:({enabled}={})=>setServo(enabled),
    bulbStart:args=>cameraCommand('bulbStart',args),
    bulbStop:()=>worker?call('bulbStop'):camera,
    flashSupport:async()=>flashAvailability(camera,camera.connected?await flashBridge.cached(camera.model):{}),
    flashPopup:async()=>{cameraIdle();if(!camera.connected)throw Error('Сначала подключите камеру.');return flashBridge.popup(camera.model);},
    capture:captureFromControl,
    chooseFolder:async({kind})=>{if(!['captureFolder','watchFolder','sdkDir'].includes(kind))throw Error('Неизвестная папка.');if(kind==='sdkDir')return chooseSdkFolder();if((kind==='captureFolder'&&(captureActive||interval||watcher))||(kind==='watchFolder'&&watcher))throw Error('Сначала остановите текущую операцию.');const dir=await choose(['openDirectory','createDirectory'],'Выберите папку');if(dir){if(kind==='captureFolder'){requireSession();sessionIdle();if(camera.connected)await call('destination',{folder:dir});store.sessions.find(s=>s.id===store.sessionId).captureFolder=dir;}store.settings[kind]=dir;await persist();emit('settings',store.settings);}return dir;},
    importFiles:()=>sessionAction(async()=>{requireSession();const res=await dialog.showOpenDialog(win,{title:ltext('Импорт фотографий'),properties:['openFile','multiSelections'],filters:[{name:ltext('Фотографии и RAW'),extensions:[...L.EXTENSIONS].map(s=>s.slice(1))}]});return res.canceled?null:queueImport(res.filePaths,true);},{allowWatcher:true}),
    photoDelete:a=>sessionAction(async()=>{
      const imageCache=sharp.cache();
      try{
        sharp.cache(false);
        const result=await deletePhotos(store,a,{trashItem:file=>shell.trashItem(file),persist,cacheDir,onProgress:progress=>emit('photoDeletion',progress)});
        metadataCache.clear();emit('state',publicState());return {...result,state:publicState()};
      }finally{sharp.cache({memory:imageCache.memory.max,files:imageCache.files.max,items:imageCache.items.max});}
    }),
    photoUpdate:async({id,rating,edits,sessionId})=>{
      photo(id);const patch={};
      if(rating!==undefined)patch.rating=Math.max(0,Math.min(5,Math.round(Number(rating)||0)));
      if(edits)patch.edits=cleanEdits(edits);
      if(sessionId!==undefined){
        if(sessionId!==null&&(typeof sessionId!=='string'||!store.sessions.some(session=>session.id===sessionId)))throw Error('Фотосессия не найдена.');
        patch.sessionId=sessionId;patch.sessionAssignment={source:'USER',sessionId,at:new Date().toISOString()};
      }
      const p=await commits.updatePhoto(id,patch);emit('photoUpdated',publicPhoto(p));return publicPhoto(p);
    },
    photoMetadata:async({id})=>{const p=photo(id),stat=await fs.stat(p.path),key=`${id}:${stat.size}:${stat.mtimeMs}`;if(!metadataCache.has(key)){metadataCache.set(key,await readMetadata(p.path));if(metadataCache.size>16)metadataCache.delete(metadataCache.keys().next().value);}return metadataCache.get(key);},
    exportMetadata:args=>exportTask(()=>exportsService.exportMetadata(args)),
    renderPreview:({id,edits})=>{if(sessionTransition)throw Error('Дождитесь окончания операции с библиотекой.');const job=(async()=>{const p=photo(id),e=cleanEdits(edits),out=path.join(cacheDir,`${id}-edit-${crypto.createHash('sha1').update(JSON.stringify(e)).digest('hex')}.jpg`);await L.renderEdited({...p,path:p.previewPath||p.path},out,e);return asset(out);})();previewTasks.add(job);return job.finally(()=>previewTasks.delete(job));},
    exportPhoto:args=>exportTask(()=>exportsService.exportPhoto(args)),
    reveal:({id})=>{if(id)shell.showItemInFolder(photo(id).path);else if(store.settings.captureFolder)shell.openPath(store.settings.captureFolder);return true;},
    savePreset:async p=>{const clean=validatePreset(p);store.presets=store.presets.filter(v=>v.id!==clean.id).concat(clean);await persist();emit('presets',store.presets);return clean;},
    deletePreset:async({id})=>{store.presets=store.presets.filter(p=>p.id!==id);await persist();emit('presets',store.presets);return true;},
    applyPreset:async({id})=>{cameraIdle();const preset=store.presets.find(p=>p.id===id);if(!preset)throw Error('Пресет не найден.');controlBusy=true;try{const applied=[],failed=[];for(const [key,value] of Object.entries(preset.values)){try{await call('property',{key,value});applied.push(key);}catch(error){failed.push(key);if(['OPERATION_TIMEOUT','OPERATION_UNKNOWN_TERMINATION','OPERATION_BUSY'].includes(error.code))break;}}if(failed.length)throw Error(`Применено ${applied.length} параметров. Недоступны: ${failed.join(', ')}.`);return {applied:applied.length};}finally{controlBusy=false;remote?.publishState();}},
    exportPresets:()=>exportTask(()=>exportsService.exportPresets()),
    importPresets:async()=>{const file=await choose(['openFile'],'Выберите JSON с пресетами');if(!file)return null;const stat=await fs.stat(file);if(stat.size>1024*1024)throw Error('Файл пресетов слишком большой.');const json=JSON.parse(await fs.readFile(file,'utf8'));if(json.version!==1||!Array.isArray(json.presets)||json.presets.length>200)throw Error('Неизвестный формат пресетов.');const items=json.presets.map(p=>validatePreset({...p,id:crypto.randomUUID()}));store.presets.push(...items);await persist();emit('presets',store.presets);return items.length;},
    settings:async a=>{if(a.language!==undefined&&!languages.includes(a.language))throw Error(t('language.invalid'));if(a.design!==undefined&&!['current','classic','modern'].includes(a.design))throw Error('Неизвестное оформление.');if(a.theme!==undefined&&!['light','dark','system'].includes(a.theme))throw Error('Неизвестная тема.');if(a.accentColor!==undefined&&!/^#[0-9a-f]{6}$/i.test(a.accentColor))throw Error('Укажите цвет в формате #RRGGBB.');if(a.remotePort!==undefined&&(!Number.isInteger(Number(a.remotePort))||Number(a.remotePort)<1024||Number(a.remotePort)>65535))throw Error('Порт должен быть от 1024 до 65535.');if(a.remoteHost!==undefined&&!localInterfaces().some(i=>i.address===a.remoteHost))throw Error('Выберите локальный сетевой интерфейс.');if(a.performanceMode!==undefined&&typeof a.performanceMode!=='boolean')throw Error('Некорректный режим производительности.');if(a.focusPreviewOnSuccess!==undefined&&typeof a.focusPreviewOnSuccess!=='boolean')throw Error('Некорректная настройка превью AF.');if(a.liveHistogramEnabled!==undefined&&typeof a.liveHistogramEnabled!=='boolean')throw Error(t('desktop.invalid_live_histogram_setting'));if(a.focusPreviewOnSuccess===false){focusPreview=null;emit('focusPreview',null);}if(a.language!==undefined){store.settings.language=a.language;setLocale(currentLocale());}if(a.design!==undefined)store.settings.design=a.design;for(const key of ['autofocus','focusPreviewOnSuccess','liveHistogramEnabled','grid','autoSelect','showSplashes','setupSessionSubfolder','performanceMode'])if(typeof a[key]==='boolean')store.settings[key]=a[key];if(a.theme!==undefined)store.settings.theme=a.theme;if(a.accentColor!==undefined)store.settings.accentColor=a.accentColor.toLowerCase();if(a.remotePort!==undefined)store.settings.remotePort=Number(a.remotePort);if(a.remoteHost!==undefined)store.settings.remoteHost=a.remoteHost;if(a.workspace!==undefined)store.settings.workspace=normalizeWorkspace({...store.settings.workspace,...a.workspace,panels:{...store.settings.workspace?.panels,...a.workspace?.panels}});if(a.composition!==undefined)store.settings.composition=normalizeComposition({...store.settings.composition,...a.composition,margins:{...store.settings.composition?.margins,...a.composition?.margins}});if(a.grid!==undefined)store.settings.composition=normalizeComposition({...store.settings.composition,grid:a.grid?'thirds':'off'});store.settings.grid=store.settings.composition.grid!=='off';const activeSession=store.sessions.find(s=>s.id===store.sessionId);if(activeSession){if(a.autofocus!==undefined)activeSession.autofocus=store.settings.autofocus;if(a.grid!==undefined||a.composition!==undefined){activeSession.grid=store.settings.grid;activeSession.composition=store.settings.composition;}}await persist();emit('settings',store.settings);return store.settings;},
    remoteStart:async({host,port}={})=>{const info=await remote.start({host:host||store.settings.remoteHost||localInterfaces()[0].address,port:port??store.settings.remotePort??8765});if(quitting){await remote.stop();throw Error(t('operation.closed'));}const qr=await QRCode.toDataURL(info.url,{width:280,margin:2,errorCorrectionLevel:'M'});if(quitting){await remote.stop();throw Error(t('operation.closed'));}remoteInfo={...info,qr};store.settings.remoteHost=info.host;store.settings.remotePort=info.port;await persist();emit('settings',store.settings);emit('remote',remoteInfo);return remoteInfo;},
    remoteStop:async()=>{await remote.stop();remoteInfo={running:false,clients:0};emit('remote',remoteInfo);return remoteInfo;},
    copyRemoteLink:async()=>{if(!remoteInfo.running)throw Error('Сначала включите веб-пульт.');await clipboard.writeText(remoteInfo.url);return true;},
    openRemote:()=>{if(!remoteInfo.running)throw Error('Сначала включите веб-пульт.');shell.openExternal(remoteInfo.url);return true;},
    session:a=>sessionAction(async()=>{
      const clean=cleanSession(a);const base=a.folder||store.settings.onboarding.workspace?.folder||sessionsRoot();let folder=base;
      if(a.createSubfolder!==false){const date=new Intl.DateTimeFormat('sv-SE').format(new Date());folder=await L.uniquePath(base,`${date} ${clean.name}`);}
      await fs.mkdir(folder,{recursive:true});const entry=newSession(clean,folder);
      if(camera.connected)await call('destination',{folder,route:transferRoute(folder,entry.id)});store.sessions.push(entry);return activateSession(entry,true);
    }),
    sessionOpen:({id})=>sessionAction(async()=>{const entry=store.sessions.find(s=>s.id===id);if(!entry)throw Error('Фотосессия не найдена.');return activateSession(entry);}),
    sessionUpdate:a=>sessionAction(async()=>{const entry=store.sessions.find(s=>s.id===a.id);if(!entry)throw Error('Фотосессия не найдена.');const clean=cleanSession({...entry,...a});const folder=a.folder||entry.captureFolder;await fs.mkdir(folder,{recursive:true});if(entry.id===store.sessionId&&camera.connected)await call('destination',{folder});Object.assign(entry,clean,{captureFolder:folder,updated:new Date().toISOString()});if(entry.id===store.sessionId)return activateSession(entry,true);await persist();emit('state',publicState());return publicState();}),
    sessionDelete:a=>sessionAction(async()=>{
      const entry=store.sessions.find(s=>s.id===a.id);if(!entry)throw Error('Фотосессия не найдена.');
      const active=store.sessionId===entry.id;
      const imageCache=a.deletePhotos===true?sharp.cache():null;
      try{
        if(active&&camera.connected)await call('destination',{folder:'',route:transferRoute('',null)});
        await importQueue.catch(()=>{});
        // Cached libvips operations retain Windows file handles even with files: 0.
        if(imageCache)sharp.cache(false);
        const result=await deleteSession(store,a,{trashItem:file=>shell.trashItem(file),persist,cacheDir,onProgress:progress=>emit('sessionDeletion',progress)});
        metadataCache.clear();
        if(active&&result.deleted){series=null;burst=null;focusPreview=null;}
        emit('state',publicState());return {...result,state:publicState()};
      }finally{
        if(imageCache)sharp.cache({memory:imageCache.memory.max,files:imageCache.files.max,items:imageCache.items.max});
        if(active&&store.sessionId===entry.id&&camera.connected)await call('destination',{folder:entry.captureFolder}).catch(error=>log('error',error.message));
      }
    }),
    chooseSessionFolder:()=>choose(['openDirectory','createDirectory'],'Папка фотосессии'),
    seriesQueue:async({ids})=>{cameraIdle();requireSession();if(!Array.isArray(ids)||ids.length>100||ids.some(id=>typeof id!=='string'||id.length>128))throw Error('Некорректная очередь пресетов.');store.sessions.find(s=>s.id===store.sessionId).presetQueue=[...ids];await persist();emit('state',publicState());return ids;},
    seriesStart:startSeries,
    burstStart:burstFromControl,
    burstStop:async()=>{if(pendingBurstStart)pendingBurstStart.released=true;if(burstActive()){burst.status='transferring';emit('burst',{...burst});}if(worker)await call('burstStop');return burst;},
    seriesStop:()=>{if(seriesActive()){series.cancelled=true;series.status='stopping';emit('series',{...series});}return true;},
    equipment:async()=>{if(camera.connected&&!captureActive&&!seriesActive()&&!burstActive())await call('status');return equipmentCards(camera,store);},
    equipmentPhoto:async({kind})=>{if(!['camera','lens'].includes(kind))throw Error('Неизвестный тип оборудования.');const name=kind==='camera'?camera.model:camera.equipment?.lensName;const media=await productMedia(kind,name,cacheDir);return {...media,image:asset(media.image)};},
    equipmentSource:({kind})=>{const name=kind==='camera'?camera.model:camera.equipment?.lensName;const info=identify(kind,name);if(info.source)shell.openExternal(info.source);return !!info.source;},
    watch:async({enabled})=>{if(sessionTransition)throw Error('Дождитесь окончания операции с фотосессией.');if(enabled)requireSession();if(watcher){const owner=watcher;await owner.close();if(watcher===owner)watcher=null;}if(quitting)throw Error(t('operation.closed'));if(enabled){const dir=store.settings.watchFolder;if(!dir)throw Error('Сначала выберите входящую папку.');const source=path.resolve(dir).toLowerCase(),target=path.resolve(store.settings.captureFolder).toLowerCase();if(source===target||source.startsWith(target+path.sep)||target.startsWith(source+path.sep))throw Error('Входящая папка и папка съёмки должны быть раздельными и не вложенными друг в друга.');watcher=chokidar.watch(dir,{ignoreInitial:true,depth:0,awaitWriteFinish:{stabilityThreshold:1800,pollInterval:300}});watcher.on('add',file=>{if(L.EXTENSIONS.has(path.extname(file).toLowerCase()))queueImport([file],true).catch(e=>log('error',e.message));});watcher.on('error',e=>log('error',e.message));log('info',`Автоимпорт новых файлов: ${dir}`);}emit('watching',!!watcher);return !!watcher;},
    listCard:()=>cameraCommand('listCard'),importCard:({ids})=>{requireSession();cameraIdle();if(!Array.isArray(ids)||ids.length>10000)throw Error('Некорректный список.');return cameraCommand('importCard',{ids,folder:store.settings.captureFolder});},
    intervalStart:({count,seconds})=>{cameraIdle();requireSession();if(interval)throw Error('Интервальная съёмка уже идёт.');if(!camera.connected)throw Error('Сначала подключите камеру.');count=Number(count);seconds=Number(seconds);if(!Number.isInteger(count)||count<1||count>9999||!Number.isFinite(seconds)||seconds<2||seconds>86400)throw Error('Укажите 1–9999 кадров и паузу от 2 до 86400 секунд.');interval={id:crypto.randomUUID(),count,seconds,done:0,requested:0,cancelled:false};const run=interval;emit('interval',run);trackApplication((async()=>{try{for(let i=0;i<count&&!run.cancelled;i++){const receipt=await capture();run.requested++;if(receipt.confirmation==='CONFIRMED')run.done++;else run.confirmation='UNVERIFIED';if(!run.cancelled)emit('interval',{...run});if(i<count-1)await new Promise(resolve=>{const end=Date.now()+seconds*1000;const timer=setInterval(()=>{if(run.cancelled||Date.now()>=end){clearInterval(timer);resolve();}},150);});}if(!run.cancelled)log(run.confirmation==='UNVERIFIED'?'info':'success',run.confirmation==='UNVERIFIED'?t('operation.capture_unverified'):`Интервальная съёмка завершена: ${run.done} кадров.`);}catch(e){log('error',e.message);}finally{if(interval?.id===run.id){interval=null;emit('interval',null);}}})());return interval;},
    intervalStop:()=>{stopInterval('Интервальная съёмка остановлена. Текущий кадр будет сохранён.');return true;},
    window:({action})=>{if(action==='minimize')win.minimize();if(action==='maximize')win.isMaximized()?win.unmaximize():win.maximize();if(action==='close')win.close();return true;}
  };
  commandRoutes=Object.fromEntries(Object.entries(handlers).map(([name,handler])=>[name,args=>{if(quitting&&!['window','boot'].includes(name))throw Error(t('operation.closed'));return ['window','boot'].includes(name)?handler(args):trackApplication(Promise.resolve().then(()=>handler(args)));}]));
  const desktop={
    copyColor:({text})=>copyHexColor(text,value=>clipboard.writeText(value)),
    openShotInspector:()=>shotInspector.open(),
    onboardingSave:({step,topic,completed,skipped})=>saveOnboarding({
      ...(typeof step==='string'?{step}:{}),...(typeof topic==='string'?{topic}:{}),
      ...(typeof completed==='boolean'?{completed}:{}),...(Array.isArray(skipped)?{skipped:skipped.slice(0,7)}:{})
    }),
    sdkEnvironment:({recheck}={})=>withRuntime(async sdkDir=>{
      const result=await call('sdkEnvironment',{sdkDir});
      await saveOnboarding({environment:result});return result;
    },{recheck:recheck===true}),
    cameraDiagnose:async({cameraId}={})=>{
      if(camera.connected&&camera.working!==false)throw Error(t('operation.busy'));
      if(!camera.connected||cameraId&&cameraId!==camera.cameraId){
        const result=await connectCamera({cameraId,readOnly:true});
        if(!result.connected)throw Error(result.error||'Камера не обнаружена.');
      }
      const report=await cameraCommand('diagnoseCamera');
      if(workerState?.issue)throw Object.assign(Error(t('operation.unknown')),{code:'OPERATION_UNKNOWN_TERMINATION'});
      await saveOnboarding({report});return report;
    },
    cameraWorking:async({cameraId,savePreference,controlsOnly=false}={})=>{
      if(typeof controlsOnly!=='boolean')throw Error('Некорректный режим подключения.');
      if(controlsOnly){
        if(camera.connected&&camera.working&&camera.controlsOnly!==true)throw Error('Отключите рабочую камеру перед подключением без передачи файлов.');
        return connectCamera({cameraId,controlsOnly:true});
      }
      if(![2,3].includes(savePreference))throw Error('Выберите режим сохранения.');
      if(camera.live)throw Error('Остановите Live View перед сменой места сохранения.');
      const result=await connectCamera({cameraId,savePreference,reconfigure:true});
      if(!result.connected)throw Error(result.error||'Камера не обнаружена.');
      store.settings.savePreference=savePreference;
      await saveOnboarding({connection:{model:result.model,saveTo:result.saveTo,checkedAt:new Date().toISOString()}});
      return result;
    },
    cameraEndDiagnostics:()=>camera.connected&&camera.working===false?cameraCommand('disconnect'):null,
    setupFolder:async({choose:pick=false}={})=>{
      const folder=pick===true?await choose(['openDirectory','createDirectory'],'Папка для фотосессий'):store.settings.onboarding.workspace?.folder||store.settings.captureFolder||sessionsRoot();
      if(!folder)return null;
      if(pick!==true&&folder===sessionsRoot())await fs.mkdir(folder,{recursive:true});
      const workspace=await inspectFolder(folder);
      await saveOnboarding({workspace});return workspace;
    },
    canonResource:({resource})=>{
      const url={utility:'https://www.usa.canon.com/support?app=download',sdk:'https://www.usa.canon.com/support/sdk'}[resource];
      if(typeof url!=='string')throw Error('Неизвестный ресурс Canon.');
      return shell.openExternal(url);
    }
  };
  for(const [name,handler] of Object.entries({...commandRoutes,...desktop}))ipcMain.handle('focal:'+name,async(event,args)=>{if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame)throw Error('Недопустимый источник.');if(!['boot','window'].includes(name)&&(!libraryBootstrap?.isReady()||!servicesReady||quitting))throw Error('Library is not ready.');try{return await (Object.hasOwn(desktop,name)?trackApplication(Promise.resolve().then(()=>handler(args||{}))):handler(args||{}));}catch(e){log('error',e.message);throw e;}});
  ipcMain.on('focal:frame-ack',event=>{if(event.sender===win.webContents){desktopFrameInFlight=false;flushDesktopFrame();}});
}
function cleanEdits(e={}){const number=(key,min,max)=>Math.min(max,Math.max(min,Number(e[key])||0));return {exposure:number('exposure',-3,3),contrast:number('contrast',-75,100),saturation:number('saturation',-100,100),warmth:number('warmth',-100,100),monochrome:!!e.monochrome,rotation:([0,90,180,270].includes(Number(e.rotation))?Number(e.rotation):0)};}
function writeLifecycleDiagnostic(receipt){
  const payload={version:1,at:new Date().toISOString(),outcome:'UNKNOWN_TERMINATION',receipt,issues:[...lifecycleIssues],channels:[...workerChannels].slice(-8).map(channel=>({generation:channel.generation,exited:channel.exited,exitCode:channel.exitCode??null,operations:channel.rpc.snapshot(),transfers:channel.consumer.snapshot()}))};
  diagnosticTail=diagnosticTail.catch(()=>{}).then(async()=>{
    const filename=path.join(app.getPath('userData'),'lifecycle-recovery.json'),temporary=filename+'.'+crypto.randomUUID()+'.tmp';
    await fs.mkdir(path.dirname(filename),{recursive:true});await fs.writeFile(temporary,JSON.stringify(payload,null,2),{flag:'wx'});await fs.rename(temporary,filename);
  });return diagnosticTail;
}
async function drainApplicationTasks(){while(applicationTasks.size)await Promise.allSettled([...applicationTasks]);}
async function drainTransferConsumers(){
  while(true){
    const revision=consumerRevision;
    await Promise.all([...workerChannels].map(channel=>channel.consumer.drain()));
    await importQueue;
    const reads=await Promise.allSettled([...previewTasks]);if(reads.some(result=>result.status==='rejected'))lifecycleIssue('DERIVED_TASK_FAILED');
    if(libraryBootstrap?.isReady())await commits.runExclusive(async()=>{});
    if(revision===consumerRevision&&!previewTasks.size)break;
  }
  if(importFailures||lifecycleIssues.size||[...workerChannels].some(channel=>channel.consumer.snapshot().issues.length))throw Object.assign(Error(t('operation.transfer_issue')),{code:'LIFECYCLE_ACCOUNTING_UNKNOWN'});
  return {drained:true};
}
const shutdown=createShutdownCoordinator({
  stopAdmission:()=>{quitting=true;stopInterval();if(seriesActive())series.cancelled=true;const remoteOwner=remote,watcherOwner=watcher;watcher=null;const closes=[Promise.resolve().then(()=>remoteOwner?.stop()),Promise.resolve().then(()=>watcherOwner?.close())];return Promise.allSettled(closes).then(results=>{if(results.some(result=>result.status==='rejected'))throw Object.assign(Error('Admission cleanup failed.'),{code:'ADMISSION_CLOSE_FAILED'});return true;});},
  requestCancellation:async()=>{
    const channel=workerState;if(!channel||channel.exited)return;
    if(channel.retirementPromise)return channel.retirementPromise;
    channel.rpc.cancelAll();
    if(channel.rpc.snapshot().terminated){channel.process.postMessage({type:'emergencyRelease',generation:channel.generation});return;}
    await call('burstStop',{}, {timeoutMs:1000});
  },
  fenceProducers:async({deadline})=>{
    await drainApplicationTasks();const channel=workerState;
    if(channel?.retirementPromise){const receipt=await channel.retirementPromise;return receipt.fence;}
    if(channel?.retirementReceipt)return channel.retirementReceipt.fence;
    if(!channel||channel.exited){if(channel&&!channel.finalizing)throw Object.assign(Error('Worker exited without a fence.'),{code:'WORKER_EXIT_UNFENCED'});return {drained:true,lastPhotoSequence:0,proof:'native-not-started',nativeStarted:false};}
    await channel.rpc.whenIdle({exclusiveOnly:false});channel.rpc.closeAdmission();
    const fence=await call('producerFence',{}, {timeoutMs:Math.max(1,deadline-Date.now())});channel.consumer.fence(fence.lastPhotoSequence);
    if(fence.transfers?.failed||fence.transfers?.issues?.length)lifecycleIssue('TRANSFER_PRODUCER_UNKNOWN');
    return fence;
  },
  drainConsumers:async()=>{await drainApplicationTasks();return drainTransferConsumers();},
  persist:async()=>{if(libraryBootstrap?.isReady())await persist();return true;},
  closeWorker:async({deadline})=>{
    const channel=workerState;if(!channel)return {closed:true,proof:'native-not-started',nativeStarted:false};
    if(channel.retirementPromise){const receipt=await channel.retirementPromise;return receipt.worker;}
    if(channel.retirementReceipt&&channel.exited)return channel.retirementReceipt.worker;
    if(channel.exited)throw Object.assign(Error('Worker exited before close acknowledgement.'),{code:'WORKER_EXIT_UNFENCED'});
    channel.finalizing=true;const result=await call('finalizeShutdown',{}, {timeoutMs:Math.max(1,deadline-Date.now())});
    await channel.exitPromise;
    // Teardown can expose a late callback. Account it before final window exit.
    await drainTransferConsumers();if(libraryBootstrap?.isReady())await persist();
    if(result.lastPhotoSequence!==channel.consumer.snapshot().frontier||result.observations?.hasFailures||channel.exitCode!==0)throw Object.assign(Error('Worker close remains unverified.'),{code:'WORKER_CLOSE_UNKNOWN'});
    return result;
  },
  forceWorker:async()=>{const channel=workerState;if(!channel)return {terminated:true};if(channel.retirementPromise){await channel.retirementPromise;return {terminated:channel.exited===true};}if(!channel.exited){lifecycleIssue('WORKER_FORCED_TERMINATION');channel.rpc.terminate();channel.process.kill();await channel.exitPromise;}return {terminated:true};},
  recordDiagnostic:writeLifecycleDiagnostic
});
function freshLibrary(){return {version:2,sessionId:null,sessions:[],photos:[],settings:{captureFolder:'',watchFolder:'',sdkDir:'',autofocus:true,grid:false,autoSelect:true,liveHistogramEnabled:false},presets:[
    {id:'portrait',name:'Мягкий портрет',description:'Открытая диафрагма и спокойный цвет. Режим M, объектив f/1.8.',color:'sage',values:{iso:0x48,shutter:0x75,aperture:0x14,whiteBalance:0,pictureStyle:0x82}},
    {id:'still',name:'Предметная съёмка',description:'Детали и глубина резкости. Режим M, штатив.',color:'sand',values:{iso:0x48,shutter:0x60,aperture:0x38,whiteBalance:1,pictureStyle:0x84}},
    {id:'street',name:'Город в движении',description:'Короткая выдержка для дневных прогулок. Режим M.',color:'blue',values:{iso:0x58,shutter:0x80,aperture:0x30,whiteBalance:0,pictureStyle:0x81}}
  ]};}
function prepareLibrary(candidate,{established}){
  migrateSessions(candidate,sessionsRoot());
  candidate.settings.language=migrateLanguage(candidate.settings.language,established);
  candidate.settings.onboarding=onboardingState(candidate.settings.onboarding,established);
  candidate.settings.composition=normalizeComposition(candidate.settings.composition,candidate.settings.grid);candidate.settings.workspace=normalizeWorkspace(candidate.settings.workspace);
  // Upgrade an existing 0.1 library without changing its photos, paths or ratings.
  if(!['light','dark','system'].includes(candidate.settings.theme))candidate.settings.theme=established?'light':'system';
  candidate.settings.performanceMode=candidate.settings.performanceMode===true;
  candidate.settings.liveHistogramEnabled=candidate.settings.liveHistogramEnabled===true;
  if(!/^#[0-9a-f]{6}$/i.test(candidate.settings.accentColor||''))candidate.settings.accentColor='#7f9c69';
  if(!['current','classic','modern'].includes(candidate.settings.design))candidate.settings.design='current';
  if(typeof candidate.settings.showSplashes!=='boolean')candidate.settings.showSplashes=true;
  if(typeof candidate.settings.focusPreviewOnSuccess!=='boolean')candidate.settings.focusPreviewOnSuccess=true;
  if(!candidate.settings.remotePort)candidate.settings.remotePort=8765;
  return candidate;
}
function ensureReadyServices(){
  if(servicesReady||quitting)return;
  if(!shotInspector)shotInspector=createShotInspector({
    latest:()=>store.photos.findLast(p=>p.cameraTransfer===true),
    findPhoto:id=>store.photos.find(p=>p.id===id&&p.cameraTransfer===true),
    appearance:currentAppearance,
    locale:currentLocale,
    canRead:()=>!sessionTransition&&!quitting,
    trackRead:job=>{previewTasks.add(job);job.then(()=>previewTasks.delete(job),()=>previewTasks.delete(job));return job;}
  });
  if(!remote)remote=createRemoteServer({getState:remoteState,command:async(name,args)=>{if(quitting)throw Error(t('operation.closed'));const result=await commandRoutes[name](args);if(['connect','disconnect','live','property'].includes(name))return remoteState().camera;if(name==='capture')return {captured:result.confirmation==='CONFIRMED',accepted:true,confirmation:result.confirmation,observedTransfers:result.observedTransfers,files:result.files?.map(f=>path.basename(f))};return result;},getPhoto:async id=>{const p=store.photos.find(p=>p.id===id);return p?.thumbPath?fs.readFile(p.thumbPath):null;},log,onClients:info=>{remoteInfo=info.running?{...remoteInfo,...info}:{running:false,clients:0};emit('remote',remoteInfo);}});
  if(!worker)startWorker();
  servicesReady=true;
}
const bootApplication=createBootApplication({
  bootstrap:{boot:()=>libraryBootstrap.boot()},isQuitting:()=>quitting,
  acceptStore:value=>{store=value;setLocale(currentLocale());},
  initializeServices:ensureReadyServices,
  applyAppearance:()=>win.setBackgroundColor(appearanceWindowOptions(currentAppearance()).backgroundColor),
  publicState,locale:currentLocale
});
app.whenReady().then(async()=>{
  storePath=path.join(app.getPath('userData'),'library.json');cacheDir=path.join(app.getPath('userData'),'previews');
  libraryBootstrap=createLibraryBootstrap({readText:()=>readLibraryText(storePath),writeStore:async candidate=>{const status=await writeLibraryStore(storePath,candidate,{allowBackupDegradation:true});if(status?.backupWarning){try{log('error',t('recovery.backup_warning'));}catch{/* A warning cannot undo the acknowledged primary commit. */}}},createFresh:freshLibrary,prepare:prepareLibrary});
  protocol.handle('focal-asset',request=>{const id=new URL(request.url).pathname.slice(1),file=assets.get(id);return file?net.fetch(pathToFileURL(file).toString()):new Response('Not found',{status:404});});
  installHandlers();
  nativeTheme.on('updated',()=>{emit('appearance',currentAppearance());remote?.publishState();shotInspector?.publish();});
  const target=frontendTarget({isPackaged:app.isPackaged,devURL:process.env.FOCAL_DEV_URL,entry:'index.html',distDir:path.join(__dirname,'..','dist')});
  const {backgroundColor,additionalArguments}=appearanceWindowOptions(currentAppearance());
  win=new BrowserWindow({width:1480,height:960,minWidth:1024,minHeight:720,frame:false,backgroundColor,title:'Apertrove',icon:path.join(__dirname,'..','assets','icon.png'),show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),additionalArguments:[...additionalArguments,'--apertrove-locale='+currentLocale()],contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,backgroundThrottling:false}});
  denyPermissions(win.webContents.session);
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
  const publishVisibility=()=>{if(!win.isDestroyed())win.webContents.send('focal:window-visible',win.isVisible()&&!win.isMinimized()&&win.isFocused());};
  for(const event of ['minimize','restore','hide','show','focus','blur'])win.on(event,publishVisibility);
  win.webContents.on('did-finish-load',publishVisibility);
  win.once('ready-to-show',()=>win.show());
  win.on('closed',()=>shotInspector?.close());
  win.on('close',e=>{e.preventDefault();if(quitting)return;void (async()=>{try{const result=await shutdown.close();if(result.outcome!=='CLOSED')log('error',t('operation.shutdown_unknown'));}finally{libraryBootstrap.dispose();try{if(!win.isDestroyed())win.destroy();}finally{app.quit();}}})().catch(()=>app.quit());});
  if(target.url)await win.loadURL(target.url);else await win.loadFile(target.file);
});
app.on('window-all-closed',()=>app.quit());
integration?.onReady({getState:publicState,getWindow:()=>win,getWorker:()=>workerState,shutdown});
