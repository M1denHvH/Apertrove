// Pure bounded observations. A nonzero EdsError is UNKNOWN, not a native
// fatal/recoverable taxonomy. Reference counts use their separate UInt32 contract.
const METHODS=new Set(['EdsGetEvent','EdsOpenSession','EdsCloseSession','EdsTerminateSDK','EdsSetObjectEventHandler','EdsSetPropertyEventHandler','EdsSetCameraStateEventHandler','EdsRetain','EdsRelease','EdsSendCommand','EdsSendStatusCommand','EdsGetPropertyData','EdsSetPropertyData','EdsDownloadComplete','EdsDownloadCancel','koffi.unregister','library.unload','CoUninitialize','SetDllDirectoryW']);
const PHASES=new Set(['event-pump','session-open','disconnect','session-close','handlers','callback-unregister','sdk-terminate','library-unload','com-uninitialize','release','capture','cleanup','shutdown','download','reference','teardown','initialize','orientation-enable','orientation-start','orientation-stop','orientation-frame','accessory-command','accessory-status']);
const OPERATIONS=new Set(['shutdown','disconnect','connect','listCameras','sdkEnvironment','diagnoseCamera','destination','live','capture','focus','autofocus','property','listCard','importCard','finalizeShutdown','event-pump','initialize','native','flashPopup','bulbStart','bulbStop']);
const boundedCode=value=>typeof value==='number'&&Number.isInteger(value)&&value>=-0x80000000&&value<=0xffffffff?value:null;
const errorCode=error=>boundedCode(error?.code)??(typeof error?.code==='string'&&/^[A-Z][A-Z0-9_]{0,47}$/.test(error.code)?error.code:'JS_EXCEPTION');
const clone=value=>JSON.parse(JSON.stringify(value));
function createNativeObservations({limit=32}={}){
  if(!Number.isInteger(limit)||limit<1||limit>128)throw TypeError('Observation limit must be 1..128.');
  const entries=[],groups=new Map();let total=0,dropped=0,droppedFailures=0,primary=null,hasFailures=false;
  function append(input,thrown=false){
    const kind=thrown?'exception':['EdsRetain','EdsRelease'].includes(input.method)||input.kind==='reference-count'?'reference-count':input.kind==='void'?'void':input.kind==='boolean'?'boolean':'error-code';
    const code=thrown?errorCode(input.error):kind==='boolean'&&typeof input.code==='boolean'?input.code:boundedCode(input.code);
    const failure=thrown||kind==='error-code'&&code!==0||kind==='reference-count'&&(code===null||code===0xffffffff)||kind==='boolean'&&code!==true&&code!==1;
    const value={operation:OPERATIONS.has(input.operation)?input.operation:'native',
      operationId:typeof input.operationId==='string'&&/^[A-Za-z0-9_.:-]{1,96}$/.test(input.operationId)?input.operationId:null,
      phase:PHASES.has(input.phase)?input.phase:'unknown',method:METHODS.has(input.method)?input.method:'UNKNOWN_METHOD',
      kind,code,classification:failure?'UNKNOWN':kind==='reference-count'?'REFERENCE_COUNT':kind==='void'?'OBSERVED':kind==='boolean'?'SOURCE_TRUE':'SOURCE_ZERO',failure};
    total=Math.min(Number.MAX_SAFE_INTEGER,total+1);hasFailures||=failure;
    const key=JSON.stringify(value);let entry=groups.get(key);
    if(entry)entry.count=Math.min(Number.MAX_SAFE_INTEGER,entry.count+1);
    else{
      entry={...value,firstObservation:total,count:1};
      // Successful pump/refcount observations must not consume all room before
      // the first teardown error. Remaining overflow is explicit, never silent.
      if(failure&&entries.length>=limit){
        const index=entries.findIndex(item=>!item.failure);
        if(index>=0){const [evicted]=entries.splice(index,1);for(const [group,item]of groups)if(item===evicted){groups.delete(group);break;}dropped=Math.min(Number.MAX_SAFE_INTEGER,dropped+evicted.count);}
      }
      if(entries.length<limit){entries.push(entry);groups.set(key,entry);}
      else{dropped=Math.min(Number.MAX_SAFE_INTEGER,dropped+1);if(failure)droppedFailures=Math.min(Number.MAX_SAFE_INTEGER,droppedFailures+1);}
    }
    if(failure&&!primary)primary=entry;
    return clone(entry);
  }
  return {
    observe:input=>append(input||{}),
    failure:input=>append(input||{},true),
    snapshot:()=>clone({observations:entries,primaryFailure:primary,cleanupFailures:entries.filter(entry=>entry.failure&&entry!==primary),hasFailures,totalObservations:total,droppedObservations:dropped,droppedFailures,limit})
  };
}
module.exports={createNativeObservations};
