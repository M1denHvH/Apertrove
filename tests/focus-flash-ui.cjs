const {_electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),profile=path.join(root,'qa',`focus-flash-ui-${Date.now()}`),out=path.join(root,'qa','focus-flash-ui');
async function launch(){const app=await _electron.launch({...(process.env.FOCAL_BINARY?{executablePath:process.env.FOCAL_BINARY,args:[]}:{args:[root]}),env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,FOCAL_TEST_DATA:profile}}),page=await app.firstWindow();await page.waitForSelector('.app-shell');return {app,page};}
(async()=>{
 await fs.mkdir(out,{recursive:true});let {app,page}=await launch();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.evaluate(()=>window.focal.session({name:'Параметры фокуса'}));await page.getByRole('button',{name:'Съёмка',exact:true}).click();
  await app.evaluate(({ipcMain},root)=>{const flash=process.getBuiltinModule('module').createRequire(root+'/package.json')(root+'/electron/flash-bridge.cjs');globalThis.__uiFlashCamera={};globalThis.__uiFlashQueries=0;ipcMain.removeHandler('focal:flashSupport');ipcMain.handle('focal:flashSupport',()=>{globalThis.__uiFlashQueries++;if(globalThis.__delayFlash)return new Promise(resolve=>{globalThis.__releaseFlash=resolve;});return flash.flashAvailability(globalThis.__uiFlashCamera,{available:false});});},root);
  const camera={connected:true,live:false,model:'Canon EOS 2000D',cameraId:'fixture',connectedAt:1,mode:'M',properties:{afMode:{value:0,writable:true,choices:[{value:0,label:'One Shot'}]}},capabilities:{capture:true,focus:true,liveView:true}};
  const send=async()=>app.evaluate(({BrowserWindow},camera)=>{globalThis.__uiFlashCamera=camera;BrowserWindow.getAllWindows()[0].webContents.send('focal:event',{type:'camera',data:camera});},camera);
  const flash=page.getByRole('button',{name:'Поднять встроенную вспышку',exact:true}),check=page.getByLabel('Получить кадр при успешном фокусе',{exact:true});
  await send();await page.waitForFunction(()=>!document.querySelector('.flash-popup').disabled);assert.equal(await check.isChecked(),true);
  await check.uncheck();await page.waitForFunction(async()=>(await window.focal.boot()).settings.focusPreviewOnSuccess===false);
  for(const mode of ['Auto','M','P','Tv','Av','15','M']){camera.mode=mode;await send();await page.waitForFunction(({mode,basic})=>document.querySelector('.mode-badge')?.textContent===mode&&document.querySelector('.flash-popup')?.disabled===basic,{mode,basic:['Auto','15'].includes(mode)});}
  console.log('PASS flash button follows all creative modes and Basic Zone after initial negative detection');
  const beforeQueries=await app.evaluate(()=>globalThis.__uiFlashQueries);camera.connectedAt=2;await send();await page.waitForFunction(()=>!document.querySelector('.flash-popup').disabled);assert.ok((await app.evaluate(()=>globalThis.__uiFlashQueries))>beforeQueries);
  await app.evaluate(()=>{globalThis.__delayFlash=true;});camera.mode='P';await send();while(!await app.evaluate(()=>!!globalThis.__releaseFlash))await new Promise(resolve=>setTimeout(resolve,20));
  await app.evaluate(()=>{globalThis.__delayFlash=false;});camera.mode='Auto';await send();await app.evaluate(()=>globalThis.__releaseFlash({available:true,canAttempt:true}));await page.waitForFunction(()=>document.querySelector('.mode-badge')?.textContent==='Auto'&&document.querySelector('.flash-popup').disabled);
  camera.mode='M';await send();await page.waitForFunction(()=>!document.querySelector('.flash-popup').disabled);
  console.log('PASS reconnect refreshes detection and a late old-mode response cannot enable flash in Auto');
  await check.check();await page.waitForFunction(async()=>(await window.focal.boot()).settings.focusPreviewOnSuccess===true);camera.live=true;await send();await page.waitForFunction(()=>document.querySelector('.focus-preview-option input').disabled);camera.live=false;await send();await page.waitForFunction(()=>!document.querySelector('.focus-preview-option input').disabled);
  const frame=await require('sharp')({create:{width:100,height:100,channels:3,background:'#809080'}}).jpeg().toBuffer();await app.evaluate(({BrowserWindow},image)=>BrowserWindow.getAllWindows()[0].webContents.send('focal:event',{type:'focusPreview',data:{image,at:Date.now(),focusInfo:{boxes:[]}}}),'data:image/jpeg;base64,'+frame.toString('base64'));await page.locator('.focus-snapshot').waitFor();await check.uncheck();await page.locator('.focus-snapshot').waitFor({state:'detached'});
  for(const design of ['current','classic','modern'])for(const theme of ['light','dark']){
    await page.evaluate(settings=>window.focal.settings(settings),{design,theme});await send();await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setSize(1120,760);w.webContents.setZoomFactor(1.25);});
    await page.waitForFunction(({design,theme})=>document.documentElement.dataset.design===design&&document.documentElement.dataset.theme===theme,{design,theme});await page.waitForFunction(()=>!document.querySelector('.focus-preview-option input').disabled);await check.scrollIntoViewIfNeeded();
    const issues=await page.evaluate(()=>{const errors=[];for(const el of document.querySelectorAll('.focus-section,.focus-preview-option,.flash-popup'))if(el.scrollWidth>el.clientWidth+3)errors.push(el.className);return errors;});assert.deepEqual(issues,[],design+' '+theme);
    if(theme==='dark'){const data=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toDataURL());await fs.writeFile(path.join(out,`${design}-dark.png`),Buffer.from(data.split(',')[1],'base64'));}
  }
  assert.equal((await page.evaluate(()=>window.focal.boot())).photos.length,0);await app.close();({app,page}=await launch());assert.equal((await page.evaluate(()=>window.focal.boot())).settings.focusPreviewOnSuccess,false);assert.deepEqual(errors,[]);
  console.log('PASS checkbox persistence, no-Live-View restriction, stale preview clearing, all designs/themes at 125%, no renderer errors');
 }finally{await app.close().catch(()=>{});}
})().catch(error=>{console.error(error);process.exitCode=1;});
