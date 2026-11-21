// The SDK lives in this isolated process. All Canon calls run on its main STA thread.
const fs = require('node:fs');
const path = require('node:path');
const koffi = require('koffi');
const {PROPS,choices,WHITE_BALANCE_COLOR_TEMPERATURE} = require('./camera-values.cjs');
const {parseFocusInfo}=require('./focus-info.cjs');
const {quietPeriod}=require('./capture-timing.cjs');
const {holdShutter}=require('./shutter-latch.cjs');
const {createShutterDiagnostics}=require('./shutter-diagnostics.cjs');
const {createCameraControl} = require('./camera-control.cjs');
const {copyNativeBuffer} = require('./native-buffer.cjs');
const {describeCamera,modelCapabilities,selectCamera} = require('./camera-discovery.cjs');
const {isUnsupportedCommand,configureDestination}=require('./camera-destinations.cjs');
const {sdkCandidates,fileVersion}=require('./sdk-environment.cjs');
const {capabilityReport}=require('./camera-capabilities.cjs');
const {randomUUID,createHash}=require('node:crypto');
const {createOperationHost,operationError}=require('./operation-lifecycle.cjs');
const {createTransferContexts}=require('./transfer-context.cjs');
const {createTransferProducer}=require('./transfer-producer.cjs');
const {createNativeObservations}=require('./native-observations.cjs');
const {createSdkInitializationGate}=require('./sdk-initialization.cjs');
const {createBulbControl}=require('./bulb-control.cjs');
const {createFocusHold}=require('./focus-hold.cjs');
const {profileByFingerprint,createCanonBulbAdapter,bulbExposureSeconds,createFlashPopupControl}=require('./canon-exposure-protocol.cjs');
const {cameraAccessorySupport}=require('./camera-accessory-support.cjs');
const {createLiveOrientation,ORIENTATION}=require('./live-orientation.cjs');
const {createCameraCard,cardProfile}=require('./camera-card.cjs');
const {createCameraDownload}=require('./camera-download.cjs');
const parent = process.parentPort;
const generation=process.argv.find(value=>value.startsWith('--apertrove-generation='))?.slice('--apertrove-generation='.length);
if(typeof generation!=='string'||!/^[A-Za-z0-9._:-]{1,96}$/.test(generation)||!path.isAbsolute(process.env.APERTROVE_RECOVERY_DESTINATION||''))throw Error('Explicit worker generation and recovery destination required.');
const send = value => {const message=value.type==='operation'?value:{...value,generation,sessionEpoch};return parent ? parent.postMessage(message) : process.send?.(message);};
let sdk, library, com, dllDirectory, bindings, camera=null, initialized=false, live=false, callbacks=[], timer, cardRefs=new Map(), captureWait=null, destination='', shuttingDown=false;
let sessionEpoch=0, sessionOpened=false, sessionEventsRegistered=false, restricted=false, evidence={}, environmentChecks=[], evfRestore=null;
let controlAfStopPending=false;
let nativeStarted=false,producersFenced=false,photoSequence=0,teardownUncertain=false,currentOperation=null;
const initializationGate=createSdkInitializationGate();
const quarantinedNativeRefs=new Set();
const observations=createNativeObservations(),transfers=createTransferContexts({recoveryDestination:process.env.APERTROVE_RECOVERY_DESTINATION,newId:randomUUID});
transfers.setRoute({sessionEpoch,sessionId:null,destination:''});
const shutterTrace=createShutterDiagnostics({enabled:process.env.APERTROVE_SHUTTER_TRACE==='1',write:data=>send({event:'shutterDiagnostic',data})});
function observed(method,phase,fn,kind='error-code'){
  try{const code=fn(),entry=observations.observe({operation:phase==='event-pump'?'event-pump':currentOperation?.method||'native',operationId:currentOperation?.operationId,phase,method,code,kind});if(entry.failure&&entry.count===1)send({event:'nativeObservation',data:entry});return code;}
  catch(error){observations.failure({operation:currentOperation?.method||'native',operationId:currentOperation?.operationId,phase,method,error});send({event:'nativeObservation',data:{method,phase,classification:'UNKNOWN'}});throw error;}
}
function releaseRef(ref,phase='release'){
  if(!ref||!sdk)return true;
  if(teardownUncertain){if(quarantinedNativeRefs.size<10000)quarantinedNativeRefs.add(ref);return false;}
  try{
    const count=observed('EdsRelease',phase,()=>sdk.release(ref),'reference-count');
    if(!Number.isInteger(count)||count<0||count>0xffffffff||count===0xffffffff){
      teardownUncertain=true;
      if(quarantinedNativeRefs.size<10000)quarantinedNativeRefs.add(ref);
      return false;
    }
    return true;
  }catch{
    teardownUncertain=true;
    if(quarantinedNativeRefs.size<10000)quarantinedNativeRefs.add(ref);
    return false;
  }
}
function openCameraSession(){
  let result;
  try{result=sdk.open(camera);}
  catch(error){
    // A binding exception does not tell us whether the native call took effect.
    observations.failure({operation:currentOperation?.method||'connect',operationId:currentOperation?.operationId,phase:'session-open',method:'EdsOpenSession',error});
    send({event:'nativeObservation',data:{method:'EdsOpenSession',phase:'session-open',classification:'UNKNOWN'}});
    teardownUncertain=true;
    throw operationError('OPERATION_UNKNOWN_TERMINATION','OpenSession completion is unknown; the worker cannot safely continue.');
  }
  if(!Number.isInteger(result)||result<0||result>0xffffffff){
    const error=Object.assign(Error('OpenSession returned an invalid EdsError value.'),{code:'JS_EXCEPTION'});
    observations.failure({operation:currentOperation?.method||'connect',operationId:currentOperation?.operationId,phase:'session-open',method:'EdsOpenSession',error});
    send({event:'nativeObservation',data:{method:'EdsOpenSession',phase:'session-open',classification:'UNKNOWN'}});
    teardownUncertain=true;
    throw operationError('OPERATION_UNKNOWN_TERMINATION','OpenSession returned an invalid native result; the worker cannot safely continue.');
  }
  if(result)check(result,'Открытие камеры');
  sessionOpened=true;
}
const transferReferences=Object.freeze({
  retain:ref=>{
    if(!sdk)return 0xffffffff;
    try{return observed('EdsRetain','reference',()=>sdk.retain(ref),'reference-count');}
    catch(error){teardownUncertain=true;if(quarantinedNativeRefs.size<10000)quarantinedNativeRefs.add(ref);throw error;}
  },
  release:ref=>releaseRef(ref,'transfer-release')?0:0xffffffff
});
const transferProducer=createTransferProducer({contexts:transfers,getEpoch:()=>sessionEpoch,getSdk:()=>sdk?transferReferences:null,isConnected:()=>!!camera,download:(...args)=>download(...args),onIssue:issue=>{
  if(issue.code==='TRANSFER_REFERENCE_RETAIN_FAILED'||issue.code==='TRANSFER_REFERENCE_RELEASE_FAILED'){
    teardownUncertain=true;
  }
  send({event:'transferIssue',data:issue});
}});
function setDeliveryRoute({route,folder}={}){return transfers.setRoute({sessionEpoch,sessionId:route?.sessionId??null,destination:route?.destination??folder??destination});}
let focusSample={sequence:0,status:"unknown"},focusSampleAt=0;
let evfStream=null,evfImage=null,statsAt=performance.now(),statsFrames=0,statsBytes=0,totalFrames=0,propertyRefreshPending=false;
const state={connected:false,live:false,model:null,battery:null,properties:{},sdkPath:null,error:null};
function orientationCall(method,phase,fn){
  let code;
  try{code=fn();}catch(error){return observed(method,phase,()=>{throw error;});}
  // Optional angle telemetry can be absent/busy while normal camera work stays
  // usable. A returned unsupported/property-unavailable code is a capability
  // result; exceptions, invalid results and other failures retain UNKNOWN policy.
  if(Number.isInteger(code)&&code>=0&&code<=0xffffffff&&(isUnsupportedCommand(code)||[0x50,0x60,0x81,0xa102].includes(code&0xffff)))return code;
  return observed(method,phase,()=>code);
}
const liveOrientation=createLiveOrientation({
  enable:()=>{
    const data=Buffer.alloc(4);data.writeUInt32LE(ORIENTATION.property);
    return orientationCall('EdsSetPropertyData','orientation-enable',()=>sdk.set(camera,ORIENTATION.enableProperty,ORIENTATION.enableParam,data.length,data));
  },
  start:()=>orientationCall('EdsSendCommand','orientation-start',()=>sdk.command(camera,ORIENTATION.command,0)),
  stop:()=>live?orientationCall('EdsSendCommand','orientation-stop',()=>sdk.command(camera,ORIENTATION.command,1)):0x50,
  read:ref=>{
    const buffer=Buffer.alloc(ORIENTATION.bytes);
    const code=orientationCall('EdsGetPropertyData','orientation-frame',()=>sdk.get(ref,ORIENTATION.property,0,buffer.length,buffer));
    return {code,buffer};
  },
  onState:value=>{state.liveOrientation=value;if(state.capabilities)state.capabilities.liveOrientation=value.available;status();}
});
state.liveOrientation=liveOrientation.snapshot();
let bulb=createBulbControl({onState:value=>{state.bulb=value;status();}}),flashControl=createFlashPopupControl(),accessorySupport={bulb:false,flashPopup:false},bulbCaptureOperation=null,accessoryEpoch=null;
state.bulb=bulb.snapshot();state.flash=flashControl.snapshot();
state.servo={enabled:false,status:'off',confirmation:'command-accepted',trackingConfirmed:false};
const log = (level,message) => send({event:'log',data:{level,message,time:new Date().toISOString()}});
const status = () => {
  state.live=live;
  const properties=state.working?state.properties:Object.fromEntries(Object.entries(state.properties).map(([key,value])=>[key,{...value,writable:false}]));
  const snapshot={...state,properties};send({event:'status',data:snapshot});return snapshot;
};
const errors={0x81:'Камера занята. Дождитесь завершения записи или закройте EOS Utility.',0x80:'Устройство не найдено.',0xc0:'Соединение занято другой программой. Закройте EOS Utility 3 и повторите подключение.',0xc1:'Соединение с камерой прервано. Проверьте USB и питание.',0x8d:'Камера не готова к спуску затвора.',0x8d01:'Не удалось сфокусироваться. Проверьте объектив или отключите AF перед съёмкой.',0x8d06:'В камере нет карты памяти. Вставьте карту для сохранения камера + компьютер.',0x20:'Не поддерживается камерой или текущим режимом.',0x50:'Параметр недоступен. Переведите диск камеры в M, Av, Tv или P.',0x2:'Ошибка внутренней библиотеки Canon.'};
function check(code,action) { if(code){const messages={...errors,0x7:'Команда не поддерживается этой камерой или версией SDK.',0x20:'Ошибка чтения или записи файла.',0x60:'Камера отклонила значение параметра.'};const error=Error(`${action}: ${messages[code&0xffff]||'ошибка Canon'} (0x${code.toString(16).toUpperCase()}).`);error.code=code;throw error;} }
function releaseSdk() {
  clearTimeout(timer);
  if(teardownUncertain)return false;
  if(initialized){try{if(observed('EdsTerminateSDK','sdk-terminate',()=>sdk.terminate())!==0){teardownUncertain=true;return false;}initialized=false;}catch{teardownUncertain=true;return false;}}
  const retained=[];for(const callback of callbacks)try{observed('koffi.unregister','callback-unregister',()=>koffi.unregister(callback),'void');}catch{retained.push(callback);}
  if(retained.length){callbacks=retained;teardownUncertain=true;return false;}
  callbacks=[];
  sdk=null;
  if(library)try{observed('library.unload','library-unload',()=>library.unload(),'void');}catch{teardownUncertain=true;return false;}
  library=null;
  if(dllDirectory)try{observed('SetDllDirectoryW','cleanup',()=>dllDirectory(null),'boolean');}catch{}
  state.sdkPath=null;
  return true;
}
function load(custom) {
  if(teardownUncertain)throw operationError('OPERATION_UNKNOWN_TERMINATION','Native cleanup could not be acknowledged.');
  if(initialized) return;
  if(!initializationGate.attempted){
    environmentChecks=sdkCandidates(custom);
    for(const entry of environmentChecks){
      if(entry.architecture!==process.arch){entry.result='architecture';continue;}
      try{loadCandidate(entry.file);entry.result='ready';return;}
      catch(error){
        entry.result='error';entry.error=error.message;
        if(!releaseSdk())throw operationError('OPERATION_UNKNOWN_TERMINATION','Native cleanup could not be acknowledged.');
        if(initializationGate.attempted)break;
      }
    }
  }
  throw Error(environmentChecks.some(entry=>entry.result==='error')?'Не удалось загрузить SDK Canon. Проверьте зависимости DLL и папку установки.':'Совместимая EDSDK.dll не найдена. Установите ПО Canon или укажите папку официального SDK.');
}
function loadCandidate(file) {
  nativeStarted=true;
  const kernel=koffi.load('kernel32.dll');
  if(!dllDirectory){
    const setDirectory=kernel.func('int32 __stdcall SetDllDirectoryW(str16 path)');
    dllDirectory=directory=>setDirectory(directory)!==0;
  }
  if(!dllDirectory(path.dirname(file)))throw Error('Windows не приняла каталог зависимостей SDK.');
  if(!com){
    const ole=koffi.load('ole32.dll');
    const hr=ole.func('int32 __stdcall CoInitializeEx(void *reserved, uint32 flags)')(null,2);
    if(hr<0)throw Error('Не удалось инициализировать COM для SDK Canon.');
    com=ole.func('void __stdcall CoUninitialize()');
  }
  const lib=library=koffi.load(file);
  if(!bindings){
  const DeviceInfo=koffi.struct('FocalDeviceInfo',{port:koffi.array('char',256),description:koffi.array('char',256),subType:'uint32',reserved:'uint32'});
  const PropDesc=koffi.struct('FocalPropDesc',{form:'int32',access:'int32',count:'int32',values:koffi.array('int32',128)});
  const DirInfo=koffi.struct('FocalDirInfo',{size:'uint64',folder:'int32',group:'uint32',option:'uint32',name:koffi.array('char',256),format:'uint32',dateTime:'uint32'});
  const Capacity=koffi.struct('FocalCapacity',{clusters:'int32',sector:'int32',reset:'int32'});
  const ObjectEvent=koffi.proto('uint32 __stdcall FocalObjectEvent(uint32 event, void *object, void *context)');
  const PropertyEvent=koffi.proto('uint32 __stdcall FocalPropertyEvent(uint32 event, uint32 property, uint32 param, void *context)');
  const StateEvent=koffi.proto('uint32 __stdcall FocalStateEvent(uint32 event, uint32 param, void *context)');
  const VolumeInfo=koffi.struct('FocalVolumeInfo',{type:'uint32',access:'uint32',capacity:'uint64',free:'uint64',label:koffi.array('char',256)});
  bindings={DeviceInfo,PropDesc,DirInfo,Capacity,ObjectEvent,PropertyEvent,StateEvent,VolumeInfo};
  }
  const {DeviceInfo,PropDesc,DirInfo,Capacity,ObjectEvent,PropertyEvent,StateEvent,VolumeInfo}=bindings;
  const fn=(name,ret,args)=>lib.func('__stdcall',name,ret,args);
  sdk={
    init:fn('EdsInitializeSDK','uint32',[]),terminate:fn('EdsTerminateSDK','uint32',[]),
    list:fn('EdsGetCameraList','uint32',[koffi.out('void **')]),count:fn('EdsGetChildCount','uint32',['void *',koffi.out('uint32 *')]),child:fn('EdsGetChildAtIndex','uint32',['void *','int32',koffi.out('void **')]),
    info:fn('EdsGetDeviceInfo','uint32',['void *',koffi.out(koffi.pointer(DeviceInfo))]),open:fn('EdsOpenSession','uint32',['void *']),close:fn('EdsCloseSession','uint32',['void *']),
    retain:fn('EdsRetain','uint32',['void *']),release:fn('EdsRelease','uint32',['void *']),
    propertySize:fn('EdsGetPropertySize','uint32',['void *','uint32','int32',koffi.out('uint32 *'),koffi.out('uint32 *')]),
    get:fn('EdsGetPropertyData','uint32',['void *','uint32','int32','uint32','void *']),set:fn('EdsSetPropertyData','uint32',['void *','uint32','int32','uint32','void *']),desc:fn('EdsGetPropertyDesc','uint32',['void *','uint32',koffi.out(koffi.pointer(PropDesc))]),
    command:fn('EdsSendCommand','uint32',['void *','uint32','int32']),statusCommand:fn('EdsSendStatusCommand','uint32',['void *','uint32','int32']),capacity:fn('EdsSetCapacity','uint32',['void *',Capacity]),event:fn('EdsGetEvent','uint32',[]),
    objectHandler:fn('EdsSetObjectEventHandler','uint32',['void *','uint32',koffi.pointer(ObjectEvent),'void *']),propertyHandler:fn('EdsSetPropertyEventHandler','uint32',['void *','uint32',koffi.pointer(PropertyEvent),'void *']),stateHandler:fn('EdsSetCameraStateEventHandler','uint32',['void *','uint32',koffi.pointer(StateEvent),'void *']),
    dir:fn('EdsGetDirectoryItemInfo','uint32',['void *',koffi.out(koffi.pointer(DirInfo))]),
    stream:fn('EdsCreateMemoryStream','uint32',['uint64',koffi.out('void **')]),download:fn('EdsDownload','uint32',['void *','uint64','void *']),complete:fn('EdsDownloadComplete','uint32',['void *']),cancel:fn('EdsDownloadCancel','uint32',['void *']),
    pointer:fn('EdsGetPointer','uint32',['void *',koffi.out('void **')]),length:fn('EdsGetLength','uint32',['void *',koffi.out('uint64 *')]),
    seek:fn('EdsSeek','uint32',['void *','int64','uint32']),position:fn('EdsGetPosition','uint32',['void *',koffi.out('uint64 *')]),
    evfRef:fn('EdsCreateEvfImageRef','uint32',['void *',koffi.out('void **')]),evf:fn('EdsDownloadEvfImage','uint32',['void *','void *'])
  };
  try{sdk.volume=fn('EdsGetVolumeInfo','uint32',['void *',koffi.out(koffi.pointer(VolumeInfo))]);sdk.volumeRaw=fn('EdsGetVolumeInfo','uint32',['void *','void *']);}catch{}
  try{sdk.thumbnail=fn('EdsDownloadThumbnail','uint32',['void *','void *']);}catch{}
  const exported=name=>{try{fn(name,'uint32',[]);return true;}catch{return false;}};
  sdk.exports={volume:!!sdk.volume,propertyDescEx:exported('EdsGetPropertyDescEx'),framePoint:exported('EdsSetFramePoint')};
  // Canon allows one initialization cycle per process, including a failed attempt.
  initializationGate.run(()=>check(sdk.init(),'Инициализация EDSDK')); initialized=true;state.sdkPath=file;
  const objCb=koffi.register((event,obj)=>{
    if(!sdk){send({event:'transferIssue',data:{code:'CALLBACK_AFTER_SDK_CLOSE'}});return 0;}
    if(obj) {
      if(event===0x208) {
        if(!state.working){if(producersFenced||shuttingDown||teardownUncertain)send({event:'transferIssue',data:{code:'TRANSFER_NOT_DOWNLOADABLE'}});observed('EdsDownloadCancel','download',()=>sdk.cancel(obj));}
        else {
          try{transferProducer.admit(obj);}catch{send({event:'transferIssue',data:{code:'TRANSFER_ADMISSION_FAILED'}});}
        }
      }
      releaseRef(obj,'callback-release');
    }
    return 0;
  },koffi.pointer(ObjectEvent));callbacks.push(objCb);
  const propCb=koffi.register(()=>{if(!propertyRefreshPending){propertyRefreshPending=true;setTimeout(()=>{propertyRefreshPending=false;if(camera)refresh();},100);}return 0;},koffi.pointer(PropertyEvent));callbacks.push(propCb);
  function pump(){
    if(shuttingDown||teardownUncertain)return;let delay=20;
    try{observed('EdsGetEvent','event-pump',()=>sdk.event());liveOrientation.expire();if(camera&&live&&!captureWait&&!bulb.isBusy()&&controls.canStream())delay=frame()?0:3;}catch{/* The bounded observation and parent notification retain this failure. */}
    timer=setTimeout(pump,delay);
  }
  timer=setTimeout(pump,0);
}
function get(id) {const buf=Buffer.alloc(4);if(sdk.get(camera,id,0,4,buf)) return null;return buf.readUInt32LE();}
function set(id,value) {if(state.controlsOnly&&![PROPS.iso,PROPS.shutter,PROPS.aperture,PROPS.compensation,0x500,0x501].includes(id))throw Error('Это свойство недоступно в подключении без передачи файлов.');const buf=Buffer.alloc(4);buf.writeUInt32LE(value>>>0);check(sdk.set(camera,id,0,4,buf),'Изменение параметра');}
function probeData(id,ref=camera){
  if(!camera)return {code:0x80};const type=[0],size=[0];
  const sizeCode=sdk.propertySize(ref,id,0,type,size);
  if(sizeCode||!size[0]||size[0]>262144)return {code:sizeCode||0x65};
  const buffer=Buffer.alloc(size[0]),code=sdk.get(ref,id,0,buffer.length,buffer);
  return {code,type:type[0],buffer:code?null:buffer};
}
function readData(id){const result=probeData(id);return result.code?null:result;}
function textProperty(id){const data=readData(id);return data?.type===2?data.buffer.toString('utf8').replace(/\0.*$/s,'').trim():null;}
function refresh() {
  if(!camera) return status();
  state.battery=get(0x8);const focal=readData(0x409);state.equipment={firmware:textProperty(0x7),lensName:textProperty(0x40d),lensAttached:get(0x416)===1,availableShots:get(0x40a),focalLength:focal?.buffer.length===8&&focal.buffer.readUInt32LE(4)?focal.buffer.readUInt32LE(0)/focal.buffer.readUInt32LE(4):null};
  const mode=get(0x400);state.mode=({0:'P',1:'Tv',2:'Av',3:'M',4:'Bulb',9:'Auto'})[mode]||String(mode??'—');
  if(state.controlsOnly){state.evfState={output:get(0x500),mode:get(0x501)};state.observedSaveTo=get(0xb);}
  if(state.working&&!restricted&&get(0x500)!==null){state.capabilities.liveView=true;state.capabilities.manualFocus=true;}
  for(const [key,id] of Object.entries(PROPS)) {
    if(key==='colorTemperature'&&state.properties.whiteBalance?.value!==WHITE_BALANCE_COLOR_TEMPERATURE){state.properties[key]={value:null,choices:[],writable:false};continue;}
    const current=get(id);if(current===null) {state.properties[key]={value:null,choices:[],writable:false};continue;}
    const desc={};const code=sdk.desc(camera,id,desc);
    const allowed=code?[]:Array.from(desc.values||[]).slice(0,Math.max(0,Math.min(desc.count||0,128))).map(v=>v>>>0);
    state.properties[key]={value:current,allowed,choices:choices(key,allowed,current),descriptorCode:code,writable:!code&&allowed.length>0&&(!state.controlsOnly||['iso','shutter','aperture','compensation'].includes(key))&&!(key==='afMode'&&current===3&&!allowed.includes(3))};
  }
  const af=state.properties.afMode;
  state.capabilities={...state.capabilities,servo:!!state.working&&!restricted&&[0,1,2].includes(af?.value)&&(af.value===1||af.writable&&af.allowed.includes(1)),bulb:accessoryCapabilities().bulb,flashPopup:accessoryCapabilities().flashPopup,liveOrientation:state.liveOrientation.available};
  if(controls.isServoHeld()&&state.servo.enabled===true&&af?.value!==1)controls.stopServo();
  return status();
}
function accessoryCapabilities(){return {bulb:!!accessorySupport.bulb&&!restricted&&!!state.working&&!state.controlsOnly&&sessionEventsRegistered&&state.capabilities?.capture===true&&!!state.saveTo,flashPopup:!!accessorySupport.flashPopup&&!restricted&&!!state.working&&!state.controlsOnly&&sessionEventsRegistered&&flashControl.snapshot().available};}
function accessoryCall(method,phase,fn){
  let code;try{code=fn();}catch(error){return observed(method,phase,()=>{throw error;});}
  // Known returned command rejection keeps its feature retryable. Native binding
  // exceptions/malformed outcomes retain UNKNOWN ownership and quarantine policy.
  if(Number.isInteger(code)&&code>=0&&code<=0xffffffff&&(isUnsupportedCommand(code)||[0x50,0x60,0x81,0x8d,0x8d01,0x8d06].includes(code&0xffff)))return code;
  return observed(method,phase,()=>code);
}
async function prepareAccessories(modelId){
  if(accessoryEpoch===sessionEpoch&&(bulb.isBusy()||flashControl.isBusy()))throw operationError('OPERATION_BUSY','Дождитесь завершения текущей команды камеры.');
  const epoch=sessionEpoch,reference=camera,file=state.sdkPath;
  let profile=null;
  if(file)try{const sha256=createHash('sha256').update(fs.readFileSync(file)).digest('hex'),version=await fileVersion(file);profile=profileByFingerprint({sha256,version,architecture:process.arch});state.sdkFingerprint={sha256,version,architecture:process.arch,qualifiedProfile:profile?.id||null};}catch{state.sdkFingerprint=null;}
  if(epoch!==sessionEpoch||camera!==reference)throw operationError('OPERATION_STALE_SESSION','Accessory preparation belongs to an old camera session.');
  accessoryEpoch=epoch;const support=cameraAccessorySupport(modelId),sessionCurrent=()=>{ensureWorking();if(epoch!==sessionEpoch||camera!==reference)throw operationError('OPERATION_STALE_SESSION','Accessory command belongs to an old camera session.');};
  const sendCommand=(id,parameter)=>{sessionCurrent();return accessoryCall('EdsSendCommand','accessory-command',()=>sdk.command(camera,id,parameter));};
  const sendStatus=(id,parameter)=>{sessionCurrent();return accessoryCall('EdsSendStatusCommand','accessory-status',()=>sdk.statusCommand(camera,id,parameter));};
  accessorySupport={bulb:!restricted&&!!profile&&!!support.bulbRoute,flashPopup:!restricted&&!!profile&&support.flashPopup===true};
  const onBulb=value=>{if(epoch===sessionEpoch&&camera===reference){state.bulb=value;status();}};
  bulb=createBulbControl(createCanonBulbAdapter({profile,route:support.bulbRoute,cameraQualified:accessorySupport.bulb,io:{sendCommand,sendStatus,onState:onBulb,ensure:()=>{sessionCurrent();if(captureWait||controls.isBusy()||controls.isServoHeld()||flashControl.isBusy()||state.controlsOnly||!sessionEventsRegistered)throw operationError('OPERATION_BUSY','Дождитесь завершения текущей команды камеры.');const mode=get(0x400),tv=get(PROPS.shutter);if(!(mode===4||mode===3&&tv===0x0c))throw Error('Для запуска установите режим BULB на камере.');}}}));
  flashControl=createFlashPopupControl({profile,cameraQualified:accessorySupport.flashPopup,io:{sendCommand,ensure:()=>{sessionCurrent();if(captureWait||bulb.isBusy()||controls.isBusy()||controls.isServoHeld()||state.controlsOnly||!sessionEventsRegistered)throw operationError('OPERATION_BUSY','Дождитесь завершения текущей команды камеры.');}},onState:value=>{if(epoch===sessionEpoch&&camera===reference){state.flash=value;if(state.capabilities)state.capabilities.flashPopup=accessoryCapabilities().flashPopup;status();}}});
  state.bulb=bulb.snapshot();state.flash=flashControl.snapshot();
}
async function startBulb(args={},operation){
  ensureWorking();
  if(!state.saveTo||state.capabilities?.capture!==true)throw Error('Камера не подтвердила сохранение на ПК. Повторите подключение.');
  if(!accessoryCapabilities().bulb)throw operationError('BULB_PROTOCOL_UNQUALIFIED','BULB недоступен: протокол этой камеры и версии SDK не квалифицирован.');
  if(bulb.isBusy()||captureWait||controls.isBusy()||controls.isServoHeld())throw operationError('OPERATION_BUSY','Дождитесь завершения текущей команды камеры.');
  const mode=get(0x400);if(!(mode===4||mode===3&&get(PROPS.shutter)===0x0c))throw Error('Для запуска установите режим BULB на камере.');
  setDeliveryRoute(args);transfers.noteCapture({operationId:operation.operationId,captureId:args.captureId,sessionEpoch});bulbCaptureOperation=operation.operationId;
  try{return await bulb.start({autofocus:args.autofocus!==false});}catch(error){if(!bulb.isBusy()){transfers.settleCapture(bulbCaptureOperation,{outcome:'FAILED'});bulbCaptureOperation=null;}throw error;}
}
async function stopBulb(){
  const result=await bulb.stop();
  if(!bulb.isBusy()&&bulbCaptureOperation){transfers.settleCapture(bulbCaptureOperation,{outcome:'END_COMMAND_ACCEPTED'});bulbCaptureOperation=null;}
  return result;
}
async function closeCamera({lost=false}={}){
  if(lost)focusRestore=null;
  await focusHold.stop();
  if(lost){bulb.disconnected();flashControl.disconnected();failCapture(Error('Камера отключилась.'));return disconnect();}
  // Never close a native session before its owed exposure end and UI unlock.
  await stopBulb();if(bulb.isBusy())throw operationError('OPERATION_UNKNOWN_TERMINATION','Завершение BULB не подтверждено. Подключение сохранено для повторной остановки.');
  flashControl.disconnected();return disconnect();
}
function listCameras({sdkDir}={}){
  load(sdkDir);let list=null;
  try{const out=[null];check(sdk.list(out),'Поиск камер');list=out[0];const count=[0];check(sdk.count(list,count),'Поиск камер');const items=[];
    for(let index=0;index<count[0];index++){const ref=[null];check(sdk.child(list,index,ref),'Чтение камеры');try{const info={};check(sdk.info(ref[0],info),'Информация камеры');items.push(describeCamera(info,index));}finally{releaseRef(ref[0],'camera-discovery-release');}}
    return items;
  }finally{if(list)releaseRef(list,'camera-list-release');}
}
async function sdkEnvironment({sdkDir,recheck=false}={}){
  if(recheck)throw operationError('OPERATION_ADMISSION_CLOSED','Runtime recheck requires main-process worker replacement.');
  let error=null;
  try{load(sdkDir);}catch(e){if(teardownUncertain||e.code==='OPERATION_UNKNOWN_TERMINATION')throw e;error=e.message;}
  const file=state.sdkPath;
  const version=file?await fileVersion(file):null;
  return {status:file?'ready':environmentChecks.some(entry=>entry.result==='error')?'error':'missing',architecture:process.arch,file,version,checks:environmentChecks,optional:sdk?.exports||{},error};
}
function cameraStorage(){
  // VolumeInfo's native layout is still unverified in NATIVE_ABI_MATRIX.md.
  // H1 must not call the optional FFI binding with a guessed struct layout.
  return {volumes:[],code:0,unverifiedLayout:'EdsGetVolumeInfo'};
}
function readFlashPopupConditions(){
  // Canon's popup menu checks these values before enabling the mechanical
  // command. Reading them never changes flash mode or dispatches a popup.
  const empty={source:'canon-ui-conditions',allowed:null,aEMode:null,movieSwStatus:null,hiIsoNoiseReduction:null};
  if(!camera||!state.connected)return {...empty,status:'unavailable',reasons:['CAMERA_DISCONNECTED']};
  if(cameraAccessorySupport(state.modelId).flashPopup!==true)return {...empty,status:'unavailable',reasons:['MODEL_POPUP_UNQUALIFIED']};
  const read=id=>{try{const value=get(id);return Number.isInteger(value)&&value>=0&&value<=0xffffffff?value:null;}catch{return null;}};
  const aEMode=read(0x400),movieSwStatus=read(0x01000422),hiIsoNoiseReduction=read(0x0100043d);
  const values={aEMode,movieSwStatus,hiIsoNoiseReduction};
  if(Object.values(values).some(value=>value===null))return {...empty,...values,status:'unknown',reasons:['CAMERA_CONDITION_UNAVAILABLE']};
  const imageMode=[9,10,11,12,13,14,15,19,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,65,66,67].includes(aEMode);
  const reasons=[];
  if(imageMode)reasons.push('SCENE_MODE');
  if(aEMode===20||movieSwStatus!==0)reasons.push('MOVIE_MODE');
  if(hiIsoNoiseReduction===4)reasons.push('MULTI_SHOT_NOISE_REDUCTION');
  return {...empty,...values,status:'ready',allowed:reasons.length===0,reasons};
}
async function diagnoseCamera(){
  ensure();
  if(captureWait||controls.isBusy())throw Error('Дождитесь окончания команды камеры.');
  refresh();
  const storage=cameraStorage();
  const read=id=>{
    if(evfImage&&live&&[0x104,0x507,0x508].includes(id)){
      const result=probeData(id,evfImage);
      if(!result.code)return result;
    }
    return probeData(id);
  };
  const rows=capabilityReport({state,read,storage,exports:sdk.exports,restricted,evidence});
  const file=state.sdkPath, epoch=sessionEpoch;
  const sdkVersion=await fileVersion(file);
  if(!camera||epoch!==sessionEpoch)throw Error('Камера отключилась во время диагностики.');
  return {checkedAt:new Date().toISOString(),model:state.model,description:state.description,firmware:state.equipment.firmware,battery:state.battery,
    lens:state.equipment.lensName,mode:state.mode,availableShots:state.equipment.availableShots,sdkVersion,sdkPath:file,working:state.working,
    saveTo:state.saveTo,storage:storage.volumes,optional:sdk.exports,flashConditions:readFlashPopupConditions(),rows};
}
function handleCameraState(event,parameter,epoch){
  if(epoch!==sessionEpoch||!sessionEventsRegistered)return 0;
  const seconds=bulbExposureSeconds(event,parameter);
  // The SDK event has no exposure identity. Never accept a queued value during
  // lock/start; camera time becomes visible only after this start was accepted.
  if(seconds!==null&&state.working&&state.bulb?.status==='exposing')bulb.event(seconds);
  if(event===0x301)setImmediate(()=>{if(epoch!==sessionEpoch)return;void closeCamera({lost:true}).catch(error=>log('error',error.message));log('error','Камера отключена. Проверьте USB и питание.');});
  if(event===0x303&&camera&&state.working)sdk.command(camera,1,0);
  return 0;
}
function registerStateCallback(epoch){
  // Retain every per-session callback until SDK termination. No late native
  // callback can dereference a freed closure, or publish into a newer session.
  if(callbacks.length>=128)throw operationError('OPERATION_ADMISSION_CLOSED','Native callback lifetime budget reached. Restart Apertrove.');
  const callback=koffi.register((event,parameter)=>handleCameraState(event,parameter,epoch),koffi.pointer(bindings.StateEvent));
  callbacks.push(callback);return callback;
}
function registerWorkingEvents(){
  if(sessionEventsRegistered)return;
  if(callbacks.length>=128)throw operationError('OPERATION_ADMISSION_CLOSED','Native callback lifetime budget reached. Restart Apertrove.');
  // Mark before the first registration so partial failure still unregisters on close.
  sessionEventsRegistered=true;
  check(sdk.objectHandler(camera,0x200,callbacks[0],null),'События снимков');
  check(sdk.propertyHandler(camera,0x100,callbacks[1],null),'События параметров');
  check(sdk.stateHandler(camera,0x300,registerStateCallback(sessionEpoch),null),'События камеры');
  state.eventsRegistered=true;
}
function prepareWorkingSession(preferred){
  state.controlsOnly=false;state.evfState=null;state.observedSaveTo=null;
  registerWorkingEvents();
  const existing=get(0xb);
  state.saveTo=null;
  if(!restricted){
    try{
      const accepted=configureDestination(set,preferred);
      if(accepted&&get(0xb)===accepted){
        const code=sdk.capacity(camera,{clusters:0x7fffffff,sector:512,reset:1});
        if(code&&!isUnsupportedCommand(code))check(code,'Память компьютера');
        state.saveTo=accepted;
      }
    }catch(error){log('info',error.message);}
    if(!state.saveTo&&existing!==null&&get(0xb)!==existing)try{set(0xb,existing);}catch(error){log('error',error.message);}
    if(!state.saveTo)log('info','Камера подключена. Назначение для передачи на ПК не подтверждено.');
  }
  state.working=true;
  state.capabilities={...modelCapabilities(state.model,get(0x500)!==null),capture:!restricted&&!!state.saveTo,
    reason:restricted?'Для этой модели доступен импорт.':!state.saveTo?'Камера не подтвердила сохранение на ПК. Повторите подключение.':null};
  return refresh();
}
function prepareControlSession(){
  if(sessionEventsRegistered||state.working&&!state.controlsOnly)throw Error('Отключите рабочую камеру перед подключением без передачи файлов.');
  const output=get(0x500),mode=get(0x501);
  state.working=true;state.controlsOnly=true;state.saveTo=null;state.eventsRegistered=false;
  state.evfState={output,mode};
  state.capabilities={...modelCapabilities(state.model,output!==null&&mode!==null),capture:false,import:false};
  return refresh();
}
async function connect({sdkDir,folder,cameraId,readOnly=false,controlsOnly=false,savePreference,reconfigure=false,route}) {
  if(typeof controlsOnly!=='boolean'||readOnly&&controlsOnly)throw Error('Некорректный режим подключения.');
  if(camera&&(!cameraId||cameraId===state.cameraId)){
    if(!readOnly&&state.working&&!!state.controlsOnly!==controlsOnly)throw Error('Отключите камеру перед сменой режима подключения.');
    destination=folder;setDeliveryRoute({route,folder});
    if(!readOnly&&!controlsOnly&&!state.working)await prepareAccessories(state.modelId);
    if(controlsOnly)return prepareControlSession();
    return !readOnly&&(!state.working||reconfigure||!state.saveTo&&!restricted) ? prepareWorkingSession(savePreference) : refresh();
  }
  if(camera){if(captureWait||controls.isBusy())throw Error('Дождитесь завершения текущей команды камеры.');await transferProducer.drain();await closeCamera();if(teardownUncertain)throw operationError('OPERATION_UNKNOWN_TERMINATION','Native session close is unverified.');}
  load(sdkDir);destination=folder;
  const items=listCameras({sdkDir});state.cameras=items;const selected=selectCamera(items,cameraId);
  if(!selected){state.error='Камера не найдена. Проверьте USB-кабель, питание и режим подключения. Закройте другие программы управления камерой.';return status();}
  let list=null;
  try {
    const out=[null];check(sdk.list(out),'Поиск камер');list=out[0];const count=[0];check(sdk.count(list,count),'Поиск камер');
    if(!count[0]) {state.error='Камера не найдена. Проверьте USB-кабель, питание и режим подключения. Закройте другие программы управления камерой.';return status();}
    for(let index=0;index<count[0];index++){
      const c=[null];check(sdk.child(list,index,c),'Выбор камеры');
      let keep=false;
      try{const candidate={};check(sdk.info(c[0],candidate),'Информация камеры');if(describeCamera(candidate,index).id===selected.id){camera=c[0];keep=true;break;}}
      finally{if(!keep)releaseRef(c[0],'camera-selection-release');}
    }
    if(!camera)throw Error('Список камер изменился. Повторите поиск.');
    // Canon §6.12 requires enabling angle information before OpenSession. Never
    // add writes to a read-only connection or probe Canon-unconfirmed bodies.
    if(!readOnly)liveOrientation.prepare({model:selected.model,version:await fileVersion(state.sdkPath)});
    openCameraSession();sessionEpoch++;evidence={};setDeliveryRoute({route,folder});
    state.description=selected.model;state.modelId=selected.modelId;state.model=textProperty(0x2)||selected.model;state.connectedAt=Date.now();state.cameraId=selected.id;state.connected=true;state.error=null;controls.servoConnected();
    restricted=!modelCapabilities(selected.model,true).capture;
    state.working=false;state.controlsOnly=false;state.evfState=null;state.observedSaveTo=null;state.saveTo=null;state.eventsRegistered=false;
    state.capabilities={capture:false,liveView:false,focus:false,manualFocus:false,import:false,reason:'Открыта сессия диагностики.'};
    log('success',`${state.model}: USB-подключение установлено.`);if(!readOnly&&!controlsOnly)await prepareAccessories(selected.modelId);if(controlsOnly)return prepareControlSession();return readOnly?refresh():prepareWorkingSession(savePreference);
  } catch(e) {await transferProducer.drain();await closeCamera();state.error=e.message;status();throw e;}
  finally {if(list) releaseRef(list,'camera-list-release');}
}
function clearCard() {for(const [id,ref] of cardRefs){if(releaseRef(ref,'card-release'))cardRefs.delete(id);}cameraCard.reset();}
function failCapture(error){if(!captureWait)return;const waiting=captureWait;captureWait=null;try{waiting.latch?.release();}catch{waiting.releaseUnknown=true;}clearTimeout(waiting.timeout);clearTimeout(waiting.settle);if(waiting.releaseUnknown)error=operationError('OPERATION_UNKNOWN_TERMINATION','Shutter release could not be acknowledged.');transfers.settleCapture(waiting.operationId,{outcome:error?.code==='OPERATION_UNKNOWN_TERMINATION'?'UNKNOWN_TERMINATION':'FAILED'});waiting.reject(error);}
function settleCapture(){
  const waiting=captureWait;if(!waiting||waiting.latch?.isHolding())return;
  if(waiting.releaseUnknown){failCapture(operationError('OPERATION_UNKNOWN_TERMINATION','Shutter release could not be acknowledged.'));return;}
  clearTimeout(waiting.settle);if(!waiting.observedTransfers)return;
  waiting.settle=setTimeout(()=>{if(captureWait!==waiting)return;captureWait=null;clearTimeout(waiting.timeout);transfers.settleCapture(waiting.operationId,{outcome:'OBSERVATION_WINDOW_DRAINED'});waiting.resolve({files:waiting.observedFiles||[],observedTransferIds:(waiting.observedFiles||[]).map(file=>file.transferId),shots:0,observedTransfers:waiting.observedTransfers,confirmation:'UNVERIFIED',nativeQuiescence:'UNKNOWN',operationId:waiting.operationId});},waiting.quietMs);
}

function disconnect() {
  try{controls.stopServo();}catch(error){log('error',error.message);}
  controls.servoDisconnected();bulb.disconnected();flashControl.disconnected();accessorySupport={bulb:false,flashPopup:false};
  if(teardownUncertain){liveOrientation.disconnected();return status();}
  sessionEpoch++;
  failCapture(Error('Съёмка прервана: камера отключена.'));
  if(camera) {
    try {restoreLiveView();}catch{}
    if(teardownUncertain){liveOrientation.disconnected();return status();}
    releaseEvf();clearCard();
    if(sessionOpened){
      if(sessionEventsRegistered)for(const [method,event] of [['objectHandler',0x200],['propertyHandler',0x100],['stateHandler',0x300]])try{if(observed({objectHandler:'EdsSetObjectEventHandler',propertyHandler:'EdsSetPropertyEventHandler',stateHandler:'EdsSetCameraStateEventHandler'}[method],'handlers',()=>sdk[method](camera,event,null,null))!==0)teardownUncertain=true;}catch{teardownUncertain=true;}
      try{if(observed('EdsCloseSession','session-close',()=>sdk.close(camera))!==0)teardownUncertain=true;}catch{teardownUncertain=true;}
    }
    // Unknown close/unregister results do not justify shortening native lifetime.
    if(!teardownUncertain){if(releaseRef(camera,'camera-release'))camera=null;}
  }
  sessionOpened=false;sessionEventsRegistered=false;state.eventsRegistered=false;restricted=false;evidence={};focusSampleAt=0;focusSample={sequence:focusSample.sequence,status:'unknown'};
  transfers.setRoute({sessionEpoch,sessionId:null,destination:''});
  liveOrientation.disconnected();
  live=false;Object.assign(state,{focusInfo:null,lastFocused:null,autofocus:null,connected:false,working:false,controlsOnly:false,evfState:null,observedSaveTo:null,properties:{},liveStats:null,saveTo:null,capabilities:null,description:null,model:null,battery:null,equipment:null,cameraId:null,error:null,nativeOutcome:teardownUncertain?'UNKNOWN':null});return status();
}
function ensure() {if(!camera||!state.connected) throw Error('Сначала подключите камеру по USB.');}
function ensureWorking(){ensure();if(!state.working)throw Error('Сначала настройте рабочее подключение камеры.');}
function releaseEvf(){if(evfImage&&releaseRef(evfImage,'evf-image-release'))evfImage=null;if(evfStream&&releaseRef(evfStream,'evf-stream-release'))evfStream=null;}
function restoreLiveView(){
  liveOrientation.stop();
  if(!evfRestore)return;
  const {output,mode}=evfRestore;
  try{
    if(!Number.isInteger(output)||!Number.isInteger(mode))throw Error('Исходные настройки Live View неизвестны.');
    set(0x500,output);set(0x501,mode);
    if(get(0x500)!==output||get(0x501)!==mode)throw Error('Камера не подтвердила восстановление Live View.');
    evfRestore=null;
    if(state.controlsOnly)state.evfState={output,mode};
  }catch(error){
    teardownUncertain=true;
    observations.failure({operation:currentOperation?.method||'live',phase:'evf-restore',method:'EdsSetPropertyData',error});
    send({event:'nativeObservation',data:{method:'EdsSetPropertyData',phase:'evf-restore',classification:'UNKNOWN'}});
    throw operationError('OPERATION_UNKNOWN_TERMINATION','Live View restoration is unverified.');
  }
}
function liveView({enabled}) {
  ensureWorking();
  controls.stopServo();
  if(enabled&&state.capabilities?.liveView===false)throw Error('Live View недоступен в текущем режиме камеры.');
  if(captureWait||controls.isBusy())throw Error('Дождитесь завершения текущей команды камеры.');
  if(!!enabled===live)return state.controlsOnly&&!enabled&&!evfRestore?refresh():status();
  if(enabled){
    const output=get(0x500),mode=get(0x501);
    if(output===null||mode===null)throw Error('Камера не предоставила исходные настройки Live View.');
    evfRestore={output,mode};
    try{
      if(mode===0)set(0x501,1);set(0x500,output|2);
      if(state.controlsOnly){
        const actualOutput=get(0x500),actualMode=get(0x501);
        if(actualOutput!==(output|2)||actualMode!==(mode===0?1:mode))throw Error('Камера не подтвердила включение Live View.');
        state.evfState={output:actualOutput,mode:actualMode};
      }
    }
    catch(error){try{restoreLiveView();}catch(restoreError){restoreError.cause=error;throw restoreError;}throw error;}
    live=true;state.error=null;liveOrientation.start();
  }else{
    try{restoreLiveView();}
    finally{live=false;releaseEvf();state.liveStats=null;status();}
  }
  statsAt=performance.now();statsFrames=0;statsBytes=0;
  // Live View can change the camera's reported AF/metering state. Publish a
  // fresh read-only snapshot after restoration instead of reusing EVF-era data.
  return state.controlsOnly&&!enabled?refresh():status();
}
function readFocus(){
  // This restricted connection has no qualified FocusInfo point-layout decoder.
  if(state.controlsOnly)return;
  if(Date.now()-focusSampleAt<125)return;
  focusSampleAt=Date.now();
  for(const ref of [evfImage,camera]){
    if(!ref)continue;const type=[0],size=[0];
    if(sdk.propertySize(ref,0x104,0,type,size)||size[0]<24||size[0]>262144)continue;
    const buffer=Buffer.alloc(size[0]);if(sdk.get(ref,0x104,0,buffer.length,buffer))continue;
    focusSample={...parseFocusInfo(buffer),sequence:focusSample.sequence+1};
    evidence.focusInfo=true;
    const at=Date.now();
    if(focusSample.boxes.some(point=>point.status==='focused'))state.lastFocused={at,boxes:focusSample.boxes.filter(point=>point.status==='focused')};
    state.focusInfo={boxes:focusSample.boxes,at,autofocus:state.autofocus,lastFocused:state.lastFocused};
    send({event:'focusInfo',data:state.focusInfo});
    if(process.env.FOCAL_AF_TRACE)log('info',`AF metadata: ${JSON.stringify(focusSample)}`);
    return;
  }
}
function frame(publish=true) {
  try {
    if(!evfStream){const s=[null];check(sdk.stream(2*1024*1024,s),'Live View');evfStream=s[0];const im=[null];check(sdk.evfRef(evfStream,im),'Live View');evfImage=im[0];}
    check(sdk.seek(evfStream,0,0),'Live View');
    const code=sdk.evf(camera,evfImage);
    if(!Number.isInteger(code)||code<0||code>0xffffffff)throw Error('Некорректный результат Live View.');
    if(code===0xa102||code===0x81&&!state.controlsOnly)return false;
    check(code,'Live View');liveOrientation.sample(evfImage);readFocus();const p=[null],position=[0],length=[0];check(sdk.pointer(evfStream,p),'Live View');check(sdk.position(evfStream,position),'Live View');
    check(sdk.length(evfStream,length),'Live View');
    const available=Number(length[0]),positionSize=Number(position[0]),size=positionSize||available;
    if(!Number.isSafeInteger(available)||available<1||available>=20*1024*1024||!Number.isSafeInteger(positionSize)||positionSize<0||positionSize>available)throw Error('Некорректные границы буфера Live View.');
    let bytes=null;
    if(size>0&&size<20*1024*1024){bytes=copyNativeBuffer(p[0],size);evidence.evf=true;if(publish){send({event:'frame',data:bytes,sequence:++totalFrames,at:Date.now()});statsFrames++;statsBytes+=size;}}
    const now=performance.now();if(now-statsAt>=1000){state.liveStats={fps:Number((statsFrames*1000/(now-statsAt)).toFixed(1)),bytesPerSecond:Math.round(statsBytes*1000/(now-statsAt)),frames:totalFrames};statsAt=now;statsFrames=0;statsBytes=0;status();}
    return publish?true:bytes;
  } catch(e) {
    if(publish)try{restoreLiveView();}catch{}
    live=false;
    if(state.controlsOnly&&(!Number.isInteger(e.code)||e.code<0||e.code>0xffffffff)){
      teardownUncertain=true;
      observations.failure({operation:'live',phase:'evf-frame',method:'EVF frame',error:e});
      send({event:'nativeObservation',data:{method:'EVF frame',phase:'evf-frame',classification:'UNKNOWN'}});
    }
    releaseEvf();state.error=e.message;status();log('error',e.message);return false;
  }
}
async function previewFocus(drive,nativeFocus){
  if(state.controlsOnly)throw Error('Для управления фокусом включите Live View явно.');
  ensure();if(state.capabilities?.liveView===false)throw Error('Превью недоступно для этой камеры.');
  const output=get(0x500),mode=get(0x501);if(output===null||mode===null)throw Error('Камера не предоставила Live View.');
  const wasLive=live;let bytes=null;
  try{
    if(mode===0)set(0x501,1);set(0x500,output|2);
    const start=Date.now();let count=0,driven=!drive;
    while(Date.now()-start<5500){
      ensure();const next=frame(false);if(next){if(!driven){await drive();driven=true;count=0;}else{bytes=next;count++;if(count>=3&&Date.now()-start>=450)break;}}
      await new Promise(resolve=>setTimeout(resolve,60));
    }
    if(!bytes)throw Error('Камера не передала кадр превью AF.');
    const at=Date.now(),sample=nativeFocus||focusSample;
    send({event:'focusPreview',data:{bytes,at,focusInfo:{boxes:sample.boxes||[],at,autofocus:{status:sample.status,at}}}});
    return {at};
  }finally{
    try{if(camera){set(0x500,output);if(get(0x501)!==mode)set(0x501,mode);}}finally{live=wasLive;if(!wasLive){releaseEvf();state.liveStats=null;}status();}
  }
}
let focusRestore=null;
const focusHold=createFocusHold({
  onState:value=>{state.focusHold=value;status();},
  prepare:async()=>{
    ensureWorking();if(captureWait||bulb.isBusy()||restricted||controls.isBusy()||controls.isServoHeld())throw operationError('OPERATION_BUSY','Дождитесь завершения текущей команды камеры.');
    if(state.capabilities?.focus===false||get(0x404)===3)throw Error('Объектив в MF. Переведите его переключатель в AF.');
    if(live)return;
    if(state.controlsOnly)throw Error('Для управления фокусом включите Live View.');
    const output=get(0x500),mode=get(0x501),epoch=sessionEpoch;
    if(output===null||mode===null)throw Error('Камера не предоставила исходные настройки Live View.');
    focusRestore={output,mode,epoch};
    if(mode===0)set(0x501,1);set(0x500,output|2);live=true;liveOrientation.start();status();
    // Keep the existing qualified EVF lens-drive path. Acquire EVF once for the
    // whole hold; never run the preview start/stop sequence around every step.
    // This does not claim every camera universally rejects lens drive without EVF.
    const start=Date.now();while(Date.now()-start<5500){ensureWorking();if(frame(false))return;await new Promise(resolve=>setTimeout(resolve,60));}
    throw Error('Камера не передала кадр превью AF.');
  },
  step:args=>{ensureWorking();if(!live)throw Error('Live View остановлен во время автофокуса.');return controls.focus(args);},
  restore:async()=>{
    const previous=focusRestore;focusRestore=null;if(!previous)return;
    if(!camera||sessionEpoch!==previous.epoch)return;
    try{set(0x500,previous.output);set(0x501,previous.mode);if(get(0x500)!==previous.output||get(0x501)!==previous.mode)throw Error('Камера не подтвердила восстановление Live View.');}
    catch(error){teardownUncertain=true;observations.failure({operation:'focus',phase:'evf-restore',method:'EdsSetPropertyData',error});send({event:'nativeObservation',data:{method:'EdsSetPropertyData',phase:'evf-restore',classification:'UNKNOWN'}});throw error;}
    finally{live=false;liveOrientation.stop();releaseEvf();state.liveStats=null;status();}
  }
});
function download(ref,folder,isCapture=false,context) {
  if(!folder) throw Error('Не выбрана папка съёмки.');let stream=null,complete=false,target;
  try {
    const info={};check(sdk.dir(ref,info),'Информация файла');
    const name=(typeof info.name==='string'?info.name:Buffer.from(info.name).toString()).replace(/\0.*$/,'');
    const size=Number(info.size);if(info.folder||size<=0||size>512*1024*1024) throw Error('Неподдерживаемый размер файла камеры.');
    const out=[null];check(sdk.stream(size,out),'Буфер импорта');stream=out[0];check(sdk.download(ref,size,stream),'Загрузка снимка');
    const ptr=[null],length=[0];check(sdk.pointer(stream,ptr),'Чтение снимка');check(sdk.length(stream,length),'Размер снимка');
    fs.mkdirSync(folder,{recursive:true});const ext=path.extname(name),stem=path.basename(name,ext);let i=0;
    const bytes=copyNativeBuffer(ptr[0],Number(length[0]));
    while(true) {target=path.join(folder,`${stem}${i?'_'+i:''}${ext}`);try {fs.writeFileSync(target,bytes,{flag:'wx'});break;}catch(e){if(e.code!=='EEXIST')throw e;i++;}}
    check(sdk.complete(ref),'Завершение загрузки');complete=true;
    if(isCapture)evidence.capture=true;
    send({event:'photo',photoSequence:++photoSequence,data:{path:target,capture:isCapture,context:{...context,phase:'ORIGINAL_COMMITTED'}}});log('success',`Сохранено: ${path.basename(target)}`);
    if(isCapture&&captureWait){shutterTrace('capture-event',{...captureWait.input,operationId:captureWait.operationId,servo:state.servo?.status});captureWait.observedFiles.push({path:target,transferId:context?.transferId,photoSequence});captureWait.observedTransfers++;send({event:'burstProgress',data:{shots:0,observedTransfers:captureWait.observedTransfers,confirmation:'UNVERIFIED'}});settleCapture();}
    return {path:target};
  } finally {if(!complete) sdk.cancel(ref);if(stream)releaseRef(stream,'download-stream-release');}
}
function capture({autofocus=true,folder,burstMs=0,route,captureId,input},operation){
  ensureWorking();if(state.capabilities?.capture===false)throw Error(state.capabilities.reason||'Съёмка недоступна.');if(captureWait||controls.isBusy())throw Error('Предыдущая команда камеры ещё выполняется.');destination=folder||destination;
  if(get(0x400)===4||get(PROPS.shutter)===0x0c)throw operationError('BULB_PROTOCOL_UNQUALIFIED','BULB недоступен: протокол этой камеры и версии SDK не квалифицирован.');
  if(burstMs&&(![1,4,5].includes(get(0x401))||burstMs<100||burstMs>5000))throw Error('Выберите доступный серийный режим камеры. Максимальное удержание — 5 секунд.');
  setDeliveryRoute({route,folder});transfers.noteCapture({operationId:operation.operationId,captureId,sessionEpoch});
  return new Promise((resolve,reject)=>{
    const driveMode=get(0x401);captureWait={resolve,reject,operationId:operation.operationId,observedTransfers:0,observedFiles:[],quietMs:quietPeriod(driveMode,get(0x406)),timeout:setTimeout(()=>failCapture(operationError('OPERATION_UNKNOWN_TERMINATION','Native capture completion is unverified after the producer deadline.')),driveMode===7?900000:75000)};
    let failure;const waiting=captureWait;waiting.input=input;
    const dispatch=(parameter,phase)=>{shutterTrace('sdk-dispatch',{...input,operationId:operation.operationId,command:4,parameter,servo:state.servo?.status,driveMode,worker:'capture'});try{const code=observed('EdsSendCommand',phase,()=>sdk.command(camera,4,parameter));shutterTrace('sdk-result',{...input,operationId:operation.operationId,command:4,parameter,code});return code;}catch(error){shutterTrace('sdk-error',{...input,operationId:operation.operationId,command:4,parameter,code:Number.isInteger(error?.code)?error.code:-1});throw error;}};
    const release=()=>{try{controls.releaseAfterCapture(param=>{if(!camera||dispatch(param,'release')!==0)throw operationError('OPERATION_UNKNOWN_TERMINATION','Shutter release could not be acknowledged.');});}catch{waiting.releaseUnknown=true;throw operationError('OPERATION_UNKNOWN_TERMINATION','Shutter release could not be acknowledged.');}};
    try{
      if(burstMs){waiting.latch=holdShutter({press:()=>check(dispatch(autofocus?3:0x10003,'capture'),'Серийный спуск'),release,onReleased:()=>{send({event:'burstReleased'});if(captureWait===waiting)settleCapture();},onError:failCapture,onWatchdog:()=>shutterTrace('watchdog',{...input,operationId:operation.operationId,watchdogMs:burstMs})},burstMs);}
      else{const code=observed('EdsSendCommand','capture',()=>sdk.command(camera,4,autofocus?3:0x10003));check(isUnsupportedCommand(code)?observed('EdsSendCommand','capture',()=>sdk.command(camera,0,0)):code,'Спуск затвора');}
    }catch(error){observations.failure({operation:'capture',operationId:operation.operationId,method:'EdsSendCommand',phase:'capture',error});failure=error;}
    finally{if(!burstMs)try{release();}catch(error){failure||=error;}}
    if(failure)failCapture(failure);
  });
}
function stopBurst(){try{if(captureWait?.latch)captureWait.latch.release();}catch(error){failCapture(error);throw error;}return {released:true};}

const cardYield=()=>new Promise(resolve=>setImmediate(resolve));
function cardEnsure(){ensure();if(state.controlsOnly)throw operationError('OPERATION_ADMISSION_CLOSED','File transfer is disabled for this connection.');if(captureWait||controls.isBusy())throw operationError('OPERATION_BUSY','Wait for the camera command to finish.');}
function cardNative(method,call){let code;try{code=call();}catch(error){teardownUncertain=true;try{observed(method,'download',()=>{throw error;});}catch{}throw operationError('OPERATION_UNKNOWN_TERMINATION','The camera native operation outcome is unknown.');}if(!Number.isInteger(code)||code<0||code>0xffffffff){teardownUncertain=true;observed(method,'download',()=>code);throw operationError('OPERATION_UNKNOWN_TERMINATION','The camera returned an invalid native result.');}return code;}
function cardInfo(ref){const info={};check(cardNative('EdsGetDirectoryItemInfo',()=>sdk.dir(ref,info)),'Camera file information');return info;}
function cardChunk(ref,count){
  const out=[null];let stream;
  try{check(cardNative('EdsCreateMemoryStream',()=>sdk.stream(count,out)),'Camera download buffer');stream=out[0];check(cardNative('EdsDownload',()=>sdk.download(ref,count,stream)),'Camera download');const pointer=[null],length=[0];check(cardNative('EdsGetPointer',()=>sdk.pointer(stream,pointer)),'Camera buffer');check(cardNative('EdsGetLength',()=>sdk.length(stream,length)),'Camera buffer size');if(Number(length[0])!==count)throw operationError('CARD_DOWNLOAD_SHORT','The camera returned an incomplete file.');return copyNativeBuffer(pointer[0],count);}
  finally{if(stream)releaseRef(stream,'download-stream-release');}
}
const cardDownloader=createCameraDownload({info:cardInfo,chunk:cardChunk,complete:ref=>check(cardNative('EdsDownloadComplete',()=>sdk.complete(ref)),'Camera download completion'),cancel:ref=>check(cardNative('EdsDownloadCancel',()=>sdk.cancel(ref)),'Camera download cancellation'),yield:cardYield,cleanupIssue:()=>send({event:'transferIssue',data:{code:'CARD_TEMPORARY_CLEANUP_FAILED'}})});
const cameraCard=createCameraCard({
  ensure:cardEnsure,epoch:()=>sessionEpoch,camera:()=>camera,connected:()=>!!camera&&state.connected&&!teardownUncertain,
  qualified:()=>cardProfile(state.sdkFingerprint)&&typeof sdk?.volumeRaw==='function',
  child:(ref,index)=>{const out=[null];check(cardNative('EdsGetChildAtIndex',()=>sdk.child(ref,index,out)),'Camera item');if(!out[0])throw operationError('CARD_REFERENCE_INVALID','The camera returned an invalid item.');return out[0];},
  count:ref=>{const count=[0];check(cardNative('EdsGetChildCount',()=>sdk.count(ref,count)),'Camera folder');return count[0];},
  info:cardInfo,release:ref=>releaseRef(ref,'card-item-release'),retain:ref=>{const count=transferReferences.retain(ref);if(!Number.isInteger(count)||count<1||count>=0xffffffff)throw operationError('OPERATION_UNKNOWN_TERMINATION','Camera item retention is unknown.');return ref;},
  volume:ref=>{const bytes=Buffer.alloc(280);check(cardNative('EdsGetVolumeInfo',()=>sdk.volumeRaw(ref,bytes)),'Camera card information');return {type:bytes.readUInt32LE(0),access:bytes.readUInt32LE(4),capacity:Number(bytes.readBigUInt64LE(8)),free:Number(bytes.readBigUInt64LE(16)),label:bytes.subarray(24,280)};},
  thumbnail:ref=>{const out=[null];let stream;try{check(sdk.stream(0,out),'Camera thumbnail buffer');stream=out[0];check(sdk.thumbnail(ref,stream),'Camera thumbnail');const pointer=[null],length=[0];check(sdk.pointer(stream,pointer),'Camera thumbnail');check(sdk.length(stream,length),'Camera thumbnail size');const bytes=Number(length[0]);if(!Number.isSafeInteger(bytes)||bytes<3||bytes>8*1024*1024)throw operationError('CARD_THUMBNAIL_INVALID','Camera thumbnail is unavailable.');return copyNativeBuffer(pointer[0],bytes);}finally{if(stream)releaseRef(stream,'thumbnail-stream-release');}},
  download:(...args)=>cardDownloader.download(...args),yield:cardYield,progress:data=>send({event:'cardExportProgress',data})
});
async function listCard(args){return cameraCard.list(args);}
const controls=createCameraControl({
  onServo:value=>{state.servo=value;status();},onServoUnknown:error=>{send({event:'nativeObservation',data:{method:'EdsSendCommand',phase:'servo-release',classification:'UNKNOWN'}});log('error',error.message);},
  ensure:ensureWorking,refresh,get,set,log,previewFocus,pollFocus:readFocus,focusState:()=>focusSample,requiresLiveFocus:()=>!!state.controlsOnly,focusConfirmationAvailable:()=>!state.controlsOnly,onAutofocus:result=>{if(result.status==='focused')evidence.autofocus=true;state.autofocus={...result,at:Date.now()};if(result.status==='focusing')state.lastFocused=null;status();},canFocus:()=>state.controlsOnly?state.capabilities?.focus!==false&&get(0x416)===1&&[0,1,2].includes(get(0x404)):get(0x404)!==3,isCapturing:()=>!!captureWait||bulb.isBusy(),canBulb:()=>accessoryCapabilities().bulb,isLive:()=>live,
  command:(id,param,action)=>{
    ensure();
    if(state.controlsOnly){
      const owedStop=id===0x102&&param===0&&controlAfStopPending;
      if(!owedStop&&(!live||![0x102,0x103].includes(id)||id===0x102&&param!==1))throw Error('В этом подключении разрешён только фокус при включённом Live View.');
      if(!owedStop){const output=get(0x500),mode=get(0x501);if(output===null||!(output&2)||mode===null||mode===0)throw Error('Камера не подтвердила Live View для фокуса.');}
      if(id===0x102)controlAfStopPending=param===1;
    }
    shutterTrace('af-dispatch',{operationId:currentOperation?.operationId,command:id,parameter:param,servo:state.servo?.status,worker:'focus'});
    const result=state.controlsOnly?observed('EdsSendCommand','controls-only-focus',()=>sdk.command(camera,id,param)):sdk.command(camera,id,param);
    shutterTrace('af-result',{operationId:currentOperation?.operationId,command:id,parameter:param,code:result,servo:state.servo?.status});check(result,action);
  }
});
const handlers={
  connect,disconnect:async()=>{await transferProducer.drain();const result=await closeCamera();if(teardownUncertain)throw operationError('OPERATION_UNKNOWN_TERMINATION','Native session close is unverified.');return result;},listCameras,sdkEnvironment,diagnoseCamera,destination:async({folder,route})=>{if(state.controlsOnly)throw operationError('OPERATION_ADMISSION_CLOSED','Передача файлов отключена для этого подключения.');if(captureWait||controls.isBusy())throw Error('Камера занята.');await transferProducer.drain();destination=folder;setDeliveryRoute({route,folder});return true;},status:()=>producersFenced||teardownUncertain?status():refresh(),live:liveView,capture,burstStop:stopBurst,
  focusStart:args=>focusHold.start(args),focusStop:args=>focusHold.stop(args),
  property:controls.property,focus:async args=>{const result=await controls.focus(args);evidence.driveLens=true;return result;},autofocus:controls.autofocus,
  servo:args=>controls.servo(args),servoStop:()=>controls.stopServo(),bulbStart:startBulb,bulbStop:stopBulb,flashSupport:()=>({...flashControl.snapshot(),available:accessoryCapabilities().flashPopup,canAttempt:accessoryCapabilities().flashPopup}),flashPopup:()=>flashControl.popup(),
  listCard,cardList:args=>cameraCard.list(args),cardThumbnail:args=>cameraCard.thumbnail(args),cardExport:(args,operation)=>cameraCard.export(args,operation),
  importCard:(args,operation)=>cameraCard.export(args,operation),
  producerFence:async()=>{operations.stopAdmission();await operations.whenIdle({exclusiveOnly:true});await focusHold.stop();controls.stopServo();await bulb.shutdown();if(bulb.isBusy())throw operationError('OPERATION_UNKNOWN_TERMINATION','Завершение BULB не подтверждено. Проверьте камеру.');await transferProducer.drain();clearTimeout(timer);transferProducer.fence();producersFenced=true;return {drained:true,lastPhotoSequence:photoSequence,nativeStarted,proof:nativeStarted?'unknown':'native-not-started',transfers:transferProducer.snapshot()};},
  finalizeShutdown:async()=>{if(!producersFenced)throw operationError('OPERATION_ADMISSION_CLOSED','A producer fence is required before teardown.');shuttingDown=true;await transferProducer.drain();await closeCamera();await new Promise(resolve=>setImmediate(resolve));const released=releaseSdk();if(released&&com)observed('CoUninitialize','com-uninitialize',()=>com(),'void');send({event:'shutdown'});setTimeout(()=>process.exit(teardownUncertain?1:0),20);return {closed:true,lastPhotoSequence:photoSequence,nativeStarted,proof:nativeStarted?'unknown':'native-not-started',observations:observations.snapshot(),transfers:transferProducer.snapshot()};}
};
// Safety shutter release must bypass held/unknown Servo guards. Blocking burstStop
// leaves the full press active until holdShutter's 5-second watchdog fires.
const operationHandlers=Object.fromEntries(Object.entries(handlers).map(([method,handler])=>[method,async(args,context)=>{const owned=!['status','burstStop','servoStop','bulbStop','focusStop','producerFence'].includes(method);if(owned)currentOperation={method,operationId:context.operationId};try{if(focusHold.isBusy()&&!['status','burstStop','servoStop','bulbStop','focusStop','disconnect','producerFence','finalizeShutdown'].includes(method))throw operationError('OPERATION_BUSY','Дождитесь завершения текущей команды камеры.');if(teardownUncertain&&!['status','burstStop','servoStop','bulbStop','focusStop','producerFence','finalizeShutdown'].includes(method))throw operationError('OPERATION_UNKNOWN_TERMINATION','Native teardown state is unverified.');if(bulb.isBusy()&&!['status','burstStop','bulbStop','focusStop','disconnect','producerFence','finalizeShutdown'].includes(method))throw operationError('OPERATION_BUSY','BULB-экспозиция ещё не завершена.');if(controls.isServoHeld()&&!['status','capture','burstStop','servoStop','bulbStop','focusStop','servo','property','live','disconnect','producerFence','finalizeShutdown'].includes(method))throw operationError('OPERATION_BUSY','Остановите AI Servo перед другой командой камеры.');if(state.servo.enabled===null&&state.connected&&!['status','burstStop','servoStop','focusStop','disconnect','producerFence','finalizeShutdown'].includes(method))throw operationError('OPERATION_UNKNOWN_TERMINATION','Остановка AI Servo не подтверждена. Отключите камеру.');return await handler(args,context);}finally{if(currentOperation?.operationId===context.operationId)currentOperation=null;}}]));
const operations=createOperationHost({generation,handlers:operationHandlers,send,getSessionEpoch:()=>sessionEpoch,isCancellable:method=>['importCard','cardExport'].includes(method)});
async function receive(message) {if(shuttingDown)return;if(message?.type==='emergencyRelease'&&message.generation===generation){try{stopBurst();controls.stopServo();await focusHold.stop();await stopBulb();}catch{send({event:'transferIssue',data:{code:'EMERGENCY_RELEASE_UNKNOWN'}});}return;}await operations.receive(message);}
if(parent)parent.on('message',({data})=>receive(data));else process.on('message',receive);
setInterval(()=>{if(camera&&!producersFenced&&!teardownUncertain)try{refresh();}catch(e){log('error',e.message);}},2500).unref();
send({event:'ready'});
