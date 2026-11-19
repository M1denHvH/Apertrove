'use strict';
// Named real Electron smoke. The trusted entry installs the admitted fake provider.
if(require.main!==module||process.argv.slice(2).join(' ')!=='--tier T2 --scope synthetic --allow-electron-ic01'||process.env.NODE_OPTIONS||process.env.NODE_PATH||!/^[a-f0-9]{40}$/i.test(process.env.APERTROVE_SOURCE_COMMIT||'')||!process.execArgv.includes('--no-addons')){
  console.error('IC01_SMOKE_ADMISSION_REFUSED');process.exitCode=2;
}else main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});

async function main(){
  const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),Module=require('node:module'),cp=require('node:child_process'),net=require('node:net'),tls=require('node:tls'),dns=require('node:dns');
  const root=path.resolve(__dirname,'../..'),qa=path.join(root,'qa/integration-candidate'),fixtures=path.join(qa,'fixtures');
  assert.equal(process.platform,'win32');assert.equal(process.arch,'x64');assert.equal(fs.realpathSync(process.cwd()),fs.realpathSync(root));
  assert.ok(process.execArgv.every(flag=>flag==='--no-addons'||/^--max-old-space-size=(192|256|384)$/.test(flag)));
  assert.ok(process.execArgv.some(flag=>/^--max-old-space-size=(192|256|384)$/.test(flag)),'Explicit parent heap bound required');
  const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex'),hash=file=>sha(fs.readFileSync(file));
  const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
  const within=(base,file)=>{const relative=path.relative(base,file);return relative===''||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
  function safeFolder(folder){assert.ok(within(root,folder));let current=folder;while(current!==root){if(fs.existsSync(current)){assert.equal(fs.lstatSync(current).isSymbolicLink(),false);assert.ok(within(root,fs.realpathSync(current)));}current=path.dirname(current);}}
  safeFolder(fixtures);fs.mkdirSync(fixtures,{recursive:true});
  const runRoot=fs.mkdtempSync(path.join(fixtures,'smoke-')),started=Date.now(),results=[],apps=[],denials=[],spawns=[],connections=[],physical=new Map(),sourceHashes={};
  for(const key of ['USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP']){const directory=path.join(runRoot,'host-environment',key);fs.mkdirSync(directory,{recursive:true});process.env[key]=directory;}
  const admission=read(path.join(qa,'runtime/admission.json')),binary=admission.binary.path,entry=path.join(__dirname,'entry.cjs');
  assert.equal(admission.version,'45.3.2');assert.equal(admission.architecture,'x64');assert.equal(hash(binary),admission.binary.sha256);assert.ok(within(path.join(qa,'runtime'),binary));
  assert.equal(read(path.join(root,'package.json')).devDependencies.electron,admission.version);
  assert.equal(read(path.join(root,'package-lock.json')).packages['node_modules/electron'].version,admission.version);
  const seed=require('./fixture-image.cjs');const seedBytes=Buffer.from(seed.jpegBase64,'base64');assert.equal(sha(seedBytes),seed.sha256);
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMIqFgAAAKEAWkyLad+AAAAAElFTkSuQmCC','base64');
  for(const folder of ['electron','tests/ic01','dist']){
    function scan(directory){for(const item of fs.readdirSync(directory,{withFileTypes:true})){assert.equal(item.isSymbolicLink(),false);const file=path.join(directory,item.name);if(item.isDirectory())scan(file);else if(folder==='dist'||/\.(?:[cm]?js|jsx|json|html|css)$/.test(file))sourceHashes[path.relative(root,file).replaceAll('\\','/')]=hash(file);}}
    scan(path.join(root,folder));
  }
  const originalSpawn=cp.spawn,originalExecFile=cp.execFile,originalLoad=Module._load,originalConnect=net.Socket.prototype.connect;
  let expected=false,launching=null,active=null,finishing=false;
  function deny(kind,detail){denials.push({kind,detail:String(detail).slice(0,500),expected});throw Object.assign(Error('IC01_HOST_DENIED: '+kind),{code:'IC01_HOST_DENIED'});}
  Module._load=function(request,parent,isMain){if(/^(?:electron|koffi|sharp)(?:\/|$)|camera-worker|sdk-environment|flash-wia|\.node$|\.dll$/i.test(String(request)))return deny('import',request);return originalLoad.apply(this,arguments);};
  Module._extensions['.node']=(_module,file)=>deny('addon',file);process.dlopen=()=>deny('dlopen','native host modules are not admitted');
  cp.spawn=function(command,args,options){
    if(launching){const expectedCommand=[binary,'--inspect=0','--remote-debugging-port=0',entry,'--fixture='+launching.folder].map(value=>'"'+value+'"').join(' ');
      if(command!==expectedCommand||!Array.isArray(args)||args.length||options?.shell!==true)return deny('spawn arguments',command);
      for(const key of ['USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP'])assert.ok(within(launching.folder,options.env[key]));
      assert.ok(!/--(?:no-sandbox|disable-web-security|disable-sandbox)/.test(command));
      const test=launching,child=originalSpawn.call(this,command,args,options);test.process=child;test.parentPid=child.pid;test.stderr='';child.stderr?.on('data',data=>{test.stderr=(test.stderr+String(data)).slice(-24000);});spawns.push({kind:'Electron via reviewed Windows shell',pid:child.pid,fixture:test.name,command});return child;
    }
    if(/^(?:taskkill|taskkill\.exe)$/i.test(String(command))&&Array.isArray(args)&&args.includes('/pid')&&spawns.some(item=>String(item.pid)===String(args[args.indexOf('/pid')+1])))return originalSpawn.call(this,command,args,options);
    return deny('spawn',command);
  };
  for(const method of ['exec','execSync','execFileSync','spawnSync','fork'])cp[method]=()=>deny('subprocess',method);
  cp.execFile=function(command,args,...rest){if(/(?:^|[\\/])taskkill(?:\.exe)?$/i.test(String(command))&&Array.isArray(args)&&args.includes('/pid')&&spawns.some(item=>String(item.pid)===String(args[args.indexOf('/pid')+1])))return originalExecFile.call(this,command,args,...rest);return deny('execFile',command);};
  net.Socket.prototype.connect=function(...args){let options=args[0];if(Array.isArray(options))options=options[0];const host=typeof options==='object'?(options.host||options.hostname||'localhost'):typeof args[1]==='string'?args[1]:'localhost',port=typeof options==='object'?Number(options.port):Number(options);if(!['127.0.0.1','localhost','::1'].includes(host)||!Number.isInteger(port)||port<1024||port>65535)return deny('outbound socket',host+':'+port);connections.push({host,port});return originalConnect.apply(this,args);};
  net.Server.prototype.listen=()=>deny('listener','host runner needs no listener');tls.connect=()=>deny('TLS','not admitted');global.fetch=()=>deny('fetch','not admitted');
  const originalLookup=dns.lookup;dns.lookup=function(host,...args){if(!['localhost','127.0.0.1','::1'].includes(host))return deny('DNS',host);return originalLookup.call(this,host,...args);};
  for(const method of ['resolve','resolve4','resolve6','reverse'])dns[method]=()=>deny('DNS',method);
  for(const action of [()=>require('koffi'),()=>cp.execFile('powershell.exe',[]),()=>net.connect(80,'example.invalid')]){expected=true;assert.throws(action,error=>error.code==='IC01_HOST_DENIED');expected=false;}
  const {_electron}=require('playwright');
  const catalogs=Object.fromEntries(['en-US','ru-RU'].map(locale=>[locale,read(path.join(root,'electron/i18n/locales',locale+'.json'))]));
  function valid(folder){const at='2026-11-19T00:00:00.000Z';return {version:2,sessionId:'synthetic-session',sessions:[{id:'synthetic-session',name:'Synthetic session',captureFolder:path.join(folder,'photos'),created:at,updated:at,presetQueue:[]}],photos:[],presets:[{id:'synthetic-preset',name:'Synthetic preset',values:{iso:72}}],settings:{language:'en-US',theme:'light',showSplashes:false,performanceMode:true,autoSelect:true,captureFolder:path.join(folder,'photos'),watchFolder:'',sdkDir:'',onboarding:{completed:true,step:'ready'}}};}
  function fixture(name,kind='valid'){
    const folder=path.join(runRoot,name);safeFolder(folder);fs.mkdirSync(folder);
    for(const child of ['user-data','inputs','photos','exports','environment','artifacts'])fs.mkdirSync(path.join(folder,child));
    for(const key of ['USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP'])fs.mkdirSync(path.join(folder,'environment',key));
    fs.writeFileSync(path.join(folder,'seed.jpg'),seedBytes);fs.writeFileSync(path.join(folder,'inputs/input.png'),png);
    physical.set(path.join(folder,'seed.jpg'),hash(path.join(folder,'seed.jpg')));physical.set(path.join(folder,'inputs/input.png'),hash(path.join(folder,'inputs/input.png')));
    const filename=path.join(folder,'user-data/library.json'),store=valid(folder);
    if(kind!=='cold')fs.writeFileSync(filename,kind==='corrupt'?'{synthetic-invalid-json':JSON.stringify(kind==='schema'?{version:2,photos:{},settings:{}}:kind==='future'?{...store,version:999}:kind==='legacy'?{version:1,photos:[],settings:store.settings}:store));
    fs.writeFileSync(path.join(folder,'config.json'),JSON.stringify({readFault:kind==='unreadable'}));
    return {name,folder,filename,kind,originalStoreHash:fs.existsSync(filename)?hash(filename):null,pages:[],errors:[],consoleErrors:[],info:null,runtime:null};
  }
  async function bounded(promise,label,ms=12000){let timer;try{return await Promise.race([promise,new Promise((_resolve,reject)=>{timer=setTimeout(()=>reject(Error('Deadline: '+label)),ms);})]);}finally{clearTimeout(timer);}}
  async function eventually(get,predicate,label,ms=6000){const until=Date.now()+ms;let value;do{value=await get();if(predicate(value))return value;await new Promise(resolve=>setTimeout(resolve,20));}while(Date.now()<until);throw Error('Condition deadline: '+label);}
  async function driver(test,method,...args){return test.app.evaluate(async(_electron,payload)=>{const api=globalThis.__ic01;if(!api||typeof api[payload.method]!=='function')throw Error('Missing trusted driver '+payload.method);return api[payload.method](...payload.args);},{method,args});}
  async function call(test,method,args){return test.page.evaluate(async({method,args})=>{if(typeof window.focal?.[method]!=='function')throw Error('Unknown preload method '+method);return window.focal[method](args);},{method,args});}
  async function rejected(promise,label){let failure;try{await promise;}catch(error){failure=String(error.message||error);}assert.ok(failure,label+' must reject');return failure;}
  async function launch(test){
    assert.ok(apps.length<14);assert.equal(active,null);const env={NODE_OPTIONS:'',NODE_PATH:'',PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD:'1',ELECTRON_SKIP_BINARY_DOWNLOAD:'1',APERTROVE_SOURCE_COMMIT:process.env.APERTROVE_SOURCE_COMMIT};
    for(const key of ['SystemRoot','SYSTEMROOT','WINDIR','PROCESSOR_ARCHITECTURE','NUMBER_OF_PROCESSORS'])if(process.env[key])env[key]=process.env[key];
    for(const key of ['USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP'])env[key]=path.join(test.folder,'environment',key);
    launching=test;
    try{test.app=await _electron.launch({executablePath:binary,args:[entry,'--fixture='+test.folder],cwd:root,env,chromiumSandbox:true,artifactsDir:path.join(test.folder,'artifacts'),timeout:18000});}catch(error){await killOwnedTree(test);throw error;}finally{launching=null;}
    active=test;apps.push(test);test.process=test.app.process();test.parentPid=test.process.pid;test.app.context().setDefaultTimeout(6000);
    test.app.context().on('page',page=>{test.pages.push(page);page.on('pageerror',error=>test.errors.push(String(error.message)));page.on('console',message=>{if(message.type()==='error')test.consoleErrors.push(message.text().slice(0,1000));});});
    test.page=await test.app.firstWindow({timeout:8000});test.page.on('pageerror',error=>test.errors.push(String(error.message)));
    await test.page.waitForFunction(()=>typeof window.focal?.boot==='function');test.info=await driver(test,'info');
    assert.equal(test.info.versions.electron,'45.3.2');
    return test;
  }
  async function close(test){
    if(!test.app)return;test.info=await driver(test,'info').catch(()=>test.info);
    await call(test,'window',{action:'close'}).catch(error=>{if(!/closed|destroyed|disposed|exited/i.test(error.message))throw error;});
    await bounded(test.app.close().catch(error=>{if(!/closed|destroyed|disposed|exited/i.test(error.message))throw error;}),'Electron close',12000);
    await eventually(()=>({exitCode:test.process.exitCode,signalCode:test.process.signalCode}),value=>value.exitCode!==null||value.signalCode!==null,'Electron parent exit',3000);
    assert.equal(test.process.exitCode,0,'Normal main close must exit 0');assert.equal(test.process.signalCode,null,'Normal main close must not use forced signal');
    assert.deepEqual(test.errors,[],'Unexpected page errors in '+test.name);
    const runtimeFile=path.join(test.folder,'runtime.json');assert.ok(fs.existsSync(runtimeFile),'Missing after-close entry evidence');test.runtime=read(runtimeFile);const expectedOutcome=['persist-fault','forced-crash'].includes(test.name)?'UNKNOWN_TERMINATION':'CLOSED';assert.equal(test.runtime.shutdown?.outcome,expectedOutcome,'Explicit shutdown outcome for '+test.name);active=null;test.app=null;
  }
  async function check(name,run){const at=Date.now();await bounded(run(),name,25000);assert.equal(denials.filter(row=>!row.expected).length,0);results.push({name,status:'PASS',elapsedMs:Date.now()-at});console.log('PASS '+name);}
  const report={sourceCommit:process.env.APERTROVE_SOURCE_COMMIT,tier:'T2',scope:'actual Electron main/preload/renderer/utilityProcess + admitted fake provider only',command:'node --no-addons --max-old-space-size=256 tests/ic01/smoke.cjs --tier T2 --scope synthetic --allow-electron-ic01',fixtureRoot:runRoot,executable:{path:binary,sha256:admission.binary.sha256,version:admission.version,authenticode:admission.authenticode.status},sourceHashes,results,denials,spawns,connections,limits:{suiteMs:240000,maxApps:14,maxConcurrentApps:1,caseMs:25000},limitations:['No actual Canon/Koffi/EDSDK/WIA/PTP/hardware or genuine user data','Code sentinels and redirected profiles are not an OS sandbox','No package/ASAR/installer/clean-Windows or power-loss certification','Stock official Electron is unsigned; trust anchored in verified official/locked checksums']};
  function save(code){report.exitCode=code;report.pass=results.filter(row=>row.status==='PASS').length;report.fail=results.filter(row=>row.status==='FAIL').length;report.elapsedMs=Date.now()-started;report.apps=apps.map(test=>({name:test.name,kind:test.kind,folder:test.folder,parentPid:test.parentPid,exitCode:test.process?.exitCode,signal:test.process?.signalCode,info:test.info,runtime:test.runtime,probes:test.probes||null,pageErrors:test.errors,consoleErrors:test.consoleErrors,stderr:test.stderr}));report.originals=[...physical].map(([file,before])=>({file,before,after:fs.existsSync(file)?hash(file):null}));fs.writeFileSync(path.join(qa,'smoke-results.json'),JSON.stringify(report,null,2)+'\n');}
  function killOwnedTree(test){return new Promise(resolve=>{const pid=test?.process?.pid;if(!Number.isSafeInteger(pid)||pid<1||test.process.exitCode!==null||test.process.signalCode!==null)return resolve();originalExecFile(path.join(process.env.SystemRoot||process.env.SYSTEMROOT,'System32','taskkill.exe'),['/pid',String(pid),'/T','/F'],{windowsHide:true,timeout:2500,maxBuffer:16384},()=>resolve());});}
  const hard=setTimeout(()=>{if(finishing)return;results.push({name:'hard suite deadline',status:'FAIL'});void killOwnedTree(active).finally(()=>{save(1);process.exit(1);});},240000);
  try{
    const cold=fixture('cold','cold');
    await check('D1 cold first run uses actual main preload renderer and normal onboarding',async()=>{
      await launch(cold);const state=await call(cold,'boot');assert.equal(state.bootFailure,null);assert.equal(state.photos.length,0);assert.equal(state.showOnboarding,true);assert.ok(fs.existsSync(cold.filename));assert.equal(read(cold.filename).version,2);await cold.page.locator('.setup-screen').waitFor();await cold.page.screenshot({path:path.join(cold.folder,'onboarding.png')});await close(cold);
    });
    const legacy=fixture('legacy','legacy');
    await check('D1 supported legacy store migrates and persists through actual application bootstrap',async()=>{
      await launch(legacy);const state=await call(legacy,'boot');assert.equal(state.bootFailure,null);assert.equal(state.version,2);assert.equal(read(legacy.filename).version,2);await legacy.page.locator('.page-header h1').waitFor();await close(legacy);
    });
    for(const [kind,expectedKind]of [['corrupt','CORRUPT'],['schema','CORRUPT'],['future','UNSUPPORTED_VERSION'],['unreadable','UNREADABLE']]){
      const test=fixture(kind,kind),negativeBytes=fs.readFileSync(test.filename),preserved=path.join(test.folder,'inputs/negative-store.bin');fs.writeFileSync(preserved,negativeBytes);physical.set(preserved,sha(negativeBytes));
      await check('D1 '+kind+' rejection, repeated failure and protected negative bytes',async()=>{
        await launch(test);const state=await call(test,'boot');assert.equal(state.bootFailure.kind,expectedKind);const label=key=>catalogs[state.locale][key];
        await test.page.getByRole('heading',{name:label('boot.failed'),exact:true}).waitFor();assert.equal(await test.page.evaluate(()=>document.activeElement?.tagName),'H1');assert.equal(hash(test.filename),test.originalStoreHash);
        const again=await call(test,'boot');assert.equal(again.bootFailure.kind,expectedKind);assert.equal(hash(test.filename),test.originalStoreHash);await test.page.screenshot({path:path.join(test.folder,'recovery.png')});
        if(kind==='corrupt'||kind==='unreadable'){
          if(kind==='unreadable')await driver(test,'fault','read-clear');fs.writeFileSync(test.filename,JSON.stringify(valid(test.folder)));
          await test.page.evaluate(()=>{window.__icRetryObserved=[];const target=document.querySelector('.boot-screen');const observer=new MutationObserver(()=>{window.__icRetryObserved.push({busy:target.getAttribute('aria-busy'),text:target.textContent});});observer.observe(target,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-busy']});});
          await test.page.getByRole('button',{name:label('boot.retry'),exact:true}).click();await test.page.locator('.page-header h1').waitFor();
          const retried=await call(test,'boot');assert.equal(retried.bootFailure,null);assert.ok((await test.page.evaluate(()=>window.__icRetryObserved)).some(item=>item.busy==='true'),'Actual retrying UI state must be observed');assert.equal(read(test.filename).version,2);
        }
        await close(test);assert.equal(hash(preserved),sha(negativeBytes));
      });
    }

    const product=fixture('product');let importedId,secondId;
    await check('D2 actual preload IPC sender permissions navigation clipboard and Inspector boundaries',async()=>{
      await launch(product);const state=await call(product,'boot');assert.equal(state.bootFailure,null);
      const api=await product.page.evaluate(()=>({keys:Object.keys(window.focal),node:typeof window.require,generic:typeof window.focal.invoke}));assert.equal(api.node,'undefined');assert.equal(api.generic,'undefined');assert.ok(api.keys.includes('exportPhoto')&&api.keys.includes('boot'));
      await call(product,'copyColor',{text:'#123ABC'});await rejected(call(product,'copyColor',{text:'not-a-hex-color'}),'invalid clipboard input');
      const probes=await driver(product,'ipcProbe');for(const key of ['unknownRejected','unauthorizedRejected','subframeRejected','permissionsDenied','newWindowDenied','navigationDenied','clipboardScoped'])assert.equal(probes[key],true,'Missing actual IPC/security proof '+key);product.probes=probes;
      // Reset CDP navigation bookkeeping after the intentionally denied attempt.
      await driver(product,'reload');await product.page.waitForFunction(()=>typeof window.focal?.boot==='function');await call(product,'boot');
    });
    await check('D3 actual image import persists before return and protected originals remain unchanged',async()=>{
      await driver(product,'dialog','open',{canceled:false,filePaths:[path.join(product.folder,'inputs/input.png')]});const result=await call(product,'importFiles');assert.equal(result.added,1);assert.equal(result.errors.length,0);
      const state=await driver(product,'snapshot');assert.equal(state.photos.length,1);importedId=state.photos[0].id;assert.equal(read(product.filename).photos[0].id,importedId);assert.ok(state.photos[0].thumb&&state.photos[0].preview);physical.set(state.photos[0].path,hash(state.photos[0].path));
      await driver(product,'dialog','open',{canceled:false,filePaths:[path.join(product.folder,'seed.jpg')]});assert.equal((await call(product,'importFiles')).added,1);const second=(await driver(product,'snapshot')).photos.find(photo=>photo.id!==importedId);secondId=second.id;physical.set(second.path,hash(second.path));
    });
    await check('D3 actual NEW JPEG metadata preset exports, per-route cancel and protected collision',async()=>{
      for(const [method,name,args]of [['exportPhoto','edited.jpg',{id:importedId,edits:{exposure:1}}],['exportMetadata','metadata.json',{id:importedId}],['exportPresets','presets.json',{}]]){
        const destination=path.join(product.folder,'exports',name);await driver(product,'dialog','save',{canceled:false,filePath:destination});assert.equal(await call(product,method,args),destination);assert.ok(fs.statSync(destination).size>0);
        if(name.endsWith('.jpg')){const bytes=fs.readFileSync(destination);assert.equal(bytes.readUInt16BE(0),0xffd8);assert.equal(bytes.readUInt16BE(bytes.length-2),0xffd9);assert.notEqual(sha(bytes),sha(png));}else{const json=read(destination);if(method==='exportPresets'){assert.equal(json.version,1);assert.ok(Array.isArray(json.presets));}else assert.ok(json.file&&json.metadata);}
        const before=fs.readdirSync(path.join(product.folder,'exports')).sort();await driver(product,'dialog','save',{canceled:true});assert.equal(await call(product,method,args),null);assert.deepEqual(fs.readdirSync(path.join(product.folder,'exports')).sort(),before);
      }
      const second=(await driver(product,'snapshot')).photos.find(photo=>photo.id===secondId),before=hash(second.path);await driver(product,'dialog','save',{canceled:false,filePath:second.path});await rejected(call(product,'exportPhoto',{id:importedId}),'another registered original collision');assert.equal(hash(second.path),before);
    });
    await check('D5 navigation, persisted theme, focal-asset decode, metadata error and cancel visibility',async()=>{
      const label=key=>catalogs['en-US'][key],nav=product.page.locator('.sidebar');
      for(const key of ['capture','library','presets','equipment','tools','web_remote','settings','sessions']){await nav.getByRole('button',{name:label('desktop.'+key),exact:true}).click();await product.page.locator('.page-header h1').filter({hasText:label('desktop.'+key)}).waitFor();}
      await call(product,'settings',{theme:'dark'});await product.page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');assert.equal(read(product.filename).settings.theme,'dark');
      const photo=(await driver(product,'snapshot')).photos.find(photo=>photo.id===importedId),decoded=await product.page.evaluate(async url=>{const image=new Image();image.src=url;await image.decode();return {width:image.naturalWidth,height:image.naturalHeight};},photo.preview);assert.ok(decoded.width>0&&decoded.height>0);
      await nav.getByRole('button',{name:label('desktop.library'),exact:true}).click();await product.page.getByRole('button',{name:label('photoActions.open').replace('{{v0}}','input.png'),exact:true}).click();await product.page.locator('.viewer').waitFor();await product.page.getByRole('button',{name:label('desktop.all_metadata'),exact:true}).click();
      const metadata=product.page.locator('.photo-metadata'),json=metadata.getByRole('button',{name:'JSON',exact:true});await metadata.waitFor();await json.waitFor();await product.page.waitForFunction(()=>document.querySelector('.photo-metadata .metadata-rows')?.children.length>0);
      const protectedPath=(await driver(product,'snapshot')).photos.find(photo=>photo.id===secondId).path;await driver(product,'dialog','save',{canceled:false,filePath:protectedPath});await json.click();await metadata.getByRole('alert').filter({hasText:label('export.protected')}).waitFor();await product.page.screenshot({path:path.join(product.folder,'metadata-error.png')});
      await driver(product,'dialog','save',{canceled:true});await json.click();await metadata.getByRole('alert').waitFor({state:'detached'});await product.page.keyboard.press('Escape');await metadata.waitFor({state:'detached'});await product.page.keyboard.press('Escape');await product.page.locator('.viewer').waitFor({state:'detached'});
    });
    await check('D2 D5 actual Inspector utility worker and restricted focal-asset session',async()=>{
      const cameras=await call(product,'listCameras');assert.ok(cameras.length);await call(product,'connect',{cameraId:cameras[0].id});const before=(await driver(product,'snapshot')).photos.length;await driver(product,'workerControl','emit',{name:'inspector-image',kind:'jpeg'});await eventually(()=>driver(product,'snapshot'),state=>state.photos.length===before+1,'camera file registered');
      const opening=product.app.waitForEvent('window');await call(product,'openShotInspector');const inspector=await opening;await inspector.waitForLoadState();await inspector.waitForFunction(()=>typeof window.shotInspector?.boot==='function');await inspector.waitForFunction(()=>[...document.images].some(image=>image.naturalWidth>0));
      const restriction=await inspector.evaluate(async()=>{try{return (await fetch('focal-asset://shot/not-a-valid-token')).status;}catch{return 0;}});assert.ok([0,404].includes(restriction),'Invalid media token must not return readable image data');const protocolStatus=await product.app.evaluate(async({session})=>(await session.fromPartition('persist:apertrove-shot-inspector').fetch('focal-asset://shot/not-a-valid-token')).status);assert.equal(protocolStatus,404);await inspector.evaluate(()=>window.shotInspector.copy('IC01 synthetic clipboard'));assert.equal(await product.app.evaluate(async({clipboard})=>{const matched=await clipboard.readText()==='IC01 synthetic clipboard';if(matched)clipboard.clear();return matched;}),true);await inspector.screenshot({path:path.join(product.folder,'inspector.png')});await eventually(()=>driver(product,'info'),info=>info.observations.workers.some(worker=>worker.kind==='real-inspector-codec'&&worker.guard),'Inspector codec guard completion');await inspector.close();
      const reopened=product.app.waitForEvent('window');await call(product,'openShotInspector');const secondInspector=await reopened;await secondInspector.waitForFunction(()=>typeof window.shotInspector?.boot==='function');assert.ok((await secondInspector.evaluate(()=>window.shotInspector.boot())).latest);await eventually(()=>driver(product,'info'),info=>{const workers=info.observations.workers.filter(worker=>worker.kind==='real-inspector-codec');return workers.length>=2&&workers.every(worker=>worker.guard);},'reopened Inspector completion');await secondInspector.close();
      await close(product);
    });
    await check('D3 reload sees acknowledged records and persisted settings',async()=>{
      const reload={...product,name:'product-reload',pages:[],errors:[],consoleErrors:[],app:null};await launch(reload);const state=await call(reload,'boot');assert.equal(state.bootFailure,null);assert.equal(state.settings.theme,'dark');assert.ok(state.photos.some(photo=>photo.id===importedId));assert.ok(state.photos.some(photo=>photo.id===secondId));await close(reload);
    });
    const persistFault=fixture('persist-fault');
    await check('D3 actual persistence and writer failures never publish false import/export success',async()=>{
      await launch(persistFault);await call(persistFault,'boot');await driver(persistFault,'fault','persist');await driver(persistFault,'dialog','open',{canceled:false,filePaths:[path.join(persistFault.folder,'inputs/input.png')]});
      const failed=await call(persistFault,'importFiles');assert.equal(failed.added,0);assert.equal(failed.errors.length,1);assert.equal(read(persistFault.filename).photos.length,0);assert.equal((await driver(persistFault,'snapshot')).photos.length,0);
      const retained=failed.errors[0].retainedPath;assert.ok(retained&&within(persistFault.folder,retained)&&fs.existsSync(retained));physical.set(retained,hash(retained));
      await driver(persistFault,'dialog','open',{canceled:false,filePaths:[path.join(persistFault.folder,'inputs/input.png')]});const retried=await call(persistFault,'importFiles');assert.equal(retried.added,1);const photo=(await driver(persistFault,'snapshot')).photos[0];assert.equal(photo.path,retained);assert.equal(read(persistFault.filename).photos.length,1);
      const destination=path.join(persistFault.folder,'exports','injected-write-failure.jpg');await driver(persistFault,'dialog','save',{canceled:false,filePath:destination});await driver(persistFault,'fault','export');await rejected(call(persistFault,'exportPhoto',{id:photo.id}),'injected export writer failure');assert.equal(hash(retained),physical.get(retained));await close(persistFault);
    });

    const lifecycle=fixture('lifecycle');
    await check('D4 actual utilityProcess timeout owns late work until its real producer reply',async()=>{
      await launch(lifecycle);await call(lifecycle,'boot');const cameras=await call(lifecycle,'listCameras');await call(lifecycle,'connect',{cameraId:cameras[0].id});
      await driver(lifecycle,'workerControl','configure',{nextCapture:{mode:'delayed',delayMs:500}});await rejected(call(lifecycle,'capture'),'consumer capture timeout');const pending=await driver(lifecycle,'snapshot');assert.equal(pending.operationState.busy,true);assert.ok(pending.operationState.ledger.operations.some(operation=>['CANCELLING','DRAINING'].includes(operation.state)));
      await rejected(call(lifecycle,'property',{key:'iso',value:72}),'conflicting operation while producer drains');
      const completed=await eventually(()=>driver(lifecycle,'snapshot'),state=>!state.operationState.busy&&state.photos.length===1,'late producer reply and persisted registration');assert.equal(completed.photos[0].transfer.captureId,null);assert.equal(completed.photos[0].transfer.operationId,null);assert.equal(completed.photos[0].transfer.confirmation,'UNVERIFIED');assert.equal(read(lifecycle.filename).photos.length,1);
      for(const photo of completed.photos)physical.set(photo.path,hash(photo.path));
    });
    await check('D4 partial pair and late RAW-like file cannot become guaranteed capture B identity',async()=>{
      const before=(await driver(lifecycle,'snapshot')).photos.length;await driver(lifecycle,'workerControl','configure',{nextCapture:{mode:'pair',secondDelayMs:300}});assert.equal((await call(lifecycle,'capture')).confirmation,'UNVERIFIED');assert.equal((await call(lifecycle,'capture')).confirmation,'UNVERIFIED');
      const state=await eventually(()=>driver(lifecycle,'snapshot'),state=>state.photos.length===before+3,'deferred RAW-like original registered');const arrived=state.photos.slice(before);assert.ok(arrived.some(photo=>/\.cr3$/i.test(photo.path)));for(const photo of arrived){assert.equal(photo.transfer.captureId,null);assert.equal(photo.transfer.operationId,null);assert.notEqual(photo.transfer.correlation,'CONFIRMED');physical.set(photo.path,hash(photo.path));}
    });
    await check('D4 session boundary quarantines delayed uncorrelated original and malformed messages cannot poison epoch',async()=>{
      const before=(await driver(lifecycle,'snapshot')).photos.length;await driver(lifecycle,'workerControl','configure',{nextCapture:{mode:'pair',secondDelayMs:350}});await call(lifecycle,'capture');
      const changed=await call(lifecycle,'session',{name:'Synthetic B',folder:path.join(lifecycle.folder,'photos-b'),createSubfolder:false});assert.notEqual(changed.sessionId,'synthetic-session');
      const state=await eventually(()=>driver(lifecycle,'snapshot'),value=>value.photos.length===before+2,'late cross-session original registered');const late=state.photos.find(photo=>photo.path.endsWith('.cr3')&&!physical.has(photo.path));assert.ok(late);assert.equal(late.sessionId,null);assert.equal(late.transfer.recoveryRoute,true);assert.ok(within(lifecycle.folder,late.path));physical.set(late.path,hash(late.path));
      for(const kind of ['foreign-generation','wrong-operation','unknown-event'])await driver(lifecycle,'workerControl','malformed',{kind});await call(lifecycle,'property',{key:'iso',value:72});assert.equal((await driver(lifecycle,'snapshot')).camera.properties.iso.value,72);
    });
    await check('D4 cooperative cancel acknowledgement is terminal only at the import checkpoint',async()=>{
      await call(lifecycle,'listCard');await driver(lifecycle,'workerControl','configure',{nextImport:{delayMs:350}});await rejected(call(lifecycle,'importCard',{ids:['item-1','item-2']}),'import consumer timeout');const pending=await driver(lifecycle,'snapshot');assert.equal(pending.operationState.busy,true);
      const done=await eventually(()=>driver(lifecycle,'snapshot'),state=>{const terminal=state.operationState.ledger.history.find(operation=>operation.method==='importCard');if(!terminal)assert.equal(state.operationState.busy,true,'Ownership must remain held until import checkpoint: '+JSON.stringify(state.operationState));return terminal?.state==='CANCELLED'&&!state.operationState.busy;},'cooperative cancellation terminal');assert.ok(done.operationState.ledger.history.some(operation=>operation.method==='importCard'&&operation.state==='CANCELLED'));
      const provider=await driver(lifecycle,'workerControl','snapshot');assert.equal(provider.nativeCalls,0);assert.ok(provider.references.every(value=>value===0));assert.equal(provider.denials.filter(item=>!item.expected).length,0);await close(lifecycle);
    });
    const forced=fixture('forced-crash');
    await check('D4 controlled utility crash and forced kill retain explicit UNKNOWN outcomes',async()=>{
      await launch(forced);await call(forced,'boot');let cameras=await call(forced,'listCameras');await call(forced,'connect',{cameraId:cameras[0].id});
      await driver(forced,'workerControl','configure',{nextCapture:{mode:'hold'}});const capture=call(forced,'capture').catch(error=>String(error.message));await eventually(()=>driver(forced,'workerControl','snapshot'),value=>!!value.held,'held fake capture');const firstGeneration=(await driver(forced,'snapshot')).operationState.ledger.generation;
      await driver(forced,'workerControl','crash',{code:23});assert.ok(await capture);await eventually(()=>driver(forced,'snapshot'),state=>state.camera.connected===false,'worker crash status');
      cameras=await call(forced,'listCameras');await call(forced,'connect',{cameraId:cameras[0].id});assert.notEqual((await driver(forced,'snapshot')).operationState.ledger.generation,firstGeneration);
      await driver(forced,'workerControl','configure',{nextCapture:{mode:'hang'}});const hanging=call(forced,'capture').catch(error=>String(error.message));await eventually(()=>driver(forced,'workerControl','snapshot'),value=>value.held?.mode==='hang','unresponsive fake');await driver(forced,'forceWorker');assert.ok(await hanging);
      await eventually(()=>driver(forced,'snapshot'),state=>state.operationState.ledger.history.some(operation=>operation.state==='UNKNOWN_TERMINATION'),'forced operation UNKNOWN');await close(forced);
    });
    const pendingClose=fixture('pending-close');
    await check('D4 actual window close drains a late producer and persisted consumer before exiting',async()=>{
      await launch(pendingClose);await call(pendingClose,'boot');const cameras=await call(pendingClose,'listCameras');await call(pendingClose,'connect',{cameraId:cameras[0].id});await driver(pendingClose,'workerControl','configure',{nextCapture:{mode:'delayed',delayMs:900}});await rejected(call(pendingClose,'capture'),'pending-close consumer timeout');
      assert.equal((await driver(pendingClose,'snapshot')).operationState.busy,true);await close(pendingClose);const persisted=read(pendingClose.filename);assert.equal(persisted.photos.length,1);assert.ok(fs.existsSync(persisted.photos[0].path));physical.set(persisted.photos[0].path,hash(persisted.photos[0].path));
    });
    await check('all protected generated originals retain SHA and every owned Electron parent exited',async()=>{
      for(const [file,before]of physical)assert.equal(hash(file),before,'Original changed: '+file);assert.ok(apps.length<=14);for(const test of apps){assert.ok(test.process.exitCode!==null||test.process.signalCode!==null);assert.deepEqual(test.errors,[]);assert.deepEqual(test.runtime.guard.unexpectedDenials,[]);assert.equal(test.runtime.guard.fs.openHandles,0);assert.deepEqual(test.runtime.observations.shell,[]);assert.ok(test.runtime.observations.workers.every(worker=>worker.exited),'Owned utility process still live');for(const worker of test.runtime.observations.workers){if(worker.kind==='real-inspector-codec'){assert.ok(worker.guard);assert.deepEqual(worker.guard.unexpectedDenials,[]);assert.equal(worker.guard.fs.openHandles,0);assert.equal(worker.guard.nativeLoads.length,1);}else{assert.equal(worker.provider.nativeCalls,0);assert.ok(worker.provider.denials.every(item=>item.expected));}}assert.ok(test.runtime.observations.windows.every(window=>window.sandbox===true&&window.nodeIntegration===false),'A test window weakened Chromium isolation');}assert.equal(denials.filter(row=>!row.expected).length,0);for(const [file,before]of Object.entries(sourceHashes))assert.equal(hash(path.join(root,file)),before,'Source changed during smoke: '+file);
    });
    finishing=true;clearTimeout(hard);save(0);console.log(JSON.stringify({status:'PASS',checks:results.length,apps:apps.length,exitCode:0,report:'qa/integration-candidate/smoke-results.json'}));
  }catch(error){
    results.push({name:'suite invariant or named case',status:'FAIL',error:String(error.stack||error)});
    if(active?.app){try{await bounded(active.app.close(),'failure close',10000);}catch{await killOwnedTree(active);}}
    save(1);throw error;
  }finally{finishing=true;clearTimeout(hard);}
}
