// Qualified by static analysis of the local Canon runtime and independent EOS
// Utility callers. No binary/header/decompiled content is distributed here.
// A supported command dispatcher alone does not qualify an individual camera.
const PSE_PROFILE=Object.freeze({
  id:'canon-pse-3.18.40-x64',architecture:'x64',version:'3.18.40.0',
  sha256:'35c5fd7564cf8eee3bc41004a0ab21d96caccb36ea1a1ddb512caf7b1c046627',
  command:Object.freeze({flashPopup:0x106,bulbStart:2,bulbEnd:3,pressShutter:4}),
  status:Object.freeze({lock:0,unlock:1}),bulbEvent:0x310
});
const UNQUALIFIED_BULB='BULB_PROTOCOL_UNQUALIFIED',UNQUALIFIED_FLASH='FLASH_POPUP_PROTOCOL_UNQUALIFIED';
const unsupported=code=>Number.isInteger(code)&&[1,7,0x2005].includes(code&0xffff);
const edsCode=value=>Number.isInteger(value)&&value>=0&&value<=0xffffffff;
function error(code,message){return Object.assign(Error(message),{code});}
function profileByFingerprint({sha256,architecture,version}={}){
  return typeof sha256==='string'&&sha256.toLowerCase()===PSE_PROFILE.sha256
    &&architecture===PSE_PROFILE.architecture&&version===PSE_PROFILE.version?PSE_PROFILE:null;
}
const proven=profile=>profile===PSE_PROFILE;
function checkResult(value){
  if(!edsCode(value))throw error('OPERATION_UNKNOWN_TERMINATION','The Canon command returned an invalid EdsError.');
  if(value!==0)throw error(value,'Canon command failed (0x'+value.toString(16)+').');
  return value;
}
function createCanonBulbAdapter({profile,route,cameraQualified=false,io={}}={}){
  const qualified=proven(profile)&&cameraQualified===true&&['dedicated','press-shutter'].includes(route)
    &&['ensure','sendCommand','sendStatus'].every(key=>typeof io[key]==='function');
  const ensure=args=>{
    if(!qualified)throw error(UNQUALIFIED_BULB,'BULB недоступен: протокол этой камеры и версии SDK не квалифицирован.');
    return io.ensure(args);
  };
  // Cleanup methods deliberately do not repeat the start-only B-mode/idle guard.
  // The lifecycle must be able to release an owed end/lock after a state change.
  const dispatch=async(method,id,parameter)=>{
    if(!qualified)throw error(UNQUALIFIED_BULB,'BULB недоступен: протокол этой камеры и версии SDK не квалифицирован.');
    return checkResult(await io[method](id,parameter));
  };
  return {
    qualified,route:qualified?route:null,eventId:qualified?profile.bulbEvent:null,
    ensure,
    lock:()=>dispatch('sendStatus',profile?.status.lock,0),
    unlock:()=>dispatch('sendStatus',profile?.status.unlock,0),
    start:(args={})=>dispatch('sendCommand',route==='dedicated'?profile?.command.bulbStart:profile?.command.pressShutter,route==='dedicated'?0:args.autofocus===false?0x10003:3),
    end:()=>dispatch('sendCommand',route==='dedicated'?profile?.command.bulbEnd:profile?.command.pressShutter,0),
    onState:typeof io.onState==='function'?io.onState:undefined
  };
}
function bulbExposureSeconds(event,parameter){
  return event===PSE_PROFILE.bulbEvent&&edsCode(parameter)?parameter:null;
}
function createFlashPopupControl({profile,cameraQualified=false,io={},onState=()=>{}}={}){
  const qualified=proven(profile)&&cameraQualified===true&&['ensure','sendCommand'].every(key=>typeof io[key]==='function');
  let changing=false,sessionValid=true;
  let state={available:qualified,canAttempt:qualified,accepted:false,raised:null,status:qualified?'ready':'unavailable',reason:qualified?null:UNQUALIFIED_FLASH,confirmation:'unconfirmed'};
  const snapshot=()=>({...state});
  const publish=patch=>{state={...state,...patch,raised:null};onState(snapshot());return snapshot();};
  async function popup(){
    if(!state.available)throw error(state.reason||UNQUALIFIED_FLASH,'Подъём встроенной вспышки недоступен: команда для этой камеры и версии SDK не квалифицирована.');
    if(changing)throw error('OPERATION_BUSY','A flash popup command is already pending.');
    // Worker supplies current connection, capture, BULB and Servo guards. A
    // rejected precondition never changes accepted state or cycles Live View.
    io.ensure();changing=true;publish({status:'starting',accepted:false,error:undefined,confirmation:'unknown'});
    try{
      checkResult(await io.sendCommand(profile.command.flashPopup,0));
      if(!sessionValid)throw error('OPERATION_STALE_SESSION','Flash popup completion belongs to a disconnected camera session.');
      return publish({status:'ready',accepted:true,reason:null,error:undefined,confirmation:'command-accepted'});
    }catch(cause){
      if(!sessionValid)throw cause;
      const rejected=edsCode(cause?.code),unavailable=rejected&&unsupported(cause.code);
      publish({status:unavailable?'unavailable':'error',available:!unavailable,canAttempt:!unavailable,accepted:false,
        reason:unavailable?'FLASH_POPUP_NOT_SUPPORTED':state.reason,error:cause?.message||'Flash popup command failed.',
        confirmation:rejected?'command-rejected':'unknown'});
      if(!rejected)io.onUnknown?.(cause);
      throw cause;
    }finally{changing=false;}
  }
  const disconnected=()=>{
    sessionValid=false;
    return publish({status:'disconnected',available:false,canAttempt:false,accepted:false,reason:'FLASH_POPUP_DISCONNECTED',confirmation:changing?'unknown':'unconfirmed'});
  };
  return {popup,snapshot,disconnected,isBusy:()=>changing};
}
module.exports={profileByFingerprint,createCanonBulbAdapter,bulbExposureSeconds,createFlashPopupControl};
