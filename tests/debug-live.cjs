const {_electron:electron}=require('playwright');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
(async()=>{
 const app=await electron.launch({...(process.env.FOCAL_BINARY?{executablePath:process.env.FOCAL_BINARY,args:[]}:{args:[root]}),env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,FOCAL_TEST_DATA:path.join(root,'qa/live-'+Date.now())}});
 try{
  const page=await app.firstWindow();page.on('pageerror',e=>console.log('PAGE ERROR',e.message));page.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text());});
  await page.getByRole('heading',{name:'Съёмка'}).waitFor();
  await page.evaluate(()=>{window.__frames={count:0};window.focal.on(e=>{if(e.type==='frame')window.__frames={count:window.__frames.count+1,length:e.data.length,prefix:e.data.slice(0,15)};});});
  const c=await page.evaluate(()=>window.focal.connect());console.log('CONNECT',{connected:c.connected,mode:c.mode,model:c.model,error:c.error});
  console.log('LIVE REQUEST',await page.evaluate(()=>window.focal.live({enabled:true})));
  for(let i=0;i<5;i++){
   await page.waitForTimeout(1000);console.log('DIAG',await page.evaluate(async()=>{const d=await window.focal.boot();const im=document.querySelector('.preview-image');return {camera:{live:d.camera.live,error:d.camera.error},frames:window.__frames,img:im&&{alt:im.alt,complete:im.complete,width:im.naturalWidth,prefix:im.src.slice(0,40)},logs:d.logs.slice(-4)};}));
  }
  await page.evaluate(()=>window.focal.live({enabled:false}));
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
