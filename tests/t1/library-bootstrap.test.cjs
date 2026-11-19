const assert=require('node:assert/strict');
const {createLibraryBootstrap,selectDataFolder}=require('../../electron/library-bootstrap.cjs');
const {decodeLibraryBytes}=require('../../electron/library-text.cjs');
const {valid,legacy,memoryStore,prepared}=require('./fixtures.cjs');
function rig(source,options={}){
  const io=memoryStore(source);let factories=0,prepares=0;
  const boot=createLibraryBootstrap({readText:io.readText,writeStore:io.writeStore,createFresh:()=>{factories++;return valid();},prepare:async c=>{prepares++;return options.prepare?options.prepare(c):prepared(c);}});
  return {io,boot,counts:()=>({factories,prepares})};
}
test('bootstrap: ENOENT alone creates and commits one fresh library',async()=>{
  const r=rig(),original=r.io.original(),result=await r.boot.boot();assert.equal(result.kind,'VALID');assert.equal(result.established,false);assert.deepEqual(r.counts(),{factories:1,prepares:1});assert.equal(r.io.writes.length,1);assert.equal(r.io.original(),original);assert.equal(r.boot.isReady(),true);
});
for(const [name,source]of [['v1',JSON.stringify(legacy())],['v2',JSON.stringify(valid())],['versionless',JSON.stringify({photos:[],settings:{},custom:'keep'})]]){
  test('bootstrap: '+name+' deterministic migration and ready getter without IO',async()=>{
    const r=rig(source),original=r.io.original(),result=await r.boot.boot(),expected=JSON.stringify(result.store);
    assert.equal(result.kind,'VALID');assert.equal(result.established,true);assert.equal(result.store.version,2);
    const other=rig(source);assert.equal(JSON.stringify((await other.boot.boot()).store),expected);
    result.store.settings.liveChange=true;const next=await r.boot.boot();assert.equal(next.store,result.store);assert.equal(next.store.settings.liveChange,true);assert.equal(r.io.reads,1);assert.equal(r.io.writes.length,1);assert.equal(r.io.original(),original);
  });
}
for(const [name,source]of [['corrupt','{no'],['empty',''],['truncated','{"photos":'],['invalid-schema','{}'],['future',JSON.stringify({...valid(),version:99,custom:'future'})]]){
  test('bootstrap: '+name+' keeps original bytes with zero writes',async()=>{
    const r=rig(source),before=r.io.before(),original=r.io.original(),result=await r.boot.boot();assert.equal(result.kind,name==='future'?'UNSUPPORTED_VERSION':'CORRUPT');assert.equal(r.boot.isReady(),false);assert.equal(r.io.before(),before);assert.equal(r.io.original(),original);assert.equal(r.io.writes.length,0);assert.deepEqual(r.counts(),{factories:0,prepares:0});
  });
}
for(const code of ['EACCES','EIO','EPERM','UNEXPECTED']){
  test('bootstrap: '+code+' never creates fallback or writes',async()=>{
    const r=rig(JSON.stringify(valid())),before=r.io.before(),original=r.io.original();r.io.readError=Object.assign(Error('fixture'),{code});
    assert.equal((await r.boot.boot()).kind,'UNREADABLE');assert.equal(r.io.before(),before);assert.equal(r.io.original(),original);assert.equal(r.io.writes.length,0);assert.deepEqual(r.counts(),{factories:0,prepares:0});
  });
}
test('bootstrap: unknown read exception without code also blocks writes',async()=>{
  const r=rig(JSON.stringify(valid())),before=r.io.before();r.io.readError=Error('fixture');assert.equal((await r.boot.boot()).kind,'UNREADABLE');assert.equal(r.io.before(),before);assert.equal(r.io.writes.length,0);assert.equal(r.counts().factories,0);
});
test('bootstrap: failed migration and invalid prepared output never write',async()=>{
  for(const prepare of [c=>{c.custom='changed';throw Error('fixture');},c=>({...c,version:99}),c=>({...c,photos:null})]){
    const r=rig(JSON.stringify(valid()),{prepare}),before=r.io.before();assert.equal((await r.boot.boot()).kind,'MIGRATION_FAILED');assert.equal(r.io.before(),before);assert.equal(r.io.writes.length,0);assert.equal(r.boot.isReady(),false);
  }
});
test('bootstrap: failed persist is not READY; explicit retry rereads and succeeds',async()=>{
  const r=rig(JSON.stringify(valid())),before=r.io.before(),original=r.io.original();r.io.writeError=Object.assign(Error('fixture'),{code:'ENOSPC'});
  assert.equal((await r.boot.boot()).kind,'PERSIST_FAILED');assert.equal(r.boot.isReady(),false);assert.equal(r.io.before(),before);assert.equal(r.io.original(),original);assert.equal(r.io.writes.length,1);
  r.io.writeError=null;assert.equal((await r.boot.boot()).kind,'VALID');assert.equal(r.io.reads,2);assert.equal(r.io.writes.length,2);assert.equal(r.boot.isReady(),true);
});
test('bootstrap: repeated failure does not reset; repaired fixture can load',async()=>{
  const r=rig('bad'),before=r.io.before();assert.equal((await r.boot.boot()).kind,'CORRUPT');assert.equal((await r.boot.boot()).kind,'CORRUPT');assert.equal(r.io.before(),before);assert.equal(r.io.writes.length,0);assert.equal(r.io.reads,2);
  r.io.files.set('/synthetic/s1/library.json',JSON.stringify(valid()));assert.equal((await r.boot.boot()).kind,'VALID');assert.equal(r.io.writes.length,1);
});
test('bootstrap: first-run persist failure retries without false readiness',async()=>{
  const r=rig(),before=r.io.before(),original=r.io.original();r.io.writeError=Object.assign(Error('fixture'),{code:'EACCES'});
  assert.equal((await r.boot.boot()).kind,'PERSIST_FAILED');assert.equal(r.boot.isReady(),false);assert.equal(r.io.before(),before);assert.equal(r.io.original(),original);
  r.io.writeError=null;assert.equal((await r.boot.boot()).kind,'VALID');assert.equal(r.io.reads,2);assert.equal(r.io.writes.length,2);assert.equal(r.counts().factories,2);
});
test('bootstrap: non-text read result is unreadable, never missing',async()=>{
  let writes=0,fresh=0;const b=createLibraryBootstrap({readText:async()=>null,writeStore:async()=>{writes++;},createFresh:()=>{fresh++;return valid();},prepare:prepared});
  assert.equal((await b.boot()).kind,'UNREADABLE');assert.equal(writes,0);assert.equal(fresh,0);
});
test('bootstrap: concurrent retries share one operation',async()=>{
  let release;const r=rig(JSON.stringify(valid()),{prepare:c=>new Promise(resolve=>{release=()=>resolve(prepared(c));})}),one=r.boot.boot(),two=r.boot.boot();assert.equal(one,two);await Promise.resolve();await Promise.resolve();release();await one;assert.equal(r.io.reads,1);assert.equal(r.io.writes.length,1);
});
test('bootstrap: closing during read/prepare prevents commit and READY',async()=>{
  for(const stage of ['read','prepare']){
    let release,writes=0;const b=createLibraryBootstrap({readText:()=>stage==='read'?new Promise(r=>{release=()=>r(JSON.stringify(valid()));}):Promise.resolve(JSON.stringify(valid())),createFresh:valid,prepare:c=>stage==='prepare'?new Promise(r=>{release=()=>r(prepared(c));}):prepared(c),writeStore:async()=>{writes++;}});
    const pending=b.boot();await Promise.resolve();await Promise.resolve();b.dispose();release();assert.equal((await pending).kind,'CANCELLED');assert.equal(writes,0);assert.equal(b.isReady(),false);
  }
});
test('bootstrap: already pending valid write cannot publish READY after close',async()=>{
  let release,writes=0;const b=createLibraryBootstrap({readText:async()=>JSON.stringify(valid()),createFresh:valid,prepare:prepared,writeStore:()=>{writes++;return new Promise(r=>{release=r;});}}),pending=b.boot();await Promise.resolve();await Promise.resolve();await Promise.resolve();b.dispose();release();assert.equal((await pending).kind,'CANCELLED');assert.equal(writes,1);assert.equal(b.isReady(),false);
});
test('profile: only explicit ENOENT selects current instead of legacy',()=>{
  const legacy='/synthetic/s1/legacy',current='/synthetic/s1/current';assert.equal(selectDataFolder({legacy,current,probe:()=>{}}),legacy);
  for(const code of ['EACCES','EIO',undefined])assert.equal(selectDataFolder({legacy,current,probe:()=>{throw Object.assign(Error('fixture'),{code});}}),legacy);
  assert.equal(selectDataFolder({legacy,current,probe:()=>{throw Object.assign(Error('fixture'),{code:'ENOENT'});}}),current);
});
test('bootstrap: fatal UTF-8 decoding blocks write-back of damaged text',async()=>{
  const bytes=new Uint8Array([123,34,120,34,58,34,255,34,125]),before=Array.from(bytes);let writes=0,fresh=0;
  const b=createLibraryBootstrap({readText:async()=>decodeLibraryBytes(bytes),writeStore:async()=>{writes++;},createFresh:()=>{fresh++;return valid();},prepare:prepared});
  assert.equal((await b.boot()).kind,'UNREADABLE');assert.equal(writes,0);assert.equal(fresh,0);assert.deepEqual(Array.from(bytes),before);
  assert.equal(decodeLibraryBytes(new Uint8Array([208,175])),'Я');
});
