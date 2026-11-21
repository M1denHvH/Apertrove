// Named T2: actual built React in an isolated installed Edge profile.
// The focal RPC transport/services/dialogs are explicit fixtures, NOT Electron IPC.
// Boot uses the production bootstrap/storage/orchestrator through the reviewed VM.
// Launcher must provide APERTROVE_SOURCE_COMMIT=<reviewed git rev-parse HEAD>.
// Run only after reviewing this entry: node --no-addons tests/t2/renderer.cjs
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const http=require('node:http');
const Module=require('node:module');
const childProcess=require('node:child_process');
const net=require('node:net');
const tls=require('node:tls');
const dns=require('node:dns');

const REPO=path.resolve(__dirname,'../..');
const EDGE='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const FIXTURES=path.join(REPO,'qa','integration','fixtures');
const ALLOWED_COMMANDS=Object.freeze(['boot','window','settings','onboardingSave','cameraEndDiagnostics','sdkEnvironment','listCameras','equipment','importFiles','renderPreview','photoMetadata','exportMetadata','exportPhoto','exportPresets','importPresets','openShotInspector','copyColor','flashSupport','burstStart','burstStop']);
const clone=value=>JSON.parse(JSON.stringify(value));
const within=(root,file)=>{const relative=path.relative(root,file);return relative===''||(!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep));};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const hostEvidence={expectedDenials:[],unexpectedDenials:[],browserSpawns:[],blockedPageRequests:[]};
let profileRoot,allowBrowserSpawn=false,browserChild=null,server,context,runRoot,deadline,budgetFired=false;
const withinBudget=()=>assert.ok(!budgetFired&&Date.now()-deadline<85000,'T2 renderer hard budget exceeded');

// Trusted host runner fencing. This is an allowlist/sentinel, not an OS sandbox.
// Install BEFORE Playwright, production loader entrypoints and browser launch.
function installHostSentinels(){
  const deny=(kind,detail)=>{const error=Error('T2_HOST_DENIED: '+kind);error.code='T2_HOST_DENIED';hostEvidence.unexpectedDenials.push({kind,detail});throw error;};
  const originalLoad=Module._load;
  Module._load=function(request,parent,isMain){
    const normalized=String(request).replaceAll('\\','/');
    if(/^(electron|sharp|koffi)(\/|$)/.test(normalized)||/^(?:node:)?(?:worker_threads|cluster)(?:\/|$)/.test(normalized)||/\.(node|dll)$/i.test(normalized)||/camera-worker|shot-inspector-worker|sdk-environment|camera-capabilities|flash-wia/i.test(normalized))return deny('import',normalized);
    let resolved;try{resolved=Module._resolveFilename(request,parent,isMain);}catch{}
    if(typeof resolved==='string'&&path.isAbsolute(resolved)&&within(path.join(REPO,'electron'),resolved))return deny('host production import',normalized);
    return originalLoad.call(this,request,parent,isMain);
  };
  Module._extensions['.node']=(_module,file)=>deny('native addon',file);
  process.dlopen=()=>deny('process.dlopen','not admitted');
  const realSpawn=childProcess.spawn;
  childProcess.spawn=function(file,args,options){
    if(!allowBrowserSpawn||path.resolve(String(file)).toLowerCase()!==EDGE.toLowerCase()||hostEvidence.browserSpawns.length!==0||!Array.isArray(args))return deny('child spawn',String(file));
    const profiles=args.filter(arg=>arg.startsWith('--user-data-dir='));
    if(profiles.length!==1||path.resolve(profiles[0].slice('--user-data-dir='.length))!==profileRoot||!args.includes('--remote-debugging-pipe')||!args.some(arg=>arg.startsWith('--headless')))return deny('browser arguments',args);
    for(const key of ['USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP'])if(!options?.env?.[key]||!within(runRoot,path.resolve(options.env[key])))return deny('browser environment',key);
    const child=realSpawn.call(this,file,args,options);
    browserChild=child;
    hostEvidence.browserSpawns.push({executable:file,pid:child.pid,profile:profileRoot});
    return child;
  };
  for(const method of ['exec','execSync','execFile','execFileSync','spawnSync','fork'])childProcess[method]=()=>deny('child '+method,'not admitted');
  net.Socket.prototype.connect=function(){return deny('outbound Node socket','not admitted');};
  net.connect=net.createConnection=()=>deny('outbound Node socket','not admitted');
  tls.connect=()=>deny('outbound Node TLS','not admitted');
  // Satisfy Node's literal-IP listen lookup without entering a DNS resolver.
  dns.lookup=(hostname,options,callback)=>{
    if(hostname!=='127.0.0.1')return deny('Node DNS','lookup');
    if(typeof options==='function'){callback=options;options={};}
    process.nextTick(()=>options?.all?callback(null,[{address:'127.0.0.1',family:4}]):callback(null,'127.0.0.1',4));
  };
  for(const method of ['resolve','resolve4','resolve6','resolveAny','reverse'])dns[method]=()=>deny('Node DNS',method);
  for(const method of ['lookup','resolve','resolve4','resolve6','resolveAny','reverse'])if(dns.promises?.[method])dns.promises[method]=async()=>deny('Node DNS promise',method);
  // Prove the host sentinels before admitting a browser. Remove only expected probes.
  for(const [kind,action] of [['native import',()=>require('koffi')],['dlopen',()=>process.dlopen({},'sentinel.node')],['worker import',()=>require('node:worker_threads')],['process',()=>childProcess.execFile('powershell.exe',[])],['outbound socket',()=>net.connect(80,'example.invalid')]]){
    const start=hostEvidence.unexpectedDenials.length;
    assert.throws(action,error=>error.code==='T2_HOST_DENIED');
    assert.equal(hostEvidence.unexpectedDenials.length,start+1);
    hostEvidence.expectedDenials.push({probe:kind,...hostEvidence.unexpectedDenials.pop()});
  }
}

function installBridge({origin,token}){
  const listeners=new Set();
  const commands=['boot','window','settings','onboardingSave','cameraEndDiagnostics','sdkEnvironment','listCameras','equipment','importFiles','renderPreview','photoMetadata','exportMetadata','exportPhoto','exportPresets','importPresets','openShotInspector','copyColor','flashSupport','burstStart','burstStop'];
  const rpc=async(method,args={})=>{
    if(!commands.includes(method))throw Error('Unknown fixture command');
    const response=await fetch(origin+'/__fixture/rpc',{method:'POST',headers:{'Content-Type':'application/json','X-Fixture-Token':token},body:JSON.stringify({fixture:new URL(location.href).searchParams.get('fixture'),method,args})});
    const payload=await response.json();
    if(!response.ok||payload.error)throw Error(payload.error||'Fixture RPC refused');
    for(const event of payload.events||[])for(const listener of listeners)listener(event);
    return payload.result;
  };
  const appearance={theme:'light',resolvedTheme:'light',systemTheme:'light',design:'current',accentColor:'#7f9c69',onAccent:'#102018',performanceMode:true};
  const focal={initialLocale:'en-US',initialAppearance:appearance,on:callback=>{listeners.add(callback);return()=>listeners.delete(callback);},onFrame:()=>()=>{},onFocus:()=>()=>{},onWindowVisible:()=>()=>{}};
  for(const command of commands)focal[command]=args=>rpc(command,args);
  Object.defineProperty(window,'focal',{value:Object.freeze(focal),writable:false,configurable:false});
  // Test fixture events only. This bridge is never part of the built application.
  Object.defineProperty(window,'__apertroveSyntheticEvent',{value:event=>{for(const listener of listeners)listener(event);},writable:false,configurable:false});
}

async function main(){
  assert.equal(process.platform,'win32','This reviewed runner uses installed Windows Edge only.');
  assert.ok(process.execArgv.includes('--no-addons'),'Run with --no-addons.');
  assert.equal(process.env.NODE_OPTIONS||'','','NODE_OPTIONS must be empty.');
  assert.equal(process.env.NODE_PATH||'','','NODE_PATH must be empty.');
  const sourceCommit=process.env.APERTROVE_SOURCE_COMMIT||'';
  assert.match(sourceCommit,/^[0-9a-f]{40}$/i,'Launcher must provide the reviewed APERTROVE_SOURCE_COMMIT.');
  assert.equal(process.argv.length,2,'This entrypoint admits no extra CLI arguments.');
  assert.equal(fs.realpathSync(REPO),fs.realpathSync(process.cwd()),'Run from the integration worktree.');
  assert.equal(fs.realpathSync(EDGE).toLowerCase(),EDGE.toLowerCase(),'Unexpected Edge path/alias.');
  assert.ok(fs.statSync(EDGE).isFile());
  assert.ok(fs.statSync(path.join(REPO,'dist','index.html')).isFile(),'Root must build reviewed dist first.');
  const canonicalRepo=fs.realpathSync(REPO);
  for(const relative of ['qa',path.join('qa','integration'),path.join('qa','integration','fixtures')]){
    const candidate=path.join(REPO,relative);
    try{assert.equal(fs.lstatSync(candidate).isSymbolicLink(),false,'fixture ancestor must not be an alias');assert.ok(within(canonicalRepo,fs.realpathSync(candidate)),'fixture ancestor escapes worktree');}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  await fsp.mkdir(FIXTURES,{recursive:true});
  runRoot=await fsp.mkdtemp(path.join(FIXTURES,'renderer-'));
  profileRoot=path.join(runRoot,'edge-profile');
  const environment={};
  for(const key of ['SystemRoot','SYSTEMROOT','WINDIR','PROCESSOR_ARCHITECTURE','NUMBER_OF_PROCESSORS'])if(process.env[key])environment[key]=process.env[key];
  for(const key of ['USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP']){environment[key]=path.join(runRoot,'environment',key);await fsp.mkdir(environment[key],{recursive:true});}
  environment.HOME=environment.USERPROFILE;
  environment.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD='1';
  for(const key of ['TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','HOME'])process.env[key]=environment[key];
  process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD='1';
  installHostSentinels();
  const {createProductionGuard}=require('./guard.cjs');
  const guard=createProductionGuard({repoRoot:REPO,fixtureRoot:runRoot});
  for(const request of ['electron','sharp','koffi','node:child_process','../camera-worker.cjs','../sdk-environment.cjs'])guard.expectDeniedImport(request);
  guard.expectDeniedPath('readFile',path.join(REPO,'package.json'));
  guard.expectDeniedPath('writeFile',path.join(path.dirname(runRoot),'outside-library.json'));
  guard.assertNoUnexpected();
  const storage=guard.load('electron/library-storage.cjs');
  const {createLibraryBootstrap}=guard.load('electron/library-bootstrap.cjs');
  const {createBootApplication}=guard.load('electron/boot-application.cjs');
  const {migrateSessions}=guard.load('electron/sessions.cjs');
  const {onboardingState}=guard.load('electron/onboarding.cjs');
  const {workspace,composition}=guard.load('electron/workspace-settings.cjs');
  const {normalize}=guard.load('electron/remote/appearance.js');
  const locale=JSON.parse(await fsp.readFile(path.join(REPO,'electron','i18n','locales','en-US.json'),'utf8'));
  const label=key=>locale[key];
  const token=crypto.randomBytes(32).toString('hex'),cases=new Map(),pageErrors=[],checks=[];
  const defaults=folder=>({language:'en-US',theme:'light',design:'current',accentColor:'#7f9c69',performanceMode:true,showSplashes:false,autoSelect:true,autofocus:true,focusPreviewOnSuccess:true,grid:false,setupSessionSubfolder:true,captureFolder:folder,remoteHost:'127.0.0.1',remotePort:8765,savePreference:3,watchFolder:'',sdkDir:'',workspace:workspace(),composition:composition()});
  const fresh=folder=>({version:2,sessionId:null,sessions:[],photos:[],presets:[],settings:defaults(folder)});
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1sAAAAASUVORK5CYII=';
  async function makeCase(name,{corrupt=false,missing=false}={}){
    const folder=path.join(runRoot,name),photosFolder=path.join(folder,'photos'),filename=path.join(folder,'library.json');
    await fsp.mkdir(photosFolder,{recursive:true});
    const original=path.join(photosFolder,'synthetic.png');
    await fsp.writeFile(original,Buffer.from(png.split(',')[1],'base64'));
    const originalHashBefore=crypto.createHash('sha256').update(await fsp.readFile(original)).digest('hex');
    const fixture={name,filename,photosFolder,original,originalHashBefore,calls:[],reads:0,writes:0,services:0,store:null,bootstrap:null};
    fixture.valid=()=>{
      const store=fresh(photosFolder),at='2026-11-19T09:00:00.000Z';
      store.sessionId='synthetic-session';store.settings.onboarding={completed:true,step:'ready'};
      store.sessions=[{id:'synthetic-session',name:'Synthetic session',captureFolder:photosFolder,client:'',description:'',created:at,updated:at}];
      store.photos=[{id:'synthetic-photo',name:'synthetic.png',path:path.join(photosFolder,'synthetic.png'),sessionId:store.sessionId,size:68,date:at,rating:0,metadata:{width:1,height:1},edits:{exposure:0,contrast:0,saturation:0,warmth:0,monochrome:false,rotation:0},thumb:png,preview:png}];
      return store;
    };
    if(corrupt)await fsp.writeFile(filename,'{synthetic-corrupt');else if(!missing)await fsp.writeFile(filename,JSON.stringify(fixture.valid()));
    fixture.bootstrap=createLibraryBootstrap({
      readText:async()=>{fixture.reads++;if(fixture.reads>1)await sleep(400);return storage.readLibraryText(filename);},
      writeStore:async candidate=>{const status=await storage.writeLibraryStore(filename,candidate,{allowBackupDegradation:true});fixture.backupWarning=status?.backupWarning;fixture.writes++;},
      createFresh:()=>fresh(photosFolder),
      prepare:(candidate,{established})=>{
        migrateSessions(candidate,photosFolder);
        candidate.settings={...defaults(photosFolder),...candidate.settings,onboarding:onboardingState(candidate.settings.onboarding,established),workspace:workspace(candidate.settings.workspace),composition:composition(candidate.settings.composition,candidate.settings.grid)};
        return candidate;
      }
    });
    fixture.state=()=>({...clone(fixture.store),locale:'en-US',appearance:clone(normalize(fixture.store.settings)),showOnboarding:fixture.store.settings.onboarding.completed===false,camera:{connected:false,live:false,working:false,properties:{},capabilities:{capture:false,liveView:false,focus:false}},cameras:[],values:Object.fromEntries(['iso','shutter','aperture','whiteBalance','pictureStyle','meteringMode','imageQuality','driveMode','afMode','liveAfMode','compensation'].map(key=>[key,[]])),remote:{running:false,clients:0},interfaces:[{name:'Synthetic loopback',address:'127.0.0.1'}],logs:[],watching:false,interval:null,series:null,burst:null,captureState:{active:false},bootFailure:null});
    fixture.boot=createBootApplication({bootstrap:fixture.bootstrap,isQuitting:()=>false,acceptStore:value=>{fixture.store=value;},initializeServices:()=>{if(!fixture.services)fixture.services++;},applyAppearance:()=>{},publicState:fixture.state,locale:()=> 'en-US'});
    cases.set(name,fixture);return fixture;
  }
  const recovery=await makeCase('recovery',{corrupt:true}),onboarding=await makeCase('onboarding',{missing:true}),valid=await makeCase('valid');
  const backupOnly=await makeCase('backup-only',{missing:true}),degraded=await makeCase('degraded');
  const backupOnlyPath=path.join(path.dirname(backupOnly.filename),'library.previous.json'),degradedPath=path.join(path.dirname(degraded.filename),'library.previous.json');
  const backupOnlyBytes=JSON.stringify(backupOnly.valid()),degradedBytes='{synthetic-corrupt-backup';
  await fsp.writeFile(backupOnlyPath,backupOnlyBytes);await fsp.writeFile(degradedPath,degradedBytes);
  async function dispatch(fixture,method,args){
    assert.ok(ALLOWED_COMMANDS.includes(method),'Unknown fixture command: '+method);
    fixture.calls.push({method,args:clone(args||{})});
    if(method==='boot')return {result:clone(await fixture.boot())};
    if(method==='window'){assert.equal(args.action,'close');return {result:null};}
    assert.ok(fixture.bootstrap.isReady(),'Fixture library not ready');
    const settings=fixture.store.settings;
    const changed=()=>({events:[{type:'settings',data:clone(settings),appearance:clone(normalize(settings)),locale:'en-US'}]});
    if(method==='settings'){
      for(const key of Object.keys(args))assert.ok(['theme','showSplashes','autoSelect','grid','language','accentColor','design','performanceMode'].includes(key),'Unreviewed setting: '+key);
      Object.assign(settings,args);await storage.writeLibraryStore(fixture.filename,fixture.store);return {result:clone(settings),...changed()};
    }
    if(method==='onboardingSave'){settings.onboarding=onboardingState({...settings.onboarding,...args},false);await storage.writeLibraryStore(fixture.filename,fixture.store);return {result:clone(settings.onboarding),...changed()};}
    if(method==='cameraEndDiagnostics')return {result:null};
    if(method==='sdkEnvironment'){settings.onboarding.environment={status:'missing',architecture:'x64',checks:[],fixture:true};await storage.writeLibraryStore(fixture.filename,fixture.store);return {result:clone(settings.onboarding.environment),...changed()};}
    if(method==='listCameras')return {result:[]};
    if(method==='flashSupport')return {result:{available:false,canAttempt:false,error:'Synthetic provider has no flash.'}};
    if(method==='burstStart'){assert.equal(args.seconds,5);return {result:{status:'holding'},events:[{type:'burst',data:{id:'synthetic-burst',status:'holding',shots:0}},{type:'operationState',data:{busy:true}}]};}
    if(method==='burstStop')return {result:{status:'unconfirmed'},events:[{type:'burst',data:{id:'synthetic-burst',status:'unconfirmed',shots:0,observedTransfers:1}},{type:'operationState',data:{busy:false}}]};
    if(method==='equipment')return {result:Object.fromEntries(['camera','lens'].map(kind=>[kind,{kind,name:'',source:null,manufacturer:'',connected:false,facts:[],stats:[]}]))}; // No source/name: never asks for manufacturer/product media.
    if(method==='renderPreview'){assert.equal(args.id,'synthetic-photo');return {result:png};} // Fixture pixels only; no Sharp/codec execution.
    if(method==='photoMetadata'){assert.equal(args.id,'synthetic-photo');return {result:{file:{name:'synthetic.png',width:1,height:1,bytes:68},metadata:{EXIF:{Artist:'Synthetic fixture'}},errors:[]}};}
    if(method==='exportMetadata'&&fixture.failMetadataOnce){fixture.failMetadataOnce=false;return {error:label('export.exists')};} // Expected policy rejection, not an unhandled RPC refusal.
    if(['importFiles','exportPhoto','exportMetadata','exportPresets','importPresets'].includes(method))return {result:null}; // Explicit dialog cancellation; no native/codec success.
    if(method==='openShotInspector')return {result:true}; // Dispatch evidence only; no Electron inspector window.
    if(method==='copyColor'){assert.match(args.text,/^#[0-9a-f]{6}$/i);return {result:args.text};} // No OS clipboard.
    throw Error('Unhandled fixture method');
  }
  const distRoot=await fsp.realpath(path.join(REPO,'dist'));
  let origin;
  const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.woff2':'font/woff2','.woff':'font/woff','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
  let requests=0;
  server=http.createServer(async(request,response)=>{
    try{
      assert.ok(++requests<=350,'Fixture request budget exceeded');
      assert.equal(request.socket.remoteAddress,'127.0.0.1');
      assert.equal(request.headers.host,new URL(origin).host);
      const url=new URL(request.url,origin);
      if(url.pathname==='/__fixture/rpc'){
        assert.equal(request.method,'POST');assert.equal(request.headers.origin,origin);assert.equal(request.headers['x-fixture-token'],token);
        let body='';for await(const bytes of request){body+=bytes.toString();assert.ok(Buffer.byteLength(body)<=8192);}
        const command=JSON.parse(body),fixture=cases.get(command.fixture);
        assert.ok(fixture);assert.ok(ALLOWED_COMMANDS.includes(command.method));assert.ok(command.args&&typeof command.args==='object'&&!Array.isArray(command.args));
        const result=await dispatch(fixture,command.method,command.args);
        response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify(result));return;
      }
      assert.equal(request.method,'GET');
      const requested=path.resolve(distRoot,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
      assert.ok(within(distRoot,requested));
      const file=await fsp.realpath(requested);assert.ok(within(distRoot,file));
      const stat=await fsp.stat(file);assert.ok(stat.isFile()&&stat.size<=4*1024*1024);
      response.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});response.end(await fsp.readFile(file));
    }catch(error){if(request.url.startsWith('/__fixture/rpc'))hostEvidence.unexpectedDenials.push({kind:'RPC refusal',detail:error.message});response.writeHead(400,{'Content-Type':'application/json'});response.end(JSON.stringify({error:error.message}));}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen({host:'127.0.0.1',port:0},resolve);});
  assert.equal(server.address().address,'127.0.0.1');origin='http://127.0.0.1:'+server.address().port;
  guard.assertNoUnexpected();assert.equal(hostEvidence.unexpectedDenials.length,0);
  const {chromium}=require('playwright');
  allowBrowserSpawn=true;
  context=await chromium.launchPersistentContext(profileRoot,{executablePath:EDGE,headless:true,viewport:{width:1440,height:1000},deviceScaleFactor:1,locale:'en-US',timezoneId:'UTC',colorScheme:'light',reducedMotion:'reduce',acceptDownloads:false,serviceWorkers:'block',env:environment,args:['--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run','--disable-quic','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']});
  allowBrowserSpawn=false;
  context.setDefaultTimeout(5000);context.setDefaultNavigationTimeout(10000);await context.clearPermissions();
  await context.route('**/*',route=>{
    const requested=new URL(route.request().url());
    if(requested.origin!==origin){hostEvidence.blockedPageRequests.push(requested.origin+requested.pathname);return route.abort('blockedbyclient');}
    return route.continue();
  });
  await context.addInitScript(installBridge,{origin,token});
  context.on('page',page=>{page.on('pageerror',error=>pageErrors.push(error.message));page.on('download',download=>{pageErrors.push('Unexpected download');void download.cancel();});page.on('popup',popup=>{pageErrors.push('Unexpected popup');void popup.close();});});
  for(const page of context.pages())await page.close();
  async function open(name){const page=await context.newPage();await page.goto(origin+'/?fixture='+name);return page;}
  async function waitForCount(fixture,method,count){const until=Date.now()+5000;while(fixture.calls.filter(call=>call.method===method).length<count){assert.ok(Date.now()<until,'Missing command '+method);await sleep(20);}}
  const recovered=await open('recovery'),heading=recovered.getByRole('heading',{name:label('boot.failed'),exact:true}),retry=recovered.getByRole('button',{name:label('boot.retry'),exact:true});
  await heading.waitFor();await recovered.waitForFunction(()=>document.activeElement?.matches('.boot-recovery h1'));
  assert.equal(await recovered.getByRole('alert').count(),1);
  await recovered.screenshot({path:path.join(runRoot,'recovery.png'),animations:'disabled'});
  assert.equal(await recovered.locator('.sidebar').count(),0);assert.equal(recovery.services,0);assert.equal(recovery.writes,0);
  await recovered.keyboard.press('Tab');assert.ok(await retry.evaluate(node=>node===document.activeElement));await recovered.keyboard.press('Enter');
  await recovered.getByRole('status').filter({hasText:label('boot.retrying')}).waitFor();
  await waitForCount(recovery,'boot',2);await heading.waitFor();await recovered.waitForFunction(()=>document.activeElement?.matches('.boot-recovery h1'));
  assert.equal(await fsp.readFile(recovery.filename,'utf8'),'{synthetic-corrupt');assert.equal(recovery.writes,0);assert.equal(recovery.services,0);
  await fsp.writeFile(recovery.filename,JSON.stringify(recovery.valid()));
  await recovered.keyboard.press('Tab');await recovered.keyboard.press('Enter');
  await recovered.locator('.page-header h1').filter({hasText:label('desktop.sessions')}).waitFor();
  assert.equal(recovery.reads,3);assert.equal(recovery.writes,1);assert.equal(recovery.services,1);
  checks.push('actual React recovery heading/alert, keyboard retry, repeated corrupt error and preserved source, real-file correction to ready');
  await recovered.screenshot({path:path.join(runRoot,'recovered.png'),animations:'disabled'});await recovered.close();

  const backupPage=await open('backup-only');
  await backupPage.getByRole('heading',{name:label('boot.failed'),exact:true}).waitFor();
  assert.ok((await backupPage.getByRole('alert').innerText()).includes(label('boot.recovery_required')));
  assert.equal(backupOnly.writes,0);assert.equal(backupOnly.services,0);assert.equal(fs.existsSync(backupOnly.filename),false);
  assert.equal(await fsp.readFile(backupOnlyPath,'utf8'),backupOnlyBytes);
  await backupPage.screenshot({path:path.join(runRoot,'backup-only.png'),animations:'disabled'});await backupPage.close();
  checks.push('actual React missing-primary/present-backup recovery alert; no empty library/services/write and backup bytes retained');

  const degradedPage=await open('degraded');
  await degradedPage.locator('.page-header h1').filter({hasText:label('desktop.sessions')}).waitFor();
  assert.ok(degraded.backupWarning);assert.equal(degraded.services,1);assert.equal(await fsp.readFile(degradedPath,'utf8'),degradedBytes);
  await degradedPage.locator('.sidebar').getByRole('button',{name:label('desktop.presets'),exact:true}).click();
  await degradedPage.getByRole('button',{name:label('desktop.export_json'),exact:true}).click();await waitForCount(degraded,'exportPresets',1);
  await degradedPage.close();
  checks.push('actual React remains usable with valid primary/corrupt backup via boot-only degradation; backup retained and export dispatch available');

  const firstRun=await open('onboarding');
  await firstRun.getByRole('heading',{name:label('onboarding.hi_this_is_apertrove'),exact:true}).waitFor();
  assert.equal(onboarding.store.settings.onboarding.completed,false);assert.equal(onboarding.writes,1);
  await firstRun.getByRole('button',{name:label('onboarding.start_setup'),exact:true}).click();
  await firstRun.locator('.setup-screen[data-step="environment"]').waitFor();await waitForCount(onboarding,'sdkEnvironment',1);
  await firstRun.getByRole('button',{name:label('onboarding.skip_step'),exact:true}).click();await firstRun.locator('.setup-screen[data-step="discovery"]').waitFor();
  assert.equal(onboarding.calls.filter(call=>call.method==='listCameras').length,0,'Missing SDK fixture must not trigger discovery');
  checks.push('actual React fresh onboarding, persisted step, explicit missing-SDK fixture, skip without camera discovery');
  await firstRun.screenshot({path:path.join(runRoot,'onboarding.png'),animations:'disabled'});await firstRun.close();

  const page=await open('valid');await page.locator('.page-header h1').filter({hasText:label('desktop.sessions')}).waitFor();
  assert.equal(await page.locator('.setup-screen').count(),0);assert.equal(valid.services,1);
  const nav=page.locator('.sidebar');
  for(const key of ['capture','library','presets','equipment','tools','web_remote','settings','sessions']){
    await nav.getByRole('button',{name:label('desktop.'+key),exact:true}).click();
    await page.locator('.page-header h1').filter({hasText:label('desktop.'+key)}).waitFor();
    if(key==='equipment'){
      await waitForCount(valid,'equipment',1);await page.locator('.equipment-card').nth(1).waitFor();
      assert.equal(await page.locator('.equipment-card').count(),2);assert.equal(await page.locator('.equipment-error').count(),0);assert.equal(await page.locator('.equipment-online.on').count(),0);
    }
  }
  checks.push('actual React navigation: Sessions/Capture/Library/Presets/Equipment/Tools/Web Remote/Settings; equipment RPC called and two disconnected cards rendered without equipment-error');
  await nav.getByRole('button',{name:label('desktop.capture'),exact:true}).click();
  const cameraEvent={connected:true,model:'Synthetic provider',properties:{driveMode:{value:0,choices:[]}},capabilities:{capture:true,liveView:false,focus:false},live:false};
  await page.evaluate(camera=>window.__apertroveSyntheticEvent({type:'camera',data:camera}),cameraEvent);
  const shutter=page.locator('.capture-button-group button.shutter');await shutter.waitFor();
  await page.waitForFunction(()=>!document.querySelector('.capture-button-group button.shutter')?.disabled);
  await page.evaluate(()=>window.__apertroveSyntheticEvent({type:'operationState',data:{busy:true,ledger:{operations:[{state:'DRAINING'}]}}}));
  await page.waitForFunction(()=>document.querySelector('.capture-button-group button.shutter')?.disabled===true);
  await page.screenshot({path:path.join(runRoot,'operation-draining.png'),animations:'disabled'});
  await page.evaluate(()=>window.__apertroveSyntheticEvent({type:'operationState',data:{busy:true,ledger:{admissionOpen:false,history:[{state:'UNKNOWN_TERMINATION'},{state:'COMPLETED',method:'status'}]}}}));
  await page.getByText(label('operation.unknown'),{exact:true}).first().waitFor();
  assert.equal(await shutter.isEnabled(),false,'A safety response must not clear UNKNOWN admission');
  await page.evaluate(()=>window.__apertroveSyntheticEvent({type:'operationState',data:{busy:false}}));
  await page.waitForFunction(()=>!document.querySelector('.capture-button-group button.shutter')?.disabled);
  await page.evaluate(camera=>window.__apertroveSyntheticEvent({type:'camera',data:{...camera,properties:{driveMode:{value:1,choices:[]}}}}),cameraEvent);
  const burstButton=page.locator('.native-burst-control button');await burstButton.waitFor();
  const bounds=await burstButton.boundingBox();assert.ok(bounds);await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.down();
  await waitForCount(valid,'burstStart',1);await page.waitForFunction(()=>document.querySelector('.native-burst-control button')?.textContent.includes('Release'));
  assert.equal(await burstButton.isEnabled(),true,'An owned held shutter must remain releasable');await page.mouse.up();await waitForCount(valid,'burstStop',1);
  await page.locator('.native-burst-control small').filter({hasText:label('operation.capture_unverified')}).waitFor();
  assert.equal(await page.locator('.native-burst-control small').innerText(),label('operation.capture_unverified'));
  await page.screenshot({path:path.join(runRoot,'operation-unconfirmed.png'),animations:'disabled'});
  await page.evaluate(()=>{window.__apertroveSyntheticEvent({type:'burst',data:null});window.__apertroveSyntheticEvent({type:'camera',data:{connected:false,properties:{},capabilities:{capture:false,liveView:false,focus:false}}});});
  checks.push('actual React operationState draining blocks new shutter; proven handler receipt releases busy; held burst remains releasable through pointer-up and UNVERIFIED transfer shows no false saved-count success (fixture transport)');
  await nav.getByRole('button',{name:label('desktop.settings'),exact:true}).click();
  await page.getByRole('button',{name:label('appearance.theme').replace('{{v0}}',label('appearance.dark')),exact:true}).click();
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
  assert.equal(JSON.parse(await fsp.readFile(valid.filename,'utf8')).settings.theme,'dark');
  checks.push('actual React settings event/appearance update and production storage write');
  await nav.getByRole('button',{name:label('desktop.library'),exact:true}).click();
  await page.getByRole('button',{name:label('desktop.open_shot_inspector'),exact:true}).click();await waitForCount(valid,'openShotInspector',1);
  await page.locator('.header-actions').getByRole('button',{name:/^Import\s+Ctrl I$/}).click();await waitForCount(valid,'importFiles',1);
  await page.locator('.page-header h1').click();await page.keyboard.press('Control+i');await waitForCount(valid,'importFiles',2);
  await page.getByRole('button',{name:label('photoActions.open').replace('{{v0}}','synthetic.png'),exact:true}).click();
  await page.locator('.viewer').waitFor();await page.getByRole('button',{name:label('desktop.export_jpeg'),exact:true}).click();await waitForCount(valid,'exportPhoto',1);
  await page.getByRole('button',{name:label('desktop.all_metadata'),exact:true}).click();
  const metadata=page.locator('.photo-metadata'),jsonExport=metadata.getByRole('button',{name:'JSON',exact:true});
  await metadata.waitFor();await waitForCount(valid,'photoMetadata',1);await jsonExport.waitFor();
  await page.waitForFunction(()=>document.querySelector('.photo-metadata .metadata-rows')?.children.length>0);
  const metadataRows=await metadata.locator('.metadata-rows>div').count();valid.failMetadataOnce=true;
  await jsonExport.click();await waitForCount(valid,'exportMetadata',1);
  await metadata.getByRole('alert').filter({hasText:label('export.exists')}).waitFor();
  assert.equal(await metadata.locator('.metadata-rows>div').count(),metadataRows);assert.equal(await jsonExport.isEnabled(),true);
  await page.screenshot({path:path.join(runRoot,'metadata-export-error.png'),animations:'disabled'});
  await jsonExport.click();await waitForCount(valid,'exportMetadata',2);
  await metadata.getByRole('alert').waitFor({state:'detached'});assert.equal(await metadata.locator('.metadata-rows>div').count(),metadataRows);
  await page.keyboard.press('Escape');await metadata.waitFor({state:'detached'});
  await page.keyboard.press('Escape');await page.locator('.viewer').waitFor({state:'detached'});
  await nav.getByRole('button',{name:label('desktop.presets'),exact:true}).click();
  await page.getByRole('button',{name:label('desktop.export_json'),exact:true}).click();await waitForCount(valid,'exportPresets',1);
  await page.getByRole('button',{name:label('desktop.import_json'),exact:true}).click();await waitForCount(valid,'importPresets',1);
  checks.push('UI dispatch only: Inspector/import via button+Ctrl-I/export JPEG/metadata JSON/preset JSON import+export; cancellation retained; metadata policy rejection is visible, preserves tags and permits retry without pageerror');
  await nav.getByRole('button',{name:'Lighting Studio',exact:true}).click();
  await page.locator('.lighting-swatches button').first().click();await waitForCount(valid,'copyColor',1);
  assert.match(valid.calls.find(call=>call.method==='copyColor').args.text,/^#[0-9a-f]{6}$/i);
  checks.push('Lighting Studio copy HEX dispatch through focal.copyColor fixture (no OS clipboard)');
  const assets=await page.evaluate(async()=>{
    await document.fonts.ready;
    const fonts=[...document.fonts].filter(face=>face.status==='loaded').map(face=>face.family);
    const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;canvas.getContext('2d').fillRect(0,0,2,2);
    const image=new Image();image.src=canvas.toDataURL('image/png');await image.decode();
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png')),url=URL.createObjectURL(blob),preview=new Image();
    try{preview.src=url;await preview.decode();return {fonts,dataPreview:image.naturalWidth,blobPreview:preview.naturalWidth};}finally{URL.revokeObjectURL(url);}
  });
  assert.ok(assets.fonts.some(font=>/Manrope/i.test(font)));assert.equal(assets.dataPreview,2);assert.equal(assets.blobPreview,2);
  checks.push('built CSS/font assets loaded; browser canvas/data/blob image decode (no Electron focal-asset/CSP claim)');
  await page.screenshot({path:path.join(runRoot,'valid.png'),animations:'disabled'});await page.close();
  guard.assertNoUnexpected();assert.deepEqual(pageErrors,[]);assert.deepEqual(hostEvidence.unexpectedDenials,[]);assert.deepEqual(hostEvidence.blockedPageRequests,[]);
  await closeContextBounded();
  await new Promise(resolve=>server.close(resolve));server=null;
  const until=Date.now()+5000;while(browserChild&&browserChild.exitCode===null&&browserChild.signalCode===null&&Date.now()<until)await sleep(20);
  assert.ok(browserChild&&(browserChild.exitCode!==null||browserChild.signalCode!==null),'Edge root process has not exited');
  for(const fixture of cases.values()){fixture.originalHashAfter=crypto.createHash('sha256').update(await fsp.readFile(fixture.original)).digest('hex');assert.equal(fixture.originalHashAfter,fixture.originalHashBefore,'Synthetic original changed: '+fixture.name);}
  const edgeHash=crypto.createHash('sha256').update(await fsp.readFile(EDGE)).digest('hex');
  withinBudget();
  const report={status:'PASS',testLevel:'T2',name:'renderer',sourceCommit,kind:'named T2 actual React + real synthetic filesystem boot with mock focal transport/services',checks,fixtureRoot:runRoot,elapsedMs:Date.now()-deadline,edge:{path:EDGE,sha256:edgeHash,versionEvidence:'Installed Edge signature was verified separately by the orchestrator; this runner records executable hash.',rootExited:true},host:hostEvidence,production:guard.evidence(),cases:Object.fromEntries([...cases].map(([name,fixture])=>[name,{reads:fixture.reads,writes:fixture.writes,services:fixture.services,original:fixture.original,originalHashBefore:fixture.originalHashBefore,originalHashAfter:fixture.originalHashAfter,calls:fixture.calls}])),limitations:['No actual Electron/preload/IPC/BrowserWindow/utilityProcess or camera/native provider was launched.','Service constructors and focal transport are mocks. Fixture prepare composes reviewed production normalizers; it is not the full main module.','Import/export/Inspector/clipboard checks prove React dispatch only; dialogs cancel and no codec/OS file export is exercised.','Page requests and host Node sockets are fenced; installed Edge is trusted and this is not an OS network/filesystem sandbox.','Browser canvas/data/blob decoding is not an Electron focal-asset or CSP acceptance test.']};
  await fsp.writeFile(path.join(runRoot,'report.json'),JSON.stringify(report,null,2));
  if(budgetFired||Date.now()-deadline>=85000){await fsp.writeFile(path.join(runRoot,'report.json'),JSON.stringify({status:'FAIL',testLevel:'T2',name:'renderer',sourceCommit,reason:'hard budget exceeded'}));throw Error('T2 renderer hard budget exceeded');}
  withinBudget();
  process.stdout.write(JSON.stringify({status:report.status,checks:checks.length,report:path.join(runRoot,'report.json')})+'\n');
}

deadline=Date.now();
const watchdog=setTimeout(()=>{
  budgetFired=true;process.exitCode=1;allowBrowserSpawn=false;process.stderr.write('T2_RENDERER_BUDGET_EXCEEDED\n');
  // A finite emergency grace bounds hung browser close/driver operations to 88 s.
  const forceExit=setTimeout(()=>{killKnownEdge();process.exit(1);},3000);forceExit.unref();
  void cleanup().catch(error=>process.stderr.write('Budget cleanup: '+error.message+'\n'));
},85000);
function killKnownEdge(){if(browserChild&&browserChild.exitCode===null&&browserChild.signalCode===null){try{browserChild.kill();}catch(error){process.stderr.write('Known Edge cleanup: '+error.message+'\n');}}}
async function closeContextBounded(){
  const closing=context;context=null;if(!closing)return;
  let timer;
  try{await Promise.race([closing.close(),new Promise((_resolve,reject)=>{timer=setTimeout(()=>reject(Error('Browser close exceeded 2 s')),2000);})]);}
  catch(error){killKnownEdge();throw error;}
  finally{clearTimeout(timer);}
}
async function cleanup(){
  allowBrowserSpawn=false;
  try{await closeContextBounded();}catch(error){process.stderr.write('Context cleanup: '+error.message+'\n');}
  if(server){const closing=server;server=null;closing.closeAllConnections();await Promise.race([new Promise(resolve=>closing.close(resolve)),sleep(1000)]);}
  killKnownEdge();
}
main().catch(async error=>{process.exitCode=1;process.stderr.write(error.stack+'\n');if(runRoot)await fsp.writeFile(path.join(runRoot,'failure.json'),JSON.stringify({status:'FAIL',budgetFired,error:error.stack,host:hostEvidence},null,2));}).finally(async()=>{await cleanup();clearTimeout(watchdog);if(budgetFired)process.exitCode=1;});
