const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('cardFixtureAPI',{
  ...Object.fromEntries(['cardList','cardThumbnail','cardExport','cardExportCancel'].map(method=>[method,args=>ipcRenderer.invoke('card-ui',method,args)])),
  on:callback=>{const listener=(_event,data)=>callback(data);ipcRenderer.on('card-ui-event',listener);return()=>ipcRenderer.removeListener('card-ui-event',listener);}
});
