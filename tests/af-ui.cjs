const {_electron}=require('playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
(async()=>{
  const profile=path.join(root,'qa',`af-${Date.now()}`);await fs.mkdir(profile,{recursive:true});
  const app=await _electron.launch({...(process.env.FOCAL_BINARY?{executablePath:process.env.FOCAL_BINARY,args:[]}:{args:[root]}),env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,FOCAL_TEST_DATA:profile,FOCAL_AF_TRACE:'1'}});
  let page;
  try{
    page=await app.firstWindow();await require('./test-session.cjs').capturePage(page);const cam=await page.evaluate(()=>window.focal.connect());if(!cam.connected)throw Error(cam.error);
    await page.evaluate(()=>window.focal.live({enabled:true}));await page.waitForFunction(()=>Number(document.querySelector('.live-canvas')?.dataset.frames)>3);
    const result=await page.evaluate(async()=>{try{return await window.focal.autofocus();}catch(e){return {error:e.message};}});
    const state=await page.evaluate(()=>window.focal.boot());
    const report={result,autofocus:state.camera.autofocus,frames:await page.locator('.live-canvas').getAttribute('data-frames'),logs:state.logs,shutterReleased:false};
    await fs.writeFile(path.join(root,'qa','af-ui-report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));if(!result.confirmed)process.exitCode=1;
  }finally{await app.close().catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1;});
