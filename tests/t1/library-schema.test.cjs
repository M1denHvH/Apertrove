const assert=require('node:assert/strict');
const {validateLibrary,preparationCopy}=require('../../electron/library-schema.cjs');
const {migrateSessions}=require('../../electron/sessions.cjs');
const {valid,legacy}=require('./fixtures.cjs');
test('schema: versionless, v1, v2 and minimal inspector records remain valid',()=>{
  for(const version of [undefined,1,2]){const v=valid();if(version===undefined)delete v.version;else v.version=version;assert.equal(validateLibrary(v).kind,'VALID');}
  assert.equal(validateLibrary(legacy()).kind,'VALID');assert.equal(validateLibrary({settings:{},photos:[{id:'smoke',name:'fixture.jpg',path:'/synthetic/s1/original.jpg',cameraTransfer:true,size:20}]}).kind,'VALID');
});
test('schema: invalid roots, version types and required containers fail closed',()=>{
  for(const v of [null,[],{},true,{...valid(),version:'2'},{...valid(),version:null},{...valid(),version:0},{...valid(),photos:null},{...valid(),settings:[]},{...valid(),sessions:null},{...valid(),presets:{}}])assert.equal(validateLibrary(v).kind,'CORRUPT');
});
test('schema: future version is unsupported without mutation',()=>{
  const v={version:99,photos:null,sentinel:'future'},before=JSON.stringify(v);assert.equal(validateLibrary(v).kind,'UNSUPPORTED_VERSION');assert.equal(JSON.stringify(v),before);
});
test('schema: malformed records and consumer field types are rejected',()=>{
  for(const p of [null,{id:'p'},{id:'p',path:3},{id:'p',path:'x',thumbPath:5},{id:'p',path:'x',previewPath:[]},{id:'p',path:'x',histogram:{}},{id:'p',path:'x',histogram:[null]},{id:'p',path:'x',metadata:[]},{id:'p',path:'x',edits:'bad'}])assert.equal(validateLibrary({...valid(),photos:[p]}).kind,'CORRUPT');
  assert.equal(validateLibrary({...valid(),photos:[{id:'same',path:'a'},{id:'same',path:'b'}]}).kind,'CORRUPT');assert.equal(validateLibrary({...valid(),presets:[{id:'p',values:[]}]}).kind,'CORRUPT');
  assert.equal(validateLibrary({...valid(),sessions:[{id:'s',name:'fixture',client:{bad:true}}]}).kind,'CORRUPT');
  assert.equal(validateLibrary({...valid(),presets:[{id:'p',description:{bad:true}}]}).kind,'CORRUPT');
  assert.equal(validateLibrary({...valid(),photos:[{id:'p',path:'fixture.jpg',previewError:{bad:true}}]}).kind,'CORRUPT');
});
test('schema: preparation preserves unknown fields and dangling references',()=>{
  const v=legacy();v.photos[0].extra={keep:true};v.presets=[{id:'preset',unknown:'keep'}];v.sessions[0].presetQueue=['missing-preset'];v.photos[0].sessionId='missing-session';v.sessionId='missing-active';
  const before=JSON.stringify(v),c=preparationCopy(v);migrateSessions(c,'/synthetic/s1/sessions');assert.equal(JSON.stringify(v),before);assert.equal(c.version,2);assert.equal(c.sessionId,null);assert.equal(c.photos[0].sessionId,'missing-session');assert.equal(c.photos[0].name,'shot.jpg');assert.deepEqual(c.photos[0].extra,{keep:true});assert.deepEqual(c.extra,{sentinel:'keep'});assert.deepEqual(c.presets[0].values,{});assert.equal(c.presets[0].unknown,'keep');assert.deepEqual(c.sessions[0].presetQueue,['missing-preset']);
});
test('schema: migrateSessions preserves its existing photo-record contract',()=>{
  const v=legacy(),before=JSON.stringify(v.photos);migrateSessions(v,'/synthetic/s1/sessions');assert.equal(JSON.stringify(v.photos),before);assert.equal(v.sessions[0].captureFolder,'/synthetic/s1/capture');assert.equal(v.sessions[1].captureFolder,'/synthetic/s1/old');
});
