const {_electron:electron}=require('playwright');
const {WebSocket}=require('ws');
const {once}=require('node:events');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'qa');
const report={checks:[],errors:[],shutterReleased:false};
const ok=(name,detail)=>{report.checks.push({name,detail});console.log('PASS',name,detail?JSON.stringify(detail):'');};
async function poll(fn,test,timeout=12000){const end=Date.now()+timeout;while(Date.now()<end){const v=await fn();if(test(v))return v;await new Promise(r=>setTimeout(r,100));}throw Error('Condition timed out');}
(async()=>{await fs.mkdir(path.join(root,'qa'),{recursive:true});
 const app=await electron.launch({...(process.env.FOCAL_BINARY?{executablePath:process.env.FOCAL_BINARY,args:[]}:{args:[root]}),env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,FOCAL_TEST_DATA:path.join(root,'qa/remote-'+Date.now())}});
 let hud,ws,originalISO;
 try{
  const page=await app.firstWindow();page.on('pageerror',e=>report.errors.push(e.message));await require('./test-session.cjs').capturePage(page);
  await page.evaluate(()=>window.focal.settings({theme:'dark',accentColor:'#669dd8'}));
  const cameras=await poll(()=>page.evaluate(()=>window.focal.listCameras()),items=>items.length>0,60000);assert.ok(cameras[0].id);ok('SDK camera discovery returns selectable models',{models:cameras.map(c=>c.model)});
  const cam=await page.evaluate(id=>window.focal.connect({cameraId:id}),cameras[0].id);assert.equal(cam.connected,true);originalISO=cam.properties.iso.value;ok('Selected camera opens by device ID',{model:cam.model});
  const before=await page.evaluate(()=>window.focal.boot());const address=before.interfaces.find(i=>i.address!=='127.0.0.1')?.address||'127.0.0.1';
  const remote=await page.evaluate(host=>window.focal.remoteStart({host,port:0}),address),base=`http://${remote.host}:${remote.port}`,key=new URLSearchParams(new URL(remote.url).hash.slice(1)).get('key');
  assert.ok(remote.qr.startsWith('data:image/png'));assert.equal((await fetch(base+'/api/state')).status,401);ok('LAN listener starts with QR access and rejects unauthenticated control',{host:remote.host});
  const newWindow=app.waitForEvent('window');await app.evaluate(({BrowserWindow},url)=>{const w=new BrowserWindow({width:420,height:900,show:true,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});w.loadURL(url);},remote.url);hud=await newWindow;hud.on('pageerror',e=>report.errors.push(e.message));await hud.setViewportSize({width:390,height:844});
  await hud.locator('#connection-text').filter({hasText:'Подключено'}).waitFor();assert.equal(await hud.locator('#model').innerText(),cam.model);ok('Phone viewport authenticates from fragment key and receives current camera');
  let received=0;ws=new WebSocket(`ws://${remote.host}:${remote.port}/ws`,{origin:base});await once(ws,'open');ws.on('message',(_,binary)=>{if(binary)received++;});ws.send(JSON.stringify({type:'auth',key}));
  await hud.locator('#live').click();await page.waitForFunction(()=>Number(document.querySelector('.live-canvas')?.dataset.frames)>3);await hud.waitForFunction(()=>Number(document.querySelector('#preview')?.dataset.frames)>3);
  const nativeStart=await page.locator('.live-canvas').getAttribute('data-frames'),hudStart=await hud.locator('#preview').getAttribute('data-frames'),wsStart=received,start=performance.now();
  await page.waitForTimeout(5000);const seconds=(performance.now()-start)/1000;
  const nativeEnd=Number(await page.locator('.live-canvas').getAttribute('data-frames')),hudEnd=Number(await hud.locator('#preview').getAttribute('data-frames'));
  const state=await page.evaluate(()=>window.focal.boot());report.performance={model:cam.model,sdkFps:state.camera.liveStats.fps,desktopFps:Number(((nativeEnd-Number(nativeStart))/seconds).toFixed(2)),hudFps:Number(((hudEnd-Number(hudStart))/seconds).toFixed(2)),websocketFps:Number(((received-wsStart)/seconds).toFixed(2)),seconds};
  console.log('PERFORMANCE',JSON.stringify(report.performance));assert.ok(report.performance.desktopFps>10);assert.ok(report.performance.hudFps>10);ok('Binary JPEG reaches desktop and phone canvas without a fixed FPS cap',report.performance);
  const framesBeforeAF=Number(await hud.locator('#preview').getAttribute('data-frames'));
  await hud.locator('#af').click();const afState=await poll(()=>page.evaluate(()=>window.focal.boot()),d=>['focused','failed'].includes(d.camera.autofocus?.status),18000);if(afState.camera.autofocus.status!=='focused'){console.error('AF DIAGNOSTIC',JSON.stringify({autofocus:afState.camera.autofocus,logs:afState.logs}));throw Error(afState.camera.autofocus.message);}
  assert.ok(afState.camera.focusInfo?.boxes?.length>0);assert.ok(afState.camera.focusInfo?.lastFocused?.boxes?.length>0);
  assert.ok(Number(await hud.locator('#preview').getAttribute('data-frames'))>framesBeforeAF);ok('One phone AF press completes with camera-confirmed focus while frames continue');
  const iso=cam.properties.iso,temporary=iso.allowed[iso.allowed.indexOf(originalISO)+1]??iso.allowed.find(v=>v!==originalISO);
  try{await hud.locator('[data-property="iso"]').selectOption(String(temporary));await poll(()=>page.evaluate(()=>window.focal.boot()),d=>d.camera.properties.iso.value===temporary);await poll(()=>hud.locator('[data-property="iso"]').isEnabled(),Boolean);ok('Phone exposure control changes actual camera and synchronizes desktop',{temporaryISO:temporary});}
  finally{await page.evaluate(value=>window.focal.property({key:'iso',value}),originalISO);}
  assert.equal((await page.evaluate(()=>window.focal.boot())).camera.properties.iso.value,originalISO);ok('Original camera ISO restored');
  if(process.env.FOCAL_TEST_SHOT==='1'){
    const count=(await page.evaluate(()=>window.focal.boot())).photos.length;
    const autofocus=(await page.evaluate(()=>window.focal.boot())).settings.autofocus;await page.evaluate(()=>window.focal.settings({autofocus:false}));
    let saved;try{await hud.locator('#shutter').click();saved=await poll(()=>page.evaluate(()=>window.focal.boot()),d=>d.photos.length>count,85000);}finally{await page.evaluate(value=>window.focal.settings({autofocus:value}),autofocus);}
    const photo=saved.photos.at(-1);assert.ok((await fs.stat(photo.path)).size>0);report.shutterReleased=true;report.testPhoto={name:photo.name,bytes:photo.size};ok('Browser shutter triggers real exposure and image download to the PC',report.testPhoto);
    await poll(()=>hud.locator('#shutter').isEnabled(),Boolean,85000);
  }
  await hud.locator('#more').click();assert.equal(await hud.locator('#details').isVisible(),true);assert.equal(await hud.evaluate(()=>document.scrollingElement.scrollWidth<=document.scrollingElement.clientWidth),true);ok('Expanded phone controls fit a 390px viewport');
  await hud.locator('#live').click();await poll(()=>page.evaluate(()=>window.focal.boot()),d=>!d.camera.live);await hud.waitForTimeout(250);
  await hud.screenshot({path:path.join(out,'Apertrove-mobile-HUD.png'),fullPage:true});
  await page.locator('.nav-item').filter({hasText:'Веб-пульт'}).click();await page.screenshot({path:path.join(out,'Apertrove-remote-desktop.png')});
  await page.evaluate(()=>window.focal.remoteStop());await poll(()=>page.evaluate(()=>window.focal.boot()),d=>!d.remote.running);ok('Stopping remote closes the listener and connected browsers');
  assert.deepEqual(report.errors,[]);ok('No renderer errors in desktop or browser HUD');
  await fs.writeFile(path.join(out,'Apertrove-remote-report.json'),JSON.stringify(report,null,2));
 }finally{ws?.terminate();if(hud)await hud.close().catch(()=>{});await app.close().catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1;});
