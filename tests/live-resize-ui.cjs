const {_electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),sharp=require('sharp');
const root=path.resolve(__dirname,'..'),profile=path.join(root,'qa',`live-resize-${Date.now()}`);
(async()=>{await fs.mkdir(profile,{recursive:true});const app=await _electron.launch({...(process.env.FOCAL_BINARY?{executablePath:process.env.FOCAL_BINARY,args:[]}:{args:[root]}),env:{...process.env,FOCAL_TEST_DATA:profile,ELECTRON_RUN_AS_NODE:undefined}});const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));let cases=0;
try{await page.waitForSelector('.app-shell');await page.evaluate(()=>window.focal.session({name:'Live resize'}));const images=[];for(let i=0;i<8;i++){const file=path.join(profile,`Frame-${i}.jpg`);await sharp({create:{width:900,height:600,channels:3,background:'#667a80'}}).withExif({IFD0:{ImageDescription:'Frame '+i}}).jpeg().toFile(file);images.push(file);}await app.evaluate(({dialog},files)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:files});},images);await page.evaluate(()=>window.focal.importFiles());await page.locator('.nav-item').filter({hasText:'Съёмка'}).click();
const frame=await sharp({create:{width:1800,height:1200,channels:3,background:'#758e83'}}).jpeg().toBuffer();await app.evaluate(({BrowserWindow},bytes)=>{const win=BrowserWindow.getAllWindows()[0];win.webContents.send('focal:event',{type:'camera',data:{connected:true,live:true,model:'Live resize fixture',properties:{},capabilities:{liveView:true,focus:true}}});globalThis.__resizeFrames=setInterval(()=>{if(!win.isDestroyed())win.webContents.send('focal:frame',Buffer.from(bytes));},35);},Array.from(frame));await page.waitForFunction(()=>Number(document.querySelector('.live-canvas')?.dataset.frames)>2);
for(const performanceMode of [true,false]){
  await page.evaluate(performanceMode=>window.focal.settings({performanceMode}),performanceMode);
  await page.waitForFunction(expected=>document.documentElement.hasAttribute('data-performance-mode')===expected,performanceMode);
  const frameCount=await page.locator('.live-canvas').evaluate(canvas=>Number(canvas.dataset.frames));
  await page.waitForFunction(previous=>Number(document.querySelector('.live-canvas')?.dataset.frames)>previous+4,frameCount);
}
console.log('PASS live JPEG decode continues while switching Performance Mode both ways');
for(const design of ['current','classic','modern'])for(const theme of ['light','dark']){
await page.evaluate(settings=>window.focal.settings(settings),{design,theme,workspace:{inspectorWidth:590,inspectorHeight:1200}});
for(const size of [[1480,1100],[1280,850],[1100,760],[1550,960]]){
 await app.evaluate(({BrowserWindow},size)=>{const win=BrowserWindow.getAllWindows()[0];if(win.isMaximized())win.unmaximize();win.setSize(...size);},size);await page.waitForTimeout(80);
 const bounds=await page.evaluate(()=>{const r=selector=>{const b=document.querySelector(selector).getBoundingClientRect();return {x:b.x,y:b.y,right:b.right,bottom:b.bottom,width:b.width,height:b.height};};return {preview:r('.preview-panel'),canvas:r('.preview-canvas'),strip:r('.filmstrip'),inspector:r('.inspector-frame'),mainOverflow:document.querySelector('main').scrollWidth-document.querySelector('main').clientWidth,frames:Number(document.querySelector('.live-canvas').dataset.frames)};});
 assert.ok(bounds.strip.y>=bounds.preview.bottom-1,JSON.stringify({size,design,theme,bounds}));assert.ok(bounds.canvas.bottom<=bounds.preview.bottom+1);assert.ok(bounds.inspector.bottom<=bounds.strip.y+1);assert.ok(bounds.mainOverflow<=1);assert.ok(bounds.frames>2);cases++;
}
await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].maximize());await page.waitForTimeout(80);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].unmaximize());await page.waitForTimeout(80);assert.ok(await page.evaluate(()=>document.querySelector('.filmstrip').getBoundingClientRect().top>=document.querySelector('.preview-panel').getBoundingClientRect().bottom-1));cases++;
}
await page.screenshot({path:path.join(root,'qa/live-resize-v07.png')});assert.deepEqual(errors,[]);console.log(`PASS ${cases} active Live View resize/maximize cases across all designs/themes, with actual decoded 1800x1200 JPEG and oversized inspector; no overlap`);
}finally{await app.evaluate(()=>clearInterval(globalThis.__resizeFrames)).catch(()=>{});await app.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
