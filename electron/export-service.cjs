// Shared dialog/export routes. Electron dialogs and codecs are explicit ports.
const path=require('node:path');

function createExportService({exporter,showSaveDialog,getPhoto,getPresets,readMetadata,renderEditedBuffer,cleanEdits,localize=value=>value,t=key=>key,onPhotoExport=()=>{}}){
  function friendly(error){
    if(!error?.code?.startsWith('EXPORT_'))return error;
    const message=error.outputRetained?t('export.incomplete',{path:error.destination}):
      error.code==='EXPORT_PROTECTED'?t('export.protected'):
      error.code==='EXPORT_EXISTS'?t('export.exists'):
      error.code==='EXPORT_BUSY'?t('export.busy'):
      ['EXPORT_PATH','EXPORT_PARENT','EXPORT_ALIAS'].includes(error.code)?t('export.destination'):
      error.code==='EXPORT_PATH_CHANGED'?t('export.changed'):t('export.failed');
    const result=Error(message);result.code=error.code;result.cause=error;
    if(error.outputRetained){result.outputRetained=true;result.destination=error.destination;}
    return result;
  }
  async function save(options,produceBytes){
    const result=await showSaveDialog(options);
    try{return await exporter.save(result,produceBytes);}catch(error){throw friendly(error);}
  }
  return {
    async exportPhoto({id,edits}){
      const photo=getPhoto(id);
      if(/\.cr[23]$/i.test(photo.path))throw Error(localize('RAW хранится без изменений. Для экспорта обработки используйте JPEG: RAW здесь показывается через встроенную миниатюру.'));
      const output=await save({title:localize('Экспорт JPEG'),defaultPath:path.basename(photo.name,path.extname(photo.name))+'-apertrove.jpg',filters:[{name:'JPEG',extensions:['jpg']}]},()=>renderEditedBuffer(photo,cleanEdits(edits||photo.edits)));
      if(output){try{onPhotoExport(output);}catch{/* A notification cannot undo the completed file. */}}
      return output;
    },
    async exportMetadata({id}){
      const photo=getPhoto(id);
      return save({defaultPath:path.basename(photo.name,path.extname(photo.name))+'.metadata.json',filters:[{name:localize('Метаданные JSON'),extensions:['json']}]},async()=>JSON.stringify(await readMetadata(photo.path),null,2));
    },
    exportPresets(){
      return save({defaultPath:'Apertrove-presets.json',filters:[{name:localize('Пресеты Apertrove'),extensions:['json']}]},()=>JSON.stringify({version:1,presets:getPresets()},null,2));
    }
  };
}
module.exports={createExportService};
