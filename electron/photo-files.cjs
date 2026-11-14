const fs=require('node:fs/promises');
const path=require('node:path');

const pathKey=file=>process.platform==='win32'?path.resolve(file).toLowerCase():path.resolve(file);
async function fileKeys(file){
  const keys=[pathKey(file)];
  try{keys.push(pathKey(await fs.realpath(file)));}catch(error){if(error.code!=='ENOENT')throw error;}
  return keys;
}
async function cleanCaches(removed,retained,cacheDir){
  if(!cacheDir)return;
  const retainedIds=new Set(retained.map(photo=>photo.id));
  const ids=new Set(removed.map(photo=>photo.id).filter(id=>/^[a-f0-9]{24}$/i.test(id)&&!retainedIds.has(id)));
  const protectedPaths=new Set(retained.flatMap(photo=>[photo.thumbPath,photo.previewPath]).filter(Boolean).map(pathKey));
  const entries=await fs.readdir(cacheDir,{withFileTypes:true}).catch(()=>[]);
  for(const entry of entries){
    const match=/^([a-f0-9]{24})-(?:thumb|preview|edit-[a-f0-9]{40})\.jpg$/i.exec(entry.name);
    if(!entry.isFile()||!match||!ids.has(match[1]))continue;
    const file=path.join(cacheDir,entry.name);
    if(!protectedPaths.has(pathKey(file)))await fs.unlink(file).catch(()=>{});
  }
}

async function trashRegisteredPhotos(selected,retained,{trashItem,onProgress=()=>{}}){
  const result={trashed:0,missing:0,shared:0,errors:[]},removed=new Set();
  const sharedKeys=new Set();
  for(const photo of retained){
    if(typeof photo.path==='string'&&path.isAbsolute(photo.path))for(const key of await fileKeys(photo.path))sharedKeys.add(key);
  }
  const files=new Map();
  // Preflight the whole selection before changing any files.
  for(const photo of selected){
    if(typeof photo.path!=='string'||!path.isAbsolute(photo.path)||path.parse(photo.path).root===photo.path)throw Error(`Некорректный путь снимка: ${photo.name||photo.id}`);
    const key=pathKey(photo.path);
    if(files.has(key)){files.get(key).photos.push(photo);continue;}
    let missing=false;
    try{if(!(await fs.stat(photo.path)).isFile())throw Error(`Вместо снимка указана папка: ${photo.name||photo.id}`);}catch(error){if(error.code==='ENOENT')missing=true;else throw error;}
    const keys=await fileKeys(photo.path);
    files.set(key,{file:path.resolve(photo.path),photos:[photo],missing,shared:keys.some(key=>sharedKeys.has(key))});
  }
  let done=0;onProgress({done,total:files.size});
  for(const entry of files.values()){
    try{
      if(entry.shared)result.shared++;
      else if(entry.missing)result.missing++;
      else{if(!(await fs.stat(entry.file)).isFile())throw Error('Вместо снимка теперь указана папка.');await trashItem(entry.file);result.trashed++;}
      entry.photos.forEach(photo=>removed.add(photo));
    }catch(error){result.errors.push({name:path.basename(entry.file),message:error.message||String(error)});}
    onProgress({done:++done,total:files.size});
  }
  return {...result,removed};
}
module.exports={trashRegisteredPhotos,cleanCaches};
