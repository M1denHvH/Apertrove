'use strict';
// Exact utilityProcess-only provider. There is deliberately no native loader.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module');
const ROOT=path.resolve(__dirname,'../..'),parent=process.parentPort;
function fail(code){throw Object.assign(Error(code),{code});}
if(!parent||typeof parent.postMessage!=='function'||process.versions.electron!=='45.3.2'||process.env.NODE_OPTIONS||process.env.NODE_PATH)fail('IC01_UTILITY_ADMISSION_REQUIRED');
const generation=process.argv.find(value=>value.startsWith('--apertrove-generation='))?.slice('--apertrove-generation='.length);
if(!process.argv.includes('--ic01-fake-provider')||!/^[A-Za-z0-9._:-]{1,96}$/.test(generation||'')||generation!==process.env.APERTROVE_IC01_GENERATION)fail('IC01_WORKER_ARGUMENTS_REFUSED');
const token=process.env.APERTROVE_IC01_CONTROL_TOKEN;if(!/^[a-f0-9]{64}$/.test(token||''))fail('IC01_CONTROL_TOKEN_REQUIRED');
const inside=(base,file)=>{const relative=path.relative(base,file);return relative===''||!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep);};
const same=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
const raw={readFileSync:fs.readFileSync,mkdirSync:fs.mkdirSync,writeFileSync:fs.writeFileSync,lstatSync:fs.lstatSync,realpathSync:fs.realpathSync,statSync:fs.statSync};
const fixtureRoot=path.resolve(process.env.APERTROVE_IC01_FIXTURE||'');
if(!inside(path.join(ROOT,'qa','integration-candidate','fixtures'),fixtureRoot)||!same(raw.realpathSync(fixtureRoot),fixtureRoot))fail('IC01_FIXTURE_REQUIRED');
function checked(file,{existing=false}={}){
  if(typeof file!=='string'||!path.isAbsolute(file)||!inside(fixtureRoot,path.resolve(file)))fail('IC01_FIXTURE_PATH_REFUSED');
  const absolute=path.resolve(file);let ancestor=absolute;
  for(;;){try{if(raw.lstatSync(ancestor).isSymbolicLink()||!same(raw.realpathSync(ancestor),ancestor))fail('IC01_FIXTURE_ALIAS_REFUSED');break;}catch(error){if(!['ENOENT','ENOTDIR'].includes(error.code))throw error;if(existing)throw error;ancestor=path.dirname(ancestor);}}
  return absolute;
}
checked(fixtureRoot,{existing:true});
const seedFile=checked(process.env.APERTROVE_IC01_SEED_FILE,{existing:true});
const seed=raw.readFileSync(seedFile);
if(seed.length<4||seed.length>262144||seed.readUInt16BE(0)!==0xffd8||seed.readUInt16BE(seed.length-2)!==0xffd9)fail('IC01_GENERATED_JPEG_REQUIRED');
const recoveryDestination=checked(process.env.APERTROVE_RECOVERY_DESTINATION);
const allowed=new Set(['operation-lifecycle','transfer-context','transfer-producer'].map(name=>path.join(ROOT,'electron',name+'.cjs').toLowerCase()));
const core=new Set(['fs','path','crypto','module']),originalLoad=Module._load,originalResolve=Module._resolveFilename;
const denials=[];let expected=false;
function deny(kind){if(denials.length<32)denials.push({kind:String(kind).slice(0,96),expected});fail('IC01_FAKE_NATIVE_OR_IMPORT_DENIED');}
Module._load=function(request,owner,isMain){
  const name=String(request).replace(/^node:/,'');
  if(Module.builtinModules.includes(name)){if(!core.has(name))return deny('builtin:'+name);return originalLoad.apply(this,arguments);}
  if(/^(?:electron|koffi|sharp)(?:\/|$)|\.(?:node|dll)$/i.test(request)||/camera-worker|sdk-environment|native-buffer|flash-bridge|flash-wia|wia|ptp/i.test(request))return deny('forbidden-module');
  const file=originalResolve.call(Module,request,owner,isMain);
  if(!allowed.has(String(file).toLowerCase()))return deny('nonallowlisted-module');
  return originalLoad.apply(this,arguments);
};
Module._extensions['.node']=()=>deny('native-addon');process.dlopen=()=>deny('process.dlopen');
for(const request of ['koffi','electron','node:child_process','node:net','../../electron/camera-worker.cjs','../../electron/sdk-environment.cjs']){
  expected=true;let refused=false;try{require(request);}catch(error){if(error.code!=='IC01_FAKE_NATIVE_OR_IMPORT_DENIED')throw error;refused=true;}finally{expected=false;}if(!refused)fail('IC01_SENTINEL_FAILED');
}
const {createOperationHost,operationError}=require('../../electron/operation-lifecycle.cjs');
const {createTransferContexts}=require('../../electron/transfer-context.cjs');
const {createTransferProducer}=require('../../electron/transfer-producer.cjs');
let sessionEpoch=0,photoSequence=0,captureSequence=0,refSequence=0,messageCount=0,receivedCount=0,writtenBytes=0,fenced=false,shuttingDown=false;
const fileRecords=[],references=new Map(),payloads=new Map(),deferredJobs=new Set(),issues=[];
const h1={readOnlyConnects:0,workingConnects:0,diagnoses:0,propertyCalls:0,propertyWrites:0,captureCalls:0,liveCalls:0,autofocusCalls:0,focusCalls:0,listCardCalls:0,importCardCalls:0,readOnlyMutationAttempts:0};
const contexts=createTransferContexts({recoveryDestination,newId:()=>generation});contexts.setRoute({sessionEpoch,sessionId:null,destination:''});
const state={connected:false,working:false,live:false,model:null,properties:{},cameraId:null,capabilities:{capture:false,liveView:false,focus:false,manualFocus:false,import:false}};
function post(message){if(++messageCount>1024)fail('IC01_MESSAGE_BUDGET');if(denials.some(item=>!item.expected))fail('IC01_UNEXPECTED_DENIAL');parent.postMessage(message);}
function send(message){post(message.type==='operation'?message:{...message,generation,sessionEpoch});}
function status(){const value=JSON.parse(JSON.stringify(state));send({event:'status',data:value});return value;}
const sleep=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
function knownDeferred(job){deferredJobs.add(job);job.then(()=>deferredJobs.delete(job),()=>deferredJobs.delete(job));return job;}
async function drainCallbacks(){while(deferredJobs.size)await Promise.allSettled([...deferredJobs]);await producer.drain();}
function route(args={}){const destination=args.route?.destination??args.folder??contexts.snapshot().route?.destination??'';if(destination)checked(destination);contexts.setRoute({sessionEpoch,sessionId:args.route?.sessionId??null,destination});}
function writeOriginal(name,kind,destination,context,capture=true){
  if(!/^[a-z][a-z0-9-]{0,63}$/.test(name)||!['jpeg','raw'].includes(kind)||fileRecords.length>=32)fail('IC01_FILE_BUDGET_OR_NAME');
  const folder=checked(destination),file=checked(path.join(folder,name+(kind==='jpeg'?'.jpg':'.cr3')));
  const bytes=kind==='jpeg'?seed:Buffer.concat([Buffer.from('IC01_RAW_LIKE_SYNTHETIC_NOT_CANON\n'),seed.subarray(0,128)]);
  if(bytes.length>262144||writtenBytes+bytes.length>8388608)fail('IC01_FILE_BYTES_BUDGET');
  raw.mkdirSync(folder,{recursive:true});raw.writeFileSync(file,bytes,{flag:'wx'});writtenBytes+=bytes.length;
  const record={path:file,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,kind};fileRecords.push(record);
  send({event:'photo',photoSequence:++photoSequence,data:{path:file,capture,context:{...context,phase:'ORIGINAL_COMMITTED'}}});return record;
}
const fakeSDK={retain(ref){references.set(ref,(references.get(ref)||0)+1);return references.get(ref);},release(ref){const count=(references.get(ref)||0)-1;if(count<0)fail('IC01_REFERENCE_UNDERFLOW');references.set(ref,count);return count;}};
const producer=createTransferProducer({contexts,getEpoch:()=>sessionEpoch,getSdk:()=>fakeSDK,isConnected:()=>state.connected,onIssue:issue=>{issues.push(issue.code);send({event:'transferIssue',data:issue});},download:(ref,folder,_capture,context)=>{const payload=payloads.get(ref);if(!payload)fail('IC01_REFERENCE_PAYLOAD_MISSING');payload.record=writeOriginal(payload.name,payload.kind,folder,context);}});
async function emitTransfer({name,kind='jpeg'}={}){
  if(!state.connected)fail('IC01_FAKE_CAMERA_DISCONNECTED');
  const ref='reference-'+(++refSequence),payload={name:name||'transfer-'+refSequence,kind};payloads.set(ref,payload);references.set(ref,1);
  try{const context=producer.admit(ref);fakeSDK.release(ref);await producer.drain();if(!payload.record)fail('IC01_TRANSFER_FAILED');return {...payload.record,context};}finally{payloads.delete(ref);}
}
const defaultCapture=()=>({mode:'normal',delayMs:0,secondDelayMs:350});
let nextCapture=defaultCapture(),nextImport={delayMs:0},held=null,syntheticLiveView=false,frameTimer=null,frameSequence=0;
function keys(value,allowed){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key)))fail('IC01_CONTROL_CONFIGURATION_REFUSED');return value;}
function delay(value,fallback=0){const number=value??fallback;if(!Number.isInteger(number)||number<0||number>2000)fail('IC01_CONTROL_DELAY_REFUSED');return number;}
function configure(args){
  keys(args,['nextCapture','nextImport','liveView']);
  if(args.nextCapture){const value=keys(args.nextCapture,['mode','delayMs','secondDelayMs']);if(!['normal','delayed','pair','hold','hang','unknown'].includes(value.mode))fail('IC01_CAPTURE_MODE_REFUSED');nextCapture={mode:value.mode,delayMs:delay(value.delayMs),secondDelayMs:delay(value.secondDelayMs,350)};}
  if(args.nextImport){const value=keys(args.nextImport,['delayMs']);nextImport={delayMs:delay(value.delayMs)};}
  if(args.liveView!==undefined){if(typeof args.liveView!=='boolean')fail('IC01_LIVE_VIEW_CONFIGURATION_REFUSED');syntheticLiveView=args.liveView;}
  return {configured:true,nextCapture:{...nextCapture},nextImport:{...nextImport}};
}
function requireConnected(){if(!state.connected)throw operationError('IC01_FAKE_CAMERA_DISCONNECTED','The synthetic provider is not connected.');}
function requireWorking(){requireConnected();if(!state.working){h1.readOnlyMutationAttempts++;fail('IC01_READ_ONLY_MUTATION_REFUSED');}}
function properties(){
  const values={iso:[0x48,0x50],shutter:[0x70,0x75],aperture:[0x30,0x38],driveMode:[0,1],imageQuality:[0x0013ff0f],whiteBalance:[0,1],pictureStyle:[0x81],afMode:[0]};
  return Object.fromEntries(Object.entries(values).map(([key,list])=>[key,{value:list[0],writable:true,allowed:list,choices:list.map(value=>({value,label:key+' '+value}))}]));
}
function capabilities(working){return {capture:!!working,import:true,liveView:!!working&&syntheticLiveView,focus:false,manualFocus:false,reason:working?null:'Explicit synthetic diagnostic connection.'};}
function stopSyntheticFrames(){if(frameTimer){clearInterval(frameTimer);frameTimer=null;}}
function sendSyntheticFrame(){if(state.connected&&state.working&&state.live)send({event:'frame',data:seed,sequence:++frameSequence,at:Date.now()});}
const receipt=count=>({confirmation:'UNVERIFIED',nativeQuiescence:'UNKNOWN',shots:0,files:[],observedTransfers:count});
async function capture(args,operation){
  h1.captureCalls++;requireWorking();route(args);
  const plan=nextCapture;nextCapture=defaultCapture();const number=++captureSequence;
  contexts.noteCapture({operationId:operation.operationId,captureId:args.captureId||null,sessionEpoch});
  try{
    if(plan.mode==='unknown')throw operationError('OPERATION_UNKNOWN_TERMINATION','Explicit synthetic unknown producer outcome.');
    if(plan.mode==='hold'||plan.mode==='hang')return await new Promise(resolve=>{held={mode:plan.mode,operationId:operation.operationId,number,resolve};send({event:'ic01-held',data:{operationId:operation.operationId,mode:plan.mode}});});
    if(plan.delayMs)await sleep(plan.delayMs);
    await emitTransfer({name:'capture-'+number,kind:'jpeg'});
    if(plan.mode==='pair')knownDeferred((async()=>{await sleep(plan.secondDelayMs);await emitTransfer({name:'late-raw-'+number,kind:'raw'});})().catch(()=>{issues.push('IC01_DEFERRED_TRANSFER_FAILED');send({event:'transferIssue',data:{code:'IC01_DEFERRED_TRANSFER_FAILED'}});}));
    return receipt(1);
  }finally{contexts.settleCapture(operation.operationId,{outcome:'SYNTHETIC_OBSERVATION_ONLY'});}
}
async function release(args={}){
  keys(args,['jpeg','raw']);if(args.jpeg!==undefined&&typeof args.jpeg!=='boolean'||args.raw!==undefined&&typeof args.raw!=='boolean')fail('IC01_RELEASE_ARGUMENTS_REFUSED');
  const pending=held;if(!pending)return {released:false,reason:'NO_HELD_SYNTHETIC_OPERATION'};
  if(pending.mode==='hang')return {released:false,reason:'EXPLICIT_UNRESPONSIVE_FAKE'};
  held=null;let count=0;
  if(args.jpeg!==false){await emitTransfer({name:'released-jpeg-'+pending.number,kind:'jpeg'});count++;}
  if(args.raw===true){await emitTransfer({name:'released-raw-'+pending.number,kind:'raw'});count++;}
  pending.resolve(receipt(count));return {released:true,observedTransfers:count};
}
function snapshot(){return {provider:'IC01_SYNTHETIC_JS_ONLY',generation,sessionEpoch,photoSequence,connected:state.connected,working:state.working,fenced,held:held?{mode:held.mode,operationId:held.operationId}:null,h1:{...h1},transfers:producer.snapshot(),pendingCallbackJobs:deferredJobs.size,references:[...references.values()],files:fileRecords.map(item=>({...item})),denials:denials.map(item=>({...item})),issues:[...issues],messages:messageCount,nativeCalls:0,processId:process.pid,electronVersion:process.versions.electron};}
let operations;
const handlers={
  listCameras:()=>[{id:'ic01-synthetic-camera',index:0,model:'IC01 Synthetic Camera'}],
  sdkEnvironment:()=>({status:'ready',architecture:process.arch,file:null,version:'SYNTHETIC_PROVIDER_ONLY',checks:[{result:'ready',source:'IC01 synthetic JavaScript provider'}],optional:{},error:null}),
  connect:async args=>{if(args.cameraId&&args.cameraId!=='ic01-synthetic-camera')fail('IC01_CAMERA_ID_REFUSED');await producer.drain();const readOnly=args.readOnly===true;if(readOnly)h1.readOnlyConnects++;else h1.workingConnects++;sessionEpoch++;Object.assign(state,{connected:true,working:!readOnly,cameraId:'ic01-synthetic-camera',model:'IC01 Synthetic Camera',description:'IC01 Synthetic Camera',connectedAt:Date.now(),mode:'M',battery:100,saveTo:readOnly?null:3,properties:properties(),equipment:{firmware:'synthetic',lensName:'IC01 synthetic lens',lensAttached:false,availableShots:32,focalLength:50},capabilities:capabilities(!readOnly)});route(args);return status();},
  disconnect:async()=>{stopSyntheticFrames();await producer.drain();sessionEpoch++;contexts.setRoute({sessionEpoch,sessionId:null,destination:''});Object.assign(state,{connected:false,working:false,live:false,cameraId:null,model:null,properties:{},capabilities:capabilities(false)});return status();},
  destination:async args=>{await producer.drain();route(args);return true;},
  status:()=>status(),
  diagnoseCamera:()=>{requireConnected();if(state.working)fail('IC01_DIAGNOSIS_REQUIRES_READ_ONLY');h1.diagnoses++;return {checkedAt:new Date().toISOString(),model:'IC01 Synthetic Camera',firmware:'synthetic',working:state.working,sdkVersion:'SYNTHETIC_PROVIDER_ONLY',sdkPath:null,storage:[],rows:[{id:'iso',group:'Exposure',label:'ISO',status:'temporary',detail:'Synthetic descriptor-backed read-only observation.'}]};},
  property:({key,value})=>{h1.propertyCalls++;requireWorking();const property=state.properties[key];if(!property||!property.allowed.includes(value))fail('IC01_PROPERTY_REFUSED');h1.propertyWrites++;property.value=value;return status();},
  live:({enabled}={})=>{h1.liveCalls++;requireWorking();if(typeof enabled!=='boolean')fail('IC01_LIVE_ARGUMENTS_REFUSED');if(enabled&&!syntheticLiveView)fail('IC01_LIVE_VIEW_UNAVAILABLE');stopSyntheticFrames();state.live=enabled;if(enabled){sendSyntheticFrame();frameTimer=setInterval(sendSyntheticFrame,120);}return status();},
  autofocus:()=>{h1.autofocusCalls++;requireWorking();return status();},
  focus:()=>{h1.focusCalls++;requireWorking();return status();},
  capture,
  burstStop:()=>{send({event:'burstReleased'});return {released:true,syntheticOnly:true};},
  listCard:()=>{h1.listCardCalls++;requireWorking();return [{id:'item-1',name:'synthetic-card-1.jpg',size:seed.length},{id:'item-2',name:'synthetic-card-2.jpg',size:seed.length}];},
  importCard:async(args,operation)=>{
    h1.importCardCalls++;requireWorking();if(!Array.isArray(args.ids)||!args.ids.length||args.ids.length>2||args.ids.some(id=>!['item-1','item-2'].includes(id)))fail('IC01_CARD_ITEMS_REFUSED');
    const folder=checked(args.route?.destination??args.folder),plan=nextImport;nextImport={delayMs:0};const files=[];
    const context=Object.freeze({sessionEpoch,sessionId:args.route?.sessionId??null,destination:folder,operationId:operation.operationId,captureId:null,operationType:'CARD_IMPORT',attribution:'EXPLICIT_IMPORT',correlation:'CONFIRMED'});
    for(const id of args.ids){operation.cancellation.throwIfRequested();if(plan.delayMs)await sleep(plan.delayMs);operation.cancellation.throwIfRequested();const record=writeOriginal('card-'+id+'-'+(++refSequence),'jpeg',folder,{...context,transferId:generation+':card:'+refSequence},false);files.push({path:record.path});await new Promise(resolve=>setImmediate(resolve));}
    operation.cancellation.throwIfRequested();return files;
  },
  producerFence:async()=>{operations.stopAdmission();await operations.whenIdle({exclusiveOnly:true});await drainCallbacks();producer.fence();fenced=true;return {drained:true,lastPhotoSequence:photoSequence,proof:'synthetic',nativeStarted:false,transfers:producer.snapshot()};},
  finalizeShutdown:async()=>{if(!fenced)throw operationError('OPERATION_ADMISSION_CLOSED','Synthetic producer fence required.');await drainCallbacks();stopSyntheticFrames();shuttingDown=true;clearTimeout(hardDeadline);send({event:'shutdown'});setTimeout(()=>process.exit(0),20);return {closed:true,lastPhotoSequence:photoSequence,proof:'synthetic',nativeStarted:false,observations:{hasFailures:false},transfers:producer.snapshot()};}
};
operations=createOperationHost({generation,handlers,send,getSessionEpoch:()=>sessionEpoch});
let rejectedControls=0;
async function control(message){
  const controlId=typeof message.controlId==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(message.controlId)?message.controlId:null;
  const validToken=typeof message.token==='string'&&/^[a-f0-9]{64}$/.test(message.token)&&crypto.timingSafeEqual(Buffer.from(message.token),Buffer.from(token));
  if(!controlId||!validToken){rejectedControls++;if(controlId)send({type:'ic01-control-result',controlId,ok:false,code:'IC01_CONTROL_AUTH_DENIED'});return;}
  try{
    const args=message.args??{};let result;
    switch(message.command){
      case 'configure':result=configure(args);break;
      case 'emit':keys(args,['name','kind']);result=await emitTransfer(args);break;
      case 'release':result=await release(args);break;
      case 'snapshot':keys(args,[]);result={...snapshot(),rejectedControls};break;
      case 'crash':keys(args,['code']);if(args.code!==undefined&&args.code!==23)fail('IC01_CRASH_CODE_REFUSED');result={scheduled:true,code:23};setTimeout(()=>process.exit(23),20);break;
      case 'malformed':{
        keys(args,['kind']);
        if(args.kind==='foreign-generation')post({event:'status',generation:'ic01-foreign-generation',sessionEpoch:sessionEpoch+1000,data:{connected:true,model:'IC01 forged status'}});
        else if(args.kind==='wrong-operation')send({type:'operation',kind:'terminal',generation,requestId:generation+':request:99999',operationId:generation+':operation:99999',sequence:99999,method:'capture',sessionEpoch,nativeSessionEpoch:sessionEpoch+1000,state:'COMPLETED',result:{shots:999,confirmation:'CONFIRMED'}});
        else if(args.kind==='unknown-event')post({event:'ic01-unknown-event',generation,sessionEpoch:sessionEpoch+1000,data:{connected:true,model:'IC01 forged unknown event'}});
        else fail('IC01_MALFORMED_KIND_REFUSED');
        result={sent:true,kind:args.kind};break;
      }
      default:fail('IC01_CONTROL_METHOD_REFUSED');
    }
    send({type:'ic01-control-result',controlId,ok:true,result});
  }catch(error){send({type:'ic01-control-result',controlId,ok:false,code:typeof error.code==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)?error.code:'IC01_CONTROL_FAILED'});}
}
const hardDeadline=setTimeout(()=>process.exit(96),90000);
parent.on('message',({data:message})=>{
  if(++receivedCount>1024)fail('IC01_INCOMING_MESSAGE_BUDGET');
  if(!message||typeof message!=='object')return;
  let bytes;try{bytes=Buffer.byteLength(JSON.stringify(message));}catch{return;}
  if(bytes>65536)fail('IC01_INCOMING_BYTES_BUDGET');
  if(message.type==='ic01-control'){void control(message);return;}
  if(shuttingDown)return;
  if(message.type==='emergencyRelease'&&message.generation===generation){handlers.burstStop();return;}
  if(message.type==='operation')void operations.receive(message).catch(()=>{send({event:'transferIssue',data:{code:'IC01_OPERATION_DISPATCH_FAILED'}});});
});
send({event:'ready',data:{provider:'IC01_SYNTHETIC_JS_ONLY',nativeCalls:0,denials:denials.map(item=>({...item})),electronVersion:process.versions.electron}});
