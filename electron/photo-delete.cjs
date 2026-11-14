const {trashRegisteredPhotos,cleanCaches}=require('./photo-files.cjs');
async function deletePhotos(store,{ids}={},{trashItem,persist,cacheDir,onProgress}){
  if(!Array.isArray(ids)||!ids.length||ids.length>10000||ids.some(id=>typeof id!=='string'||!id||id.length>128))throw Error('Выберите фотографии для удаления.');
  const selectedIds=new Set(ids),selected=store.photos.filter(photo=>selectedIds.has(photo.id));
  if(new Set(selected.map(photo=>photo.id)).size!==selectedIds.size)throw Error('Один из снимков уже удалён. Обновите выбор.');
  const {removed,...result}=await trashRegisteredPhotos(selected,store.photos.filter(photo=>!selectedIds.has(photo.id)),{trashItem,onProgress});
  const previous=store.photos;store.photos=store.photos.filter(photo=>!removed.has(photo));
  try{await persist();}catch(error){store.photos=previous;throw error;}
  await cleanCaches([...removed],store.photos,cacheDir);
  return {...result,deleted:!result.errors.length,removedIds:[...new Set([...removed].map(photo=>photo.id))],failedIds:selected.filter(photo=>!removed.has(photo)).map(photo=>photo.id)};
}
module.exports={deletePhotos};
