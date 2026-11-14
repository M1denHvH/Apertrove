const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {deleteSession}=require('../electron/session-delete.cjs');

async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'apertrove-delete-'));
  t.after(()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('apertrove-delete-'));return fs.rm(root,{recursive:true,force:true});});
  const cache=path.join(root,'cache');await fs.mkdir(cache);
  const store={sessions:[{id:'a',name:'A',captureFolder:root},{id:'b',name:'B',captureFolder:root}],sessionId:'a',settings:{captureFolder:root,autofocus:false},photos:[]};
  const trashed=[];let persisted=0;
  const options={cacheDir:cache,trashItem:async file=>{trashed.push(file);await fs.rename(file,path.join(root,`trash-${trashed.length}.jpg`));},persist:async()=>{persisted++;}};
  async function photo(name,sessionId='a',id=String(store.photos.length+1).padStart(24,'0')){
    const file=path.join(root,name);await fs.writeFile(file,name);
    const record={id,path:file,name,sessionId,rating:5,edits:{exposure:1},thumbPath:path.join(cache,`${id}-thumb.jpg`),previewPath:path.join(cache,`${id}-preview.jpg`)};
    await fs.writeFile(record.thumbPath,'thumb');await fs.writeFile(record.previewPath,'preview');store.photos.push(record);return record;
  }
  return {root,cache,store,trashed,options,photo,persisted:()=>persisted};
}
test('Deleting only a session preserves originals, metadata and caches as unassigned photos',async t=>{
  const f=await fixture(t),p=await f.photo('keep.jpg'),before=structuredClone(p);
  const result=await deleteSession(f.store,{id:'a'},f.options);
  assert.equal(result.deleted,true);assert.equal(f.store.sessionId,null);assert.equal(f.store.settings.captureFolder,'');
  assert.deepEqual(f.store.photos[0],{...before,sessionId:null});assert.equal(await fs.readFile(p.path,'utf8'),'keep.jpg');await fs.access(p.thumbPath);
  assert.equal(f.trashed.length,0);assert.equal(f.persisted(),1);assert.equal(f.store.sessions.length,1);
});
test('Photo deletion trashes only registered originals and their private cache; keeps shared originals and unrelated files',async t=>{
  const f=await fixture(t),a=await f.photo('delete.jpg'),shared=await f.photo('shared.jpg');
  f.store.photos.push({...shared,id:'f'.repeat(24),sessionId:'b'});
  await fs.writeFile(path.join(f.root,'notes.txt'),'leave');await fs.mkdir(path.join(f.root,'unrelated'));
  const edit=path.join(f.cache,`${a.id}-edit-${'a'.repeat(40)}.jpg`);await fs.writeFile(edit,'edit');
  const unrelatedCache=path.join(f.cache,'other.jpg');await fs.writeFile(unrelatedCache,'leave');
  const result=await deleteSession(f.store,{id:'a',deletePhotos:true},f.options);
  assert.equal(result.deleted,true);assert.equal(result.trashed,1);assert.equal(result.shared,1);assert.deepEqual(f.trashed,[a.path]);
  await assert.rejects(fs.access(a.path));await assert.rejects(fs.access(a.thumbPath));await assert.rejects(fs.access(edit));
  for(const file of [shared.path,shared.thumbPath,shared.previewPath,unrelatedCache,path.join(f.root,'notes.txt'),path.join(f.root,'unrelated')])await fs.access(file);
  assert.equal(f.store.photos.length,1);assert.equal(f.store.photos[0].sessionId,'b');await fs.access(f.root);
});
test('Missing originals and duplicate file references are handled; deleting another session leaves the active one intact',async t=>{
  const f=await fixture(t),p=await f.photo('duplicate.jpg','b');f.store.photos.push({...p,id:'a'.repeat(24)});
  const missing=await f.photo('missing.jpg','b');await fs.unlink(missing.path);
  const result=await deleteSession(f.store,{id:'b',deletePhotos:true},f.options);
  assert.equal(result.trashed,1);assert.equal(result.missing,1);assert.equal(f.store.photos.length,0);assert.equal(f.store.sessionId,'a');assert.equal(f.store.settings.captureFolder,f.root);
});
test('Failed file moves retain the session and failed photos for retry',async t=>{
  const f=await fixture(t),ok=await f.photo('ok.jpg'),fail=await f.photo('locked.jpg');const trash=f.options.trashItem;
  f.options.trashItem=async file=>{if(file===fail.path)throw Error('File locked');return trash(file);};
  const result=await deleteSession(f.store,{id:'a',deletePhotos:true},f.options);
  assert.equal(result.deleted,false);assert.equal(result.errors.length,1);assert.equal(result.remaining,1);assert.equal(f.store.sessionId,'a');assert.equal(f.store.sessions.length,2);
  assert.deepEqual(f.store.photos,[fail]);await fs.access(fail.path);await fs.access(fail.thumbPath);await assert.rejects(fs.access(ok.path));
  f.options.trashItem=trash;assert.equal((await deleteSession(f.store,{id:'a',deletePhotos:true},f.options)).deleted,true);assert.equal(f.store.sessionId,null);
});
test('Whole-selection validation rejects directory/relative paths before trashing anything and requires a boolean option',async t=>{
  const f=await fixture(t);await f.photo('valid.jpg');const bad={id:'bad',name:'bad',path:f.root,sessionId:'a'};f.store.photos.push(bad);
  await assert.rejects(deleteSession(f.store,{id:'a',deletePhotos:true},f.options),/папка/);
  bad.path='relative.jpg';await assert.rejects(deleteSession(f.store,{id:'a',deletePhotos:true},f.options),/путь/);
  await assert.rejects(deleteSession(f.store,{id:'a',deletePhotos:'false'},f.options),/вариант/);
  assert.equal(f.trashed.length,0);assert.equal(f.store.sessions.length,2);assert.equal(f.persisted(),0);
});
test('Shared originals are protected through realpath and Windows case aliases',async t=>{
  const f=await fixture(t),p=await f.photo('Shared.JPG');
  const alias=process.platform==='win32'?p.path.toUpperCase():path.join(f.root,'linked.jpg');
  if(process.platform!=='win32')await fs.symlink(p.path,alias);
  f.store.photos.push({...p,path:alias,sessionId:null,id:'e'.repeat(24)});
  const result=await deleteSession(f.store,{id:'a',deletePhotos:true},f.options);
  assert.equal(result.shared,1);assert.equal(f.trashed.length,0);await fs.access(p.path);
});
test('A failed save rolls back a keep-photos deletion',async t=>{
  const f=await fixture(t);await f.photo('keep.jpg');const before=structuredClone(f.store);
  f.options.persist=async()=>{throw Error('Disk full');};await assert.rejects(deleteSession(f.store,{id:'a'},f.options),/Disk full/);
  assert.deepEqual(f.store,before);assert.equal(f.trashed.length,0);
});
test('After a failed save, references remain and a retry reconciles originals already in the Recycle Bin',async t=>{
  const f=await fixture(t),p=await f.photo('save-error.jpg'),before=structuredClone(f.store),persist=f.options.persist;
  f.options.persist=async()=>{throw Error('Disk full');};await assert.rejects(deleteSession(f.store,{id:'a',deletePhotos:true},f.options),/Disk full/);
  assert.deepEqual(f.store,before);await assert.rejects(fs.access(p.path));await fs.access(p.thumbPath);
  f.options.persist=persist;const result=await deleteSession(f.store,{id:'a',deletePhotos:true},f.options);
  assert.equal(result.deleted,true);assert.equal(result.missing,1);assert.equal(f.store.sessionId,null);
});
test('Originals stored with forward slashes are normalized for the Windows shell',async t=>{
  const f=await fixture(t),p=await f.photo('slash.jpg');p.path=p.path.replaceAll('\\','/');
  const result=await deleteSession(f.store,{id:'a',deletePhotos:true},f.options);
  assert.equal(result.deleted,true);assert.deepEqual(f.trashed,[path.resolve(p.path)]);
});
