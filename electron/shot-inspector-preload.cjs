const { contextBridge, ipcRenderer } = require('electron');

const appearanceArgument=process.argv.find(argument=>argument.startsWith('--apertrove-appearance='));
contextBridge.exposeInMainWorld('shotInspector',{
  initialLocale:process.argv.find(argument=>argument.startsWith('--apertrove-locale='))?.split('=')[1],
  initialAppearance:appearanceArgument?JSON.parse(appearanceArgument.slice('--apertrove-appearance='.length)):undefined,
  boot: () => ipcRenderer.invoke('shot:boot'),
  view: (id, revision) => ipcRenderer.invoke('shot:view', { id, revision }),
  reveal: id => ipcRenderer.invoke('shot:reveal', { id }),
  copy: text => ipcRenderer.invoke('shot:copy', { text }),
  onState: callback => subscribe('shot:state', callback),
  onDetails: callback => subscribe('shot:details', callback)
});

function subscribe(channel, callback) {
  const listener = (_event, data) => callback(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
