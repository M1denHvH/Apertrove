'use strict';
// No production application import until the addon-free parent confirms Job assignment.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {app,utilityProcess,ipcMain,session,shell,dialog}=require('electron');
const root=path.resolve(__dirname,'../..'),configPath=process.argv.find(arg=>arg.startsWith('--h2-config='))?.slice('--h2-config='.length);
const nonce=process.argv.find(arg=>arg.startsWith('--h2-nonce='))?.slice('--h2-nonce='.length);
if(!configPath||!path.isAbsolute(configPath)||!/^[a-f0-9]{48}$/.test(nonce||''))throw Error('H2_ENTRY_ADMISSION_REQUIRED');
const config=JSON.parse(fs.readFileSync(configPath,'utf8'));
if(config.nonce!==nonce||config.kind!=='H2_REAL_ELECTRON_CONTROLS_ONLY'||process.env.NODE_OPTIONS||process.env.NODE_PATH||process.env.FOCAL_TEST_DATA!==path.join(config.output,'profile'))throw Error('H2_ENTRY_CONFIGURATION_MISMATCH');
// Resolve every writable Electron location before its native startup can create children.
const paths={userData:path.join(config.output,'profile'),sessionData:path.join(config.output,'chromium'),appData:path.join(config.output,'environment','APPDATA'),temp:path.join(config.output,'temp'),crashDumps:path.join(config.output,'crashes')};
for(const [key,value]of Object.entries(paths)){fs.mkdirSync(value,{recursive:true});app.setPath(key,value);}
app.setAppPath(root);app.setAppLogsPath(path.join(config.output,'logs'));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const observations={workers:[],ipc:[],denials:[],childEvents:[],frames:{count:0,first:null,last:null}};
function save(){try{fs.writeFileSync(path.join(config.output,'electron-entry.json'),JSON.stringify({pid:process.pid,versions:process.versions,paths,observations},null,2)+'\n');}catch{}}
function deny(kind,detail){observations.denials.push({kind,detail});save();throw Error('H2_ENTRY_DENIED: '+kind);}
const rawFork=utilityProcess.fork.bind(utilityProcess);
utilityProcess.fork=(file,args=[],options={})=>{
  if(path.resolve(file)!==path.join(root,'electron','camera-worker.cjs')||observations.workers.length)return deny('utility worker',String(file));
  const worker=rawFork(path.join(__dirname,'h2-worker-entry.cjs'),args,{...options,execArgv:['--max-old-space-size=192'],env:{...options.env,APERTROVE_H2_CONFIG:configPath,APERTROVE_H2_NONCE:nonce,NODE_OPTIONS:'',NODE_PATH:''}});
  const record={logicalEntry:path.relative(root,file),pid:null,exited:false,exitCode:null};observations.workers.push(record);
  worker.on('spawn',()=>{record.pid=worker.pid;save();});worker.on('exit',code=>{record.exited=true;record.exitCode=code;save();});
  worker.on('message',message=>{if(message?.event==='photo')deny('unexpected transfer','photo');if(message?.event==='frame'){const row={workerAt:message.at,mainAt:Date.now(),sequence:message.sequence,bytes:message.data?.byteLength??message.data?.length??null};if(observations.frames.count===0)fs.writeFileSync(path.join(config.output,'first-evf.jpg'),Buffer.from(message.data));observations.frames.count++;observations.frames.first??=row;observations.frames.last=row;fs.appendFileSync(path.join(config.output,'frame-metadata.jsonl'),JSON.stringify(row)+'\n');}});return worker;
};
// flashSupport only consults production's cached result; H2 never admits the popup/probe route.
const rawHandle=ipcMain.handle.bind(ipcMain),safeIpc=new Set(['boot','equipment','equipmentPhoto','flashSupport','cameraWorking','property','live','autofocus','focus','disconnect','settings','window']);
ipcMain.handle=(channel,handler)=>rawHandle(channel,async(event,args)=>{
  const method=channel.replace(/^focal:/,'');observations.ipc.push({method,atUtc:new Date().toISOString()});
  if(observations.ipc.length>250||!safeIpc.has(method))return deny('IPC',method);
  if(method==='cameraWorking'&&(args?.controlsOnly!==true||observations.ipc.filter(item=>item.method===method).length>1))return deny('control session admission',method);
  if(method==='settings'&&(Object.keys(args||{}).length!==1||typeof args.liveHistogramEnabled!=='boolean'))return deny('isolated histogram setting only',method);
  if(method==='autofocus'&&(args?.preview!==false||observations.ipc.filter(item=>item.method===method).length>1))return deny('one AF attempt',method);
  if(method==='focus'&&(!['near','far'].includes(args?.direction)||args?.step!==1))return deny('one small lens step',method);
  if(method==='property'&&!['iso','aperture','shutter'].includes(args?.key))return deny('exposure only',method);
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
globalThis.__h2=Object.freeze({info:()=>({pid:process.pid,versions:process.versions,metrics:app.isReady()?app.getAppMetrics().map(item=>({pid:item.pid,type:item.type,serviceName:item.serviceName})):[],observations})});
fs.writeFileSync(path.join(config.output,'entry-ready.json'),JSON.stringify({pid:process.pid,parentPid:process.ppid,nonce,productionLoaded:false}));
let released=false;const gatedAt=Date.now(),pause=new Int32Array(new SharedArrayBuffer(4));
// Returning to the event loop here starts Chromium children before Job assignment.
// The independent parent/supervisor can grant admission while this main thread waits.
while(!fs.existsSync(config.gate)&&Date.now()-gatedAt<15000)Atomics.wait(pause,0,0,20);
if(!fs.existsSync(config.gate)){save();app.exit(96);}
else{
  try{
    const grant=JSON.parse(fs.readFileSync(config.gate,'utf8'));
    if(released||grant.nonce!==nonce||grant.pid!==process.pid||grant.jobAssigned!==true||!Array.isArray(grant.jobPids))throw Error('H2_GATE_INVALID');
    // Chromium startup may precede production main. A pre-assignment child must block admission.
    const startupMetrics=app.isReady()?app.getAppMetrics().map(item=>({pid:item.pid,type:item.type,serviceName:item.serviceName})):[];
    observations.startupMetrics=startupMetrics;
    if(startupMetrics.some(item=>!grant.jobPids.includes(item.pid)))throw Error('H2_STARTUP_CHILD_NOT_IN_JOB');
    for(const [name,digest] of Object.entries(config.sourceHashes))if(hash(path.join(root,name))!==digest)throw Error('H2_ENTRY_SOURCE_CHANGED: '+name);
    released=true;require('../../electron/main.cjs');
  }catch(error){fs.writeFileSync(path.join(config.output,'bootstrap-error.json'),JSON.stringify({error:String(error.stack||error)}));app.exit(98);}
}
const hard=setTimeout(()=>{save();app.exit(97);},55000);hard.unref();
