const {test}=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');
const {migrateSessions,cleanSession}=require('../electron/sessions.cjs');
test('Legacy sessions retain the active output folder and recover old session folders from originals',()=>{
  const base=path.resolve('qa/migration');const store={version:1,sessionId:'active',settings:{captureFolder:path.join(base,'active'),autofocus:false,grid:true},sessions:[{id:'active',name:'A'},{id:'old',name:'B'}],photos:[{id:'photo',path:path.join(base,'old','shot.jpg'),sessionId:'old',rating:5}]};
  const before=JSON.stringify(store.photos);migrateSessions(store,base);assert.equal(store.sessions[0].captureFolder,path.join(base,'active'));assert.equal(store.sessions[1].captureFolder,path.join(base,'old'));assert.equal(store.sessions[0].autofocus,false);assert.equal(JSON.stringify(store.photos),before);assert.equal(store.version,2);
});
test('New session input requires a name, keeps notes bounded and rejects relative output paths',()=>{
  assert.throws(()=>cleanSession({name:' '}));assert.throws(()=>cleanSession({name:'A',folder:'relative/path'}));assert.equal(cleanSession({name:' Studio ',description:'x'.repeat(1500)}).description.length,1200);
});
test('Session editing can disable a golden grid and re-enable a previously disabled grid',()=>{assert.equal(cleanSession({name:'A',grid:false,composition:{grid:'golden'}}).composition.grid,'off');assert.equal(cleanSession({name:'A',grid:true,composition:{grid:'off'}}).composition.grid,'thirds');});
