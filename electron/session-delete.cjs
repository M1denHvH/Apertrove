const {trashRegisteredPhotos,cleanCaches}=require('./photo-files.cjs');
// Only registered originals are trashed. The output directory may contain unrelated files.
async function deleteSession(store,{id,deletePhotos=false},{trashItem,persist,cacheDir,onProgress=()=>{}}){
  if(typeof deletePhotos!=='boolean')throw Error('Некорректный вариант удаления.');
  const session=store.sessions.find(entry=>entry.id===id);
  if(!session)throw Error('Фотосессия не найдена.');
  const selected=store.photos.filter(photo=>photo.sessionId===id);
  const result={deleted:false,trashed:0,missing:0,shared:0,errors:[]};
  let removed=new Set();
  if(deletePhotos){
    const {removed:completed,...outcome}=await trashRegisteredPhotos(selected,store.photos.filter(photo=>photo.sessionId!==id),{trashItem,onProgress});
    removed=completed;Object.assign(result,outcome);
  }
  const previous={photos:store.photos,sessions:store.sessions,sessionId:store.sessionId,captureFolder:store.settings.captureFolder};
  if(deletePhotos)store.photos=store.photos.filter(photo=>!removed.has(photo));
  else store.photos=store.photos.map(photo=>photo.sessionId===id?{...photo,sessionId:null}:photo);
  result.deleted=!result.errors.length;
  if(result.deleted){
    store.sessions=store.sessions.filter(entry=>entry.id!==id);
    if(store.sessionId===id){store.sessionId=null;store.settings.captureFolder='';}
  }
  try{await persist();}catch(error){
    // Keep references on save failure; a retry reconciles files already in the Recycle Bin.
    Object.assign(store,{photos:previous.photos,sessions:previous.sessions,sessionId:previous.sessionId});store.settings.captureFolder=previous.captureFolder;
    throw error;
  }
  await cleanCaches([...removed],store.photos,cacheDir);
  return {...result,remaining:store.photos.filter(photo=>photo.sessionId===id).length};
}
module.exports={deleteSession};
