// Pure injected producer-first shutdown. No SDK, filesystem or process imports.
// Ports must preserve native call order; only a proved fence/close permits CLOSED.
const copy=value=>JSON.parse(JSON.stringify(value));
const proved=value=>value?.proof==='synthetic'||value?.proof==='vendor-confirmed'||value?.proof==='native-not-started'&&value?.nativeStarted===false;
const safeCode=error=>typeof error?.code==='number'&&Number.isInteger(error.code)?error.code:
  typeof error?.code==='string'&&/^[A-Z][A-Z0-9_]{0,47}$/.test(error.code)?error.code:'PORT_FAILED';
function createShutdownCoordinator({clock={now:Date.now,setTimeout,clearTimeout},budgetMs=8000,diagnosticMs=250,
  stopAdmission,requestCancellation,fenceProducers,drainConsumers,persist,closeWorker,forceWorker,recordDiagnostic}){
  if(!Number.isInteger(budgetMs)||budgetMs<4||budgetMs>60000||!Number.isInteger(diagnosticMs)||diagnosticMs<1||diagnosticMs>250)throw TypeError('Shutdown budgets are invalid.');
  if(['now','setTimeout','clearTimeout'].some(key=>typeof clock?.[key]!=='function')||[stopAdmission,requestCancellation,fenceProducers,drainConsumers,persist,closeWorker,forceWorker,recordDiagnostic].some(port=>typeof port!=='function'))throw TypeError('Shutdown requires explicit clock and lifecycle ports.');
  let phase='OPEN',pending=null,result=null,started=null,deadline=null,forced=false;
  const errors=[],phases=[];let fence=null,worker=null;
  function enter(value){phase=value;if(phases.length<16)phases.push({phase:value,elapsedMs:Math.max(0,clock.now()-started)});}
  function failure(at,operation,code,kind){const item={phase:at,operation,code,kind};if(errors.length<16)errors.push(item);return item;}
  function step(at,operation,port,until,context={}){
    enter(at);
    const remaining=until-clock.now();
    if(remaining<=0){failure(at,operation,'DEADLINE_EXHAUSTED','deadline');return Promise.resolve({ok:false});}
    return new Promise(resolve=>{
      let settled=false,timer;
      const finish=value=>{if(settled)return;settled=true;clock.clearTimeout(timer);if(!value.ok)failure(at,operation,value.code,value.kind);resolve(value);};
      timer=clock.setTimeout(()=>finish({ok:false,code:'PHASE_DEADLINE',kind:'timeout'}),remaining);
      try{Promise.resolve(port({deadline:until,overallDeadline:deadline,...context})).then(value=>finish({ok:true,value}),error=>finish({ok:false,code:safeCode(error),kind:'rejected'}));}
      catch(error){finish({ok:false,code:safeCode(error),kind:'rejected'});}
    });
  }
  function fenceSummary(value){return {drained:value?.drained===true,lastPhotoSequence:Number.isSafeInteger(value?.lastPhotoSequence)&&value.lastPhotoSequence>=0?value.lastPhotoSequence:null,proof:proved(value)?value.proof:'unknown',nativeStarted:typeof value?.nativeStarted==='boolean'?value.nativeStarted:null};}
  function workerSummary(value){return {closed:value?.closed===true,proof:proved(value)?value.proof:'unknown',nativeStarted:typeof value?.nativeStarted==='boolean'?value.nativeStarted:null};}
  async function force(reason){
    if(forced)return;forced=true;
    // The force reserve is inside the total budget. A delayed event loop must
    // still issue the owned-worker kill, but cannot claim its acknowledgement.
    if(clock.now()>=deadline){
      enter('FORCING_WORKER');failure('FORCING_WORKER','forceWorker','FORCE_NOT_ACKNOWLEDGED','deadline');
      try{Promise.resolve(forceWorker({deadline,reason})).catch(()=>{});}catch{}
      return;
    }
    const forcedResult=await step('FORCING_WORKER','forceWorker',forceWorker,Math.min(deadline,clock.now()+forceReserve),{reason});
    if(forcedResult.ok&&forcedResult.value?.terminated!==true&&forcedResult.value?.closed!==true)failure('FORCING_WORKER','forceWorker','FORCE_NOT_ACKNOWLEDGED','unproven');
  }
  let forceReserve;
  function receipt(outcome){return {outcome,phase:outcome,forced,startedAt:started,deadline,elapsedMs:Math.max(0,clock.now()-started),deadlineExceeded:clock.now()>deadline,
    fence:fenceSummary(fence),worker:workerSummary(worker),errors:copy(errors),primaryFailure:errors[0]?copy(errors[0]):null,cleanupFailures:copy(errors.slice(1)),phases:copy(phases)};}
  async function run(){
    started=clock.now();deadline=started+budgetMs;
    forceReserve=Math.max(1,Math.min(250,Math.floor(budgetMs/8)));
    const producerDeadline=started+Math.floor(budgetMs/2),workDeadline=deadline-forceReserve;
    // Invocations are ordered, but asynchronous Remote/watcher closure must not
    // hold emergency cancellation/release behind its promise.
    const stopping=step('STOP_NEW_ADMISSION','stopAdmission',stopAdmission,producerDeadline);
    const cancelling=step('CANCELLING','requestCancellation',requestCancellation,producerDeadline);
    const [stopResult]=await Promise.all([stopping,cancelling]);
    const fenced=await step('DRAINING_PRODUCERS','fenceProducers',fenceProducers,producerDeadline);
    fence=fenced.ok?fenced.value:null;
    const drained=fence?.drained===true,producerProof=drained&&proved(fence);
    if(fenced.ok&&!drained)failure('DRAINING_PRODUCERS','fenceProducers','PRODUCER_NOT_FENCED','unproven');
    else if(drained&&!proved(fence))failure('DRAINING_PRODUCERS','fenceProducers','PRODUCER_PROOF_UNKNOWN','unproven');
    if(!stopResult.ok||stopResult.value===false||!drained){
      if(stopResult.ok&&stopResult.value===false)failure('STOP_NEW_ADMISSION','stopAdmission','ADMISSION_NOT_CLOSED','unproven');
      await force('PRODUCER_NOT_FENCED');
    }
    const consumed=await step('DRAINING_CONSUMERS','drainConsumers',drainConsumers,workDeadline,{fence,producerUnknown:!producerProof,forced});
    const consumerProof=consumed.ok&&consumed.value?.drained===true;
    if(consumed.ok&&!consumerProof)failure('DRAINING_CONSUMERS','drainConsumers','CONSUMERS_NOT_DRAINED','unproven');
    const persisted=await step('PERSISTING','persist',persist,workDeadline,{producerUnknown:!producerProof,forced});
    if(persisted.ok&&persisted.value===false)failure('PERSISTING','persist','PERSIST_NOT_ACKNOWLEDGED','unproven');
    let workerProof=false;
    if(!forced){
      const closed=await step('CLOSING_WORKER','closeWorker',closeWorker,workDeadline);
      worker=closed.ok?closed.value:null;workerProof=worker?.closed===true&&proved(worker);
      if(closed.ok&&!workerProof)failure('CLOSING_WORKER','closeWorker','WORKER_PROOF_UNKNOWN','unproven');
      if(!closed.ok||worker?.closed!==true)await force('WORKER_NOT_CLOSED');
    }
    const outcome=!forced&&producerProof&&consumerProof&&workerProof&&!errors.length?'CLOSED':'UNKNOWN_TERMINATION';
    if(outcome==='UNKNOWN_TERMINATION'){
      // The only time beyond the absolute work deadline: one <=250 ms bounded
      // diagnostic port. It receives no file paths, raw error messages or bytes.
      await step('RECORDING_DIAGNOSTIC','recordDiagnostic',()=>recordDiagnostic(receipt(outcome)),clock.now()+diagnosticMs);
    }
    enter(outcome);result=receipt(outcome);return copy(result);
  }
  function close(){
    if(pending)return pending;
    let resolve;
    // Allocate the singleflight promise before invoking any re-entrant port.
    pending=new Promise(done=>{resolve=done;});
    run().catch(async error=>{
      failure(phase,'coordinator',safeCode(error),'rejected');
      if(deadline!==null)await force('PRODUCER_NOT_FENCED');
      await step('RECORDING_DIAGNOSTIC','recordDiagnostic',()=>recordDiagnostic(receipt('UNKNOWN_TERMINATION')),clock.now()+diagnosticMs);
      enter('UNKNOWN_TERMINATION');result=receipt('UNKNOWN_TERMINATION');return copy(result);
    }).then(resolve);
    return pending;
  }
  return {close,getState:()=>({phase,startedAt:started,deadline,outcome:result?.outcome||null,result:result?copy(result):null})};
}
module.exports={createShutdownCoordinator};
