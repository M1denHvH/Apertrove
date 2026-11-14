const { _electron, chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const output=path.resolve(process.env.APERTROVE_I18N_SCREENSHOTS||path.join(root,'qa','i18n'));

const fixture = (system,frame) => [
 "const {app,utilityProcess}=require('electron');",
 "const {EventEmitter}=require('node:events');",
 "app.getPreferredSystemLanguages=()=>"+ JSON.stringify([system])+";",
 "const realFork=utilityProcess.fork.bind(utilityProcess);",
 "const frame=Buffer.from("+JSON.stringify(frame)+",'base64');",
 "global.fixtureCalls=[];",
 "utilityProcess.fork=(file,...args)=>{",
 "if(!file.endsWith('camera-worker.cjs'))return realFork(file,...args);",
 "const child=new EventEmitter();",
 "let live=false,connected=false;",
 "const camera=()=>({connected,live,model:'Canon EOS Test',cameraId:'mock-camera',mode:'M',working:true,saveTo:3,properties:{driveMode:{value:0,writable:true,choices:[{value:0,label:'Одиночная'}]}},capabilities:{capture:true,liveView:true,focus:true}});",
 "const timer=setInterval(()=>{if(live)child.emit('message',{event:'frame',data:frame});},70);",
 "child.kill=()=>clearInterval(timer);",
 "child.postMessage=({id,method,args})=>{",
 "global.fixtureCalls.push(method);",
 "let result=true,error;",
 "if(method==='listCameras')result=[{id:'mock-camera',model:'Canon EOS Test'}];",
 "if(method==='connect'||method==='live'){if(method==='connect')connected=true;else live=args.enabled;result=camera();child.emit('message',{event:'status',data:result});}",
 "if(method==='flashSupport')result={available:false};",
 "if(method==='property')error='Камера занята. Закройте EOS Utility. (0x81)';",
 "if(method==='sdkEnvironment')result={status:'missing',architecture:'x64',checks:[]};",
 "if(method==='diagnoseCamera')result={checkedAt:new Date().toISOString(),model:'Canon EOS Test',mode:'M',storage:[],rows:[{id:'iso',status:'temporary',group:'Экспозиция и параметры',label:'Выдержка',detail:'Значение прочитано. Разрешённых вариантов записи нет.'}]};",
 "setImmediate(()=>child.emit('message',{id,result,error}));",
 "if(method==='shutdown')clearInterval(timer);",
 "};return child;};",
 "require("+JSON.stringify(path.join(root,'electron/main.cjs'))+");"
].join('\n');

async function language(page,expected) {
  await page.waitForFunction(locale=>document.documentElement.lang===locale,expected);
}
async function layout(page,label) {
  const overflow=await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth,document.body.scrollWidth-innerWidth));
  assert.ok(overflow<=1,label+' overflows by '+overflow+'px');
}
async function open(system,profile,frame) {
  await fs.mkdir(profile,{recursive:true});
  const launcher=path.join(profile,'launch.cjs');
  await fs.writeFile(launcher,fixture(system,frame));
  const instance=await _electron.launch({args:[launcher],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,FOCAL_TEST_DATA:profile,FOCAL_TEST_ONBOARDING:'1'}});
  return [instance,await instance.firstWindow()];
}

(async()=>{
 const sharp=require('sharp');
 const frame=(await sharp({create:{width:192,height:108,channels:3,background:'#869790'}}).jpeg().toBuffer()).toString('base64');
 const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'apertrove-i18n-'));
 await fs.mkdir(output,{recursive:true});
 let app,browser;
 const errors=[];
 try{
   [app,]=await open('ru-RU',path.join(scratch,'clean-ru'),frame);
   const ru=await app.firstWindow();
   await ru.getByRole('heading',{name:'Привет! Это Apertrove.'}).waitFor();
   assert.equal((await ru.evaluate(()=>window.focal.boot())).settings.language,'system');
   await app.close();app=null;

   const profile=path.join(scratch,'clean-en');
   let main;
   [app,main]=await open('en-US',profile,frame);
   main.on('pageerror',error=>errors.push(error.message));
   await main.getByRole('heading',{name:'Hi, this is Apertrove.'}).waitFor();
   await main.getByRole('combobox',{name:'Interface language'}).click();
   await main.getByRole('option',{name:'Русский'}).click();
   await language(main,'ru-RU');
   await main.getByRole('heading',{name:'Привет! Это Apertrove.'}).waitFor();
   await main.getByRole('combobox',{name:'Язык интерфейса'}).click();
   await main.getByRole('option',{name:'English'}).click();
   await language(main,'en-US');
   await main.getByRole('heading',{name:'Hi, this is Apertrove.'}).waitFor();
   assert.equal((await main.evaluate(()=>window.focal.boot())).settings.onboarding.step,'welcome');
   await main.getByRole('button',{name:'Start setup',exact:true}).click();
   await main.getByText('We couldn’t find the Canon components yet',{exact:true}).waitFor();
   await layout(main,'English SDK setup');
   await main.screenshot({path:path.join(output,'sdk-en-US.png'),animations:'disabled'});
   await main.evaluate(()=>window.focal.settings({language:'ru-RU'}));
   await main.getByText('Пока не нашли компоненты Canon',{exact:true}).waitFor();
   assert.equal((await main.evaluate(()=>window.focal.boot())).settings.onboarding.step,'environment');
   await main.screenshot({path:path.join(output,'sdk-ru-RU.png'),animations:'disabled'});
   await main.evaluate(()=>window.focal.settings({language:'en-US'}));
   await main.getByRole('button',{name:'Check the camera',exact:true}).click();
   await main.getByRole('heading',{name:'Let’s meet your camera'}).waitFor();
   await main.getByRole('button',{name:'Find cameras',exact:true}).click();
   await main.getByRole('button',{name:'Check capabilities',exact:true}).click();
   const capabilities=main.getByRole('region',{name:'Capability report'});
   await capabilities.getByText('Exposure and settings',{exact:true}).waitFor();
   await capabilities.getByText('Temporarily unavailable',{exact:true}).waitFor();
   await main.screenshot({path:path.join(output,'diagnostic-en-US.png'),animations:'disabled'});
   await main.evaluate(()=>window.focal.settings({language:'ru-RU'}));
   await main.getByRole('region',{name:'Отчёт о возможностях'}).getByText('Экспозиция и параметры',{exact:true}).waitFor();
   await main.screenshot({path:path.join(output,'diagnostic-ru-RU.png'),animations:'disabled'});
   await main.getByRole('button',{name:'Назад',exact:true}).click();
   await main.getByRole('button',{name:'Назад',exact:true}).click();
   await main.getByRole('heading',{name:'Привет! Это Apertrove.'}).waitFor();

   await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1024,720));
   for(const design of ['current','classic','modern'])for(const locale of ['en-US','ru-RU']){
     await main.evaluate(settings=>window.focal.settings(settings),{design,language:locale});
     await language(main,locale);
     await layout(main,design+' '+locale);
     await main.screenshot({path:path.join(output,'welcome-'+design+'-'+locale+'.png'),animations:'disabled'});
   }
   await main.evaluate(async()=>{await window.focal.settings({language:'en-US'});await window.focal.onboardingSave({completed:true,step:'ready'});});
   await main.reload();
   await main.getByRole('heading',{name:'Sessions',exact:true}).waitFor();
   for(const design of ['current','classic','modern'])for(const locale of ['ru-RU','en-US']){
     const russian=locale==='ru-RU';
     await main.evaluate(settings=>window.focal.settings(settings),{design,language:locale});
     await language(main,locale);
     await main.getByRole('button',{name:russian?'Настройки':'Settings',exact:true}).click();
     await main.getByRole('combobox',{name:russian?'Язык интерфейса':'Interface language'}).waitFor();
     await layout(main,'Settings '+design+' '+locale);
     await main.screenshot({path:path.join(output,'settings-'+design+'-'+locale+'.png'),animations:'disabled'});
   }
   await main.getByRole('button',{name:'Settings',exact:true}).click();
   await main.getByRole('combobox',{name:'Interface language'}).waitFor();
   await main.getByRole('button',{name:'Sessions',exact:true}).click();
   await main.evaluate(()=>window.focal.session({name:'QA Session',subfolder:true}));
   await main.getByRole('button',{name:'Capture',exact:true}).click();
   await main.evaluate(async()=>{await window.focal.connect({cameraId:'mock-camera'});await window.focal.live({enabled:true});});
   await main.waitForFunction(()=>Number(document.querySelector('canvas.live-canvas')?.dataset.frames)>1);
   const inspectorEvent=app.waitForEvent('window');
   await main.getByRole('button',{name:'Open Shot Inspector',exact:true}).click();
   const inspector=await inspectorEvent;
   inspector.on('pageerror',error=>errors.push(error.message));
   await inspector.getByText('Latest photo',{exact:true}).waitFor();
   const info=await main.evaluate(()=>window.focal.remoteStart({host:'127.0.0.1'}));
   browser=await chromium.launch({channel:'msedge'});
   const login=await browser.newPage({viewport:{width:390,height:844}});
   await login.goto(info.url.split('#')[0]);
   await login.getByRole('heading',{name:'Web Remote',exact:true}).waitFor();
   const remote=await browser.newPage({viewport:{width:390,height:844}});
   remote.on('pageerror',error=>errors.push(error.message));
   await remote.goto(info.url);
   await remote.locator('#connection-text').getByText('Connected',{exact:true}).waitFor();
   const before=await main.locator('canvas.live-canvas').evaluate(c=>{c.qaIdentity='original';return Number(c.dataset.frames);});
   const session=(await main.evaluate(()=>window.focal.boot())).sessionId;
   await main.evaluate(()=>window.focal.settings({language:'ru-RU'}));
   await Promise.all([language(main,'ru-RU'),language(inspector,'ru-RU'),language(remote,'ru-RU')]);
   await login.getByRole('heading',{name:'Веб-пульт',exact:true}).waitFor();
   await login.close();
   await main.waitForFunction(previous=>{const c=document.querySelector('canvas.live-canvas');return c?.qaIdentity==='original'&&Number(c.dataset.frames)>previous;},before);
   assert.equal((await main.evaluate(()=>window.focal.boot())).sessionId,session);
   assert.equal(await app.evaluate(()=>global.fixtureCalls.filter(method=>method==='connect').length),2);
   await remote.locator('#more').click();
   assert.equal(await remote.locator('select[data-property=driveMode] option:checked').textContent(),'Одиночная');
   await main.evaluate(()=>window.focal.settings({language:'en-US'}));
   await Promise.all([language(main,'en-US'),language(inspector,'en-US'),language(remote,'en-US')]);
   assert.equal(await remote.locator('select[data-property=driveMode] option:checked').textContent(),'Single shooting');
   await main.getByRole('combobox',{name:'Drive mode'}).click();
   await main.getByRole('option',{name:'Single shooting'}).click();
   await main.getByText('The camera is busy. Close EOS Utility. (0x81)',{exact:true}).waitFor({timeout:6000});
   await main.getByRole('button',{name:'Presets',exact:true}).click();
   await main.getByRole('button',{name:'Edit Soft portrait',exact:true}).click();
   const presetName=main.getByPlaceholder('Preset name');
   assert.equal(await presetName.inputValue(),'Soft portrait');
   await main.getByRole('button',{name:'Save preset',exact:true}).click();
   assert.equal((await main.evaluate(()=>window.focal.boot())).presets.find(p=>p.id==='portrait').name,'Мягкий портрет');
   for(const locale of ['en-US','ru-RU']){
     await main.evaluate(language=>window.focal.settings({language}),locale);
     await Promise.all([language(main,locale),language(inspector,locale),language(remote,locale)]);
     await remote.screenshot({path:path.join(output,'remote-'+locale+'.png'),animations:'disabled'});
     await inspector.screenshot({path:path.join(output,'inspector-'+locale+'.png'),animations:'disabled'});
     const russian=locale==='ru-RU';
     await main.getByRole('button',{name:russian?'Фотосессии':'Sessions',exact:true}).click();
     await main.getByText('QA Session',{exact:true}).waitFor();
     await layout(main,'Sessions '+locale);
     await main.screenshot({path:path.join(output,'sessions-'+locale+'.png'),animations:'disabled'});
     await main.getByRole('button',{name:russian?'Библиотека':'Library',exact:true}).click();
     await main.getByRole('heading',{name:russian?'Библиотека пуста':'Your library is empty'}).waitFor();
     await layout(main,'Library '+locale);
     await main.screenshot({path:path.join(output,'library-'+locale+'.png'),animations:'disabled'});
     await main.getByRole('button',{name:'Lighting Studio',exact:true}).click();
     await layout(main,'Lighting '+locale);
     await main.screenshot({path:path.join(output,'lighting-'+locale+'.png'),animations:'disabled'});
   }
   await browser.close();browser=null;
   await app.close();app=null;
   [app,main]=await open('en-US',profile,frame);
   await language(main,'ru-RU');
   assert.equal((await main.evaluate(()=>window.focal.boot())).settings.language,'ru-RU');
   await app.close();app=null;
   const legacy=path.join(scratch,'legacy');
   await fs.mkdir(legacy);
   await fs.writeFile(path.join(legacy,'library.json'),JSON.stringify({photos:[],sessions:[],presets:[],settings:{onboarding:{completed:true}}}));
   [app,main]=await open('en-US',legacy,frame);
   await main.getByRole('heading',{name:'Фотосессии',exact:true}).waitFor();
   assert.equal((await main.evaluate(()=>window.focal.boot())).settings.language,'ru-RU');
   assert.deepEqual(errors,[]);
   console.log('i18n UI passed: first-run ru/en, migration, persistence, 6 theme combinations, three live surfaces and uninterrupted mock Live View');
 }finally{
   await browser?.close();
   await app?.close();
 }
})().catch(error=>{console.error(error);process.exitCode=1;});

