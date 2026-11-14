// The SDK lives in this isolated process. All Canon calls run on its main STA thread.
const fs = require('node:fs');
const path = require('node:path');
const koffi = require('koffi');
const {PROPS,choices} = require('./camera-values.cjs');
const {parseFocusInfo}=require('./focus-info.cjs');
const {quietPeriod}=require('./capture-timing.cjs');
const {holdShutter}=require('./shutter-latch.cjs');
const {createCameraControl} = require('./camera-control.cjs');
const {copyNativeBuffer} = require('./native-buffer.cjs');
const {describeCamera,modelCapabilities,selectCamera} = require('./camera-discovery.cjs');
const {isUnsupportedCommand,configureDestination}=require('./camera-destinations.cjs');
const {sdkCandidates,fileVersion}=require('./sdk-environment.cjs');
const {capabilityReport}=require('./camera-capabilities.cjs');
const parent = process.parentPort;
const send = value => parent ? parent.postMessage(value) : process.send?.(value);
let sdk, library, com, dllDirectory, bindings, camera=null, initialized=false, live=false, callbacks=[], timer, cardRefs=new Map(), captureWait=null, destination='', shuttingDown=false;
let sessionEpoch=0, sessionOpened=false, restricted=false, evidence={}, environmentChecks=[], evfRestore=null;
let focusSample={sequence:0,status:"unknown"},focusSampleAt=0;
let evfStream=null,evfImage=null,statsAt=performance.now(),statsFrames=0,statsBytes=0,totalFrames=0,propertyRefreshPending=false;
const state={connected:false,live:false,model:null,battery:null,properties:{},sdkPath:null,error:null};
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
  if(initialized){sdk.terminate();initialized=false;}
  for(const callback of callbacks)koffi.unregister(callback);
  callbacks=[];
  sdk=null;
  library?.unload();
  library=null;
  dllDirectory?.(null);
  state.sdkPath=null;
}
function load(custom) {
  if(sdk) return;
  environmentChecks=sdkCandidates(custom);
  for(const entry of environmentChecks){
    if(entry.architecture!==process.arch){entry.result='architecture';continue;}
    try{loadCandidate(entry.file);entry.result='ready';break;}
    catch(error){entry.result='error';entry.error=error.message;releaseSdk();}
  }
  if(!sdk)throw Error(environmentChecks.some(entry=>entry.result==='error')?'Не удалось загрузить SDK Canon. Проверьте зависимости DLL и папку установки.':'Совместимая EDSDK.dll не найдена. Установите ПО Canon или укажите папку официального SDK.');
}
function loadCandidate(file) {
  const kernel=koffi.load('kernel32.dll');
  dllDirectory??=kernel.func('bool __stdcall SetDllDirectoryW(str16 path)');
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
    command:fn('EdsSendCommand','uint32',['void *','uint32','int32']),capacity:fn('EdsSetCapacity','uint32',['void *',Capacity]),event:fn('EdsGetEvent','uint32',[]),
    objectHandler:fn('EdsSetObjectEventHandler','uint32',['void *','uint32',koffi.pointer(ObjectEvent),'void *']),propertyHandler:fn('EdsSetPropertyEventHandler','uint32',['void *','uint32',koffi.pointer(PropertyEvent),'void *']),stateHandler:fn('EdsSetCameraStateEventHandler','uint32',['void *','uint32',koffi.pointer(StateEvent),'void *']),
    dir:fn('EdsGetDirectoryItemInfo','uint32',['void *',koffi.out(koffi.pointer(DirInfo))]),
    stream:fn('EdsCreateMemoryStream','uint32',['uint64',koffi.out('void **')]),download:fn('EdsDownload','uint32',['void *','uint64','void *']),complete:fn('EdsDownloadComplete','uint32',['void *']),cancel:fn('EdsDownloadCancel','uint32',['void *']),
    pointer:fn('EdsGetPointer','uint32',['void *',koffi.out('void **')]),length:fn('EdsGetLength','uint32',['void *',koffi.out('uint64 *')]),
    seek:fn('EdsSeek','uint32',['void *','int64','uint32']),position:fn('EdsGetPosition','uint32',['void *',koffi.out('uint64 *')]),
    evfRef:fn('EdsCreateEvfImageRef','uint32',['void *',koffi.out('void **')]),evf:fn('EdsDownloadEvfImage','uint32',['void *','void *'])
  };
  try{sdk.volume=fn('EdsGetVolumeInfo','uint32',['void *',koffi.out(koffi.pointer(VolumeInfo))]);}catch{}
  const exported=name=>{try{fn(name,'uint32',[]);return true;}catch{return false;}};
  sdk.exports={volume:!!sdk.volume,propertyDescEx:exported('EdsGetPropertyDescEx'),framePoint:exported('EdsSetFramePoint')};
  check(sdk.init(),'Инициализация EDSDK'); initialized=true;state.sdkPath=file;
  const objCb=koffi.register((event,obj)=>{
    if(obj) {
      if(event===0x208) {
        if(!state.working){sdk.cancel(obj);}
        else {
          const epoch=sessionEpoch, currentSdk=sdk;
          sdk.retain(obj);
          setImmediate(()=>{try { if(epoch===sessionEpoch&&camera)download(obj,destination,true); } catch(e) { log('error',e.message); failCapture(e); } finally {currentSdk.release(obj);} });
        }
      }
      sdk.release(obj);
    }
    return 0;
  },koffi.pointer(ObjectEvent));callbacks.push(objCb);
  const propCb=koffi.register(()=>{if(!propertyRefreshPending){propertyRefreshPending=true;setTimeout(()=>{propertyRefreshPending=false;if(camera)refresh();},100);}return 0;},koffi.pointer(PropertyEvent));callbacks.push(propCb);
  const stateCb=koffi.register((event)=>{
    if(event===0x301){const epoch=sessionEpoch;setImmediate(()=>{if(epoch!==sessionEpoch)return;failCapture(Error('Камера отключилась.'));disconnect();log('error','Камера отключена. Проверьте USB и питание.');});}
    if(event===0x303 && camera && state.working) sdk.command(camera,1,0);
    return 0;
  },koffi.pointer(StateEvent));
  callbacks.push(stateCb);
  function pump(){
    if(shuttingDown)return;let delay=20;
    try{sdk.event();if(camera&&live&&!captureWait&&controls.canStream())delay=frame()?0:3;}catch(e){log('error',e.message);}
    timer=setTimeout(pump,delay);
  }
  timer=setTimeout(pump,0);
}
function get(id) {const buf=Buffer.alloc(4);if(sdk.get(camera,id,0,4,buf)) return null;return buf.readUInt32LE();}
function set(id,value) {const buf=Buffer.alloc(4);buf.writeUInt32LE(value>>>0);check(sdk.set(camera,id,0,4,buf),'Изменение параметра');}
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
  if(state.working&&!restricted&&get(0x500)!==null){state.capabilities.liveView=true;state.capabilities.manualFocus=true;}
  for(const [key,id] of Object.entries(PROPS)) {
    const current=get(id);if(current===null) {state.properties[key]={value:null,choices:[],writable:false};continue;}
    const desc={};const code=sdk.desc(camera,id,desc);
    const allowed=code?[]:Array.from(desc.values||[]).slice(0,Math.max(0,Math.min(desc.count||0,128))).map(v=>v>>>0);
    state.properties[key]={value:current,allowed,choices:choices(key,allowed,current),descriptorCode:code,writable:!code&&allowed.length>0&&!(key==='afMode'&&current===3&&!allowed.includes(3))};
  }
  return status();
}
function listCameras({sdkDir}={}){
  load(sdkDir);let list=null;
  try{const out=[null];check(sdk.list(out),'Поиск камер');list=out[0];const count=[0];check(sdk.count(list,count),'Поиск камер');const items=[];
    for(let index=0;index<count[0];index++){const ref=[null];check(sdk.child(list,index,ref),'Чтение камеры');try{const info={};check(sdk.info(ref[0],info),'Информация камеры');items.push(describeCamera(info,index));}finally{sdk.release(ref[0]);}}
    return items;
  }finally{if(list)sdk.release(list);}
}
async function sdkEnvironment({sdkDir,recheck=false}={}){
  let error=null;
  if(recheck&&!camera&&sdk)releaseSdk();
  try{load(sdkDir);}catch(e){error=e.message;}
  const file=state.sdkPath;
  const version=file?await fileVersion(file):null;
  return {status:file?'ready':environmentChecks.some(entry=>entry.result==='error')?'error':'missing',architecture:process.arch,file,version,checks:environmentChecks,optional:sdk?.exports||{},error};
}
function cameraStorage(){
  if(!sdk.volume)return {volumes:[],code:0};
  const volumes=[], count=[0];
  let code=sdk.count(camera,count);
  if(code)return {volumes,code};
  for(let index=0;index<Math.min(count[0],16);index++){
    const child=[null], result=sdk.child(camera,index,child);
    if(result){code||=result;continue;}
    try{
      const item={};const result=sdk.volume(child[0],item);
      if(result){code||=result;continue;}
      const label=typeof item.label==='string'?item.label:Buffer.from(item.label||[]).toString('utf8');
      volumes.push({...item,label:label.replace(/\0.*$/s,''),capacity:Number(item.capacity),free:Number(item.free)});
    }finally{sdk.release(child[0]);}
  }
  return {volumes,code};
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
    saveTo:state.saveTo,storage:storage.volumes,optional:sdk.exports,rows};
}
function prepareWorkingSession(preferred){
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
async function connect({sdkDir,folder,cameraId,readOnly=false,savePreference,reconfigure=false}) {
  if(camera&&(!cameraId||cameraId===state.cameraId)){
    destination=folder;
    return !readOnly&&(!state.working||reconfigure||!state.saveTo&&!restricted) ? prepareWorkingSession(savePreference) : refresh();
  }
  if(camera){if(captureWait||controls.isBusy())throw Error('Дождитесь завершения текущей команды камеры.');disconnect();}
  load(sdkDir);destination=folder;
  const items=listCameras({sdkDir});state.cameras=items;const selected=selectCamera(items,cameraId);
  if(!selected){state.error='Камера не найдена. Подключите USB и включите камеру. Для EOS 2000D выключите Wi-Fi в меню камеры.';return status();}
  let list=null;
  try {
    const out=[null];check(sdk.list(out),'Поиск камер');list=out[0];const count=[0];check(sdk.count(list,count),'Поиск камер');
    if(!count[0]) {state.error='Камера не найдена. Подключите USB, включите камеру и выключите Wi-Fi в меню камеры.';return status();}
    for(let index=0;index<count[0];index++){
      const c=[null];check(sdk.child(list,index,c),'Выбор камеры');
      let keep=false;
      try{const candidate={};check(sdk.info(c[0],candidate),'Информация камеры');if(describeCamera(candidate,index).id===selected.id){camera=c[0];keep=true;break;}}
      finally{if(!keep)sdk.release(c[0]);}
    }
    if(!camera)throw Error('Список камер изменился. Повторите поиск.');
    check(sdk.open(camera),'Открытие камеры');sessionOpened=true;sessionEpoch++;evidence={};
    check(sdk.objectHandler(camera,0x200,callbacks[0],null),'События снимков');
    check(sdk.propertyHandler(camera,0x100,callbacks[1],null),'События параметров');
    check(sdk.stateHandler(camera,0x300,callbacks[2],null),'События камеры');
    state.description=selected.model;state.model=textProperty(0x2)||selected.model;state.connectedAt=Date.now();state.cameraId=selected.id;state.connected=true;state.error=null;
    restricted=!modelCapabilities(selected.model,true).capture;
    state.working=false;state.saveTo=null;
    state.capabilities={capture:false,liveView:false,focus:false,manualFocus:false,import:false,reason:'Открыта сессия диагностики.'};
    log('success',`${state.model}: USB-подключение установлено.`);return readOnly?refresh():prepareWorkingSession(savePreference);
  } catch(e) {disconnect();state.error=e.message;status();throw e;}
  finally {if(list) sdk.release(list);}
}
function clearCard() {for(const ref of cardRefs.values()) sdk.release(ref);cardRefs.clear();}
function failCapture(error){if(!captureWait)return;const waiting=captureWait;captureWait=null;try{waiting.latch?.release();}catch{}clearTimeout(waiting.timeout);clearTimeout(waiting.settle);waiting.reject(error);}
function settleCapture(){
  const waiting=captureWait;if(!waiting||waiting.latch?.isHolding())return;
  clearTimeout(waiting.settle);if(!waiting.files.length)return;
  waiting.settle=setTimeout(()=>{if(captureWait!==waiting)return;captureWait=null;clearTimeout(waiting.timeout);waiting.resolve({files:waiting.files,shots:waiting.shots.size});},waiting.quietMs);
}

function disconnect() {
  sessionEpoch++;
  failCapture(Error('Съёмка прервана: камера отключена.'));
  if(camera) {
    try {restoreLiveView();}catch{}
    releaseEvf();clearCard();
    if(sessionOpened){
      for(const [method,event] of [['objectHandler',0x200],['propertyHandler',0x100],['stateHandler',0x300]])try{sdk[method](camera,event,null,null);}catch{}
      try{sdk.close(camera);}catch{}
    }
    sdk.release(camera);camera=null;
  }
  sessionOpened=false;restricted=false;evidence={};focusSampleAt=0;focusSample={sequence:focusSample.sequence,status:'unknown'};
  live=false;Object.assign(state,{focusInfo:null,lastFocused:null,autofocus:null,connected:false,working:false,properties:{},liveStats:null,saveTo:null,capabilities:null,description:null,model:null,battery:null,equipment:null,cameraId:null,error:null});return status();
}
function ensure() {if(!camera||!state.connected) throw Error('Сначала подключите камеру по USB.');}
function ensureWorking(){ensure();if(!state.working)throw Error('Сначала настройте рабочее подключение камеры.');}
function releaseEvf(){if(evfImage){sdk.release(evfImage);evfImage=null;}if(evfStream){sdk.release(evfStream);evfStream=null;}}
function restoreLiveView(){
  if(!evfRestore)return;
  const {output,mode}=evfRestore;evfRestore=null;
  try{set(0x500,output);}finally{if(mode===0)set(0x501,mode);}
}
function liveView({enabled}) {
  ensureWorking();
  if(enabled&&state.capabilities?.liveView===false)throw Error('Live View недоступен в текущем режиме камеры.');
  if(captureWait||controls.isBusy())throw Error('Дождитесь завершения текущей команды камеры.');
  if(!!enabled===live)return status();
  if(enabled){
    const output=get(0x500),mode=get(0x501);
    if(output===null)throw Error('Камера не предоставила настройки Live View.');
    evfRestore={output,mode};
    try{if(mode===0)set(0x501,1);set(0x500,output|2);}
    catch(error){try{restoreLiveView();}catch{}throw error;}
    live=true;state.error=null;
  }else{
    try{restoreLiveView();}
    finally{live=false;releaseEvf();state.liveStats=null;status();}
  }
  statsAt=performance.now();statsFrames=0;statsBytes=0;
  return status();
}
function readFocus(){
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
    const code=sdk.evf(camera,evfImage);if(code===0xa102||code===0x81)return false;
    check(code,'Live View');readFocus();const p=[null],position=[0],length=[0];check(sdk.pointer(evfStream,p),'Live View');check(sdk.position(evfStream,position),'Live View');
    let size=Number(position[0]);if(!size){check(sdk.length(evfStream,length),'Live View');size=Number(length[0]);}
    let bytes=null;
    if(size>0&&size<20*1024*1024){bytes=copyNativeBuffer(p[0],size);evidence.evf=true;if(publish){send({event:'frame',data:bytes,sequence:++totalFrames,at:Date.now()});statsFrames++;statsBytes+=size;}}
    const now=performance.now();if(now-statsAt>=1000){state.liveStats={fps:Number((statsFrames*1000/(now-statsAt)).toFixed(1)),bytesPerSecond:Math.round(statsBytes*1000/(now-statsAt)),frames:totalFrames};statsAt=now;statsFrames=0;statsBytes=0;status();}
    return publish?true:bytes;
  } catch(e) {if(publish)try{restoreLiveView();}catch{}live=false;releaseEvf();state.error=e.message;status();log('error',e.message);return false;}
}
async function previewFocus(drive,nativeFocus){
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
function download(ref,folder,isCapture=false) {
  if(!folder) throw Error('Не выбрана папка съёмки.');let stream=null,complete=false,target;
  try {
    const info={};check(sdk.dir(ref,info),'Информация файла');
    const name=(typeof info.name==='string'?info.name:Buffer.from(info.name).toString()).replace(/\0.*$/,'');
    const size=Number(info.size);if(info.folder||size<=0||size>512*1024*1024) throw Error('Неподдерживаемый размер файла камеры.');
    const out=[null];check(sdk.stream(size,out),'Буфер импорта');stream=out[0];check(sdk.download(ref,size,stream),'Загрузка снимка');check(sdk.complete(ref),'Завершение загрузки');complete=true;
    const ptr=[null],length=[0];check(sdk.pointer(stream,ptr),'Чтение снимка');check(sdk.length(stream,length),'Размер снимка');
    fs.mkdirSync(folder,{recursive:true});const ext=path.extname(name),stem=path.basename(name,ext);let i=0;
    const bytes=copyNativeBuffer(ptr[0],Number(length[0]));
    while(true) {target=path.join(folder,`${stem}${i?'_'+i:''}${ext}`);try {fs.writeFileSync(target,bytes,{flag:'wx'});break;}catch(e){if(e.code!=='EEXIST')throw e;i++;}}
    if(isCapture)evidence.capture=true;
    send({event:'photo',data:{path:target,capture:isCapture}});log('success',`Сохранено: ${path.basename(target)}`);
    if(isCapture&&captureWait){captureWait.files.push(target);captureWait.shots.add(path.basename(name,path.extname(name)).toLowerCase());send({event:'burstProgress',data:{shots:captureWait.shots.size}});settleCapture();}
    return {path:target};
  } finally {if(!complete) sdk.cancel(ref);if(stream)sdk.release(stream);}
}
function capture({autofocus=true,folder,burstMs=0}){
  ensureWorking();if(state.capabilities?.capture===false)throw Error(state.capabilities.reason||'Съёмка недоступна.');if(captureWait||controls.isBusy())throw Error('Предыдущая команда камеры ещё выполняется.');destination=folder||destination;
  if(burstMs&&(![1,4,5].includes(get(0x401))||burstMs<100||burstMs>5000))throw Error('Выберите доступный серийный режим камеры. Максимальное удержание — 5 секунд.');
  return new Promise((resolve,reject)=>{
    const driveMode=get(0x401);captureWait={resolve,reject,files:[],shots:new Set(),quietMs:quietPeriod(driveMode,get(0x406)),timeout:setTimeout(()=>failCapture(Error('Камера не завершила передачу кадров за отведённое время. Проверьте режим, карту и фокус.')),driveMode===7?900000:75000)};
    try{
      if(burstMs){const waiting=captureWait;waiting.latch=holdShutter({press:()=>check(sdk.command(camera,4,autofocus?3:0x10003),'Серийный спуск'),release:()=>{if(camera)check(sdk.command(camera,4,0),'Освобождение спуска');},onReleased:()=>{send({event:'burstReleased'});if(captureWait===waiting)settleCapture();},onError:failCapture},burstMs);}
      else{const code=sdk.command(camera,4,autofocus?3:0x10003);check(isUnsupportedCommand(code)?sdk.command(camera,0,0):code,'Спуск затвора');}
    }catch(error){failCapture(error);}finally{if(!burstMs&&camera)sdk.command(camera,4,0);}
  });
}
function stopBurst(){if(captureWait?.latch)captureWait.latch.release();return {released:true};}

async function listCard() {
  ensure();if(captureWait)throw Error('Дождитесь окончания съёмки.');clearCard();const items=[];let seen=0;
  const walk=(ref,depth)=>{
    if(depth>8||seen>10000)return;const count=[0];check(sdk.count(ref,count),'Чтение карты памяти');
    for(let i=0;i<count[0];i++) {const out=[null];check(sdk.child(ref,i,out),'Файл камеры');const child=out[0];let keep=false;seen++;
      try {const info={};const code=sdk.dir(child,info);if(depth===0||(!code&&info.folder)){walk(child,depth+1);} else if(!code) {
        const name=(typeof info.name==='string'?info.name:Buffer.from(info.name).toString()).replace(/\0.*$/,'');
        if(/\.(jpe?g|cr2|cr3)$/i.test(name)){const id=String(items.length);items.push({id,name,size:Number(info.size)});cardRefs.set(id,child);keep=true;}
      }}finally {if(!keep)sdk.release(child);}
    }
  };try{walk(camera,0);evidence.card=true;return items;}catch(error){clearCard();throw error;}
}
const controls=createCameraControl({
  ensure:ensureWorking,refresh,get,set,log,previewFocus,pollFocus:readFocus,focusState:()=>focusSample,onAutofocus:result=>{if(result.status==='focused')evidence.autofocus=true;state.autofocus={...result,at:Date.now()};if(result.status==='focusing')state.lastFocused=null;status();},canFocus:()=>get(0x404)!==3,isCapturing:()=>!!captureWait,isLive:()=>live,
  command:(id,param,action)=>{ensure();check(sdk.command(camera,id,param),action);}
});
const handlers={
  connect,disconnect,listCameras,sdkEnvironment,diagnoseCamera,destination:({folder})=>{if(captureWait||controls.isBusy())throw Error('Камера занята.');destination=folder;return true;},status:()=>refresh(),live:liveView,capture,burstStop:stopBurst,
  property:controls.property,focus:async args=>{const result=await controls.focus(args);evidence.driveLens=true;return result;},autofocus:controls.autofocus,
  listCard,
  importCard:async({ids,folder})=>{ensure();const files=[];for(const id of ids){const ref=cardRefs.get(id);if(!ref)throw Error('Список файлов устарел.');files.push(download(ref,folder));await new Promise(r=>setImmediate(r));}return files;},
  shutdown:async()=>{shuttingDown=true;disconnect();await new Promise(resolve=>setImmediate(resolve));releaseSdk();com?.();send({event:'shutdown'});setTimeout(()=>process.exit(0),20);return true;}
};
async function receive(message) {const {id,method,args}=message;try{if(shuttingDown)return;const handler=handlers[method];if(!handler)throw Error('Неизвестная команда.');const result=await handler(args||{});send({id,result});}catch(e){send({id,error:e.message});log('error',e.message);}}
if(parent)parent.on('message',({data})=>receive(data));else process.on('message',receive);
setInterval(()=>{if(camera)try{refresh();}catch(e){log('error',e.message);}},2500).unref();
send({event:'ready'});
