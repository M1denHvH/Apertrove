// Canon EDSDK Reference 13.20.11 §§5.2.91, 6.2.12, 6.12.
// These are live EVF posture data, not the EXIF Orientation image property.
const ORIENTATION = Object.freeze({
  property:0x01000544, enableProperty:0x01000000, enableParam:0x05b3740d,
  command:0x00000109, bytes:16, maximumAgeMs:1500
});

function confirmedOrientationModel(value) {
  const model=String(value||'').trim().replace(/^Canon\s+/i,'').replace(/\s+/g,' ').toUpperCase();
  // Canon's confirmed-operation list (§6.12.1); unknown bodies are never probed.
  return /^EOS R(?:P|A|\d{1,3}[A-Z]?)?(?: MARK (?:I{1,3}|IV|V))?$/.test(model)
    || ['EOS-1D X MARK III','EOS 1D X MARK III','EOS 5D MARK IV','EOS 80D',
      'EOS KISS M','EOS M50','EOS KISS M2','EOS M50 MARK II',
      'EOS KISS X10I','EOS REBEL T8I','EOS 850D'].includes(model);
}

function orientationRuntimeSupported(value) {
  // Get Angle Information was introduced in 13.11.10. Canon Windows runtime
  // versions use 3.x; record this version-family inference separately from ABI proof.
  const match=/^(3|13)\.(\d+)\.(\d+)(?:\.\d+)?$/.exec(String(value||'').trim());
  return !!match && (+match[2]>11 || +match[2]===11 && +match[3]>=10);
}

function decodeOrientation(buffer) {
  if(!Buffer.isBuffer(buffer)||buffer.length!==ORIENTATION.bytes)return null;
  const status=buffer.readInt32LE(0),position=buffer.readInt32LE(4);
  if(status!==2)return null;
  // Display correction inferred from Canon's rear-display viewpoint. This maps
  // discrete posture only; approximate roll/pitch never invent extra orientation.
  const rotation=({0:0,1:90,2:270,4:180})[position];
  return rotation===undefined?null:{rotation};
}

function createLiveOrientation(io={}) {
  const now=io.now||Date.now;
  let prepared=false,outputOwed=false,streaming=false,sampledAt=null;
  let state={available:false,status:'unavailable',rotation:null,source:null,reason:'ORIENTATION_NOT_PREPARED'};
  const publish=patch=>{
    const next={...state,...patch};
    if(Object.keys(next).some(key=>next[key]!==state[key])){state=next;io.onState?.({...state});}
    return {...state};
  };
  const unavailable=(status,reason)=>publish({available:false,status,rotation:null,source:null,reason});
  const invoke=method=>{
    if(typeof io[method]!=='function')throw Error('ORIENTATION_ADAPTER_UNAVAILABLE');
    const code=io[method]();
    if(code!==0)throw Object.assign(Error('ORIENTATION_COMMAND_FAILED'),{code});
  };
  function prepare({model,version}={}) {
    prepared=false;streaming=false;sampledAt=null;
    if(outputOwed)return unavailable('error','ORIENTATION_STOP_UNCONFIRMED');
    if(!confirmedOrientationModel(model))return unavailable('unavailable','ORIENTATION_MODEL_UNCONFIRMED');
    if(!orientationRuntimeSupported(version))return unavailable('unavailable','ORIENTATION_RUNTIME_UNCONFIRMED');
    try{invoke('enable');prepared=true;return unavailable('ready',null);}
    catch{return unavailable('unavailable','ORIENTATION_ENABLE_FAILED');}
  }
  function stop() {
    streaming=false;sampledAt=null;
    if(outputOwed){
      try{invoke('stop');outputOwed=false;}
      catch{return unavailable('error','ORIENTATION_STOP_UNCONFIRMED');}
    }
    return unavailable(prepared?'stopped':'unavailable',prepared?null:state.reason);
  }
  function start() {
    if(!prepared)return {...state};
    if(outputOwed)return streaming?{...state}:unavailable('error','ORIENTATION_STOP_UNCONFIRMED');
    sampledAt=null;
    // A thrown binding can have dispatched: compensate before treating it stopped.
    outputOwed=true;
    try{invoke('start');streaming=true;return unavailable('starting',null);}
    catch{stop();return unavailable('error',outputOwed?'ORIENTATION_STOP_UNCONFIRMED':'ORIENTATION_START_FAILED');}
  }
  function sample(ref) {
    if(!prepared||!streaming||!ref)return {...state};
    let result;
    try{result=io.read?.(ref);}
    catch{return unavailable('unknown','ORIENTATION_READ_FAILED');}
    const decoded=result?.code===0?decodeOrientation(result.buffer):null;
    if(!decoded){sampledAt=null;return unavailable('unknown',result?.code===0?'ORIENTATION_POSTURE_UNKNOWN':'ORIENTATION_READ_FAILED');}
    sampledAt=now();
    return publish({available:true,status:'active',rotation:decoded.rotation,source:'camera',reason:null});
  }
  function expire() {
    if(state.available&&sampledAt!==null&&now()-sampledAt>ORIENTATION.maximumAgeMs){sampledAt=null;unavailable('unknown','ORIENTATION_SAMPLE_STALE');}
    return {...state};
  }
  function disconnected() {
    prepared=false;outputOwed=false;streaming=false;sampledAt=null;
    return unavailable('disconnected','ORIENTATION_DISCONNECTED');
  }
  return {prepare,start,stop,sample,expire,disconnected,snapshot:expire};
}

module.exports={ORIENTATION,confirmedOrientationModel,orientationRuntimeSupported,decodeOrientation,createLiveOrientation};
