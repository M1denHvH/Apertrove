// Deferred callback ownership. Native retain/release ordering stays at these ports.
function createTransferProducer({contexts,getEpoch,getSdk,isConnected,download,schedule=setImmediate,onIssue=()=>{}}){
  if(!contexts||[getEpoch,getSdk,isConnected,download,schedule].some(fn=>typeof fn!=='function'))throw TypeError('Explicit transfer producer ports required.');
  const pending=new Set(),issues=[];let accepted=0,completed=0,failed=0,fenced=false;
  function issue(code,context){if(!issues.includes(code)&&issues.length<32)issues.push(code);try{onIssue({code,transferId:context?.transferId||null});}catch{}}
  function admit(ref){
    const context=contexts.admit({sessionEpoch:getEpoch()}),owner=getSdk();
    if(fenced)issue('TRANSFER_AFTER_PRODUCER_FENCE',context);
    // This is a reference-count operation, not an error-code classification.
    owner.retain(ref);accepted++;
    let finish;const job=new Promise(resolve=>{finish=resolve;});pending.add(job);
    try{schedule(async()=>{
      try{
        if(owner!==getSdk()||context.sessionEpoch!==getEpoch()||!isConnected()){
          failed++;issue('TRANSFER_SESSION_INVALIDATED',context);return;
        }
        const result=download(ref,context.destination,true,context);
        // The production native downloader is synchronous. Explicit async fake
        // ports still retain ownership through their actual completion.
        if(result&&typeof result.then==='function')await result;
        completed++;
      }catch{failed++;issue('TRANSFER_DOWNLOAD_FAILED',context);}
      finally{
        try{owner.release(ref);}catch{issue('TRANSFER_REFERENCE_RELEASE_FAILED',context);}
        pending.delete(job);finish();
      }
    });}catch{
      failed++;issue('TRANSFER_SCHEDULING_FAILED',context);
      try{owner.release(ref);}catch{issue('TRANSFER_REFERENCE_RELEASE_FAILED',context);}
      pending.delete(job);finish();
    }
    return context;
  }
  function snapshot(){return {accepted,completed,failed,pending:pending.size,fenced,issues:[...issues]};}
  async function drain(){while(pending.size)await Promise.allSettled([...pending]);return snapshot();}
  function fence(){fenced=true;return snapshot();}
  return {admit,drain,fence,snapshot};
}
module.exports={createTransferProducer};
