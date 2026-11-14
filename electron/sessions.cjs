const path=require('node:path');
const crypto=require('node:crypto');
const {composition}=require('./workspace-settings.cjs');
const {safeName}=require('./library.cjs');
function migrateSessions(store,root){
  store.sessions=Array.isArray(store.sessions)?store.sessions:[];
  for(const session of store.sessions){
    if(!session.captureFolder){
      const sample=store.photos.find(photo=>photo.sessionId===session.id);
      session.captureFolder=session.id===store.sessionId&&store.settings.captureFolder?store.settings.captureFolder:sample?path.dirname(sample.path):path.join(root,safeName(session.name));
    }
    session.description??='';session.client??='';session.autofocus??=store.settings.autofocus!==false;session.grid??=!!store.settings.grid;session.presetQueue??=[];session.composition=composition(session.composition,session.grid);
  }
  if(!store.sessions.some(session=>session.id===store.sessionId))store.sessionId=null;
  store.version=2;return store;
}
function cleanSession(input={}){
  const name=String(input.name||'').trim();if(!name||name.length>100)throw Error('Название фотосессии: от 1 до 100 символов.');
  if(input.folder&&(!path.isAbsolute(input.folder)||input.folder.length>2048))throw Error('Выберите абсолютный путь к папке фотосессии.');
  const guides=composition(input.composition,input.grid);
  if(input.grid===false)guides.grid='off';else if(input.grid===true&&guides.grid==='off')guides.grid='thirds';
  return {name:safeName(name),client:String(input.client||'').trim().slice(0,160),description:String(input.description||'').trim().slice(0,1200),autofocus:input.autofocus!==false,grid:guides.grid!=='off',composition:guides};
}
function newSession(input,folder){const at=new Date().toISOString();return {id:crypto.randomUUID(),...cleanSession(input),captureFolder:folder,created:at,updated:at,presetQueue:[]};}
module.exports={migrateSessions,cleanSession,newSession};
