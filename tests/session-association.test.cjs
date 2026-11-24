'use strict';
// Production delivery/import/commit seams, synthetic files only. No Electron,
// native addon, Canon library, callback, or physical camera is loaded.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {createTransferContexts}=require('../electron/transfer-context.cjs');
const {createTransferConsumer}=require('../electron/transfer-consumer.cjs');
const {createPhotoImporter}=require('../electron/photo-import.cjs');
const {createLibraryCommitter}=require('../electron/library-commits.cjs');
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const clone=value=>JSON.parse(JSON.stringify(value));
function routes(){
  const api=createTransferContexts({recoveryDestination:'/synthetic/recovery',newId:()=> 'test-worker'});
  api.setRoute({sessionEpoch:1,sessionId:'A',destination:'/synthetic/A'});
  return api;
}
async function fixture(t,{beforeRead,writeGate,failWrite=false}={}){
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'apertrove-session-test-'));
  t.after(async()=>{const relative=path.relative(os.tmpdir(),folder);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(folder,{recursive:true,force:true});});
  const filename=path.join(folder,'library.json'),events=[],writes=[];
  const store={version:2,sessionId:'A',sessions:[{id:'A',name:'Session A'},{id:'B',name:'Session B'}],photos:[],presets:[],settings:{}};
  const committer=createLibraryCommitter({getStore:()=>store,isReady:()=>true,writeSnapshot:async snapshot=>{
    writes.push(clone(snapshot));if(writeGate)await writeGate.promise;if(failWrite)throw Error('Synthetic write failure');
    await fs.writeFile(filename,JSON.stringify(snapshot));
  }});
  const importer=createPhotoImporter({getStore:()=>store,commits:committer,extensions:new Set(['.jpg']),
    uniquePath:async(dest,name)=>path.join(dest,name),buildPhoto:async file=>({id:crypto.randomUUID(),path:file,name:path.basename(file)}),
    beforeRead:beforeRead||(async()=>{}),onPhoto:photo=>events.push(clone(photo))});
  const consumer=createTransferConsumer({generation:'worker',register:(file,context,cameraTransfer)=>importer.addFiles([file],false,{
    sessionId:context.sessionId,dest:context.destination,transfer:context,cameraTransfer})});
  let sequence=0;
  async function deliver(context,name='synthetic.jpg'){
    const file=path.join(folder,name);await fs.writeFile(file,Buffer.from('SYNTHETIC ORIGINAL '+name));
    const message={generation:'worker',photoSequence:++sequence,data:{path:file,capture:true,context}};
    return {message,finish:()=>consumer.accept(message),file};
  }
  return {store,committer,importer,consumer,events,writes,filename,folder,deliver,setWriteFailure:value=>{failWrite=value;}};
}
test('ordinary session capture stores the pinned session without claiming native capture correlation',async t=>{
  const f=await fixture(t),contexts=routes();contexts.noteCapture({operationId:'op-A',captureId:'capture-A'});
  const context=contexts.admit({sessionEpoch:1});await (await f.deliver(context)).finish();
  assert.equal(f.store.photos[0].sessionId,'A');assert.equal(f.store.photos[0].transfer.sessionAssociation.status,'CAPTURE_ROUTE_CANDIDATE');
  assert.equal(f.store.photos[0].transfer.captureId,null);assert.equal(f.store.photos[0].transfer.correlation,'UNCONFIRMED');
});
test('route-only session changes before a capture no longer permanently erase association',()=>{
  const contexts=routes();contexts.setRoute({sessionEpoch:1,sessionId:'B',destination:'/synthetic/B'});
  contexts.noteCapture({operationId:'op-B'});const context=contexts.admit({sessionEpoch:1});
  assert.equal(context.sessionId,'B');assert.equal(context.destination,'/synthetic/B');assert.equal(context.recoveryRoute,false);
});
test('transfer admitted in A keeps A after session switch, close, and delayed import',async t=>{
  const gate=deferred(),entered=deferred();let once=false;
  const f=await fixture(t,{beforeRead:async()=>{if(!once){once=true;entered.resolve();await gate.promise;}}}),contexts=routes();
  contexts.noteCapture({operationId:'op-A'});const context=contexts.admit({sessionEpoch:1}),delivery=await f.deliver(context);
  const pending=delivery.finish();await entered.promise;f.store.sessionId='B';
  contexts.setRoute({sessionEpoch:1,sessionId:'B',destination:'/synthetic/B'});f.store.sessionId=null;
  gate.resolve();await pending;assert.equal(f.store.photos[0].sessionId,'A');assert.equal(f.events[0].id,f.store.photos[0].id);
});
test('a late callback after switching sessions retains a unique captured-session candidate',()=>{
  const contexts=routes();contexts.noteCapture({operationId:'op-A',captureId:'capture-A'});contexts.settleCapture('op-A');
  contexts.setRoute({sessionEpoch:1,sessionId:'B',destination:'/synthetic/B'});
  const late=contexts.admit({sessionEpoch:1});assert.equal(late.sessionId,'A');assert.equal(late.destination,'/synthetic/A');
  assert.equal(late.captureId,null);assert.deepEqual(late.sessionAssociation.candidateSessionIds,['A']);
});
test('overlapping possible A/B capture origins are explicit and never silently become session B',()=>{
  const contexts=routes();contexts.noteCapture({operationId:'op-A'});contexts.settleCapture('op-A');
  contexts.setRoute({sessionEpoch:1,sessionId:'B',destination:'/synthetic/B'});contexts.noteCapture({operationId:'op-B'});
  const late=contexts.admit({sessionEpoch:1});assert.equal(late.sessionId,null);assert.equal(late.recoveryRoute,true);
  assert.equal(late.sessionAssociation.status,'AMBIGUOUS');assert.deepEqual(late.sessionAssociation.candidateSessionIds,['A','B']);assert.equal(late.captureId,null);
});
test('closing or removing the original session during import preserves its ID and provenance',async t=>{
  const gate=deferred(),entered=deferred();let once=false;
  const f=await fixture(t,{beforeRead:async()=>{if(!once){once=true;entered.resolve();await gate.promise;}}}),context=routes().admit({sessionEpoch:1});
  const delivery=await f.deliver(context),pending=delivery.finish();await entered.promise;
  f.store.sessions=f.store.sessions.filter(session=>session.id!=='A');f.store.sessionId=null;gate.resolve();await pending;
  assert.equal(f.store.photos[0].sessionId,'A');assert.equal(f.store.photos[0].sessionAssociation.status,'SESSION_REMOVED');
  const restored=JSON.parse(await fs.readFile(f.filename,'utf8'));assert.equal(restored.photos[0].sessionId,'A');
});
test('sequential captures and identical camera bytes in distinct files remain separate assets',async t=>{
  const f=await fixture(t),contexts=routes();
  for(let n=0;n<3;n++){contexts.noteCapture({operationId:'op-'+n});await(await f.deliver(contexts.admit({sessionEpoch:1}),'frame-'+n+'.jpg')).finish();contexts.settleCapture('op-'+n);}
  assert.equal(f.store.photos.length,3);assert.ok(f.store.photos.every(photo=>photo.sessionId==='A'));assert.equal(new Set(f.events.map(photo=>photo.id)).size,3);
});
test('exact duplicate transport events commit and publish once, including simultaneous replay',async t=>{
  const gate=deferred(),f=await fixture(t,{writeGate:gate}),delivery=await f.deliver(routes().admit({sessionEpoch:1}));
  const one=delivery.finish(),two=delivery.finish();gate.resolve();await Promise.all([one,two]);await delivery.finish();
  assert.equal(f.store.photos.length,1);assert.equal(f.events.length,1);assert.equal(f.consumer.snapshot().duplicates,2);
});
test('registration failure publishes no saved asset and a replay retries the same retained original',async t=>{
  const f=await fixture(t,{failWrite:true}),delivery=await f.deliver(routes().admit({sessionEpoch:1}));
  const before=await fs.readFile(delivery.file);await delivery.finish();
  assert.equal(f.store.photos.length,0);assert.equal(f.events.length,0);assert.equal(f.consumer.snapshot().committed,0);
  f.setWriteFailure(false);await delivery.finish();assert.equal(f.store.photos.length,1);assert.equal(f.events.length,1);
  assert.equal(f.consumer.snapshot().committed,1);assert.equal(f.consumer.snapshot().accepted,1);
  assert.ok(!f.consumer.snapshot().issues.includes('PHOTO_SEQUENCE_REUSED'));assert.deepEqual(await fs.readFile(delivery.file),before);
});
test('successful persistence precedes the photo event and survives a restart',async t=>{
  const gate=deferred(),f=await fixture(t,{writeGate:gate}),delivery=await f.deliver(routes().admit({sessionEpoch:1}));
  const pending=delivery.finish();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.events.length,0);assert.equal(f.store.photos.length,0);
  gate.resolve();await pending;const restored=JSON.parse(await fs.readFile(f.filename,'utf8'));
  assert.equal(restored.photos[0].id,f.events[0].id);assert.equal(restored.photos[0].sessionId,'A');
});
test('genuinely external files outside a session retain a normal null association',()=>{
  const contexts=createTransferContexts({recoveryDestination:'/synthetic/recovery',newId:()=> 'external'});
  contexts.setRoute({sessionEpoch:1,sessionId:null,destination:'/synthetic/external'});const result=contexts.admit({sessionEpoch:1});
  assert.equal(result.sessionId,null);assert.equal(result.sessionAssociation.status,'ROUTE_AT_ADMISSION');assert.equal(result.recoveryRoute,false);
});
test('manual session assignment is acknowledged transactionally and leaves transfer evidence unchanged',async t=>{
  const f=await fixture(t),context=routes().admit({sessionEpoch:1});await(await f.deliver(context)).finish();
  const photo=f.store.photos[0],originalTransfer=clone(photo.transfer);f.setWriteFailure(true);
  await assert.rejects(f.committer.updatePhoto(photo.id,{sessionId:'B'}),/Synthetic write failure/);assert.equal(photo.sessionId,'A');
  f.setWriteFailure(false);await f.committer.updatePhoto(photo.id,{sessionId:'B',sessionAssignment:{source:'USER',sessionId:'B'}});
  assert.equal(photo.sessionId,'B');assert.deepEqual(photo.transfer,originalTransfer);
  const restored=JSON.parse(await fs.readFile(f.filename,'utf8'));assert.equal(restored.photos[0].sessionId,'B');
});
