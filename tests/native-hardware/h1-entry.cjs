'use strict';
// No production application import until the addon-free parent confirms Job assignment.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {app,utilityProcess,ipcMain,session,shell,dialog}=require('electron');
const root=path.resolve(__dirname,'../..'),configPath=process.argv.find(arg=>arg.startsWith('--h1-config='))?.slice('--h1-config='.length);
const nonce=process.argv.find(arg=>arg.startsWith('--h1-nonce='))?.slice('--h1-nonce='.length);
if(!configPath||!path.isAbsolute(configPath)||!/^[a-f0-9]{48}$/.test(nonce||''))throw Error('H1_ENTRY_ADMISSION_REQUIRED');
const config=JSON.parse(fs.readFileSync(configPath,'utf8'));
if(config.nonce!==nonce||config.kind!=='H1_REAL_ELECTRON_READ_ONLY'||process.env.NODE_OPTIONS||process.env.NODE_PATH||process.env.FOCAL_TEST_DATA!==path.join(config.output,'profile'))throw Error('H1_ENTRY_CONFIGURATION_MISMATCH');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const observations={workers:[],ipc:[],denials:[],childEvents:[]};
function save(){try{fs.writeFileSync(path.join(config.output,'electron-entry.json'),JSON.stringify({pid:process.pid,versions:process.versions,paths:{userData:app.getPath('userData'),appData:app.getPath('appData')},observations},null,2)+'\n');}catch{}}
function deny(kind,detail){observations.denials.push({kind,detail});save();throw Error('H1_ENTRY_DENIED: '+kind);}
const rawFork=utilityProcess.fork.bind(utilityProcess);
utilityProcess.fork=(file,args=[],options={})=>{
  if(path.resolve(file)!==path.join(root,'electron','camera-worker.cjs')||observations.workers.length)return deny('utility worker',String(file));
  const worker=rawFork(path.join(__dirname,'h1-worker-entry.cjs'),args,{...options,execArgv:['--max-old-space-size=192'],env:{...options.env,APERTROVE_H1_CONFIG:configPath,APERTROVE_H1_NONCE:nonce,NODE_OPTIONS:'',NODE_PATH:''}});
  const record={logicalEntry:path.relative(root,file),pid:null,exited:false,exitCode:null};observations.workers.push(record);
  worker.on('spawn',()=>{record.pid=worker.pid;save();});worker.on('exit',code=>{record.exited=true;record.exitCode=code;save();});return worker;
};
// flashSupport only consults production's cached result; H1 never admits the popup/probe route.
const rawHandle=ipcMain.handle.bind(ipcMain),safeIpc=new Set(['boot','equipment','equipmentPhoto','flashSupport','cameraDiagnose','cameraEndDiagnostics','window']);
ipcMain.handle=(channel,handler)=>rawHandle(channel,async(event,args)=>{
  const method=channel.replace(/^focal:/,'');observations.ipc.push({method,atUtc:new Date().toISOString()});
  if(observations.ipc.length>100||!safeIpc.has(method))return deny('IPC',method);
  if(method==='cameraDiagnose'&&observations.ipc.filter(item=>item.method===method).length>1)return deny('diagnostic retry',method);
  if(method==='window'&&args?.action!=='close')return deny('window action',args?.action);
  return handler(event,args);
});
app.on('session-created',value=>value.webRequest.onBeforeRequest({urls:['<all_urls>']},(request,callback)=>{
  const protocol=new URL(request.url).protocol;callback({cancel:['http:','https:','ws:','wss:','ftp:'].includes(protocol)});
}));
for(const name of ['openExternal','openPath','showItemInFolder','trashItem'])shell[name]=()=>deny('shell',name);
for(const name of ['showOpenDialog','showSaveDialog','showMessageBox','showErrorBox'])dialog[name]=()=>deny('dialog',name);
app.on('child-process-gone',(_event,value)=>{observations.childEvents.push(value);save();});
app.on('will-quit',save);process.on('exit',save);
globalThis.__h1=Object.freeze({info:()=>({pid:process.pid,versions:process.versions,metrics:app.isReady()?app.getAppMetrics().map(item=>({pid:item.pid,type:item.type,serviceName:item.serviceName})):[],observations})});
fs.writeFileSync(path.join(config.output,'entry-ready.json'),JSON.stringify({pid:process.pid,parentPid:process.ppid,nonce,productionLoaded:false}));
let released=false;const gatedAt=Date.now();
const timer=setInterval(()=>{
  if(Date.now()-gatedAt>15000){clearInterval(timer);save();app.exit(96);return;}
  if(!fs.existsSync(config.gate))return;
  try{
    const grant=JSON.parse(fs.readFileSync(config.gate,'utf8'));
    if(released||grant.nonce!==nonce||grant.pid!==process.pid||grant.jobAssigned!==true||!Array.isArray(grant.jobPids))throw Error('H1_GATE_INVALID');
    // Chromium startup may precede production main. A pre-assignment child must block admission.
    const startupMetrics=app.isReady()?app.getAppMetrics().map(item=>({pid:item.pid,type:item.type,serviceName:item.serviceName})):[];
    observations.startupMetrics=startupMetrics;
    if(startupMetrics.some(item=>!grant.jobPids.includes(item.pid)))throw Error('H1_STARTUP_CHILD_NOT_IN_JOB');
    for(const [name,digest] of Object.entries(config.sourceHashes))if(hash(path.join(root,name))!==digest)throw Error('H1_ENTRY_SOURCE_CHANGED: '+name);
    released=true;clearInterval(timer);require('../../electron/main.cjs');
  }catch(error){fs.writeFileSync(path.join(config.output,'bootstrap-error.json'),JSON.stringify({error:String(error.stack||error)}));app.exit(98);}
},20);
const hard=setTimeout(()=>{save();app.exit(97);},45000);hard.unref();
