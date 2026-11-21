// Transport ownership, independent of Electron, SDK bindings and filesystem ports.
// A consumer deadline never proves producer completion or native cancellation.
const SAFETY_METHODS=Object.freeze(['status','burstStop','servoStop','bulbStop','producerFence','finalizeShutdown']);
const TERMINAL_STATES=Object.freeze(['COMPLETED','FAILED','CANCELLED','UNKNOWN_TERMINATION']);
const safetyDefault=method=>SAFETY_METHODS.includes(method);
const exclusiveDefault=method=>!safetyDefault(method);
const validMethod=method=>typeof method==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(method);
function operationError(code,message){const error=Error(message);error.code=code;return error;}
function generationCheck(generation){if(typeof generation!=='string'||!/^[A-Za-z0-9._:-]{1,96}$/.test(generation))throw TypeError('An explicit worker generation is required.');}
function epoch(getSessionEpoch){const value=getSessionEpoch();if(value!==null&&(!Number.isSafeInteger(value)||value<0))throw operationError('OPERATION_CONTEXT_INVALID','Invalid native session epoch.');return value;}
function errorCode(error){const value=error?.code;return typeof value==='string'&&/^[A-Z][A-Z0-9_]{0,47}$/.test(value)||typeof value==='number'&&Number.isFinite(value)?value:undefined;}
function errorWire(error){let message;try{message=String(error?.message||'Camera operation failed.').slice(0,1024);}catch{message='Camera operation failed.';}return {message,...(errorCode(error)!==undefined?{code:errorCode(error)}:{})};}
function recordView(record){return {generation:record.generation,requestId:record.requestId,operationId:record.operationId,sequence:record.sequence,method:record.method,sessionEpoch:record.sessionEpoch,nativeSessionEpoch:record.nativeSessionEpoch??null,state:record.state,exclusive:record.exclusive,cancelRequested:record.cancelRequested,cancellationSupported:record.cancellationSupported??null,consumerSettled:record.consumerSettled??false,releases:record.releases,...(record.errorCode!==undefined?{errorCode:record.errorCode}:{})};}
function envelope(record,kind){return {type:'operation',kind,generation:record.generation,requestId:record.requestId,operationId:record.operationId,sequence:record.sequence,method:record.method,sessionEpoch:record.sessionEpoch};}
function sameEnvelope(record,message){return record&&message.generation===record.generation&&message.requestId===record.requestId&&message.operationId===record.operationId&&message.sequence===record.sequence&&message.method===record.method&&message.sessionEpoch===record.sessionEpoch;}
function validRequest(message,generation){return message.generation===generation&&Number.isSafeInteger(message.sequence)&&message.sequence>0&&validMethod(message.method)&&message.requestId===`${generation}:request:${message.sequence}`&&message.operationId===`${generation}:operation:${message.sequence}`&&(message.sessionEpoch===null||Number.isSafeInteger(message.sessionEpoch)&&message.sessionEpoch>=0);}
function idle(active,{exclusiveOnly=true,excludeOperationId}={}){return ![...active.values()].some(record=>record.operationId!==excludeOperationId&&(!exclusiveOnly||record.exclusive));}

function createOperationClient({generation,send,clock=globalThis,getSessionEpoch=()=>null,isExclusive=exclusiveDefault,isSafetyMethod=safetyDefault,onChange=()=>{}}){
  generationCheck(generation);
  if([send,getSessionEpoch,isExclusive,isSafetyMethod,onChange,clock?.setTimeout,clock?.clearTimeout].some(fn=>typeof fn!=='function'))throw TypeError('Operation client requires explicit transport, clock and policy functions.');
  const schedule=clock.setTimeout.bind(clock),clear=clock.clearTimeout.bind(clock),active=new Map(),history=[],waiters=new Set();
  let sequence=0,admissionOpen=true,terminated=false;
  const diagnostics={ignoredMessages:0,observerFailures:0,transportFailures:0,clockFailures:0,completedOperations:0};
  const snapshot=()=>({generation,admissionOpen,terminated,operations:[...active.values()].map(recordView),history:history.map(record=>({...record})),diagnostics:{...diagnostics}});
  function observerFailed(){diagnostics.observerFailures++;}
  function notify(){try{const observation=onChange(snapshot());if(observation&&typeof observation.then==='function')Promise.resolve(observation).catch(observerFailed);}catch{observerFailed();}}
  function releaseWaiters(){for(const waiter of [...waiters])if(idle(active,waiter.options)){waiters.delete(waiter);waiter.resolve(snapshot());}}
  function consumer(record,error,result){if(record.consumerSettled)return;record.consumerSettled=true;if(record.timer!==null){try{clear(record.timer);}catch{diagnostics.clockFailures++;}record.timer=null;}error?record.reject(error):record.resolve(result);}
  function finish(record,state,error,result){
    if(active.get(record.operationId)!==record)return false;
    active.delete(record.operationId);record.state=state;record.releases++;record.errorCode=errorCode(error);
    consumer(record,error,result);history.push(recordView(record));if(history.length>64)history.shift();diagnostics.completedOperations++;
    releaseWaiters();notify();return true;
  }
  function terminate(){
    if(terminated&&!active.size)return;
    admissionOpen=false;terminated=true;
    for(const record of [...active.values()])finish(record,'UNKNOWN_TERMINATION',operationError('OPERATION_UNKNOWN_TERMINATION','The worker operation ended without a verified producer acknowledgement.'));
    releaseWaiters();notify();
  }
  function deliveryFailed(){diagnostics.transportFailures++;terminate();}
  function transmit(message){try{const delivery=send(message);if(delivery&&typeof delivery.then==='function')Promise.resolve(delivery).catch(deliveryFailed);return true;}catch{deliveryFailed();return false;}}
  function cancel(record){
    if(active.get(record.operationId)!==record||record.cancelRequested)return;
    record.cancelRequested=true;record.state='CANCELLING';notify();
    if(active.get(record.operationId)===record&&!terminated)transmit(envelope(record,'cancel'));
  }
  function call(method,args={}, {timeoutMs=20000}={}){
    let exclusive,requestEpoch;
    try{
      if(!validMethod(method))throw operationError('OPERATION_METHOD_INVALID','Invalid camera operation.');
      if(terminated||!admissionOpen&&!isSafetyMethod(method))throw operationError('OPERATION_ADMISSION_CLOSED','New camera operations are no longer admitted.');
      exclusive=!!isExclusive(method);
      if(exclusive&&[...active.values()].some(record=>record.exclusive))throw operationError('OPERATION_BUSY','The previous camera operation is still running or draining.');
      if(active.size>=128)throw operationError('OPERATION_BUSY','The camera operation limit has been reached.');
      if(!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>86400000)throw operationError('OPERATION_DEADLINE_INVALID','A bounded camera request deadline is required.');
      if(sequence>=Number.MAX_SAFE_INTEGER)throw operationError('OPERATION_ID_EXHAUSTED','Worker operation identities are exhausted.');
      requestEpoch=epoch(getSessionEpoch);
    }catch(error){return Promise.reject(error);}
    const number=++sequence;let resolve,reject;
    const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
    const record={generation,requestId:`${generation}:request:${number}`,operationId:`${generation}:operation:${number}`,sequence:number,method,sessionEpoch:requestEpoch,nativeSessionEpoch:null,state:'ADMITTED',exclusive,cancelRequested:false,consumerSettled:false,releases:0,timer:null,resolve,reject};
    active.set(record.operationId,record);notify();
    if(active.get(record.operationId)===record&&!terminated&&transmit({...envelope(record,'request'),args})){
      // Synchronous fixture replies can already have completed this operation.
      if(active.get(record.operationId)===record&&!record.consumerSettled){
        try{record.timer=schedule(()=>{record.timer=null;if(active.get(record.operationId)!==record)return;consumer(record,operationError('OPERATION_TIMEOUT','The camera request timed out; its operation remains owned until the producer acknowledges completion.'));cancel(record);},timeoutMs);}
        catch{diagnostics.clockFailures++;terminate();}
      }
    }
    return promise;
  }
  function receive(message){
    if(!message||message.type!=='operation')return false;
    const record=active.get(message.operationId);
    if(!sameEnvelope(record,message)){diagnostics.ignoredMessages++;return false;}
    if(message.nativeSessionEpoch===null||Number.isSafeInteger(message.nativeSessionEpoch)&&message.nativeSessionEpoch>=0)record.nativeSessionEpoch=message.nativeSessionEpoch;
    if(message.kind==='started'){
      if(record.state==='ADMITTED')record.state='RUNNING';notify();return true;
    }
    if(message.kind==='cancelAck'){
      record.cancellationSupported=message.supported===true;
      if(record.cancelRequested)record.state=message.supported===true?'CANCELLING':'DRAINING';notify();return true;
    }
    if(message.kind==='terminal'&&TERMINAL_STATES.includes(message.state)){
      if(message.state==='UNKNOWN_TERMINATION'){admissionOpen=false;finish(record,'UNKNOWN_TERMINATION',operationError('OPERATION_UNKNOWN_TERMINATION','The producer outcome is unknown. New camera operations are blocked.'));return true;}
      let error;
      if(message.state!=='COMPLETED'){error=operationError(message.error?.code??(message.state==='CANCELLED'?'OPERATION_CANCELLED':'OPERATION_FAILED'),String(message.error?.message||'Camera operation failed.'));}
      finish(record,message.state,error,message.result);return true;
    }
    diagnostics.ignoredMessages++;return false;
  }
  return {call,receive,snapshot,hasOutstanding:options=>!idle(active,options),closeAdmission(){if(!admissionOpen)return;admissionOpen=false;notify();},cancelMethod(method){let count=0;for(const record of [...active.values()])if(record.method===method){cancel(record);count++;}return count;},cancelAll(){for(const record of [...active.values()])cancel(record);},terminate,whenIdle(options={}){if(idle(active,options))return Promise.resolve(snapshot());return new Promise(resolve=>waiters.add({options:{...options},resolve}));}};
}

function createOperationHost({generation,handlers,send,getSessionEpoch=()=>null,isExclusive=exclusiveDefault,isSafetyMethod=safetyDefault,isCancellable=method=>method==='importCard',onChange=()=>{}}){
  generationCheck(generation);
  if(!handlers||typeof handlers!=='object'||[send,getSessionEpoch,isExclusive,isSafetyMethod,isCancellable,onChange].some(fn=>typeof fn!=='function'))throw TypeError('Operation host requires explicit handlers, transport and policy functions.');
  const active=new Map(),history=[],waiters=new Set();let highestSequence=0,admissionOpen=true;
  const diagnostics={ignoredMessages:0,replayedRequests:0,observerFailures:0,transportFailures:0,contextFailures:0,completedOperations:0};
  const snapshot=()=>({generation,admissionOpen,highestSequence,operations:[...active.values()].map(recordView),history:history.map(record=>({...record})),diagnostics:{...diagnostics}});
  function observerFailed(){diagnostics.observerFailures++;}
  function notify(){try{const observation=onChange(snapshot());if(observation&&typeof observation.then==='function')Promise.resolve(observation).catch(observerFailed);}catch{observerFailed();}}
  function releaseWaiters(){for(const waiter of [...waiters])if(idle(active,waiter.options)){waiters.delete(waiter);waiter.resolve(snapshot());}}
  function deliveryFailed(){diagnostics.transportFailures++;admissionOpen=false;notify();}
  function transmit(message){try{const delivery=send(message);if(delivery&&typeof delivery.then==='function')Promise.resolve(delivery).catch(deliveryFailed);return true;}catch{deliveryFailed();return false;}}
  function currentEpoch(){try{return epoch(getSessionEpoch);}catch{diagnostics.contextFailures++;return null;}}
  function finish(record,state,error,result){
    if(record.finished)return;record.finished=true;active.delete(record.operationId);record.state=state;record.releases++;record.errorCode=errorCode(error);
    history.push(recordView(record));if(history.length>64)history.shift();diagnostics.completedOperations++;
    const message={...envelope(record,'terminal'),nativeSessionEpoch:currentEpoch(),state};
    if(state==='COMPLETED')message.result=result;else message.error=errorWire(error);
    transmit(message);releaseWaiters();notify();
  }
  async function receive(message){
    if(!message||message.type!=='operation')return false;
    if(!validRequest(message,generation)){diagnostics.ignoredMessages++;return true;}
    if(message.kind==='cancel'){
      const record=active.get(message.operationId);
      if(!sameEnvelope(record,message)){diagnostics.ignoredMessages++;return true;}
      record.cancelRequested=true;record.state=record.cancellationSupported?'CANCELLING':'DRAINING';
      transmit({...envelope(record,'cancelAck'),nativeSessionEpoch:currentEpoch(),supported:record.cancellationSupported});notify();return true;
    }
    if(message.kind!=='request'){diagnostics.ignoredMessages++;return true;}
    // Never reply terminal to a replay of an active request: that would falsely
    // release its real owner. A high-water mark survives bounded history pruning.
    if(message.sequence<=highestSequence){diagnostics.replayedRequests++;return true;}
    highestSequence=message.sequence;
    const record={generation,requestId:message.requestId,operationId:message.operationId,sequence:message.sequence,method:message.method,sessionEpoch:message.sessionEpoch,nativeSessionEpoch:null,state:'ADMITTED',exclusive:false,cancelRequested:false,cancellationSupported:false,releases:0,finished:false};
    let handler;
    try{
      if(!admissionOpen&&!isSafetyMethod(record.method))throw operationError('OPERATION_ADMISSION_CLOSED','New camera operations are no longer admitted.');
      if(!Object.hasOwn(handlers,record.method)||typeof handlers[record.method]!=='function')throw operationError('OPERATION_METHOD_INVALID','Unknown camera operation.');
      handler=handlers[record.method];record.exclusive=!!isExclusive(record.method);record.cancellationSupported=!!isCancellable(record.method);
      if(record.exclusive&&[...active.values()].some(other=>other.exclusive))throw operationError('OPERATION_BUSY','The previous camera operation is still running or draining.');
      if(active.size>=128)throw operationError('OPERATION_BUSY','The camera operation limit has been reached.');
      record.nativeSessionEpoch=epoch(getSessionEpoch);
      if(!isSafetyMethod(record.method)&&record.sessionEpoch!==record.nativeSessionEpoch)throw operationError('OPERATION_STALE_SESSION','The native session changed before operation admission.');
    }catch(error){finish(record,'FAILED',error);return true;}
    active.set(record.operationId,record);record.state='RUNNING';notify();
    if(!transmit({...envelope(record,'started'),nativeSessionEpoch:record.nativeSessionEpoch})){finish(record,'UNKNOWN_TERMINATION',operationError('OPERATION_UNKNOWN_TERMINATION','The producer could not acknowledge operation admission.'));return true;}
    const cancellation=Object.freeze({get requested(){return record.cancelRequested;},get supported(){return record.cancellationSupported;},throwIfRequested(){if(record.cancelRequested&&record.cancellationSupported)throw operationError('OPERATION_CANCELLED','The operation acknowledged cancellation at a cooperative checkpoint.');}});
    const context=Object.freeze({generation,requestId:record.requestId,operationId:record.operationId,sequence:record.sequence,sessionEpoch:record.nativeSessionEpoch,requestSessionEpoch:record.sessionEpoch,cancellation});
    let result,failure,failed=false;
    try{result=await handler(message.args||{},context);}catch(error){failed=true;failure=error||operationError('OPERATION_FAILED','Camera operation failed.');}
    // Await includes the handler's finally blocks. A mere cancel request never
    // settles ownership, and the event pump remains outside this admission gate.
    if(failed){const code=errorCode(failure);if(code==='OPERATION_UNKNOWN_TERMINATION')admissionOpen=false;finish(record,code==='OPERATION_CANCELLED'?'CANCELLED':code==='OPERATION_UNKNOWN_TERMINATION'?'UNKNOWN_TERMINATION':'FAILED',failure);}else finish(record,'COMPLETED',null,result);
    return true;
  }
  return {receive,snapshot,stopAdmission(){if(!admissionOpen)return;admissionOpen=false;notify();},hasOutstanding:options=>!idle(active,options),whenIdle(options={}){if(idle(active,options))return Promise.resolve(snapshot());return new Promise(resolve=>waiters.add({options:{...options},resolve}));}};
}

module.exports={createOperationClient,createOperationHost,operationError,SAFETY_METHODS,TERMINAL_STATES};
