const {contextBridge,ipcRenderer}=require('electron');
const methods=['onboardingSave','sdkEnvironment','cameraDiagnose','cameraWorking','cameraEndDiagnostics','setupFolder','canonResource','openShotInspector','flashSupport','flashPopup','boot','connect','listCameras','disconnect','live','property','focus','autofocus','capture','chooseFolder','importFiles','photoDelete','photoUpdate','photoMetadata','exportMetadata','renderPreview','exportPhoto','reveal','savePreset','deletePreset','applyPreset','exportPresets','importPresets','settings','session','sessionOpen','sessionUpdate','sessionDelete','chooseSessionFolder','seriesQueue','seriesStart','seriesStop','burstStart','burstStop','equipment','equipmentPhoto','equipmentSource','watch','listCard','importCard','intervalStart','intervalStop','window','remoteStart','remoteStop','copyRemoteLink','openRemote'];
const frameListeners=new Set();
ipcRenderer.on('focal:frame',async(_,bytes)=>{try{await Promise.all([...frameListeners].map(fn=>fn(bytes)));}catch{}finally{ipcRenderer.send('focal:frame-ack');}});
const appearanceArgument=process.argv.find(argument=>argument.startsWith('--apertrove-appearance='));
const visibilityListeners=new Set();
let windowVisible=false;
ipcRenderer.on('focal:window-visible',(_,visible)=>{windowVisible=visible;for(const fn of visibilityListeners)fn(visible);});
contextBridge.exposeInMainWorld('focal',{
  initialLocale:process.argv.find(argument=>argument.startsWith('--apertrove-locale='))?.split('=')[1],
  initialAppearance:appearanceArgument?JSON.parse(appearanceArgument.slice('--apertrove-appearance='.length)):undefined,
  onWindowVisible:fn=>{visibilityListeners.add(fn);fn(windowVisible);return()=>visibilityListeners.delete(fn);},
  ...Object.fromEntries(methods.map(name=>[name,(args)=>ipcRenderer.invoke('focal:'+name,args)])),
  onFocus:fn=>{const listener=(_,data)=>fn(data);ipcRenderer.on('focal:focus',listener);return()=>ipcRenderer.removeListener('focal:focus',listener);},
  onFrame:fn=>{frameListeners.add(fn);return()=>frameListeners.delete(fn);},
  on:(fn)=>{const listener=(_,event)=>fn(event);ipcRenderer.on('focal:event',listener);return()=>ipcRenderer.removeListener('focal:event',listener);}
});
