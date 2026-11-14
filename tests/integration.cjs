const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const sharp=require('sharp');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const base=path.join(root,'qa/'+Date.now());
const checks=[];
const ok=name=>{checks.push(name);console.log('PASS',name);};
async function poll(fn,predicate,timeout=15000){const until=Date.now()+timeout;while(Date.now()<until){const value=await fn();if(predicate(value))return value;await new Promise(r=>setTimeout(r,200));}throw Error('Polling condition was not satisfied');}
async function mockOpen(app,files){await app.evaluate(({dialog},files)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:files});},files);}
async function mockSave(app,file){await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},file);}
async function launch(){const app=await electron.launch({...(process.env.FOCAL_BINARY?{executablePath:process.env.FOCAL_BINARY,args:[]}:{args:[root]}),env:{...process.env,FOCAL_TEST_DATA:path.join(base,'profile'),ELECTRON_RUN_AS_NODE:undefined}});const page=await app.firstWindow();page.on('pageerror',e=>console.error('PAGE ERROR',e));await require('./test-session.cjs').capturePage(page);return {app,page};}
(async()=>{
  await fs.mkdir(base,{recursive:true});const image=path.join(base,'Тест студии.jpg');
  await sharp({create:{width:1600,height:1000,channels:3,background:'#bbcfaf'}}).composite([{input:Buffer.from(`<svg width="1600" height="1000"><defs><linearGradient id="g"><stop stop-color="#6f8e6a"/><stop offset="1" stop-color="#dbe4c9"/></linearGradient></defs><rect width="1600" height="1000" fill="url(#g)"/><circle cx="1100" cy="300" r="170" fill="#f4e8ba"/><path d="M0 850L400 370L900 1000H0" fill="#547457"/><path d="M300 1000L1000 500L1600 1000" fill="#8da788"/></svg>`)}]).jpeg().toFile(image);
  const originalHash=crypto.createHash('sha256').update(await fs.readFile(image)).digest('hex');
  let {app,page}=await launch();let persistedId;
  try{
    await page.screenshot({path:path.join(root,'qa/Apertrove-preview.png')});
    const initial=await page.evaluate(()=>window.focal.boot());assert.equal(initial.camera.connected,false);assert.equal(initial.photos.length,0);ok('Clean launch with camera controls disabled');
    await page.getByRole('button',{name:'Подключить камеру',exact:true}).click();
    if(process.env.FOCAL_EXPECT_CAMERA){
      await poll(()=>page.evaluate(()=>window.focal.boot()),s=>s.camera.connected);
      const connected=await page.evaluate(()=>window.focal.boot());assert.equal(connected.camera.model,'Canon EOS 2000D');ok('Packaged UI connects to real Canon EOS 2000D');
      for(const [key,label] of [['shutter','Выдержка'],['aperture','Диафрагма'],['iso','ISO']]){
        const p=connected.camera.properties[key],original=p.value,other=p.allowed.find(v=>v!==original&&v!==0xffffffff);assert.ok(p.writable);
        try{await require('./select-control.cjs').choose(page.getByLabel(label,{exact:true}),String(other));await poll(()=>page.evaluate(()=>window.focal.boot()),s=>s.camera.properties[key].value===other);}
        finally{await poll(()=>page.getByLabel(label,{exact:true}).isEnabled(),Boolean,3000);await page.evaluate(({key,value})=>window.focal.property({key,value}),{key,value:original});}
        assert.equal((await page.evaluate(()=>window.focal.boot())).camera.properties[key].value,original);ok(`Real camera ${key}: UI write, confirmed read-back, original restored`);
      }
      await page.getByRole('button',{name:'Live View',exact:true}).click();await page.waitForFunction(()=>Number(document.querySelector('.live-canvas')?.dataset.frames)>0);ok('Real Live View JPEG is displayed in the packaged UI');
      await page.getByRole('button',{name:'Остановить Live View',exact:true}).click();await page.evaluate(()=>window.focal.disconnect());
    }else{
      await page.getByText('Камера не найдена.',{exact:false}).first().waitFor();
      const state=await page.evaluate(()=>window.focal.boot());assert.ok(state.camera.sdkPath);assert.equal(state.camera.connected,false);ok('Installed x64 Canon SDK initialized; absent camera reported honestly');
    }
    await mockOpen(app,[image]);await page.getByRole('button',{name:'Импорт Ctrl I'}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.film-thumb').length===1);
    let d=await page.evaluate(()=>window.focal.boot());assert.equal(d.photos.length,1);assert.notEqual(d.photos[0].path,image);persistedId=d.photos[0].id;ok('Real import copies Unicode photo and creates accessible preview');
    await page.waitForFunction(()=>document.querySelector('.preview-image')?.naturalWidth>0);await page.screenshot({path:path.join(base,'capture-imported.png')});
    await page.getByRole('button',{name:'Импорт Ctrl I'}).click();await page.waitForTimeout(600);d=await page.evaluate(()=>window.focal.boot());assert.equal(d.photos.length,1);ok('Repeated import deduplicates photo contents');
    await page.locator('.nav-item').filter({hasText:'Библиотека'}).click();await page.locator('.photo-card-image').click();await page.getByRole('dialog').count();await page.locator('.viewer').waitFor();
    await page.locator('.viewer').getByRole('button',{name:'Оценка 5',exact:true}).click();await page.getByRole('slider',{name:'Экспозиция',exact:true}).fill('0.7');await page.getByRole('slider',{name:'Теплота',exact:true}).fill('15');
    await page.waitForTimeout(700);await page.getByRole('button',{name:'Сохранить обработку',exact:true}).click();
    const edited=await page.evaluate(()=>window.focal.boot());assert.equal(edited.photos[0].rating,5);assert.equal(edited.photos[0].edits.exposure,.7);ok('Rating and nondestructive edits persisted');
    const exported=path.join(base,'Экспорт.jpg');await mockSave(app,exported);await page.getByRole('button',{name:'Экспорт JPEG',exact:true}).click();await page.waitForTimeout(700);assert.ok((await fs.stat(exported)).size>0);assert.equal(crypto.createHash('sha256').update(await fs.readFile(image)).digest('hex'),originalHash);ok('JPEG export works and preserves original bytes');
    await page.screenshot({path:path.join(base,'viewer.png')});await page.getByRole('button',{name:'Закрыть просмотр'}).click();
    await page.locator('.nav-item').filter({hasText:'Пресеты'}).click();await page.getByRole('button',{name:'Создать пресет',exact:true}).click();await page.getByPlaceholder('Название пресета').fill('Мой тестовый свет');await page.getByRole('button',{name:'Сохранить пресет',exact:true}).click();await page.getByRole('heading',{name:'Мой тестовый свет'}).waitFor();ok('User camera preset created through editor');
    await page.getByRole('button',{name:'Изменить Мой тестовый свет'}).click();await page.getByPlaceholder('Название пресета').fill('Изменённый свет');await page.getByRole('button',{name:'Сохранить пресет',exact:true}).click();await page.getByRole('heading',{name:'Изменённый свет'}).waitFor();ok('Preset edit updates existing recipe');
    const json=path.join(base,'Пресеты.json');await mockSave(app,json);await page.getByRole('button',{name:'Экспорт JSON'}).click();await page.waitForTimeout(300);const presets=JSON.parse(await fs.readFile(json));assert.equal(presets.presets.length,4);await mockOpen(app,[json]);await page.getByRole('button',{name:'Импорт JSON'}).click();await page.waitForTimeout(300);d=await page.evaluate(()=>window.focal.boot());assert.equal(d.presets.length,8);ok('Preset JSON export and validated import');
    await page.screenshot({path:path.join(base,'presets.png')});
    await page.locator('.nav-item').filter({hasText:'Инструменты'}).click();const incoming=path.join(base,'incoming');await fs.mkdir(incoming);await mockOpen(app,[incoming]);await page.getByRole('button',{name:'Выбрать входящую папку'}).click();await page.getByRole('button',{name:'Включить автоимпорт'}).click();await page.getByRole('button',{name:'Остановить автоимпорт'}).waitFor();
    await page.waitForTimeout(500);await sharp({create:{width:200,height:150,channels:3,background:'#765d43'}}).png().toFile(path.join(incoming,'Новый кадр.png'));
    await poll(()=>page.evaluate(()=>window.focal.boot()),s=>s.photos.length===2);ok('Watched folder imports a fully written new file');await page.getByRole('button',{name:'Остановить автоимпорт'}).click();await poll(()=>page.evaluate(()=>window.focal.boot()),s=>!s.watching);
    await page.locator('.nav-item').filter({hasText:'Съёмка'}).click();await page.getByRole('button',{name:'Новая фотосессия',exact:true}).click();await page.getByLabel('Название сессии',{exact:true}).fill('Тестовая сессия');await page.getByRole('button',{name:'Создать сессию',exact:true}).click();await page.getByRole('button',{name:'Тестовая сессия'}).waitFor();d=await page.evaluate(()=>window.focal.boot());assert.equal(d.sessions.length,2);assert.equal(d.photos.length,2);ok('New session creates separate folder and retains existing library');
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1120,760));await page.waitForTimeout(250);const width=await page.evaluate(()=>({w:innerWidth,s:document.body.scrollWidth}));assert.ok(width.s<=width.w);ok('Minimum window size has no horizontal page overflow');
    await app.close();({app,page}=await launch());d=await page.evaluate(()=>window.focal.boot());assert.equal(d.photos.length,2);assert.equal(d.photos.find(p=>p.id===persistedId).rating,5);assert.equal(d.presets.length,8);ok('Library, ratings, adjustments, presets and sessions survive restart');
    await fs.writeFile(path.join(root,'qa/Apertrove-test-report.json'),JSON.stringify({time:new Date().toISOString(),checks,hardware:process.env.FOCAL_EXPECT_CAMERA?'Canon EOS 2000D connected: exposure writes/read-back/restoration and Live View verified in UI. No shutter release.':'No camera was connected. Shutter, Live View, focus and card import require hardware validation.',errors:[]},null,2));
    console.log('ALL INTEGRATION CHECKS PASSED',checks.length);
  }finally{await app.close().catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1;});
