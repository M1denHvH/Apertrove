const {_electron}=require('playwright'),path=require('node:path'),fs=require('node:fs/promises'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),profile=path.join(root,'qa',`focus-flash-hardware-${Date.now()}`);
(async()=>{
 const app=await _electron.launch({args:[root],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,FOCAL_TEST_DATA:profile}});let connected=false;
 try{
  const page=await app.firstWindow();await page.waitForSelector('.app-shell');await page.evaluate(()=>window.focal.session({name:'Проверка AF и подъёма вспышки'}));
  const cameras=await page.evaluate(()=>window.focal.listCameras());assert.equal(cameras.length,1,'A single free camera is required');
  const camera=await page.evaluate(id=>window.focal.connect({cameraId:id}),cameras[0].id);assert.equal(camera.connected,true);connected=true;assert.equal(camera.properties.afMode.value===3,false,'Lens must be in AF');assert.equal(camera.live,false);
  console.log('CAMERA',JSON.stringify({model:camera.model,mode:camera.mode,af:camera.properties.afMode.value}));
  const before=await page.evaluate(()=>window.focal.boot()),results={model:camera.model,mode:camera.mode};
  await page.evaluate(()=>window.focal.settings({focusPreviewOnSuccess:false}));results.withoutPreview=await page.evaluate(()=>window.focal.autofocus());
  let state=await page.evaluate(()=>window.focal.boot());assert.equal(results.withoutPreview.confirmed,true);assert.equal(state.focusPreview,null);assert.equal(state.camera.live,false);assert.equal(state.camera.properties.afMode.value,camera.properties.afMode.value);
  console.log('PASS native AF with preview disabled; EVF remains off, no snapshot, AF mode restored');
  await page.evaluate(()=>window.focal.settings({focusPreviewOnSuccess:true}));results.withPreview=await page.evaluate(()=>window.focal.autofocus());
  state=await page.evaluate(()=>window.focal.boot());assert.equal(results.withPreview.previewReceived,true);assert.ok(state.focusPreview?.image);assert.equal(state.camera.live,false);assert.equal(state.camera.properties.afMode.value,camera.properties.afMode.value);
  results.previewBytes=state.focusPreview.image.length;console.log('PASS native AF with preview enabled; fresh frame received and EVF restored');
  await page.getByRole('button',{name:'Съёмка',exact:true}).click();await page.getByRole('button',{name:'Поднять встроенную вспышку',exact:true}).waitFor();
  results.support=await page.evaluate(()=>window.focal.flashSupport());assert.equal(results.support.canAttempt,true);assert.equal(await page.getByRole('button',{name:'Поднять встроенную вспышку',exact:true}).isEnabled(),true);
  results.flash=await page.evaluate(()=>window.focal.flashPopup());assert.equal(results.flash.accepted,true);
  const after=await page.evaluate(()=>window.focal.boot());assert.equal(after.camera.connected,true);assert.equal(after.camera.live,false);assert.equal(after.photos.length,before.photos.length);assert.equal(after.camera.mode,camera.mode);assert.equal(after.camera.properties.afMode.value,camera.properties.afMode.value);
  for(const key of ['shutter','aperture','iso'])assert.equal(after.camera.properties[key].value,camera.properties[key].value);
  results.photosCreated=after.photos.length-before.photos.length;results.connectionRestored=true;results.exposureRestored=true;
  await fs.writeFile(path.join(root,'qa','focus-flash-hardware-report.json'),JSON.stringify(results,null,2));console.log('PASS flash popup accepted in current creative mode; SDK connection, AF and exposure retained; zero captures');
 }finally{if(connected){const page=await app.firstWindow();await page.evaluate(()=>window.focal.disconnect()).catch(()=>{});}await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
