// One application-level writer queue. A staged photo is never part of live state.
const {validateLibrary}=require('./library-schema.cjs');
const copy=value=>JSON.parse(JSON.stringify(value));
function invalid(message){const error=Error(message);error.code='LIBRARY_COMMIT_INVALID';return error;}
function createLibraryCommitter({getStore,writeSnapshot,isReady}){
  if([getStore,writeSnapshot,isReady].some(value=>typeof value!=='function'))throw TypeError('Library commits require explicit ownership and persistence ports.');
  let tail=Promise.resolve();
  function runExclusive(operation){
    if(typeof operation!=='function')return Promise.reject(TypeError('A queued operation is required.'));
    const job=tail.then(()=>{if(!isReady())throw invalid('Library is not ready.');return operation();});
    tail=job.then(()=>undefined,()=>undefined);return job;
  }
  function snapshot(){
    const candidate=copy(getStore());
    if(validateLibrary(candidate).kind!=='VALID'||candidate.version!==2)throw invalid('The prepared library snapshot is invalid.');
    return candidate;
  }
  return {
    runExclusive,
    persist:()=>runExclusive(()=>writeSnapshot(snapshot())),
    registerPhoto(record,{cameraTransfer=false}={}){
      // Freeze caller-owned staging before this operation can wait in the queue.
      let staged;try{staged=copy(record);}catch(error){return Promise.reject(error);}
      return runExclusive(async()=>{
        const live=getStore();
        const duplicate=live.photos.find(photo=>cameraTransfer
          ?photo.path===staged.path&&photo.fingerprint===staged.fingerprint
          :staged.fingerprint?photo.fingerprint===staged.fingerprint:photo.id===staged.id&&photo.path===staged.path);
        if(duplicate)return {added:false,photo:duplicate};
        const candidate=snapshot();candidate.photos.push(staged);
        if(validateLibrary(candidate).kind!=='VALID')throw invalid('The staged photo would create an invalid library.');
        await writeSnapshot(candidate);
        // Only this append is ours. Never replace a live store/settings snapshot:
        // unrelated edits made during the write must survive their queued persist.
        live.photos.push(staged);
        return {added:true,photo:staged};
      });
    }
  };
}
module.exports={createLibraryCommitter};
