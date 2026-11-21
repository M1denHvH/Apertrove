// Deferred callback ownership. Native retain/release ordering stays at these ports.
function createTransferProducer({contexts,getEpoch,getSdk,isConnected,download,schedule=setImmediate,onIssue=()=>{}}){
  if(!contexts||[getEpoch,getSdk,isConnected,download,schedule].some(fn=>typeof fn!=='function'))throw TypeError('Explicit transfer producer ports required.');
  const pending=new Set(),issues=[];let accepted=0,completed=0,failed=0,fenced=false;
  function issue(code,context,extra={}){if(!issues.includes(code)&&issues.length<32)issues.push(code);try{onIssue({code,transferId:context?.transferId||null,...extra});}catch{}}
  function releaseOwned(owner,ref,context){
    try{
      const result=owner.release(ref);
      if(!Number.isInteger(result)||result<0||result>0xffffffff||result===0xffffffff){
        issue('TRANSFER_REFERENCE_RELEASE_FAILED',context,{nativeCode:result});
        return false;
      }
      return true;
    }catch{
      issue('TRANSFER_REFERENCE_RELEASE_FAILED',context);
      return false;
    }
  }
  function admit(ref){
    const context=contexts.admit({sessionEpoch:getEpoch()}),owner=getSdk();
    if(fenced)issue('TRANSFER_AFTER_PRODUCER_FENCE',context);
    // This is a reference-count operation, not an error-code classification.
    let retained;
    try{retained=owner.retain(ref);}
    catch(error){
      failed++;
      const code=Number.isInteger(error?.code)&&error.code>=0&&error.code<=0xffffffff?error.code:undefined;
      issue('TRANSFER_REFERENCE_RETAIN_FAILED',context,code===undefined?{}:{nativeCode:code});
      throw Object.assign(Error('Native reference retention is unknown.'),{code:'OPERATION_UNKNOWN_TERMINATION'});
    }
    if(!Number.isInteger(retained)||retained<0||retained>0xffffffff||retained===0xffffffff){
      failed++;issue('TRANSFER_REFERENCE_RETAIN_FAILED',context,{nativeCode:retained});
      throw Object.assign(Error('Native reference retention is unknown.'),{code:'OPERATION_UNKNOWN_TERMINATION'});
    }
    accepted++;
    let finish;const job=new Promise(resolve=>{finish=resolve;});pending.add(job);
    try{schedule(async()=>{
      let downloaded=false;
      try{
        if(owner!==getSdk()||context.sessionEpoch!==getEpoch()||!isConnected()){
          failed++;issue('TRANSFER_SESSION_INVALIDATED',context);return;
        }
        const result=download(ref,context.destination,true,context);
        // The production native downloader is synchronous. Explicit async fake
        // ports still retain ownership through their actual completion.
        if(result&&typeof result.then==='function')await result;
        downloaded=true;
      }catch{failed++;issue('TRANSFER_DOWNLOAD_FAILED',context);}
      finally{
        if(!releaseOwned(owner,ref,context))failed++;else if(downloaded)completed++;
        pending.delete(job);finish();
      }
    });}catch{
      failed++;issue('TRANSFER_SCHEDULING_FAILED',context);
      if(!releaseOwned(owner,ref,context))failed++;
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
