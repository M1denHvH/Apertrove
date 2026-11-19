// JSON schema boundary only: no filesystem, image codecs or native imports.
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const text=value=>typeof value==='string'&&value.length>0;
function validateLibrary(value){
  const corrupt=reason=>({kind:'CORRUPT',reason});
  if(!object(value))return corrupt('root');
  const version=own(value,'version')?value.version:1;
  if(Number.isInteger(version)&&version>2)return {kind:'UNSUPPORTED_VERSION',version};
  if(version!==1&&version!==2)return corrupt('version');
  if(!Array.isArray(value.photos)||!object(value.settings))return corrupt('photos/settings');
  for(const key of ['sessions','presets'])if(own(value,key)&&!Array.isArray(value[key]))return corrupt(key);
  if(own(value,'sessionId')&&value.sessionId!==null&&!text(value.sessionId))return corrupt('sessionId');
  for(const [key,records] of [['photos',value.photos],['sessions',value.sessions||[]],['presets',value.presets||[]]]){
    const ids=new Set();
    for(const record of records){
      if(!object(record)||!text(record.id)||ids.has(record.id))return corrupt(key+'.id');
      ids.add(record.id);
      if(key==='photos'&&!text(record.path))return corrupt('photo.path');
      if(key==='photos'){
        for(const field of ['thumbPath','previewPath'])if(own(record,field)&&record[field]!==null&&typeof record[field]!=='string')return corrupt('photo.'+field);
        if(own(record,'histogram')&&record.histogram!==null&&(!Array.isArray(record.histogram)||record.histogram.some(n=>typeof n!=='number'||!Number.isFinite(n))))return corrupt('photo.histogram');
        for(const field of ['metadata','edits'])if(own(record,field)&&record[field]!==null&&!object(record[field]))return corrupt('photo.'+field);
      }
      if(own(record,'name')&&typeof record.name!=='string')return corrupt(key+'.name');
      for(const field of key==='sessions'?['client','description']:key==='presets'?['description']:['previewError']){
        if(own(record,field)&&record[field]!==null&&typeof record[field]!=='string')return corrupt(key+'.'+field);
      }
      if(key==='sessions'){
        if(!text(record.name))return corrupt('session.name');
        if(own(record,'captureFolder')&&typeof record.captureFolder!=='string')return corrupt('session.captureFolder');
        if(own(record,'presetQueue')&&(!Array.isArray(record.presetQueue)||record.presetQueue.some(id=>!text(id))))return corrupt('session.presetQueue');
      }
      if(key==='presets'&&own(record,'values')&&!object(record.values))return corrupt('preset.values');
      if(key==='photos'&&own(record,'sessionId')&&record.sessionId!==null&&!text(record.sessionId))return corrupt('photo.sessionId');
    }
  }
  return {kind:'VALID',version};
}
function preparationCopy(value){
  // Inputs originate in JSON; preserve unknown fields without mutating parsed data.
  const copy=JSON.parse(JSON.stringify(value));
  copy.sessions??=[];copy.presets??=[];copy.sessionId??=null;
  for(const photo of copy.photos)if(photo.name===undefined)photo.name=photo.path.split(/[\\/]/).pop();
  for(const preset of copy.presets){preset.values??={};preset.name??=preset.id;}
  return copy;
}
module.exports={validateLibrary,preparationCopy};
