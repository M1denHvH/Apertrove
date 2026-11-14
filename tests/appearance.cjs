const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs/promises');
const sharp=require('sharp');
const root=path.resolve(__dirname,'..'),profile=path.join(root,'qa/appearance-'+Date.now()),out=path.join(root,'qa');
const checks=[],errors=[];
const ok=name=>{checks.push(name);console.log('PASS',name);};
async function launch(){
  const app=await electron.launch({...(process.env.FOCAL_BINARY?{executablePath:process.env.FOCAL_BINARY,args:[]}:{args:[root]}),env:{...process.env,FOCAL_TEST_DATA:profile,ELECTRON_RUN_AS_NODE:undefined}});
  const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await require('./test-session.cjs').capturePage(page);return {app,page};
}
async function state(page){return page.evaluate(()=>window.focal.boot());}
(async()=>{
  await fs.mkdir(profile,{recursive:true});let {app,page}=await launch();
  try{
    assert.equal((await state(page)).settings.theme,'system');ok('A new profile follows the system appearance');
    await page.locator('.nav-item').filter({hasText:'Настройки'}).click();
    await page.getByRole('button',{name:'Тема: Тёмная',exact:true}).click();
    await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
    assert.equal(await page.locator('.settings-card').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(28, 33, 37)');ok('Dark theme applies to settings surfaces');
    await page.getByRole('button',{name:'Акцент: Лаванда',exact:true}).click();
    await page.waitForFunction(()=>getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim()==='#a08bd5');
    const color1=await page.locator('.nav-item.active').evaluate(el=>getComputedStyle(el).color);assert.notEqual(color1,'rgb(79, 107, 65)');ok('Palette accent changes actual navigation colours');
    await page.screenshot({path:path.join(out,'Apertrove-dark-settings.png')});
    const hex=page.getByRole('textbox',{name:'Код акцентного цвета'});
    await hex.fill('#bad');await hex.press('Tab');await page.getByText('Введите цвет в формате #RRGGBB.').waitFor();assert.equal((await state(page)).settings.accentColor,'#a08bd5');ok('Invalid custom colour is rejected without changing stored settings');
    await hex.fill('#3c9fb2');await hex.press('Enter');
    await page.waitForFunction(()=>getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim()==='#3c9fb2');ok('Custom hexadecimal accent applies and is saved');
    await page.getByRole('button',{name:'Тема: Как в системе',exact:true}).click();
    await app.evaluate(({nativeTheme})=>{nativeTheme.themeSource='light';});await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
    await app.evaluate(({nativeTheme})=>{nativeTheme.themeSource='dark';});await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');ok('System theme follows both light and dark system changes');
    await page.getByRole('button',{name:'Тема: Тёмная',exact:true}).click();
    for(const name of ['Съёмка','Библиотека','Пресеты','Инструменты']){
      await page.locator('.nav-item').filter({hasText:name}).click();
      assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'dark');
      const hasBrightPanel=await page.locator('main').evaluate(main=>Array.from(main.querySelectorAll('.preview-panel,.inspector,.tool-card,.preset-card,.page-empty')).some(el=>getComputedStyle(el).backgroundColor==='rgb(255, 255, 255)'));
      assert.equal(hasBrightPanel,false,`No accidental white panel on ${name}`);
      if(name==='Пресеты'){await page.getByRole('button',{name:'Создать пресет',exact:true}).click();assert.equal(await page.locator('.modal').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(28, 33, 37)');await page.getByRole('button',{name:'Закрыть',exact:true}).click();}
    }ok('All four workspaces and preset dialogs use the dark theme');
    await page.locator('.nav-item').filter({hasText:'Съёмка'}).click();
    await page.screenshot({path:path.join(out,'Apertrove-dark-preview.png')});
    for(const method of ['property','focus','autofocus']){
      const error=await page.evaluate(async method=>{try{await window.focal[method](method==='property'?{key:'shutter',value:0x70}:{direction:'near',step:2});return null;}catch(e){return e.message;}},method);
      assert.match(error,/подключите камеру/i);
    }ok('Exposure, lens drive and AF IPC routes reject missing hardware explicitly');
    await app.close();({app,page}=await launch());const saved=await state(page);assert.equal(saved.settings.theme,'dark');assert.equal(saved.settings.accentColor,'#3c9fb2');await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');ok('Theme and custom accent survive a complete application restart');
    await page.locator('.nav-item').filter({hasText:'Настройки'}).click();await page.getByRole('button',{name:'Тема: Светлая',exact:true}).click();await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');assert.equal((await state(page)).settings.accentColor,'#3c9fb2');ok('Switching back to light keeps the chosen accent');
    const testImage=path.join(profile,'Цветовой тест.jpg');await sharp({create:{width:800,height:600,channels:3,background:'#ba8e60'}}).jpeg().toFile(testImage);
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},testImage);
    await page.getByRole('button',{name:'Импорт Ctrl I'}).click();await page.locator('.nav-item').filter({hasText:'Библиотека'}).click();await page.locator('.photo-card-image').click();await page.waitForFunction(()=>document.querySelector('.viewer-image-area>img')?.naturalWidth>0);
    const center=async()=>{const box=await page.locator('.viewer-image-area>img').boundingBox();const png=await page.screenshot({clip:{x:Math.floor(box.x+box.width/2),y:Math.floor(box.y+box.height/2),width:2,height:2}});return Array.from(await sharp(png).removeAlpha().raw().toBuffer());};
    const lightPixel=await center();await page.evaluate(()=>window.focal.settings({theme:'dark',accentColor:'#ff00ff'}));await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');assert.equal(await page.locator('.viewer').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(28, 33, 37)');assert.deepEqual(await center(),lightPixel);ok('Dark theme and bright custom accent preserve displayed photo pixels');
    await page.screenshot({path:path.join(profile,'dark-viewer.png')});await page.getByRole('button',{name:'Закрыть просмотр'}).click();
    assert.deepEqual(errors,[]);ok('No renderer errors during theme switching');
    await fs.writeFile(path.join(out,'Apertrove-appearance-report.json'),JSON.stringify({checks,rendererErrors:errors,hardware:'No camera connected; camera transport commands verified separately with controlled tests.',binary:process.env.FOCAL_BINARY||'development'},null,2));
  }finally{await app.close().catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1;});
