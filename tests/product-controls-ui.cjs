'use strict';
// Actual Electron + production renderer/main/preload with the fenced JS provider.
// No Canon worker, Koffi, EDSDK, WIA or physical camera is admitted.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {_electron}=require('playwright');
const root=path.resolve(__dirname,'..'),base=path.join(root,'qa/integration-candidate'),read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const admission=read(path.join(base,'runtime/admission.json')),binary=admission.binary.path;
assert.equal(process.platform,'win32');assert.equal(process.arch,'x64');assert.ok(process.execArgv.includes('--no-addons'));assert.ok(!process.env.NODE_OPTIONS&&!process.env.NODE_PATH);
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex'),admission.binary.sha256);
assert.ok(path.resolve(binary).startsWith(path.join(base,'runtime')+path.sep));
const screenshots=process.argv.includes('--screenshots');
const demoArg=process.argv.indexOf('--demo-dir'),demoDir=demoArg>=0?path.resolve(process.argv[demoArg+1]):null;
const fixture=fs.mkdtempSync(path.join(base,'fixtures/product-ui-'));
for(const folder of ['user-data','user-data/previews','photos','other-photos','inputs','exports','artifacts','environment'])fs.mkdirSync(path.join(fixture,folder));
const env={NODE_OPTIONS:'',NODE_PATH:'',PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD:'1',ELECTRON_SKIP_BINARY_DOWNLOAD:'1'};
for(const key of ['SystemRoot','SYSTEMROOT','WINDIR','PROCESSOR_ARCHITECTURE','NUMBER_OF_PROCESSORS'])if(process.env[key])env[key]=process.env[key];
for(const key of ['USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP']){env[key]=path.join(fixture,'environment',key);fs.mkdirSync(env[key]);}
const seed=demoDir?fs.readFileSync(path.join(demoDir,'Study 08.jpg')):Buffer.from(require('./ic01/fixture-image.cjs').jpegBase64,'base64'),seedFile=path.join(fixture,'seed.jpg');fs.writeFileSync(seedFile,seed);
const at='2026-11-21T12:00:00.000Z',sessions=[{id:'portrait',name:'Portrait study',captureFolder:path.join(fixture,'photos'),created:at,updated:at,presetQueue:[]},{id:'light',name:'Light and color',captureFolder:path.join(fixture,'other-photos'),created:at,updated:at,presetQueue:[]}];
const photoFiles=Array.from({length:4},(_,index)=>{if(!demoDir)return seedFile;const target=path.join(fixture,'inputs','Study-'+(index+1)+'.jpg');fs.copyFileSync(path.join(demoDir,'Study 0'+(index*2+1)+'.jpg'),target);return target;});
const photos=Array.from({length:4},(_,index)=>({id:'demo-'+index,name:'Study-'+(index+1)+'.jpg',path:photoFiles[index],thumbPath:photoFiles[index],previewPath:photoFiles[index],sessionId:index<3?'portrait':'light',rating:index===0?5:0,size:seed.length,created:at,date:at,metadata:{width:320,height:240},edits:{exposure:0,contrast:0,saturation:0,warmth:0,rotation:0,monochrome:false},cameraTransfer:index===0,transfer:index===0?{sessionAssociation:{status:'AMBIGUOUS',candidateSessionIds:['portrait','light']}}:undefined}));
fs.writeFileSync(path.join(fixture,'user-data/library.json'),JSON.stringify({version:2,sessionId:'portrait',sessions,photos,presets:[{id:'demo',name:'Soft daylight',values:{iso:72,shutter:112,aperture:48}}],settings:{language:'en-US',theme:'light',design:'current',showSplashes:false,performanceMode:true,autoSelect:true,captureFolder:sessions[0].captureFolder,watchFolder:'',sdkDir:'',onboarding:{completed:true,step:'ready'}}}));
fs.writeFileSync(path.join(fixture,'config.json'),'{}');
let app,page;const errors=[],checks=[];
const command=(method,args)=>page.evaluate(({method,args})=>window.focal[method](args),{method,args});
const driver=(method,...args)=>app.evaluate((_electron,{method,args})=>globalThis.__ic01[method](...args),{method,args});
const configure=args=>driver('workerControl','configure',args);
const catalog=read(path.join(root,'electron/i18n/locales/en-US.json')),label=key=>catalog[key];
const button=key=>page.getByRole('button',{name:label(key),exact:true});
const nav=key=>page.locator('.sidebar .nav-item').filter({hasText:label('desktop.'+key)}).click();
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
async function waitCamera(predicate){await page.waitForFunction(predicate);}
async function visibleCapture(){await nav('capture');await page.locator('.capture-workspace').waitFor();}
async function run(){
 app=await _electron.launch({executablePath:binary,args:[path.join(root,'tests/ic01/entry.cjs'),'--fixture='+fixture],cwd:root,env,chromiumSandbox:true,timeout:20000});
 page=await app.firstWindow();page.setDefaultTimeout(6000);page.on('pageerror',error=>errors.push(error.message));
 await page.waitForSelector('.app-shell');await command('listCameras');await configure({productControls:true,liveView:true});await command('connect',{cameraId:'ic01-synthetic-camera'});await visibleCapture();
 await check('compact histogram supports keyboard, persistence and themed states',async()=>{
   assert.equal(await page.locator('.live-histogram-toggle').count(),0);await command('live',{enabled:true});await page.waitForFunction(()=>Number(document.querySelector('.live-canvas')?.dataset.frames)>0);
   const toggle=button('desktop.live_histogram_toggle');assert.equal(await toggle.getAttribute('aria-pressed'),'false');assert.equal((await toggle.textContent()).trim(),'');assert.ok(await toggle.getAttribute('title'));
   const bounds=await toggle.boundingBox();assert.ok(bounds.width<=32&&bounds.height<=32);await toggle.focus();await page.keyboard.press('Space');await page.waitForFunction(()=>document.querySelector('.live-histogram-toggle')?.getAttribute('aria-pressed')==='true');await page.waitForFunction(()=>document.querySelectorAll('.live-histogram-widget>svg path').length===4);
   assert.equal((await command('boot')).settings.liveHistogramEnabled,true);
   for(const theme of ['dark','light']){await command('settings',{theme});await page.waitForFunction(theme=>document.documentElement.dataset.theme===theme,theme);const colors=await page.locator('.live-histogram-widget').evaluate(node=>({bg:getComputedStyle(node).backgroundColor,color:getComputedStyle(node).color}));assert.notEqual(colors.bg,'rgba(0, 0, 0, 0)');}
   await toggle.click();assert.equal((await command('boot')).settings.liveHistogramEnabled,false);await command('live',{enabled:false});await page.locator('.live-histogram-toggle').waitFor({state:'detached'});
 });
 await check('histogram unavailability is disabled without disturbing the preview',async()=>{
   await command('live',{enabled:false});await page.locator('.live-canvas').waitFor({state:'detached'});
   await page.evaluate(()=>{window.originalCanvasContext=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,options){return options?.willReadFrequently?null:window.originalCanvasContext.call(this,kind,options);};});
   await command('live',{enabled:true});await page.locator('.live-histogram-toggle:disabled').waitFor();assert.equal(await button('desktop.live_histogram_toggle').getAttribute('aria-pressed'),'false');
   await page.waitForFunction(()=>Number(document.querySelector('.live-canvas')?.dataset.frames)>0);
   await page.evaluate(()=>{HTMLCanvasElement.prototype.getContext=window.originalCanvasContext;delete window.originalCanvasContext;});await command('live',{enabled:false});await page.locator('.live-canvas').waitFor({state:'detached'});
 });
 await check('AI Servo toggles command ownership, restores mode and locks incompatible UI',async()=>{
   const toggle=button('desktop.servo_toggle');await toggle.click();await waitCamera(()=>document.querySelector('.servo-toggle')?.getAttribute('aria-pressed')==='true');
   await assert.rejects(command('capture'));await assert.rejects(command('sessionOpen',{id:'light'}));
   const snapshot=await driver('workerControl','snapshot');assert.equal(snapshot.productCalls.servoStarts,1);assert.equal(snapshot.servo.trackingConfirmed,false);assert.equal((await command('boot')).camera.properties.afMode.value,1);
   assert.equal(await page.getByRole('button',{name:'AF',exact:true}).isDisabled(),true);assert.equal(await page.locator('.capture-button-group button').last().isDisabled(),true);assert.equal(await page.getByRole('combobox',{name:'ISO',exact:true}).isDisabled(),true);
   await toggle.click();await waitCamera(()=>document.querySelector('.servo-toggle')?.getAttribute('aria-pressed')==='false');assert.equal((await command('boot')).camera.properties.afMode.value,0);assert.equal(await page.getByRole('button',{name:'AF',exact:true}).isEnabled(),true);
   await configure({nextServoError:'start'});await toggle.click();await page.locator('.servo-control [role=alert]').waitFor();assert.equal((await command('boot')).camera.servo.enabled,false);
   await toggle.click();await waitCamera(()=>document.querySelector('.servo-toggle')?.getAttribute('aria-pressed')==='true');await configure({nextServoError:'stop'});await toggle.click();await page.locator('.servo-control [role=alert]').waitFor();assert.equal((await command('boot')).camera.servo.enabled,null);assert.equal(await page.locator('.capture-button-group button').last().isDisabled(),true);await toggle.click();
 });
 await check('BULB uses camera events, explicit end and honest error ownership',async()=>{
   const start=button('desktop.bulb_start');await start.click();await page.locator('.bulb-control[data-state=exposing]').waitFor();await assert.rejects(command('capture'));await assert.rejects(command('property',{key:'iso',value:80}));await assert.rejects(command('sessionOpen',{id:'light'}));assert.equal(await page.locator('.capture-button-group button').last().isDisabled(),true);await page.locator('.bulb-status output').filter({hasText:label('desktop.bulb_waiting')}).waitFor();
   await configure({bulbElapsed:7});await page.locator('.bulb-status output').filter({hasText:'7 s'}).waitFor();await page.waitForTimeout(320);assert.equal((await page.locator('.bulb-status output').textContent()).trim(),'7 s');
   await button('desktop.bulb_stop').click();await page.locator('.bulb-control[data-state=idle]').waitFor();await configure({nextBulbError:'start'});await start.click();await page.locator('.bulb-control[data-state=error]').waitFor();assert.equal((await command('boot')).camera.bulb.startAcknowledged,false);
   await start.click();await page.locator('.bulb-control[data-state=exposing]').waitFor();await configure({nextBulbError:'stop'});await button('desktop.bulb_stop').click();await page.locator('.bulb-control[data-state=error]').waitFor();assert.equal((await command('boot')).camera.bulb.confirmation,'unknown');assert.equal(await page.locator('.capture-button-group button').last().isDisabled(),true);await button('desktop.bulb_stop').click();await page.locator('.bulb-control[data-state=idle]').waitFor();
 });
 await check('delayed fake transfer commits original, session and last-received identity before UI success',async()=>{
   await configure({nextCapture:{mode:'delayed',delayMs:160}});
   const capture=command('capture');await page.waitForFunction(()=>document.querySelector('.capture-button-group button')?.disabled===true);
   await assert.rejects(command('sessionOpen',{id:'light'}));const result=await capture;assert.equal(result.confirmation,'UNVERIFIED');
   const state=await command('boot'),record=state.photos.find(photo=>photo.id===state.lastReceivedPhotoId);assert.ok(record);assert.equal(record.sessionId,'portrait');assert.equal(record.cameraTransfer,true);assert.equal(record.transfer.correlation,'UNCONFIRMED');
   assert.ok(fs.existsSync(record.path));assert.equal(crypto.createHash('sha256').update(fs.readFileSync(record.path)).digest('hex'),crypto.createHash('sha256').update(seed).digest('hex'));
   const persisted=read(path.join(fixture,'user-data/library.json')).photos.find(photo=>photo.id===record.id);assert.equal(persisted.sessionId,'portrait');
   await page.locator('.preview-file[data-asset-id="'+record.id+'"]').waitFor();
 });
 await check('Library reassignment persists and current Capture preview stays session scoped',async()=>{
   await nav('library');await page.getByRole('button',{name:label('photoActions.open').replace('{{v0}}','Study-1.jpg'),exact:true}).click();await page.locator('.viewer').waitFor();const selector=page.getByRole('combobox',{name:label('desktop.photo_session'),exact:true});await selector.click();await page.getByRole('option',{name:'Light and color',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.photo-session-association .ui-select')?.textContent.includes('Light and color'));
   const state=await command('boot');assert.equal(state.photos.find(photo=>photo.id==='demo-0').sessionId,'light');assert.equal(state.photos.find(photo=>photo.id==='demo-0').sessionAssignment.source,'USER');assert.equal(state.photos.find(photo=>photo.id==='demo-0').transfer.sessionAssociation.status,'AMBIGUOUS');await page.keyboard.press('Escape');await visibleCapture();assert.equal(await page.locator('.preview-file[data-asset-id=demo-0]').count(),0);
 });
 if(screenshots){
   await configure({bulbQualified:false});await assert.rejects(command('bulbStart'));
   while(await page.locator('.toast-stack button').count())await page.locator('.toast-stack button').first().click();
   assert.equal((await page.locator('body').innerText()).includes('C:\\Users'),false);
   await command('settings',{theme:'light',design:'current',liveHistogramEnabled:true});await command('live',{enabled:true});await page.waitForFunction(()=>Number(document.querySelector('.live-canvas')?.dataset.frames)>1);await page.screenshot({path:path.join(root,'docs/screenshots/workspace.png')});
   for(const [key,file]of [['sessions','sessions'],['library','library'],['lighting','lighting']]){await nav(key);await page.screenshot({path:path.join(root,'docs/screenshots',file+'.png')});}
   await command('live',{enabled:false});const opening=app.waitForEvent('window');await command('openShotInspector');const inspector=await opening;await inspector.waitForSelector('.shot-shell');await inspector.waitForFunction(()=>document.querySelector('.shot-stage img')?.naturalWidth>0);await inspector.screenshot({path:path.join(root,'docs/screenshots/inspector.png')});await inspector.close();
   await nav('settings');await button('desktop.setup_guide').click();await page.locator('.setup-screen').waitFor();await page.screenshot({path:path.join(root,'docs/screenshots/welcome.png')});await button('onboarding.set_up_later').click();
 }
 await configure({bulbQualified:true});
 await check('disconnect clears Live View without claiming exposure or focus completion',async()=>{
   await visibleCapture();await command('live',{enabled:true});await button('desktop.bulb_start').click();await page.locator('.bulb-control[data-state=exposing]').waitFor();await configure({disconnect:true});await page.waitForFunction(()=>!document.querySelector('.live-canvas'));assert.equal(await page.locator('.live-histogram-toggle').count(),0);assert.equal((await command('boot')).camera.bulb.confirmation,'unknown');assert.equal(await button('desktop.bulb_stop').isDisabled(),true);
 });
 assert.deepEqual(errors,[]);const info=await driver('info');const provider=await driver('workerControl','snapshot');assert.equal(provider.nativeCalls,0);assert.deepEqual(info.guard.unexpectedDenials,[]);assert.ok(provider.denials.every(item=>item.expected));
 await command('window',{action:'close'});await app.close();app=null;
 const runtime=read(path.join(fixture,'runtime.json'));assert.deepEqual(runtime.guard.unexpectedDenials,[]);assert.ok(runtime.observations.workers.every(worker=>worker.exited));
 if(screenshots){
   const appearanceFixture=fs.mkdtempSync(path.join(base,'fixtures/product-appearance-'));
   fs.mkdirSync(path.join(appearanceFixture,'user-data'));fs.writeFileSync(path.join(appearanceFixture,'seed.jpg'),seed);fs.writeFileSync(path.join(appearanceFixture,'config.json'),'{}');
   fs.writeFileSync(path.join(appearanceFixture,'user-data/library.json'),JSON.stringify({version:2,sessionId:null,sessions:[],photos:[],presets:[],settings:{language:'en-US',theme:'light',design:'current',showSplashes:false,performanceMode:true,captureFolder:'',watchFolder:'',sdkDir:'',onboarding:{completed:true,step:'ready'}}}));
   const appearanceEnv={...env};for(const key of ['USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP']){appearanceEnv[key]=path.join(appearanceFixture,'environment',key);fs.mkdirSync(appearanceEnv[key],{recursive:true});}
   app=await _electron.launch({executablePath:binary,args:[path.join(root,'tests/ic01/entry.cjs'),'--fixture='+appearanceFixture],cwd:root,env:appearanceEnv,chromiumSandbox:true,timeout:20000});
   page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));await page.waitForSelector('.app-shell');await nav('settings');
   assert.ok(!(await page.locator('body').innerText()).includes('C:\\Users'),'Private paths in settings screenshot');
   await page.screenshot({path:path.join(root,'docs/screenshots/settings.png')});await button('desktop.setup_guide').click();await page.locator('.setup-screen').waitFor();
   await page.screenshot({path:path.join(root,'docs/screenshots/welcome.png')});await app.close();app=null;
   assert.deepEqual(errors,[]);
 }
 console.log(JSON.stringify({pass:checks.length,checks,fixture,hardware:false,provider:'IC01_SYNTHETIC_JS_ONLY',screenshots,errors}));
}
run().catch(error=>{console.error(error.stack||error);process.exitCode=1;}).finally(async()=>{if(app)await app.close().catch(()=>{});});
