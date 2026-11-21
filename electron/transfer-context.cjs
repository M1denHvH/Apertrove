// Immutable delivery identity. An SDK object callback is not an app capture key.
// Route epochs are caller assertions, not proof of native callback quiescence.
function createTransferContexts({recoveryDestination,newId}={}){
  if(typeof recoveryDestination!=='string'||!recoveryDestination||typeof newId!=='function')throw TypeError('Explicit recovery destination and identity factory required.');
  const scope=newId();
  if(typeof scope!=='string'||!scope||scope.length>128||/[\r\n\0]/.test(scope))throw TypeError('Invalid transfer identity scope.');
  let route=null,revision=0,sequence=0,tainted=false,captureHistory=false,active=null,lastSettled=null;
  const freeze=value=>{
    if(value&&typeof value==='object'){
      for(const child of Object.values(value))freeze(child);
      Object.freeze(value);
    }
    return value;
  };
  function failure(code,message){const error=Error(message);error.code=code;return error;}
  function epoch(value){if(!Number.isSafeInteger(value)||value<0)throw failure('TRANSFER_CONTEXT_INVALID','A nonnegative native session epoch is required.');return value;}
  function identity(value,optional=false){
    if(optional&&(value===undefined||value===null))return null;
    if(typeof value!=='string'||!value||value.length>256||/[\r\n\0]/.test(value))throw failure('TRANSFER_CONTEXT_INVALID','Invalid operation or capture intent identity.');
    return value;
  }
  function ready(expected){
    if(!route)throw failure('TRANSFER_CONTEXT_NOT_READY','A delivery route has not been established.');
    if(expected!==undefined&&epoch(expected)!==route.sessionEpoch)throw failure('TRANSFER_STALE_EPOCH','The callback belongs to a different native session epoch.');
  }
  function snapshot(){
    return freeze({route:route?{...route}:null,routeRevision:revision,recoveryRoute:tainted||!!route&&!route.destination,captureHistory,
      activeIntent:active?{...active}:null,lastSettledIntent:lastSettled?{...lastSettled}:null,nativeQuiescence:'UNVERIFIED'});
  }
  function setRoute({sessionEpoch,sessionId=null,destination}={}){
    const next={sessionEpoch:epoch(sessionEpoch),sessionId:identity(sessionId,true),destination};
    if(typeof destination!=='string'||/[\r\n\0]/.test(destination))throw failure('TRANSFER_CONTEXT_INVALID','Invalid delivery destination.');
    if(route&&next.sessionEpoch<route.sessionEpoch)throw failure('TRANSFER_STALE_EPOCH','An older native session cannot replace the delivery route.');
    const newEpoch=!route||next.sessionEpoch!==route.sessionEpoch;
    const changed=!route||newEpoch||next.sessionId!==route.sessionId||next.destination!==route.destination;
    if(!changed)return snapshot();
    if(newEpoch){
      // A logical epoch is not a callback origin key. Once a prior delivery
      // route existed, reconnect alone cannot prove old SDK objects quiescent.
      tainted=tainted||!!route&&(!!route.destination||!!route.sessionId||captureHistory);
      if(!tainted)captureHistory=false;active=null;lastSettled=null;
    }
    else{
      // A physical shutter may have started a transfer even without app intent.
      // No quiet window, consumer timeout or next capture clears this ambiguity.
      tainted=true;
    }
    if(!Number.isSafeInteger(revision+1))throw failure('TRANSFER_ID_EXHAUSTED','Delivery route revision exhausted.');
    revision++;route=freeze(next);return snapshot();
  }
  function noteCapture({operationId,captureId=null,sessionEpoch}={}){
    ready(sessionEpoch);
    const next=freeze({operationId:identity(operationId),captureId:identity(captureId,true),sessionEpoch:route.sessionEpoch,phase:'ACCEPTED',observationOnly:true});
    active=next;captureHistory=true;
    return active;
  }
  function settleCapture(operationId,{outcome='UNVERIFIED'}={}){
    const id=identity(operationId);
    if(!active||active.operationId!==id)return false;
    if(typeof outcome!=='string'||outcome.length>64||/[\r\n\0]/.test(outcome))throw failure('TRANSFER_CONTEXT_INVALID','Invalid observed capture outcome.');
    lastSettled=freeze({...active,phase:'SETTLED',outcome,confirmation:'UNVERIFIED'});active=null;
    // Intent handler settlement says nothing about a delayed RAW/JPEG object.
    return true;
  }
  function admit({sessionEpoch}={}){
    // Require the epoch captured by the callback; never coerce stale/missing input.
    if(sessionEpoch===undefined)throw failure('TRANSFER_CONTEXT_INVALID','The admitted callback must identify its native session epoch.');
    ready(sessionEpoch);
    if(!Number.isSafeInteger(sequence+1))throw failure('TRANSFER_ID_EXHAUSTED','Transfer identity sequence exhausted.');
    const recoveryRoute=tainted||!route.destination;
    const attribution=tainted||captureHistory?'AMBIGUOUS':'EXTERNAL';
    return freeze({transferId:`${scope}:${++sequence}`,sessionEpoch:route.sessionEpoch,routeRevision:revision,
      sessionId:recoveryRoute?null:route.sessionId,destination:recoveryRoute?recoveryDestination:route.destination,
      operationType:'SDK_TRANSFER',operationId:null,captureId:null,phase:'ADMITTED',attribution,correlation:'UNCONFIRMED',confirmation:'UNVERIFIED',recoveryRoute,
      reason:tainted?'ROUTE_BOUNDARY_WITHOUT_CORRELATION':!route.destination?'DELIVERY_DESTINATION_MISSING':captureHistory?'CAPTURE_KEY_UNAVAILABLE':'NO_APP_CAPTURE_INTENT',
      activeIntentAtAdmission:active?{...active}:null});
  }
  return {setRoute,noteCapture,settleCapture,admit,snapshot};
}
module.exports={createTransferContexts};
