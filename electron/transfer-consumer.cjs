// Main-side accounting of admitted worker files. Registration remains owned by S2A.
function createTransferConsumer({generation,register,onIssue=()=>{}}){
  if(typeof generation!=='string'||typeof register!=='function')throw TypeError('Explicit transfer consumer ports required.');
  const pending=new Set(),recent=new Map(),holes=new Set(),issues=[];
  let frontier=0,watermark=null,accepted=0,committed=0,duplicates=0;
  function issue(code){if(!issues.includes(code)&&issues.length<32)issues.push(code);try{onIssue(code);}catch{}}
  function accept(message){
    const data=message?.data,sequence=message?.photoSequence,context=data?.context;
    if(message?.generation!==generation){issue('TRANSFER_GENERATION_MISMATCH');return Promise.resolve();}
    if(!data||typeof data.path!=='string'||!data.path){issue('TRANSFER_FILE_MISSING');return Promise.resolve();}
    const id=typeof context?.transferId==='string'?context.transferId:null;
    const prior=id&&recent.get(id);
    const replay=prior&&prior.path===data.path&&prior.sequence===sequence;
    if(replay&&prior.status!=='FAILED'){duplicates++;return prior.job||Promise.resolve();}
    if(prior&&!replay)issue('TRANSFER_ID_COLLISION');
    const entry={transferId:id,path:data.path,sequence,status:'PENDING',job:null};
    if(id){recent.set(id,entry);while(recent.size>128){const removable=[...recent].find(([,item])=>item.status!=='PENDING');if(!removable)break;recent.delete(removable[0]);}}
    if(!Number.isSafeInteger(sequence)||sequence<1)issue('PHOTO_SEQUENCE_INVALID');
    else if(!replay&&(sequence<=frontier||holes.has(sequence)))issue('PHOTO_SEQUENCE_REUSED');
    else if(sequence>frontier){
      holes.add(sequence);while(holes.delete(frontier+1))frontier++;
      if(holes.size>256){issue('PHOTO_SEQUENCE_GAP_BUDGET');holes.clear();}
    }
    if(watermark!==null)issue('PHOTO_AFTER_PRODUCER_FENCE');
    if(!context)issue('TRANSFER_CONTEXT_MISSING');
    const frozen=JSON.parse(JSON.stringify(context||{sessionId:null,operationId:null,captureId:null,attribution:'AMBIGUOUS',correlation:'UNCONFIRMED'}));
    // SDK callbacks have no confirmed app capture key. Never inherit new globals.
    if(frozen.correlation!=='CONFIRMED'){frozen.operationId=null;frozen.captureId=null;delete frozen.series;delete frozen.burst;}
    if(!replay)accepted++;
    const job=Promise.resolve().then(()=>register(data.path,frozen,data.capture===true)).then(result=>{
      if(result?.errors?.length){entry.status='FAILED';issue('TRANSFER_REGISTRATION_FAILED');}
      else if(Array.isArray(result?.registered)&&!result.registered.some(photo=>photo.path===data.path))entry.status='SKIPPED';
      else{entry.status='COMMITTED';committed++;}
      return result;
    },()=>{entry.status='FAILED';issue('TRANSFER_REGISTRATION_FAILED');});
    entry.job=job;
    pending.add(job);job.then(()=>pending.delete(job),()=>pending.delete(job));return job;
  }
  function fence(sequence){
    if(!Number.isSafeInteger(sequence)||sequence<0)issue('PRODUCER_WATERMARK_INVALID');
    else{watermark=sequence;if(frontier!==sequence)issue('PHOTO_SEQUENCE_GAP');}
    return snapshot();
  }
  function snapshot(){return {generation,accepted,committed,duplicates,pending:pending.size,frontier,watermark,issues:[...issues]};}
  async function drain(){while(pending.size)await Promise.allSettled([...pending]);return {drained:true,...snapshot()};}
  const receipt=id=>{const entry=recent.get(id);return entry?{transferId:entry.transferId,path:entry.path,sequence:entry.sequence,status:entry.status}:null;};
  return {accept,fence,drain,snapshot,receipt};
}
module.exports={createTransferConsumer};
