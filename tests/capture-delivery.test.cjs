'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {captureDelivery}=require('../electron/capture-delivery.cjs'),{createTransferConsumer}=require('../electron/transfer-consumer.cjs');
const {createPhotoImporter}=require('../electron/photo-import.cjs'),{createLibraryCommitter}=require('../electron/library-commits.cjs');
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
async function rig(t,{sessionId='session',gate,fail=false}={}){
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'apertrove-delivery-'));
  t.after(()=>fs.rm(folder,{recursive:true,force:true}));
  const store={version:2,sessionId,sessions:sessionId?[{id:sessionId,name:'Test'}]:[],photos:[],presets:[],settings:{}},events=[];let number=0,failed=fail;
  const commits=createLibraryCommitter({getStore:()=>store,isReady:()=>true,writeSnapshot:async data=>{if(gate)await gate.promise;if(failed)throw Error('Synthetic write failure');await fs.writeFile(path.join(folder,'library.json'),JSON.stringify(data));}});
  const importer=createPhotoImporter({getStore:()=>store,commits,extensions:new Set(['.jpg']),uniquePath:async(dir,name)=>path.join(dir,name),buildPhoto:async file=>({id:'photo-'+path.basename(file),path:file,name:path.basename(file)}),onPhoto:photo=>events.push(photo)});
  const consumer=createTransferConsumer({generation:'worker',register:(file,context,cameraTransfer)=>importer.addFiles([file],false,{sessionId:context.sessionId,dest:folder,cameraTransfer,transfer:context})});
  async function file({id='transfer-'+(++number),name=id+'.jpg',association=sessionId,generation='worker'}={}){
    const target=path.join(folder,name);await fs.writeFile(target,'synthetic '+id);
    const message={generation,photoSequence:number||1,data:{path:target,capture:true,context:{transferId:id,sessionId:association,correlation:'UNCONFIRMED',captureId:null}}};
    return {id,target,message,deliver:()=>consumer.accept(message),result:{confirmation:'UNVERIFIED',nativeQuiescence:'UNKNOWN',observedTransfers:1,observedTransferIds:[id]}};
  }
  return {folder,store,events,consumer,file,fail:value=>failed=value};
}

test('capture delivery confirms after durable Library commit and preserves native uncertainty',async t=>{
  const r=await rig(t),f=await r.file();await f.deliver();await r.consumer.drain();const result=captureDelivery(f.result,r.consumer);
  assert.equal(result.confirmation,'CONFIRMED');assert.equal(result.nativeConfirmation,'UNVERIFIED');assert.equal(result.nativeQuiescence,'UNKNOWN');assert.equal(result.files[0].path,f.target);assert.equal(r.store.photos.length,1);
});
test('capture without an active Session confirms the received unassigned photo',async t=>{
  const r=await rig(t,{sessionId:null}),f=await r.file();await f.deliver();assert.equal(captureDelivery(f.result,r.consumer).confirmation,'CONFIRMED');assert.equal(r.store.photos[0].sessionId,null);
});
test('capture in a Session retains its assignment without using it as delivery proof',async t=>{
  const r=await rig(t),f=await r.file();await f.deliver();assert.equal(r.store.photos[0].sessionId,'session');assert.equal(captureDelivery(f.result,r.consumer).shots,1);
});
test('a received photo with ambiguous session assignment is still confirmed',async t=>{
  const r=await rig(t),f=await r.file({association:null});await f.deliver();assert.equal(r.store.photos[0].sessionId,null);assert.equal(captureDelivery(f.result,r.consumer).confirmation,'CONFIRMED');
});
test('an object event and completed download do not confirm delivery before registration',async t=>{
  const gate=deferred(),r=await rig(t,{gate}),f=await r.file(),pending=f.deliver();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(captureDelivery(f.result,r.consumer).confirmation,'UNVERIFIED');assert.equal(r.events.length,0);gate.resolve();await pending;await r.consumer.drain();assert.equal(captureDelivery(f.result,r.consumer).confirmation,'CONFIRMED');
});
test('delayed receipt can be reconciled after the response without depending on UI rendering',async t=>{
  const r=await rig(t),f=await r.file();assert.equal(captureDelivery(f.result,r.consumer).confirmation,'UNVERIFIED');await f.deliver();assert.equal(captureDelivery(f.result,r.consumer).confirmation,'CONFIRMED');assert.equal(r.events.length,1);
});
test('registration failure remains an error despite a complete downloaded original',async t=>{
  const r=await rig(t,{fail:true}),f=await r.file();await f.deliver();assert.throws(()=>captureDelivery(f.result,r.consumer),{code:'TRANSFER_REGISTRATION_FAILED'});assert.equal(r.store.photos.length,0);assert.ok(await fs.stat(f.target));
});
test('missing files and missing transfer IDs cannot be promoted to confirmed capture',async t=>{
  const r=await rig(t);assert.equal(captureDelivery({confirmation:'UNVERIFIED',observedTransferIds:['missing']},r.consumer).confirmation,'UNVERIFIED');assert.equal(captureDelivery({files:[{path:'unregistered.jpg'}]},r.consumer).confirmation,'UNVERIFIED');
});
test('duplicate camera messages neither duplicate Library photos nor inflate capture delivery',async t=>{
  const r=await rig(t),f=await r.file();await Promise.all([f.deliver(),f.deliver()]);await f.deliver();assert.equal(r.store.photos.length,1);assert.equal(captureDelivery({...f.result,observedTransferIds:[f.id,f.id]},r.consumer).shots,1);
});
test('two quick captures reconcile only their own observed delivery IDs',async t=>{
  const r=await rig(t),a=await r.file(),b=await r.file();await Promise.all([a.deliver(),b.deliver()]);
  assert.equal(captureDelivery(a.result,r.consumer).files[0].path,a.target);assert.equal(captureDelivery(b.result,r.consumer).files[0].path,b.target);assert.equal(r.store.photos.length,2);
});
test('disconnect before registration does not erase files already admitted to Library',async t=>{
  const gate=deferred(),r=await rig(t,{gate}),f=await r.file(),job=f.deliver();r.store.sessionId=null;gate.resolve();await job;assert.equal(captureDelivery(f.result,r.consumer).confirmation,'CONFIRMED');
});
test('a new worker cannot inherit the old consumer receipt after reconnect',async t=>{
  const r=await rig(t),f=await r.file();await f.deliver();const fresh=createTransferConsumer({generation:'fresh',register:()=>{throw Error('Not called');}});await fresh.accept(f.message);assert.equal(captureDelivery(f.result,fresh).confirmation,'UNVERIFIED');assert.equal(captureDelivery(f.result,r.consumer).confirmation,'CONFIRMED');
});
test('unsupported originals skipped by Library are not falsely certified as registered',async t=>{
  const r=await rig(t),f=await r.file({name:'synthetic.unknown'});await f.deliver();assert.equal(r.store.photos.length,0);assert.equal(captureDelivery(f.result,r.consumer).confirmation,'UNVERIFIED');
});
test('a recovered registration retry succeeds without a historical failure tainting later captures',async t=>{
  const r=await rig(t,{fail:true}),a=await r.file();await a.deliver();r.fail(false);await a.deliver();assert.equal(captureDelivery(a.result,r.consumer).confirmation,'CONFIRMED');const b=await r.file();await b.deliver();assert.equal(captureDelivery(b.result,r.consumer).confirmation,'CONFIRMED');
});
