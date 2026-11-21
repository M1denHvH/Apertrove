// Main-side retirement of one exact worker generation. Replacement is admitted
// by the caller only after CLOSED; UNKNOWN is sticky and never starts a worker.
const {createShutdownCoordinator}=require('./shutdown-coordinator.cjs');
const fault=code=>Object.assign(Error(code),{code});
function createWorkerRetirement({channel,drainConsumers,persist,recordDiagnostic,onUnknown=()=>{},
  budgetMs=8000,diagnosticMs=250,clock={now:Date.now,setTimeout,clearTimeout}}){
  if(!channel||typeof channel.generation!=='string'||!channel.generation||
    ['call','snapshot','whenIdle','closeAdmission','cancelAll','terminate'].some(name=>typeof channel.rpc?.[name]!=='function')||
    ['fence','drain','snapshot'].some(name=>typeof channel.consumer?.[name]!=='function')||
    typeof channel.process?.kill!=='function'||typeof channel.exitPromise?.then!=='function'||
    [drainConsumers,persist,recordDiagnostic,onUnknown].some(port=>typeof port!=='function'))throw TypeError('Worker retirement requires an exact channel and explicit accounting ports.');
  let pending=null,result=null,quarantined=false;
  function unknown(receipt){
    if(quarantined)return;quarantined=true;
    try{const observation=onUnknown({...receipt,generation:channel.generation});if(observation&&typeof observation.then==='function')Promise.resolve(observation).catch(()=>{});}catch{}
  }
  function live(){if(channel.exited||channel.rpc.snapshot().terminated)throw fault('WORKER_EXIT_UNFENCED');}
  function request(method,deadline){live();return channel.rpc.call(method,{}, {timeoutMs:Math.max(1,deadline-clock.now())});}
  function producerIssues(value){return !!value?.transfers?.failed||!!value?.transfers?.issues?.length;}
  function consumerReceipt(){
    const value=channel.consumer.snapshot();
    if(value.pending!==0||value.issues?.length)throw fault('LIFECYCLE_ACCOUNTING_UNKNOWN');
    return value;
  }
  async function drain(){
    await channel.consumer.drain();const receipt=await drainConsumers();await channel.consumer.drain();
    if(receipt===false||receipt?.drained===false)throw fault('CONSUMERS_NOT_DRAINED');
    consumerReceipt();return {drained:true};
  }
  async function drainAndPersist(){
    let failure;try{await drain();}catch(error){failure=error;}
    try{if(await persist()===false)throw fault('PERSIST_NOT_ACKNOWLEDGED');}catch(error){failure??=error;}
    if(failure)throw failure;
  }
  const coordinator=createShutdownCoordinator({clock,budgetMs,diagnosticMs,
    stopAdmission:()=>{channel.retiring=true;channel.rpc.closeAdmission();return true;},
    requestCancellation:({deadline})=>{live();channel.rpc.cancelAll();return request('burstStop',deadline);},
    fenceProducers:async({deadline})=>{
      await channel.rpc.whenIdle({exclusiveOnly:false});live();
      const fence=await request('producerFence',deadline);channel.consumer.fence(fence?.lastPhotoSequence);
      if(producerIssues(fence))throw fault('TRANSFER_PRODUCER_UNKNOWN');
      return fence;
    },
    drainConsumers:drain,persist,
    closeWorker:async({deadline})=>{
      live();channel.finalizing=true;
      const receipt=await request('finalizeShutdown',deadline);await channel.exitPromise;
      // Exit can expose already-sent callbacks. Keep this generation's consumer
      // alive and commit all known registrations even if the final check fails.
      await drainAndPersist();
      if(!channel.exited||channel.exitCode!==0||receipt?.closed!==true||receipt.lastPhotoSequence!==consumerReceipt().frontier||
        receipt.observations?.hasFailures||producerIssues(receipt)||channel.issue)throw fault('WORKER_CLOSE_UNKNOWN');
      return receipt;
    },
    forceWorker:async()=>{
      channel.forced=true;channel.rpc.terminate();
      if(!channel.exited){channel.process.kill();await channel.exitPromise;}
      return {terminated:channel.exited===true};
    },
    recordDiagnostic:receipt=>{unknown(receipt);return recordDiagnostic({...receipt,generation:channel.generation});}
  });
  function close(){
    if(pending)return pending;
    // Allocate before invoking ports so re-entrant and repeated requests share
    // the exact same completion and never run teardown a second time.
    let resolve;pending=new Promise(done=>{resolve=done;});
    coordinator.close().then(receipt=>{
      result={...receipt,generation:channel.generation};channel.retirementReceipt=result;
      if(result.outcome!=='CLOSED')unknown(result);
      resolve(result);
    });
    return pending;
  }
  return {close,getState:()=>({...coordinator.getState(),generation:channel.generation,quarantined,result:result?JSON.parse(JSON.stringify(result)):null})};
}
module.exports={createWorkerRetirement};
