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
const onlyBurst=process.argv.includes('--only-burst');
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
fs.writeFileSync(path.join(fixture,'config.json'),JSON.stringify({extendedUiDeadline:true}));
let app,page;const errors=[],checks=[];
const command=(method,args)=>page.evaluate(({method,args})=>window.focal[method](args),{method,args});
const driver=(method,...args)=>app.evaluate((_electron,{method,args})=>globalThis.__ic01[method](...args),{method,args});
const configure=args=>driver('workerControl','configure',args);
const catalog=read(path.join(root,'electron/i18n/locales/en-US.json')),label=key=>catalog[key];
const button=key=>page.getByRole('button',{name:label(key),exact:true});
const nav=key=>page.locator('.sidebar .nav-item').filter({hasText:label('desktop.'+key)}).click();
const evidence=name=>page.screenshot({path:path.join(fixture,'artifacts',name+'.png')});
async function servoMenu(){await page.locator('.af-mode-toggle').click();return page.getByRole('menuitemcheckbox',{name:label('desktop.servo_toggle'),exact:true});}
async function toggleServo(){await(await servoMenu()).click();}
async function assertServo(enabled){try{await page.waitForFunction(enabled=>{const control=document.querySelector('.af-control');return control?.dataset.servo===String(enabled)&&control.getAttribute('aria-busy')==='false';},enabled);}catch(error){fs.writeFileSync(path.join(fixture,'artifacts/servo-wait-state.json'),JSON.stringify({boot:await command('boot'),provider:await driver('workerControl','snapshot')},null,2));throw error;}assert.equal((await command('boot')).camera.servo.enabled,enabled);}
async function waitBurstAfter(previous){await page.waitForFunction(async previous=>{const state=await window.focal.boot();return state.burst?.id!==previous&&['unconfirmed','completed'].includes(state.burst?.status)&&!state.captureState?.active&&!state.operationState?.busy;},previous);await page.waitForFunction(label=>{const node=document.querySelector('.native-burst-control button');return node&&!node.disabled&&node.getAttribute('aria-label')===label;},label('burstShutter.hold_for_continuous_shooting'));}
async function waitFakeHeld(){for(let attempt=0;attempt<70;attempt++){const snapshot=await driver('workerControl','snapshot');if(snapshot.held)return snapshot;await page.waitForTimeout(20);}throw Error('Fake capture was not admitted into its held state.');}
async function check(name,fn){if(onlyBurst&&!name.startsWith('burst shutter'))return;await fn();checks.push(name);console.log('PASS '+name);}
async function waitCamera(predicate){await page.waitForFunction(predicate);}
async function visibleCapture(){await nav('capture');await page.locator('.capture-workspace').waitFor();}
async function run(){
 app=await _electron.launch({executablePath:binary,args:[path.join(root,'tests/ic01/entry.cjs'),'--fixture='+fixture],cwd:root,env,chromiumSandbox:true,timeout:20000});
 page=await app.firstWindow();page.setDefaultTimeout(6000);page.on('pageerror',error=>errors.push(error.message));
 await page.waitForSelector('.app-shell');await command('listCameras');await configure({productControls:true,liveView:true});await command('connect',{cameraId:'ic01-synthetic-camera'});await visibleCapture();
 await check('histogram OFF leaves only an icon; keyboard opens the original RGB plot in both themes',async()=>{
   assert.equal(await page.locator('.live-histogram-toggle').count(),0);await command('live',{enabled:true});await page.waitForFunction(()=>Number(document.querySelector('.live-canvas')?.dataset.frames)>0);
   const toggle=button('desktop.live_histogram_toggle');assert.equal(await toggle.getAttribute('aria-pressed'),'false');assert.equal((await toggle.textContent()).trim(),'');assert.ok(await toggle.getAttribute('title'));
   assert.equal(await page.locator('.live-histogram-widget,.live-histogram-head,.live-histogram-empty').count(),0);
   const controls=page.locator('.live-preview-controls'),surface=await controls.evaluate(node=>({background:getComputedStyle(node).backgroundColor,padding:getComputedStyle(node).padding,shadow:getComputedStyle(node).boxShadow,text:node.textContent.trim()}));
   assert.equal(surface.background,'rgba(0, 0, 0, 0)');assert.equal(surface.padding,'0px');assert.equal(surface.shadow,'none');assert.equal(surface.text,'');await evidence('histogram-off-light');
   const bounds=await toggle.boundingBox();assert.ok(bounds.width<=32&&bounds.height<=32);await toggle.focus();await page.keyboard.press('Space');await page.waitForFunction(()=>document.querySelector('.live-histogram-toggle')?.getAttribute('aria-pressed')==='true');await page.waitForFunction(()=>document.querySelectorAll('.live-histogram-widget>svg path').length===4);
   assert.equal((await command('boot')).settings.liveHistogramEnabled,true);
   for(const theme of ['dark','light']){await command('settings',{theme});await page.waitForFunction(theme=>document.documentElement.dataset.theme===theme,theme);const colors=await page.locator('.live-histogram-widget').evaluate(node=>({bg:getComputedStyle(node).backgroundColor,color:getComputedStyle(node).color}));assert.notEqual(colors.bg,'rgba(0, 0, 0, 0)');assert.deepEqual(await toggle.boundingBox(),bounds);await evidence('histogram-on-'+theme);}
   await toggle.focus();await page.keyboard.press('Enter');assert.equal((await command('boot')).settings.liveHistogramEnabled,false);await page.locator('.live-histogram-widget').waitFor({state:'detached'});
   await command('live',{enabled:false});await page.locator('.live-histogram-toggle').waitFor({state:'detached'});
 });
 await check('histogram unavailability is disabled without disturbing the preview',async()=>{
   await command('live',{enabled:false});await page.locator('.live-canvas').waitFor({state:'detached'});
   await page.evaluate(()=>{window.originalCanvasContext=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,options){return options?.willReadFrequently?null:window.originalCanvasContext.call(this,kind,options);};});
   await command('settings',{liveHistogramEnabled:true});await command('live',{enabled:true});await page.locator('.live-histogram-toggle[aria-pressed=true]').waitFor();assert.equal(await button('desktop.live_histogram_toggle').isEnabled(),true);await page.locator('.live-histogram-widget').waitFor();await button('desktop.live_histogram_toggle').click();await page.locator('.live-histogram-widget').waitFor({state:'detached'});
   await page.locator('.live-histogram-toggle:disabled').waitFor();assert.equal(await button('desktop.live_histogram_toggle').getAttribute('aria-pressed'),'false');assert.equal((await command('boot')).settings.liveHistogramEnabled,false);
   await page.waitForFunction(()=>Number(document.querySelector('.live-canvas')?.dataset.frames)>0);
   await page.evaluate(()=>{HTMLCanvasElement.prototype.getContext=window.originalCanvasContext;delete window.originalCanvasContext;});await command('live',{enabled:false});await page.locator('.live-canvas').waitFor({state:'detached'});
 });
 await check('manual Live View rotation cycles four angles, preserves aspect and keeps the histogram upright',async()=>{
   const before=(await driver('workerControl','snapshot')).h1.propertyWrites,sourceHash=crypto.createHash('sha256').update(fs.readFileSync(seedFile)).digest('hex');
   await command('live',{enabled:true});await page.waitForFunction(()=>Number(document.querySelector('.live-canvas')?.dataset.frames)>0);
   const rotate=button('desktop.live_rotate');assert.equal((await rotate.textContent()).trim(),'');assert.ok(await rotate.getAttribute('title'));const area=await rotate.boundingBox();assert.ok(area.width<=32&&area.height<=32);
   await button('desktop.live_histogram_toggle').click();await page.locator('.live-histogram-widget>svg').waitFor();
   for(const size of [[1480,960],[1280,900]]){
     await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setSize(...size),size);
     const overlay=await page.locator('.live-histogram-widget').boundingBox();
     for(const angle of [0,90,180,270]){
       await page.waitForFunction(angle=>document.querySelector('.live-canvas')?.dataset.rotation===String(angle),angle);
       const dimensions=await page.locator('.live-canvas').evaluate(node=>{const rect=node.getBoundingClientRect(),parent=node.closest('.preview-canvas').getBoundingClientRect();return {width:rect.width,height:rect.height,naturalWidth:node.width,naturalHeight:node.height,centerX:rect.x+rect.width/2,centerY:rect.y+rect.height/2,parentX:parent.x+parent.width/2,parentY:parent.y+parent.height/2,parentWidth:parent.width,parentHeight:parent.height};});
       const expected=angle%180?dimensions.naturalHeight/dimensions.naturalWidth:dimensions.naturalWidth/dimensions.naturalHeight;
       assert.ok(Math.abs(dimensions.width/dimensions.height-expected)<0.01,JSON.stringify({angle,dimensions}));assert.ok(dimensions.width<=dimensions.parentWidth+1&&dimensions.height<=dimensions.parentHeight+1);assert.ok(Math.abs(dimensions.centerX-dimensions.parentX)<1&&Math.abs(dimensions.centerY-dimensions.parentY)<1);
       assert.deepEqual(await page.locator('.live-histogram-widget').boundingBox(),overlay);if(size[0]===1480&&(angle===90||angle===270))await evidence('live-view-manual-'+angle);
       await rotate.focus();await page.keyboard.press(angle===90?'Enter':'Space');
     }
   }
   await page.waitForFunction(()=>document.querySelector('.live-canvas')?.dataset.rotation==='0');assert.equal((await driver('workerControl','snapshot')).h1.propertyWrites,before);assert.equal(crypto.createHash('sha256').update(fs.readFileSync(seedFile)).digest('hex'),sourceHash);
   await button('desktop.live_histogram_toggle').click();await command('live',{enabled:false});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1480,960));
 });
 await check('camera orientation updates live without restarting; manual override and automatic recovery are explicit',async()=>{
   await command('live',{enabled:true});await page.waitForFunction(()=>Number(document.querySelector('.live-canvas')?.dataset.frames)>0);const before=(await driver('workerControl','snapshot')).h1.liveCalls;
   for(const angle of [0,90,180,270,0,90]){await configure({liveOrientation:{status:'active',rotation:angle}});await page.waitForFunction(angle=>{const frame=document.querySelector('.live-canvas');return frame?.dataset.rotation===String(angle)&&frame.dataset.orientationMode==='auto';},angle);}
   await evidence('live-view-auto-90');await button('desktop.live_rotate').click();await page.waitForFunction(()=>document.querySelector('.live-canvas')?.dataset.rotation==='180');assert.equal(await page.locator('.live-canvas').getAttribute('data-orientation-mode'),'manual');
   await configure({liveOrientation:{status:'active',rotation:270}});assert.equal(await page.locator('.live-canvas').getAttribute('data-rotation'),'180');await button('desktop.live_rotation_restore_auto').click();await page.waitForFunction(()=>document.querySelector('.live-canvas')?.dataset.rotation==='270');assert.equal(await page.locator('.live-canvas').getAttribute('data-orientation-mode'),'auto');
   await configure({liveOrientation:{status:'unknown'}});await page.waitForFunction(()=>document.querySelector('.live-canvas')?.dataset.orientationMode==='manual');assert.equal(await page.locator('.live-rotation-auto').count(),0);assert.equal((await command('boot')).camera.liveOrientation.available,false);
   await configure({liveOrientation:{status:'active',rotation:180}});await page.waitForFunction(()=>document.querySelector('.live-canvas')?.dataset.rotation==='180'&&document.querySelector('.live-canvas')?.dataset.orientationMode==='auto');assert.equal((await driver('workerControl','snapshot')).h1.liveCalls,before);
   await configure({liveOrientation:{status:'unavailable'}});await command('live',{enabled:false});
 });
 await check('one AF control keeps One Shot separate from the Servo toggle and captures while tracking',async()=>{
   await command('live',{enabled:true});await page.waitForFunction(()=>Number(document.querySelector('.live-canvas')?.dataset.frames)>1);
   assert.equal(await page.locator('.servo-toggle,.servo-control').count(),0);assert.equal(await page.locator('.af-control').count(),1);
   await page.locator('.af-primary').click();assert.equal((await driver('workerControl','snapshot')).h1.autofocusCalls,1);
   await page.locator('.af-mode-toggle').focus();await page.keyboard.press('Enter');await page.getByRole('menu').waitFor();const toggle=page.getByRole('menuitemcheckbox',{name:label('desktop.servo_toggle'),exact:true});assert.equal(await toggle.getAttribute('aria-checked'),'false');
   await page.keyboard.press('Escape');assert.equal(await page.getByRole('menu').count(),0);await toggleServo();await assertServo(true);
   await assert.rejects(command('sessionOpen',{id:'light'}));
   let snapshot=await driver('workerControl','snapshot');assert.equal(snapshot.productCalls.servoStarts,1);assert.equal(snapshot.servo.trackingConfirmed,false);assert.equal(snapshot.h1.autofocusCalls,1);assert.equal((await command('boot')).camera.properties.afMode.value,1);
   assert.equal(snapshot.operations.operations.length,0);assert.equal(await page.locator('.af-primary').getAttribute('aria-label'),label('desktop.servo_stop'));assert.equal(await page.locator('.capture-button-group button').last().isEnabled(),true);
   await evidence('af-servo-active');
   const frames=Number(await page.locator('.live-canvas').getAttribute('data-frames'));await page.waitForTimeout(550);assert.ok(Number(await page.locator('.live-canvas').getAttribute('data-frames'))>frames);
   await page.locator('.capture-button-group button').last().click();await page.waitForFunction(()=>document.querySelector('.capture-button-group button')?.disabled===false);await assertServo(true);
   snapshot=await driver('workerControl','snapshot');assert.equal(snapshot.h1.captureCalls,1);assert.equal(snapshot.h1.autofocusCalls,1);assert.equal(snapshot.servo.enabled,true);assert.equal(snapshot.productCalls.servoStops,0);
   const state=await command('boot');assert.ok(state.lastReceivedPhotoId);await page.locator('.preview-file[data-asset-id="'+state.lastReceivedPhotoId+'"]').waitFor();
   await page.locator('.af-primary').click();await assertServo(false);assert.equal((await command('boot')).camera.properties.afMode.value,0);
   await toggleServo();await assertServo(true);await toggleServo();await assertServo(false);assert.equal((await driver('workerControl','snapshot')).h1.autofocusCalls,1);
   await page.locator('.af-mode-toggle').click();await page.getByRole('menuitem',{name:label('desktop.af_one_shot'),exact:true}).click();assert.equal((await driver('workerControl','snapshot')).h1.autofocusCalls,2);
 });
 await check('a shutter request during a Servo transition queues behind that command',async()=>{
   await configure({nextServoDelayMs:900,nextCapture:{mode:'delayed',delayMs:160}});const before=(await driver('workerControl','snapshot')).h1.captureCalls;await toggleServo();await page.waitForFunction(()=>document.querySelector('.af-control')?.getAttribute('aria-busy')==='true');
   assert.equal(await page.locator('.capture-button-group button').last().isEnabled(),true);await page.locator('.capture-button-group button').last().click();await page.waitForTimeout(70);assert.equal((await driver('workerControl','snapshot')).h1.captureCalls,before);
   await page.waitForFunction(()=>document.querySelector('.capture-button-group button')?.disabled===false);await assertServo(true);assert.equal((await driver('workerControl','snapshot')).h1.captureCalls,before+1);assert.equal((await driver('workerControl','snapshot')).operations.operations.length,0);
   await configure({nextServoDelayMs:350});const stopping=command('servo',{enabled:false});await page.waitForFunction(()=>document.querySelector('.af-control')?.getAttribute('aria-busy')==='true');const capturing=command('capture');await stopping;await capturing;await assertServo(false);
   assert.equal((await driver('workerControl','snapshot')).h1.captureCalls,before+2);
   await configure({nextServoDelayMs:350,nextServoError:'start'});const failedStart=command('servo',{enabled:true}).then(()=>{throw Error('Synthetic start should fail');},error=>error);await page.waitForFunction(()=>document.querySelector('.af-control')?.getAttribute('aria-busy')==='true');await assert.rejects(command('capture'),/Synthetic AI Servo start failure/);await failedStart;assert.equal((await driver('workerControl','snapshot')).h1.captureCalls,before+2);assert.equal((await command('boot')).camera.servo.enabled,false);
 });
 await check('Servo start and stop errors keep the visible state honest and allow explicit stop retry',async()=>{
   await configure({nextServoError:'start'});await toggleServo();await page.locator('.af-control [role=alert]').waitFor();assert.equal((await command('boot')).camera.servo.enabled,false);
   await toggleServo();await assertServo(true);await configure({nextServoError:'stop'});await page.locator('.af-primary').click();await page.locator('.af-control [role=alert]').waitFor();assert.equal((await command('boot')).camera.servo.enabled,null);assert.equal(await page.locator('.capture-button-group button').last().isDisabled(),true);await assert.rejects(command('capture'));await page.locator('.af-primary').click();await assertServo(false);
 });
 await check('burst shutter works with Servo and a release cancels a burst queued behind an AF transition',async()=>{
   await command('property',{key:'driveMode',value:1});const shutter=page.locator('.native-burst-control button');await shutter.waitFor();await toggleServo();await assertServo(true);let snapshot=await driver('workerControl','snapshot');const before=snapshot.h1.captureCalls,stops=snapshot.productCalls.servoStops;
   await configure({nextCapture:{mode:'hold'}});let previous=(await command('boot')).burst?.id;assert.equal(await shutter.isEnabled(),true);await shutter.hover();await page.mouse.down();await waitFakeHeld();assert.equal(await page.locator('.af-primary').isDisabled(),true);await page.mouse.up();await waitBurstAfter(previous);await page.waitForFunction(()=>document.querySelector('.af-primary')?.disabled===false);await assertServo(true);
   snapshot=await driver('workerControl','snapshot');assert.equal(snapshot.h1.captureCalls,before+1);assert.equal(snapshot.shutterCommands.length,2);assert.ok([0,1].includes(snapshot.shutterCommands[1].parameter));assert.ok(snapshot.shutterCommands[1].at-snapshot.shutterCommands[0].at<1200,'brief click must release well before the 5s watchdog');assert.equal(snapshot.productCalls.servoStops,stops);await page.locator('.af-primary').click();await assertServo(false);
   await configure({nextServoDelayMs:900});await toggleServo();await page.waitForFunction(()=>document.querySelector('.af-control')?.getAttribute('aria-busy')==='true');assert.equal(await shutter.isEnabled(),true);await shutter.hover();await page.mouse.down();await page.waitForTimeout(50);await page.mouse.up();await assertServo(true);await page.waitForFunction(()=>document.querySelector('.af-primary')?.disabled===false);await page.waitForTimeout(80);
   snapshot=await driver('workerControl','snapshot');assert.equal(snapshot.h1.captureCalls,before+1);assert.equal(snapshot.operations.operations.length,0);
   await configure({nextCapture:{mode:'hold'}});previous=(await command('boot')).burst?.id;await page.waitForFunction(()=>document.querySelector('.native-burst-control button')?.disabled===false);await shutter.focus();assert.equal(await shutter.evaluate(node=>document.activeElement===node),true);await page.keyboard.down('Space');await page.keyboard.down('Space');await waitFakeHeld();await page.keyboard.up('Space');await waitBurstAfter(previous);snapshot=await driver('workerControl','snapshot');assert.equal(snapshot.h1.captureCalls,before+2);await assertServo(true);
   await configure({nextCapture:{mode:'hold'}});previous=(await command('boot')).burst?.id;await shutter.focus();assert.equal(await shutter.evaluate(node=>document.activeElement===node),true);await page.keyboard.down('Enter');snapshot=await waitFakeHeld();assert.equal(snapshot.h1.captureCalls,before+3);await page.locator('.sidebar .nav-item').first().focus();assert.equal(await shutter.evaluate(node=>document.activeElement===node),false);await page.keyboard.up('Enter');await waitBurstAfter(previous);snapshot=await driver('workerControl','snapshot');assert.equal(snapshot.h1.captureCalls,before+3);await assertServo(true);
   await page.locator('.af-primary').click();await assertServo(false);await configure({nextServoDelayMs:900});await toggleServo();await page.waitForFunction(()=>document.querySelector('.af-control')?.getAttribute('aria-busy')==='true');await shutter.focus();await page.keyboard.down('Space');await page.keyboard.up('Space');await assertServo(true);await page.waitForFunction(()=>document.querySelector('.af-primary')?.disabled===false);await page.waitForTimeout(80);snapshot=await driver('workerControl','snapshot');assert.equal(snapshot.h1.captureCalls,before+3);assert.equal(snapshot.operations.operations.length,0);
   await page.locator('.af-primary').click();await assertServo(false);await command('property',{key:'driveMode',value:0});await page.locator('.native-burst-control').waitFor({state:'detached'});
 });
 await check('burst input cancellation and unmount release the real fake latch before the watchdog',async()=>{
   await command('property',{key:'driveMode',value:1});const shutter=page.locator('.native-burst-control button');
   for(const [reason,servo]of [['pointerup',false],['pointercancel',true],['lostpointercapture',true],['blur',true],['unmount',true]]){
     if((await command('boot')).camera.servo.enabled!==servo){await toggleServo();await assertServo(servo);}
     const before=await driver('workerControl','snapshot'),previous=(await command('boot')).burst?.id;
     await page.waitForFunction(()=>document.querySelector('.native-burst-control button')?.disabled===false);await shutter.hover();await page.mouse.down();await waitFakeHeld();
     if(reason==='pointercancel')await shutter.dispatchEvent('pointercancel',{pointerId:1});
     else if(reason==='lostpointercapture')await shutter.evaluate(node=>{if(node.hasPointerCapture(1))node.releasePointerCapture(1);else node.dispatchEvent(new PointerEvent('lostpointercapture',{bubbles:true,pointerId:1}));});
     else if(reason==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
     else if(reason==='unmount')await nav('library');
     await page.mouse.up();if(reason==='unmount')await visibleCapture();await waitBurstAfter(previous);
     const after=await driver('workerControl','snapshot'),pair=after.shutterCommands.slice(before.shutterCommands.length);
     assert.equal(after.h1.captureCalls,before.h1.captureCalls+1);assert.equal(pair.length,2,reason);assert.equal(pair[0].parameter,3);assert.ok([0,1].includes(pair[1].parameter));assert.ok(pair[1].at-pair[0].at<1500,reason+' must not wait for 5s watchdog');assert.equal(after.held,null);await assertServo(servo);
   }
   await page.locator('.af-primary').click();await assertServo(false);await command('property',{key:'driveMode',value:0});
 });
 await check('BULB uses camera events, explicit end and honest error ownership',async()=>{
   await command('property',{key:'shutter',value:0x0c});const start=button('desktop.bulb_start');await start.click();await page.locator('.bulb-control[data-state=exposing]').waitFor();await assert.rejects(command('capture'));await assert.rejects(command('property',{key:'iso',value:80}));await assert.rejects(command('sessionOpen',{id:'light'}));assert.equal(await page.locator('.capture-button-group button').last().isDisabled(),true);await page.locator('.bulb-status output').filter({hasText:label('desktop.bulb_waiting')}).waitFor();
   await configure({bulbElapsed:7});await page.locator('.bulb-status output').filter({hasText:'7 s'}).waitFor();await page.waitForTimeout(320);assert.equal((await page.locator('.bulb-status output').textContent()).trim(),'7 s');
   await button('desktop.bulb_stop').click();await page.locator('.bulb-control[data-state=idle]').waitFor();await configure({nextBulbError:'start'});await start.click();await page.locator('.bulb-control[data-state=error]').waitFor();assert.equal((await command('boot')).camera.bulb.startAcknowledged,false);
   await start.click();await page.locator('.bulb-control[data-state=exposing]').waitFor();await configure({nextBulbError:'stop'});await button('desktop.bulb_stop').click();await page.locator('.bulb-control[data-state=error]').waitFor();assert.equal((await command('boot')).camera.bulb.confirmation,'unknown');assert.equal(await page.locator('.capture-button-group button').last().isDisabled(),true);await button('desktop.bulb_stop').click();await page.locator('.bulb-control[data-state=idle]').waitFor();await command('property',{key:'shutter',value:0x70});
 });
 await check('delayed fake transfer commits original, session and last-received identity before UI success',async()=>{
   await configure({nextCapture:{mode:'delayed',delayMs:160}});
   const capture=command('capture');await page.waitForFunction(()=>document.querySelector('.capture-button-group button')?.disabled===true);
   await assert.rejects(command('sessionOpen',{id:'light'}));const result=await capture;assert.equal(result.confirmation,'CONFIRMED');assert.equal(result.nativeConfirmation,'UNVERIFIED');
   const state=await command('boot'),record=state.photos.find(photo=>photo.id===state.lastReceivedPhotoId);assert.ok(record);assert.equal(record.sessionId,'portrait');assert.equal(record.cameraTransfer,true);assert.equal(record.transfer.correlation,'UNCONFIRMED');
   assert.ok(fs.existsSync(record.path));assert.equal(crypto.createHash('sha256').update(fs.readFileSync(record.path)).digest('hex'),crypto.createHash('sha256').update(seed).digest('hex'));
   const persisted=read(path.join(fixture,'user-data/library.json')).photos.find(photo=>photo.id===record.id);assert.equal(persisted.sessionId,'portrait');
   await page.locator('.preview-file[data-asset-id="'+record.id+'"]').waitFor();
 });
 await check('Library reassignment persists and current Capture preview stays session scoped',async()=>{
   await nav('library');await page.getByRole('button',{name:label('photoActions.open').replace('{{v0}}','Study-1.jpg'),exact:true}).click();await page.locator('.viewer').waitFor();const selector=page.getByRole('combobox',{name:label('desktop.photo_session'),exact:true});await selector.click();await page.getByRole('option',{name:'Light and color',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.photo-session-association .ui-select')?.textContent.includes('Light and color'));
   const state=await command('boot');assert.equal(state.photos.find(photo=>photo.id==='demo-0').sessionId,'light');assert.equal(state.photos.find(photo=>photo.id==='demo-0').sessionAssignment.source,'USER');assert.equal(state.photos.find(photo=>photo.id==='demo-0').transfer.sessionAssociation.status,'AMBIGUOUS');await page.keyboard.press('Escape');await visibleCapture();assert.equal(await page.locator('.preview-file[data-asset-id=demo-0]').count(),0);
 });
 await check('flash popup reports the unsupported protocol through the fake composition',async()=>{
   await assert.rejects(command('flashPopup'),/Synthetic flash popup protocol is unavailable/);assert.equal((await driver('workerControl','snapshot')).nativeCalls,0);
 });
 await check('qualified fake flash button dispatches once, preserves Live View and refreshes unsupported capability',async()=>{
   await visibleCapture();await command('live',{enabled:true});await configure({flashQualified:true});const flash=button('flashButton.raise_the_built_in_flash');await flash.waitFor();await page.waitForFunction(()=>document.querySelector('.flash-popup')?.disabled===false);
   const before=await driver('workerControl','snapshot'),liveCalls=before.h1.liveCalls;await configure({nextFlashDelayMs:120});await flash.click();await page.waitForFunction(()=>document.querySelector('.flash-popup')?.disabled===true);await page.waitForFunction(()=>document.querySelector('.flash-popup')?.disabled===false);
   let state=await command('boot'),snapshot=await driver('workerControl','snapshot');assert.equal(snapshot.productCalls.flashPopups,before.productCalls.flashPopups+1);assert.deepEqual(snapshot.flashCommands.at(-1),{command:0x106,parameter:0});assert.equal(state.camera.flash.accepted,true);assert.equal(state.camera.flash.raised,null);assert.equal(await page.getByRole('status').filter({hasText:label('flashButton.request_accepted_check_camera')}).count(),0);assert.equal(snapshot.h1.liveCalls,liveCalls);assert.equal(state.camera.live,true);
   await configure({nextFlashError:'busy'});await flash.click();await page.waitForFunction(()=>document.querySelector('.flash-popup')?.disabled===false);await page.waitForFunction(async()=>!(await window.focal.boot()).camera.flash.accepted);assert.equal((await command('boot')).camera.flash.available,true);
   await configure({nextFlashError:'unsupported'});await flash.click();await page.waitForFunction(async()=>(await window.focal.boot()).camera.flash.available===false);await page.locator('.flash-popup:disabled').waitFor();state=await command('boot');assert.equal(state.camera.flash.raised,null);snapshot=await driver('workerControl','snapshot');assert.equal(snapshot.h1.liveCalls,liveCalls);assert.equal(snapshot.nativeCalls,0);await configure({flashQualified:false});await command('live',{enabled:false});
 });
 await check('Servo disconnect reports unknown ownership and reconnect starts with a fresh stopped controller',async()=>{
   await toggleServo();await assertServo(true);await configure({disconnect:true});await page.waitForFunction(()=>!document.querySelector('.live-canvas'));assert.equal((await command('boot')).camera.servo.enabled,null);assert.equal(await page.locator('.capture-button-group button').last().isDisabled(),true);
   await command('connect',{cameraId:'ic01-synthetic-camera'});await assertServo(false);assert.equal((await command('boot')).camera.properties.afMode.value,0);await toggleServo();await assertServo(true);await page.locator('.af-primary').click();await assertServo(false);assert.equal((await driver('workerControl','snapshot')).operations.operations.length,0);
 });
 await check('sessions, Library and settings render after the new control workflows',async()=>{
   for(const key of ['sessions','library','settings']){await nav(key);await evidence('screen-'+key);}await command('settings',{theme:'dark'});await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');await visibleCapture();await page.locator('.af-mode-toggle').click();await page.getByRole('menu').waitFor();await evidence('af-menu-dark');await page.keyboard.press('Escape');await command('settings',{theme:'light'});
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
   await visibleCapture();await command('live',{enabled:true});await command('property',{key:'shutter',value:0x0c});await button('desktop.bulb_start').click();await page.locator('.bulb-control[data-state=exposing]').waitFor();await configure({disconnect:true});await page.waitForFunction(()=>!document.querySelector('.live-canvas'));assert.equal(await page.locator('.live-histogram-toggle').count(),0);assert.equal((await command('boot')).camera.bulb.confirmation,'unknown');assert.equal(await page.locator('.bulb-control button').isDisabled(),true);
 });
 await check('BULB disconnect history does not block reconnect and a fresh controller starts stopped',async()=>{
   const historical=(await command('boot')).camera.bulb;assert.equal(historical.confirmation,'unknown');
   // Use the renderer's ordinary connect action to exercise nativeBusyRef, not
   // only a direct IPC call that would miss a stale disconnected UI busy guard.
   const reconnect=page.locator('.camera-card-bottom button');await reconnect.waitFor();assert.equal(await reconnect.isEnabled(),true);await reconnect.click();await page.waitForFunction(async()=>(await window.focal.boot()).camera.connected===true);await page.locator('.capture-button-group button').last().waitFor();await page.waitForFunction(()=>document.querySelector('.capture-button-group button')?.disabled===false);
   const state=await command('boot');assert.equal(state.camera.bulb.status,'idle');assert.equal(state.camera.bulb.confirmation,'command-accepted');assert.equal(state.camera.servo.enabled,false);assert.equal(historical.confirmation,'unknown');
   await command('property',{key:'shutter',value:0x0c});await button('desktop.bulb_start').click();await page.locator('.bulb-control[data-state=exposing]').waitFor();await button('desktop.bulb_stop').click();await page.locator('.bulb-control[data-state=idle]').waitFor();await command('property',{key:'shutter',value:0x70});
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
 const result={pass:checks.length,checks,fixture,hardware:false,provider:'IC01_SYNTHETIC_JS_ONLY',screenshots,errors};fs.writeFileSync(path.join(fixture,'artifacts/results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}
run().catch(async error=>{console.error(error.stack||error);fs.writeFileSync(path.join(fixture,'artifacts/results.json'),JSON.stringify({pass:checks.length,checks,fixture,hardware:false,provider:'IC01_SYNTHETIC_JS_ONLY',errors,error:error.stack||String(error)},null,2));if(page&&!page.isClosed())await evidence('failure').catch(()=>{});process.exitCode=1;}).finally(async()=>{if(app)await app.close().catch(()=>{});});
