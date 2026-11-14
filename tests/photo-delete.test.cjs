const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {deletePhotos}=require('../electron/photo-delete.cjs');
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'apertrove-photo-delete-'));t.after(()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('apertrove-photo-delete-'));return fs.rm(root,{recursive:true,force:true});});
 const cache=path.join(root,'cache');await fs.mkdir(cache);const store={photos:[],sessions:[{id:'session',name:'A',captureFolder:root,presetQueue:['portrait']}],sessionId:'session',settings:{captureFolder:root,theme:'dark'}},trashed=[];
 const options={cacheDir:cache,persist:async()=>{},trashItem:async file=>{trashed.push(file);await fs.rename(file,path.join(root,'recycled-'+path.basename(file)));}};
 async function photo(name,sessionId='session'){const id=String(store.photos.length+1).padStart(24,'0'),file=path.join(root,name),thumbPath=path.join(cache,id+'-thumb.jpg');await fs.writeFile(file,name);await fs.writeFile(thumbPath,'thumb');const p={id,path:file,name,sessionId,thumbPath,rating:5,edits:{exposure:1}};store.photos.push(p);return p;}
 return {root,cache,store,options,trashed,photo};
}
test('Deleting selected photos keeps the session, output folder, remaining metadata and unrelated files',async t=>{
 const f=await fixture(t),a=await f.photo('delete.jpg'),b=await f.photo('keep.cr2'),sessions=structuredClone(f.store.sessions),settings=structuredClone(f.store.settings);await fs.writeFile(path.join(f.root,'notes.txt'),'keep');
 const result=await deletePhotos(f.store,{ids:[a.id,a.id]},f.options);assert.equal(result.deleted,true);assert.deepEqual(result.removedIds,[a.id]);assert.equal(result.trashed,1);assert.deepEqual(f.store.photos,[b]);assert.deepEqual(f.store.sessions,sessions);assert.deepEqual(f.store.settings,settings);assert.equal(f.store.sessionId,'session');await fs.access(path.join(f.root,'notes.txt'));await fs.access(f.root);await assert.rejects(fs.access(a.thumbPath));await fs.access(b.thumbPath);
});
test('A whole selection is validated before file operations and stale IDs do not cause partial deletion',async t=>{
 const f=await fixture(t),a=await f.photo('valid.jpg');
 for(const ids of [[],null,['unknown'],[a.id,'unknown'],[a.id,12]])await assert.rejects(deletePhotos(f.store,{ids},f.options));
 const b=await f.photo('bad.jpg');b.path=f.root;await assert.rejects(deletePhotos(f.store,{ids:[a.id,b.id]},f.options),/папка/);assert.equal(f.trashed.length,0);assert.equal(f.store.photos.length,2);
});
test('Shared originals and previews are retained when another library record refers to them',async t=>{
 const f=await fixture(t),a=await f.photo('shared.jpg');f.store.photos.push({...a,id:'f'.repeat(24),sessionId:null,path:process.platform==='win32'?a.path.toUpperCase():a.path});
 const result=await deletePhotos(f.store,{ids:[a.id]},f.options);assert.equal(result.shared,1);assert.equal(result.trashed,0);assert.equal(f.store.photos.length,1);await fs.access(a.path);await fs.access(a.thumbPath);
});
test('Partial failures keep only failed items for retry, including unassigned and missing originals',async t=>{
 const f=await fixture(t),a=await f.photo('ok.jpg',null),b=await f.photo('locked.jpg'),missing=await f.photo('missing.jpg');await fs.unlink(missing.path);const trash=f.options.trashItem;
 f.options.trashItem=async file=>{if(file===b.path)throw Error('Locked');return trash(file);};const result=await deletePhotos(f.store,{ids:[a.id,b.id,missing.id]},f.options);
 assert.equal(result.deleted,false);assert.equal(result.missing,1);assert.deepEqual(result.failedIds,[b.id]);assert.deepEqual(f.store.photos,[b]);assert.equal(f.store.sessions.length,1);await fs.access(b.thumbPath);
 f.options.trashItem=trash;assert.equal((await deletePhotos(f.store,{ids:[b.id]},f.options)).deleted,true);assert.equal(f.store.photos.length,0);assert.equal(f.store.sessionId,'session');
});
test('A persistence failure retains references and retry reconciles files already in the Recycle Bin',async t=>{
 const f=await fixture(t),a=await f.photo('save-error.jpg'),before=structuredClone(f.store),persist=f.options.persist;f.options.persist=async()=>{throw Error('Disk full');};await assert.rejects(deletePhotos(f.store,{ids:[a.id]},f.options),/Disk full/);assert.deepEqual(f.store,before);await fs.access(a.thumbPath);
 f.options.persist=persist;const result=await deletePhotos(f.store,{ids:[a.id]},f.options);assert.equal(result.missing,1);assert.equal(result.deleted,true);assert.equal(f.store.photos.length,0);
});
test('A file replaced by a directory during a batch is not passed to the Windows trash operation',async t=>{
 const f=await fixture(t),a=await f.photo('first.jpg'),b=await f.photo('changed.jpg'),trash=f.options.trashItem;
 f.options.trashItem=async file=>{await trash(file);if(file===a.path){await fs.rename(b.path,path.join(f.root,'changed-backup.jpg'));await fs.mkdir(b.path);}};
 const result=await deletePhotos(f.store,{ids:[a.id,b.id]},f.options);assert.equal(result.deleted,false);assert.equal(result.errors.length,1);assert.deepEqual(result.failedIds,[b.id]);assert.deepEqual(f.trashed,[a.path]);assert.equal((await fs.stat(b.path)).isDirectory(),true);
});
