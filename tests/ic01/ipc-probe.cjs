'use strict';
// Actual Electron IPC probes. Production BrowserWindow/preferences are untouched.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'../..');
const inside=(base,file)=>{const relative=path.relative(base,file);return relative===''||!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep);};
function assert(value,code){if(!value)throw Object.assign(Error(code),{code});}
async function runIpcProbe({electron,win,fixtureRoot}){
  const {app,BrowserWindow,ipcMain,clipboard}=electron;
  assert(app.isPackaged===false&&win&&!win.isDestroyed(),'IC01_LIVE_UNPACKAGED_MAIN_REQUIRED');
  assert(typeof fixtureRoot==='string'&&path.isAbsolute(fixtureRoot)&&inside(path.join(ROOT,'qa/integration-candidate/fixtures'),fixtureRoot),'IC01_PROBE_FIXTURE_REQUIRED');
  assert(fs.realpathSync(fixtureRoot).toLowerCase()===path.resolve(fixtureRoot).toLowerCase()&&!fs.lstatSync(fixtureRoot).isSymbolicLink(),'IC01_PROBE_FIXTURE_ALIAS');
  const directory=fs.mkdtempSync(path.join(fixtureRoot,'ipc-probe-'));
  const childFile=path.join(directory,'child.html'),mainFile=path.join(directory,'main.html');
  const policy="default-src 'none'; frame-src file:; script-src 'none'; style-src 'none'; object-src 'none'; base-uri 'none'";
  fs.writeFileSync(childFile,'<!doctype html><meta http-equiv="Content-Security-Policy" content="'+policy+'"><title>IC01 fixed child</title><p>Fixed synthetic subframe</p>',{flag:'wx'});
  fs.writeFileSync(mainFile,'<!doctype html><meta http-equiv="Content-Security-Policy" content="'+policy+'"><title>IC01 fixed foreign frame</title><iframe src="./child.html" title="Fixed synthetic child"></iframe>',{flag:'wx'});
  const result={unknownRejected:false,unauthorizedRejected:false,subframeRejected:null,permissionsDenied:false,newWindowDenied:false,navigationDenied:false,clipboardScoped:false,subframeStatus:'NOT RUN',observations:[]};
  const preload=path.join(__dirname,'probe-preload.cjs');
  const normal=await win.webContents.executeJavaScript("(async()=>({namedApi:typeof window.focal?.boot==='function'&&typeof window.focal?.copyColor==='function',rawNodeAbsent:typeof window.require==='undefined',accepted:!!(await window.focal.boot())}))()",true);
  assert(normal.namedApi&&normal.rawNodeAbsent&&normal.accepted,'IC01_VALID_MAINFRAME_IPC_FAILED');
  result.observations.push({kind:'valid-mainframe',...normal});
  async function foreignProbe(subframes){
    const id=crypto.randomUUID(),channel='ic01:probe:'+id,observations=[];let probe=null,finish,timer,count=0;
    const awaited=new Promise(resolve=>{finish=resolve;});
    const listener=(event,data)=>{
      if(!probe||probe.isDestroyed()||event.sender!==probe.webContents||!event.senderFrame)return;
      if(++count>8){finish({failed:true,reason:'PROBE_TELEMETRY_BUDGET'});return;}
      if(!data||data.version!==1||Object.keys(data).some(key=>!['version','bootRejected','bootSourceRejected','unknownRejected','isMainFrame','sandboxed'].includes(key))||['bootRejected','bootSourceRejected','unknownRejected','isMainFrame','sandboxed'].some(key=>typeof data[key]!=='boolean'))return;
      const frame=event.senderFrame;
      if(!frame.url.startsWith('file:')||!frame.url.includes(path.basename(directory)))return;
      const actualSubframe=frame.parent!==null;
      if(data.isMainFrame===actualSubframe)return;
      const record={kind:subframes?'sandboxed-subframe-probe':'foreign-mainframe-probe',actualSubframe,senderIsProduction: event.sender===win.webContents,sourceRejected:data.bootSourceRejected===true,bootRejected:data.bootRejected===true,unknownRejected:data.unknownRejected===true,sandboxed:data.sandboxed===true};
      observations.push(record);
      if(subframes?actualSubframe:!actualSubframe)finish({record});
    };
    ipcMain.on(channel,listener);
    try{
      probe=new BrowserWindow({show:false,width:320,height:240,webPreferences:{preload,additionalArguments:['--ic01-probe-id='+id],partition:'ic01-probe-'+id,contextIsolation:true,nodeIntegration:false,nodeIntegrationInSubFrames:subframes,sandbox:true,webSecurity:true}});
      const preferences=probe.webContents.getLastWebPreferences();
      if(preferences.sandbox!==true){return {notRun:true,reason:'REQUESTED_SANDBOX_NOT_EFFECTIVE',observations};}
      probe.webContents.setWindowOpenHandler(()=>({action:'deny'}));probe.webContents.on('will-navigate',event=>event.preventDefault());
      timer=setTimeout(()=>finish({notRun:true,reason:subframes?'NO_SANDBOXED_SUBFRAME_PRELOAD_TELEMETRY':'FOREIGN_PROBE_TELEMETRY_DEADLINE'}),2500);
      await Promise.race([probe.loadFile(mainFile),awaited]);
      const outcome=await awaited;
      if(outcome.record&&!outcome.record.sandboxed)return {notRun:true,reason:'PRELOAD_DID_NOT_CONFIRM_SANDBOX',observations};
      return {...outcome,observations};
    }finally{clearTimeout(timer);ipcMain.removeListener(channel,listener);if(probe&&!probe.isDestroyed())probe.destroy();}
  }
  const foreign=await foreignProbe(false);result.observations.push(...foreign.observations);
  assert(foreign.record&&foreign.record.bootRejected&&foreign.record.sourceRejected&&foreign.record.unknownRejected&&foreign.record.sandboxed,'IC01_FOREIGN_MAINFRAME_REJECTION_FAILED');
  result.unknownRejected=foreign.record.unknownRejected;result.unauthorizedRejected=foreign.record.sourceRejected;
  const subframe=await foreignProbe(true);result.observations.push(...subframe.observations);
  if(subframe.record){assert(subframe.record.actualSubframe&&subframe.record.bootRejected&&subframe.record.sourceRejected&&subframe.record.sandboxed,'IC01_SUBFRAME_REJECTION_FAILED');result.subframeRejected=true;result.subframeStatus='PASS';}
  else{result.subframeStatus='NOT RUN';result.subframeReason=subframe.reason||'SANDBOXED_SUBFRAME_UNAVAILABLE';}
  result.subframeLimitation='Actual subframe belongs to a foreign probe WebContents. This does not isolate the second senderFrame condition for the production WebContents.';
  const permission=await win.webContents.executeJavaScript("(async()=>({supported:typeof Notification!=='undefined',permission:typeof Notification==='undefined'?'unavailable':await Notification.requestPermission()}))()",true);
  result.permissionsDenied=permission.supported&&permission.permission==='denied';assert(result.permissionsDenied,'IC01_PERMISSION_NOT_DENIED');
  const beforeWindows=new Set(BrowserWindow.getAllWindows().map(window=>window.id));let created=0;
  const createdListener=()=>{created++;};win.webContents.on('did-create-window',createdListener);
  try{
    const returnedNull=await win.webContents.executeJavaScript("window.open('about:blank')===null",true);
    await new Promise(resolve=>setTimeout(resolve,100));
    const extra=BrowserWindow.getAllWindows().filter(window=>!beforeWindows.has(window.id));
    result.newWindowDenied=returnedNull&&created===0&&extra.length===0;
    for(const window of extra)if(!window.isDestroyed())window.destroy();
    assert(result.newWindowDenied,'IC01_UNEXPECTED_NEW_WINDOW');
  }finally{win.webContents.removeListener('did-create-window',createdListener);}
  const previousURL=win.webContents.getURL(),target='https://ic01.invalid/blocked-navigation';let navTimer;
  let navigated;const navigation=new Promise(resolve=>{navigated=resolve;});
  const navListener=(event,url)=>{if(url===target)navigated({prevented:event.defaultPrevented===true});};
  win.webContents.on('will-navigate',navListener);
  try{
    navTimer=setTimeout(()=>navigated({prevented:false}),1500);
    await win.webContents.executeJavaScript('location.href='+JSON.stringify(target)+';true',true);
    const observation=await navigation;result.navigationDenied=observation.prevented&&win.webContents.getURL()===previousURL;
    assert(result.navigationDenied,'IC01_NAVIGATION_NOT_PREVENTED_BY_PRODUCTION');
    // The denied attempt can leave Chromium's loading signal pending for CDP.
    // Stop that test navigation after proving the production policy blocked it.
    win.webContents.stop();
  }finally{clearTimeout(navTimer);win.webContents.removeListener('will-navigate',navListener);}
  const badRejected=await win.webContents.executeJavaScript("window.focal.copyColor({text:'invalid'}).then(()=>false,()=>true)",true);
  assert(badRejected,'IC01_INVALID_CLIPBOARD_ARGUMENT_ACCEPTED');
  const wrote=await win.webContents.executeJavaScript("window.focal.copyColor({text:'#112233'})",true);
  assert(wrote===true,'IC01_OWN_CLIPBOARD_WRITE_NOT_ACKNOWLEDGED');
  const ownText=await clipboard.readText();result.clipboardScoped=ownText==='#112233';
  if(result.clipboardScoped)clipboard.clear();
  assert(result.clipboardScoped,'IC01_OWN_CLIPBOARD_READBACK_FAILED');
  result.observations.push({kind:'clipboard',invalidRejected:badRejected,ownWriteAcknowledged:wrote===true,ownTextMatched:result.clipboardScoped,clearedOwnValue:result.clipboardScoped,priorClipboardRead:false});
  return result;
}
module.exports={runIpcProbe};
