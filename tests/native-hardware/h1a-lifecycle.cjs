'use strict';
// Pure sequencing seam. This module has no FFI, process, filesystem or camera access.
const METHODS=Object.freeze(['initialize','list','count','release','terminate']);
const NAMES=Object.freeze({initialize:'EdsInitializeSDK',list:'EdsGetCameraList',count:'EdsGetChildCount',release:'EdsRelease',terminate:'EdsTerminateSDK'});
const uint32=value=>typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<=0xffffffff;
function enumerate(sdk,{isOpaqueRef}={}){
  if(typeof isOpaqueRef!=='function')throw Error('H1A_OPAQUE_POINTER_VALIDATOR_REQUIRED');
  if(!sdk||Object.keys(sdk).sort().join(',')!==[...METHODS].sort().join(',')||METHODS.some(name=>typeof sdk[name]!=='function'))throw Error('H1A_EXACT_SDK_PORT_REQUIRED');
  const receipt={initialize:null,list:null,count:null,release:null,terminate:null,cameraCount:null,listAcquired:false,listReleased:false,cleanupEligible:false,outcome:'UNKNOWN',calls:[]};
  let initialized=false,list=null,unknown=false,failed=false;
  function invoke(method,...args){
    const row={method:NAMES[method]};receipt.calls.push(row);
    try{const raw=sdk[method](...args);row.returnCode=uint32(raw)?raw:null;row.returnType=typeof raw;if(!uint32(raw))throw Error('INVALID_UINT32_RESULT: '+NAMES[method]);receipt[method]=raw;return raw;}
    catch(error){row.threw=true;row.error=String(error.message||error).slice(0,256);throw error;}
  }
  try{
    initialized=invoke('initialize')===0;
    if(!initialized)failed=true;
    else{
      const output=[null];
      if(invoke('list',output)!==0)failed=true; // On failure output is unspecified; never inspect/release it.
      else{
        list=output[0];
        if(list===null||list===undefined||list===0||list===0n)throw Error('SUCCESS_WITH_NULL_CAMERA_LIST');
        if(!isOpaqueRef(list))throw Error('SUCCESS_WITH_INVALID_CAMERA_LIST_POINTER');
        receipt.listAcquired=true;
        const count=[0];
        if(invoke('count',list,count)!==0)failed=true;
        else{if(!uint32(count[0]))throw Error('INVALID_CAMERA_COUNT');receipt.cameraCount=count[0];}
      }
    }
  }catch(error){unknown=true;receipt.error=String(error.message||error).slice(0,256);}
  // Unknown calls can have changed ownership. Retain the native dependencies until process exit.
  if(receipt.listAcquired&&!unknown){
    try{const remaining=invoke('release',list);if(remaining!==0){unknown=true;receipt.error=remaining===0xffffffff?'RELEASE_ERROR_SENTINEL':'RELEASE_REMAINING_REFERENCES';}else receipt.listReleased=true;}
    catch(error){unknown=true;receipt.error=String(error.message||error).slice(0,256);}
  }
  if(initialized&&!unknown){
    try{if(invoke('terminate')!==0){unknown=true;receipt.error='TERMINATE_NONZERO';}}
    catch(error){unknown=true;receipt.error=String(error.message||error).slice(0,256);}
  }
  receipt.cleanupEligible=initialized&&!unknown&&receipt.terminate===0&&(!receipt.listAcquired||receipt.listReleased);
  receipt.outcome=unknown?'UNKNOWN':failed?'FAILED':'H1A_COUNT_RECORDED';
  return receipt;
}
module.exports={enumerate,METHODS,NAMES,uint32};
