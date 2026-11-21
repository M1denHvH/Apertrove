// Real import orchestration; image codecs and UI are injected by main.
const fs=require('node:fs/promises');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {constants}=require('node:fs');
function createPhotoImporter({getStore,commits,extensions,uniquePath,buildPhoto,beforeRead=async()=>{},onPhoto=()=>{},onError=()=>{},onComplete=()=>{}}){
  if(typeof getStore!=='function'||typeof commits?.registerPhoto!=='function'||typeof buildPhoto!=='function'||typeof uniquePath!=='function'||!extensions?.has)throw TypeError('Import requires explicit store, commit, file and codec ports.');
  const retained=new Map();
  const key=file=>process.platform==='win32'?path.resolve(file).toLowerCase():path.resolve(file);
  const digest=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex');
  const notify=(callback,value)=>{try{callback(value);}catch{/* Notifications cannot undo an acknowledged registration. */}};
  function remember(hint,target){retained.delete(hint);retained.set(hint,target);while(retained.size>256)retained.delete(retained.keys().next().value);}
  async function addFiles(files,copy=true,context){
    // Import may wait for codec/file/persistence work while the active session
    // changes. The caller's delivery context owns this photo for the whole job.
    context=JSON.parse(JSON.stringify(context));
    const result={added:0,skipped:0,errors:[],registered:[]};const {sessionId,dest}=context;
    if(copy&&!dest)throw Error('Сначала выберите папку для снимков.');
    for(const source of files){
      let stage='source',target=source,copyAcknowledged=false,sourceAvailable=false,hint,fingerprint,registered=false;
      try{
        if(!extensions.has(path.extname(source).toLowerCase())){result.skipped++;continue;}
        await beforeRead(source);
        const stat=await fs.stat(source);if(!stat.isFile()){result.skipped++;continue;}sourceAvailable=true;
        fingerprint=await digest(source);
        const existing=getStore().photos.find(photo=>context.cameraTransfer?photo.path===source&&photo.fingerprint===fingerprint:photo.fingerprint===fingerprint);
        if(existing){result.skipped++;result.registered.push({id:existing.id,path:existing.path});continue;}
        if(copy){
          stage='copy';await fs.mkdir(dest,{recursive:true});
          hint=JSON.stringify([key(source),fingerprint,key(dest),sessionId??null]);
          const previous=retained.get(hint);let reused=false;
          if(previous){
            try{await beforeRead(previous);if((await fs.stat(previous)).isFile()&&await digest(previous)===fingerprint){target=previous;copyAcknowledged=true;reused=true;}}catch{/* A changed/missing retained copy is never deleted or trusted. */}
            if(!reused)retained.delete(hint);
          }
          if(!reused){
            target=await uniquePath(dest,path.basename(source));
            await fs.copyFile(source,target,constants.COPYFILE_EXCL);copyAcknowledged=true;
            await beforeRead(target);
            if(await digest(target)!==fingerprint){const error=Error('The source changed while it was being copied; inspect the retained copy.');error.code='IMPORT_SOURCE_CHANGED';throw error;}
          }
        }
        stage='build';await beforeRead(target);
        const built=await buildPhoto(target);
        const record={...built,fingerprint,sessionId:sessionId??null,equipment:context.equipment,series:context.series||undefined,burst:context.burst||undefined,cameraTransfer:context.cameraTransfer||undefined,...(context.transfer?{transfer:context.transfer}:{}),
          ...(sessionId&&!getStore().sessions.some(session=>session.id===sessionId)?{sessionAssociation:{status:'SESSION_REMOVED',sessionId}}:{})};
        stage='persist';const committed=await commits.registerPhoto(record,{cameraTransfer:!!context.cameraTransfer});
        if(hint)retained.delete(hint);
        result.registered.push({id:committed.photo.id,path:committed.photo.path});
        if(!committed.added){result.skipped++;continue;}
        registered=true;result.added++;
        notify(onPhoto,committed.photo);
      }catch(error){
        const item={name:path.basename(source),message:String(error?.message||error),stage};
        if(!registered&&(copyAcknowledged||!copy&&sourceAvailable||copy&&sourceAvailable&&target===source&&stage!=='source'))item.retainedPath=target;
        if(!registered&&copyAcknowledged&&hint)remember(hint,target);
        result.errors.push(item);notify(onError,item);
      }
    }
    notify(onComplete,result);return result;
  }
  return {addFiles};
}
module.exports={createPhotoImporter};
