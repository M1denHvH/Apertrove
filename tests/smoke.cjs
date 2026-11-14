const {_electron:electron}=require('playwright');
const path=require('node:path');
const fs=require('node:fs/promises');
const root=path.resolve(__dirname,'..');
(async()=>{
  const profile=path.join(root,'qa/smoke');await fs.mkdir(profile,{recursive:true});
  const app=await electron.launch({args:[root],env:{...process.env,FOCAL_TEST_DATA:profile,ELECTRON_RUN_AS_NODE:undefined}});
  app.process().stderr.on('data',d=>process.stdout.write(String(d)));
  try{
    const page=await app.firstWindow();page.on('pageerror',e=>console.error('PAGE ERROR',e));
    await require('./test-session.cjs').capturePage(page);
    await page.screenshot({path:path.join(root,'qa/Apertrove-preview.png')});
    console.log(await page.locator('body').innerText());
    console.log('layout',await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.body.scrollWidth,mainHeight:document.querySelector('main').scrollHeight,mainVisible:document.querySelector('main').clientHeight})));
  }finally{await app.close();}
})();
