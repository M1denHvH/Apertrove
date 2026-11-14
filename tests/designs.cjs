// No SDK session and no shutter release: appearance, persistence and safe migration.
const {_electron}=require('playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'qa'),profile=path.join(out,'design-profile');
async function launch(){const app=await _electron.launch({...(process.env.FOCAL_BINARY?{executablePath:process.env.FOCAL_BINARY,args:[]}:{args:[root]}),env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,FOCAL_TEST_DATA:profile}});const page=await app.firstWindow();await require('./test-session.cjs').capturePage(page);return {app,page};}
(async()=>{
  await fs.mkdir(profile,{recursive:true});
  let {app,page}=await launch();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
    assert.equal(await page.title(),'Apertrove');
    assert.equal(await page.locator('.brand-icon').evaluate(el=>el.complete&&el.naturalWidth>0),true);
    const first=await page.locator('.splash').textContent();await page.locator('.splash').click();assert.notEqual(await page.locator('.splash').textContent(),first);
    await page.locator('.nav-item').filter({hasText:'Настройки'}).click();
    for(const [design,label] of [['current','Studio'],['classic','Canon Classic'],['modern','Modern']]){
      await page.getByRole('button',{name:`Оформление: ${label}`,exact:true}).click();
      await page.waitForFunction(value=>document.documentElement.dataset.design===value,design);
      for(const [theme,name] of [['light','Светлая'],['dark','Тёмная']]){
        await page.getByRole('button',{name:`Тема: ${name}`,exact:true}).click();await page.waitForFunction(value=>document.documentElement.dataset.theme===value,theme);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        await page.locator('.nav-item').filter({hasText:'Съёмка'}).click();
        await page.screenshot({path:path.join(out,`${design}-${theme}.png`)});
        await page.locator('.nav-item').filter({hasText:'Настройки'}).click();
        await page.screenshot({path:path.join(out,`${design}-${theme}-settings.png`)});
      }
      console.log('PASS',label,'light / dark');
    }
    await page.evaluate(()=>window.focal.settings({accentColor:'#b6663e',showSplashes:false}));await page.waitForSelector('.splash',{state:'detached'});
    await app.close();({app,page}=await launch());const boot=await page.evaluate(()=>window.focal.boot());assert.equal(boot.settings.design,'modern');assert.equal(boot.settings.accentColor,'#b6663e');assert.equal(boot.settings.showSplashes,false);assert.equal(await page.locator('.splash').count(),0);
    await page.evaluate(()=>window.focal.settings({design:'current',showSplashes:true}));await page.waitForFunction(()=>document.documentElement.dataset.design==='current');
    assert.deepEqual(errors,[]);console.log('PASS persistent skin / accent / splashes, original design retained, no renderer errors');
  }finally{await app.close().catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1;});
