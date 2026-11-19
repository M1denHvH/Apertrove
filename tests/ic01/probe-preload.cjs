'use strict';
// Fixed hostile-probe telemetry only. This preload exposes no renderer API.
const {ipcRenderer}=require('electron');
const id=process.argv.find(value=>value.startsWith('--ic01-probe-id='))?.slice('--ic01-probe-id='.length);
if(!/^[a-f0-9-]{36}$/.test(id||''))throw Error('IC01_PROBE_ID_REQUIRED');
async function report(){
  if(location.protocol!=='file:')return;
  let bootRejected=false,bootSourceRejected=false,unknownRejected=false;
  try{await ipcRenderer.invoke('focal:boot',{});}catch(error){bootRejected=true;bootSourceRejected=String(error.message).includes('Недопустимый источник.');}
  try{await ipcRenderer.invoke('focal:ic01-unknown',{});}catch{unknownRejected=true;}
  ipcRenderer.send('ic01:probe:'+id,{version:1,bootRejected,bootSourceRejected,unknownRejected,isMainFrame:process.isMainFrame===true,sandboxed:process.sandboxed===true});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>void report(),{once:true});else void report();
