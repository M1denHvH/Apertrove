'use strict';
// Trusted Electron entry only; never shipped by the production package allowlist.
const electron=require('electron'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {app,utilityProcess,dialog,shell,net,session}=electron,ROOT=path.resolve(__dirname,'../..');
if(app.isPackaged||process.versions.electron!=='45.3.2'||process.env.NODE_OPTIONS||process.env.NODE_PATH||process.env.FOCAL_DEV_URL||process.argv.some(arg=>/^(?:--no-sandbox|--disable-web-security)(?:=|$)/.test(arg)))throw Error('IC01_TRUSTED_UNPACKAGED_ENTRY_REQUIRED');
const args=process.argv.filter(arg=>arg.startsWith('--fixture='));if(args.length!==1)throw Error('IC01_EXPLICIT_FIXTURE_REQUIRED');
const fixtureRoot=fs.realpathSync(args[0].slice(10)),base=path.join(ROOT,'qa/integration-candidate/fixtures');
const inside=(root,file)=>{const relative=path.relative(root,file);return relative===''||!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep);};
if(!inside(base,fixtureRoot)||fixtureRoot===base)throw Error('IC01_FIXTURE_ESCAPE');
for(let file=fixtureRoot;;file=path.dirname(file)){if(fs.lstatSync(file).isSymbolicLink())throw Error('IC01_FIXTURE_ALIAS');if(file===path.parse(file).root)break;}
const dataFolder=path.join(fixtureRoot,'user-data');fs.mkdirSync(dataFolder,{recursive:true});
for(const key of ['USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP']){const value=process.env[key];if(!value||!inside(fixtureRoot,path.resolve(value)))throw Error('IC01_PROFILE_ENVIRONMENT_REQUIRED');fs.mkdirSync(value,{recursive:true});}
const configFile=path.join(fixtureRoot,'config.json'),config=fs.existsSync(configFile)?JSON.parse(fs.readFileSync(configFile,'utf8')):{};
if(Object.keys(config).some(key=>!['readFault'].includes(key)))throw Error('IC01_UNKNOWN_FIXTURE_CONFIGURATION');
const paths={userData:dataFolder,sessionData:path.join(fixtureRoot,'chromium'),appData:process.env.APPDATA,temp:process.env.TEMP,crashDumps:path.join(fixtureRoot,'crashes')};
for(const [key,value]of Object.entries(paths)){fs.mkdirSync(value,{recursive:true});app.setPath(key,value);}
app.setAppPath(ROOT);app.setAppLogsPath(path.join(fixtureRoot,'logs'));
process.env.FOCAL_TEST_DATA=dataFolder;process.env.FOCAL_TEST_ONBOARDING=fs.existsSync(path.join(dataFolder,'library.json'))?'0':'1';
for(const flag of ['disable-background-networking','disable-component-update','disable-sync','no-first-run'])app.commandLine.appendSwitch(flag);
app.commandLine.appendSwitch('proxy-server','http://127.0.0.1:9');
app.commandLine.appendSwitch('host-resolver-rules','MAP * ~NOTFOUND, EXCLUDE localhost');
let diagnosticGuard=null;
try{
const {installGuard}=require('./guard.cjs'),guard=installGuard({root:ROOT,fixtureRoot,mode:'main'});
diagnosticGuard=guard;
for(const request of ['koffi','../../electron/camera-worker.cjs','../../electron/flash-bridge.cjs'])guard.expect(()=>require(request));
guard.expect(()=>require('node:child_process').execFile('powershell.exe',[]));
guard.expect(()=>require('node:net').connect(443,'example.invalid'));
guard.expect(()=>process.dlopen({},path.join(fixtureRoot,'forbidden.node')));
guard.expect(()=>require('node:fs').readFileSync(path.join(path.parse(ROOT).root,'IC01-not-admitted.jpg')));
if(config.readFault)guard.fault('read');
const observations={sessions:[],network:[],shell:[],dialogs:[],workers:[],windows:[],childEvents:[]},dialogQueues={open:[],save:[]};
const cap=(array,value)=>{if(array.length<128)array.push(value);else throw Error('IC01_OBSERVATION_BUDGET');};
function deny(kind){throw Object.assign(Error('IC01_FORBIDDEN_'+kind),{code:'IC01_FORBIDDEN'});}
function admittedBrowserFile(url){
  const file=require('node:url').fileURLToPath(url),absolute=path.resolve(file);
  if(!inside(fixtureRoot,absolute)&&!inside(path.join(ROOT,'dist'),absolute))return false;
  try{for(let p=absolute;;p=path.dirname(p)){if(fs.lstatSync(p).isSymbolicLink())return false;if(p===ROOT)break;if(!inside(ROOT,p))return false;}return inside(ROOT,fs.realpathSync(absolute));}catch{return false;}
}
function fenceSession(value){
  if(observations.sessions.includes(value.partition||'<default>')&&value===session.defaultSession)return;
  cap(observations.sessions,value.partition||'<session>');
  value.webRequest.onBeforeRequest({urls:['<all_urls>']},(details,callback)=>{const protocol=new URL(details.url).protocol;if(['http:','https:','ws:','wss:','ftp:'].includes(protocol)||protocol==='file:'&&!admittedBrowserFile(details.url)){cap(observations.network,{protocol,blocked:true});callback({cancel:true});}else callback({cancel:false});});
}
app.on('session-created',fenceSession);app.whenReady().then(()=>fenceSession(session.defaultSession));
const rawNetFetch=net.fetch.bind(net);net.fetch=(url,...options)=>{const value=new URL(String(url));if(value.protocol!=='file:')return Promise.reject(Error('IC01_NET_FETCH_DENIED'));const filename=require('node:url').fileURLToPath(value);guard.checkFile(filename);return rawNetFetch(url,...options);};
for(const name of ['openExternal','openPath','showItemInFolder','trashItem'])shell[name]=()=>{cap(observations.shell,name);return deny('SHELL');};
dialog.showOpenDialog=async()=>{const result=dialogQueues.open.shift();if(!result)throw Error('IC01_UNSCRIPTED_OPEN_DIALOG');cap(observations.dialogs,{type:'open',canceled:result.canceled});return result;};
dialog.showSaveDialog=async()=>{const result=dialogQueues.save.shift();if(!result)throw Error('IC01_UNSCRIPTED_SAVE_DIALOG');cap(observations.dialogs,{type:'save',canceled:result.canceled});return result;};
dialog.showErrorBox=()=>deny('ERROR_DIALOG');
const rawFork=utilityProcess.fork.bind(utilityProcess),actualInspector=path.join(ROOT,'electron/shot-inspector-worker.cjs'),fakeFile=path.join(__dirname,'fake-camera.cjs');
utilityProcess.fork=(file,args=[],options={})=>{
  if(observations.workers.length>=8)throw Error('IC01_WORKER_BUDGET');
  const logical=path.resolve(file),camera=logical===fakeFile,inspector=logical===actualInspector;
  if(!camera&&!inspector)deny('UTILITY_ENTRY');
  if(camera&&(!args.includes('--ic01-fake-provider')||!options.env?.APERTROVE_IC01_CONTROL_TOKEN))deny('FAKE_WORKER_CONFIGURATION');
  const entry=inspector?path.join(__dirname,'inspector-entry.cjs'):logical;
  const child=rawFork(entry,args,{...options,execArgv:['--max-old-space-size=128'],env:{...options.env,...(inspector?{...process.env,IC01_FIXTURE:fixtureRoot,APERTROVE_IC01_FIXTURE:fixtureRoot}:{}),NODE_OPTIONS:'',NODE_PATH:''}});
  const record={kind:camera?'synthetic-camera':'real-inspector-codec',logicalEntry:path.relative(ROOT,logical),entry:path.relative(ROOT,entry),pid:null,exited:false,exitCode:null};cap(observations.workers,record);
  child.on('spawn',()=>{record.pid=child.pid;});child.on('exit',code=>{record.exited=true;record.exitCode=code;});child.on('message',message=>{if(camera&&message.event==='ready')record.provider=message.data;if(inspector&&message.ic01Guard)record.guard=message.ic01Guard;});return child;
};
app.on('browser-window-created',(_event,window)=>{cap(observations.windows,{id:window.id,sandbox:window.webContents.getLastWebPreferences().sandbox,nodeIntegration:window.webContents.getLastWebPreferences().nodeIntegration});});
app.on('child-process-gone',(_event,details)=>cap(observations.childEvents,{type:details.type,reason:details.reason,exitCode:details.exitCode}));
const {createFakeCamera}=require('./admission.cjs'),camera=createFakeCamera({app,fixtureRoot});
let main=null,currentWorker=null,workerReady=false,workerHistory=[];
const flash={createFlashBridge:()=>({probe:async()=>({available:false,canAttempt:false,synthetic:true}),cached:async()=>({available:false,canAttempt:false,synthetic:true}),popup:async()=>deny('WIA')}),withFlashConnection:async()=>deny('WIA'),flashAvailability:()=>({available:false,canAttempt:false,synthetic:true})};
require('../../electron/integration-composition.cjs').install({fixtureRoot,dataFolder,camera,flash,requestTimeoutMs:method=>['capture','importCard'].includes(method)?180:null,onWorker:(worker,channel)=>{currentWorker={worker,channel};workerHistory.push(channel.generation);workerReady=false;worker.on('message',message=>{if(message.event==='ready')workerReady=true;});},onReady:value=>{main=value;}});
function snapshot(){try{return main?.getState()||null;}catch{return null;}}
function metrics(){try{return app.getAppMetrics().map(value=>({pid:value.pid,type:value.type,serviceName:value.serviceName||null,name:value.name||null}));}catch{return[];}}
function info(){return {electronVersion:process.versions.electron,versions:{electron:process.versions.electron,node:process.versions.node,chrome:process.versions.chrome},processId:process.pid,processes:metrics(),paths,fixtureRoot,observations,guard:guard.evidence(),provider:camera.evidence(),workerReady,workerGenerations:[...workerHistory],operationState:snapshot()?.operationState||null,shutdown:main?.shutdown.getState()||null};}
globalThis.__ic01=Object.freeze({
  info,snapshot:()=>new Promise(resolve=>setImmediate(()=>resolve(snapshot()))),
  dialog(type,result){if(!Object.hasOwn(dialogQueues,type)||!result||typeof result.canceled!=='boolean')throw Error('IC01_DIALOG_CONFIGURATION');for(const file of type==='open'?result.filePaths||[]:result.filePath?[result.filePath]:[]){if(!inside(fixtureRoot,path.resolve(file)))throw Error('IC01_DIALOG_ESCAPE');}dialogQueues[type].push(result);return true;},
  fault:name=>guard.fault(name),
  reload:()=>new Promise((resolve,reject)=>{const window=main.getWindow(),timer=setTimeout(()=>reject(Error('IC01_RELOAD_DEADLINE')),6000);window.webContents.once('did-finish-load',()=>{clearTimeout(timer);resolve(true);});window.webContents.reload();}),
  workerControl:async(action,options={})=>{if(!currentWorker)throw Error('IC01_NO_WORKER');return camera.sendControl(currentWorker.worker,action,options);},
  forceWorker:async()=>{const owned=currentWorker?.worker;if(!owned)throw Error('IC01_NO_WORKER');return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('IC01_FORCE_DEADLINE')),1500);owned.once('exit',code=>{clearTimeout(timer);resolve({exitCode:code});});owned.kill();});},
  ipcProbe:async()=>require('./ipc-probe.cjs').runIpcProbe({electron,win:main.getWindow(),fixtureRoot})
});
const writeEvidence=()=>{try{fs.writeFileSync(path.join(fixtureRoot,'runtime.json'),JSON.stringify(info(),null,2));}catch(error){process.stderr.write('IC01_EVIDENCE_WRITE_FAILED '+error.code+'\n');}};
app.on('will-quit',writeEvidence);process.on('exit',writeEvidence);
const hardDeadline=setTimeout(()=>{writeEvidence();app.exit(97);},75000);hardDeadline.unref();
require('../../electron/main.cjs');
}catch(error){fs.writeFileSync(path.join(fixtureRoot,'bootstrap-error.json'),JSON.stringify({code:error.code,message:error.message,stack:error.stack,guard:diagnosticGuard?.evidence()},null,2));app.exit(98);}
