const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const profile = path.join(root, 'qa', 'onboarding-' + Date.now() + '-profile');
const output = path.join(root, 'qa', 'onboarding');
const launcher = path.join(profile, 'launcher.cjs');

const fixture = `
const {app,utilityProcess} = require('electron');
app.getPreferredSystemLanguages = () => ['ru-RU'];
const {EventEmitter} = require('node:events');
const {capabilityReport} = require(${JSON.stringify(path.join(root,'electron/camera-capabilities.cjs'))});
const original = utilityProcess.fork.bind(utilityProcess);
global.fixture = { sdk:false, plugged:false, busy:false, commands:[] };
utilityProcess.fork = (file,...args) => {
  if (!file.endsWith('camera-worker.cjs')) return original(file,...args);
  const child=new EventEmitter(),f=global.fixture;
  const dev={id:'fixture',index:0,model:'Canon EOS Test'};
  let camera={connected:false,properties:{}};
  const send=(event,data)=>child.emit('message',{event,data});
  child.kill=()=>child.emit('exit',0);
  child.postMessage=({id,method,args})=>{
    f.commands.push({method,args});
    let result,error;
    if(method==='sdkEnvironment')result=f.sdk?{status:'ready',architecture:'x64',version:'3.18.40.0',checks:[]}:{status:'missing',architecture:'x64',checks:[],error:'Совместимая EDSDK.dll не найдена.'};
    if(method==='listCameras'){if(!f.sdk)error='Совместимая EDSDK.dll не найдена.';result=f.plugged?[dev]:[];}
    if(method==='connect'){
      if(f.busy)error='Камера занята. Закройте EOS Utility. (0x81)';
      else if(!f.plugged)result={connected:false,error:'Камера не обнаружена.'};
      else {
        camera={connected:true,working:!args.readOnly,cameraId:'fixture',model:dev.model,saveTo:args.readOnly?null:args.savePreference,mode:'M',
          properties:{iso:{writable:!args.readOnly,value:72,allowed:[72]},afMode:{writable:false,value:3}},
          capabilities:{capture:!args.readOnly,liveView:false,focus:!args.readOnly,import:!args.readOnly}};
        result=camera;send('status',camera);
      }
    }
    if(method==='diagnoseCamera'){
      const rows=capabilityReport({state:camera,read:id=>({code:id===0x500?0x81:0}),storage:{volumes:[],code:0},exports:{volume:true},restricted:false});
      result={checkedAt:new Date().toISOString(),model:camera.model,description:camera.model,firmware:'1.0.0',sdkVersion:'3.18.40.0',mode:'M',storage:[],rows};
    }
    if(method==='disconnect'){camera={connected:false,properties:{}};send('status',camera);result=camera;}
    if(method==='shutdown'){result=true;}
    setImmediate(()=>{child.emit('message',{id,result,error});if(method==='shutdown')child.emit('exit',0);});
  };
  return child;
};
require(${JSON.stringify(path.join(root,'electron/main.cjs'))});
`;

async function launch() {
  const app = await _electron.launch({ args:[launcher], env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,FOCAL_TEST_DATA:profile,FOCAL_TEST_ONBOARDING:'1'} });
  return [app,await app.firstWindow()];
}

(async()=>{
  await fs.mkdir(profile,{recursive:true});
  await fs.mkdir(output,{recursive:true});
  await fs.writeFile(launcher,fixture);
  let [app,page]=await launch();
  const byButton=name=>page.getByRole('button',{name,exact:true});
  const heading=name=>page.getByRole('heading',{name,exact:true});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try{
    await heading('Привет! Это Apertrove.').waitFor();
    await page.waitForFunction(()=>!document.querySelector('.setup-intro h1').style.opacity);
    await page.screenshot({path:path.join(output,'welcome.png')});
    await byButton('Начать настройку').click();
    await page.getByText('Пока не нашли компоненты Canon',{exact:true}).waitFor();
    await app.evaluate(()=>{globalThis.fixture.sdk=true;});
    await byButton('Повторить проверку').click();
    await page.getByText('Компоненты Canon на месте',{exact:true}).waitFor();
    await byButton('К проверке камеры').click();
    await heading('Познакомимся с камерой').waitFor();
    await page.getByText(/Пока не видим вашу камеру/).waitFor();
    await app.evaluate(()=>{globalThis.fixture.plugged=true;globalThis.fixture.busy=true;});
    await byButton('Проверить возможности').click({timeout:10000});
    await page.getByRole('alert').filter({hasText:'Камера занята'}).waitFor();
    await app.evaluate(()=>{globalThis.fixture.busy=false;});
    await byButton('Проверить возможности').click();
    await page.getByRole('region',{name:'Отчёт о возможностях'}).waitFor();
    assert.equal((await page.evaluate(()=>window.focal.boot())).camera.working,false);
    await page.screenshot({path:path.join(output,'discovery.png')});
    const category=page.locator('.capability-report summary').filter({hasText:'Live View'});
    await category.focus();
    await page.keyboard.press('Enter');
    await category.locator('..').getByText('Запуск и остановка Live View',{exact:true}).waitFor();
    await page.keyboard.press('Enter');
    await category.locator('..').getByText('Запуск и остановка Live View',{exact:true}).waitFor({state:'hidden'});
    await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.setSize(1120,760);win.webContents.setZoomFactor(1.25);});
    await page.emulateMedia({reducedMotion:'reduce'});
    const layout=await page.locator('.setup-screen').evaluate(node=>({ width:node.clientWidth, scroll:node.scrollWidth, motion:getComputedStyle(node.querySelector('.capability-camera')).animationName }));
    assert.ok(layout.scroll<=layout.width+1,JSON.stringify(layout));
    assert.equal(layout.motion,'none');
    await byButton('К подключению').click();
    await byButton('Подключить камеру').click();
    await page.getByText('Подключено · Canon EOS Test',{exact:true}).waitFor();
    await byButton('К рабочей папке').click();
    await byButton('Проверить папку по умолчанию').click();
    await page.getByText(/Папка готова для фотосессий/).waitFor();
    await page.screenshot({path:path.join(output,'workspace.png'),scale:'css'});
    await byButton('К обучению').click();
    const tutorialWidth=await byButton('Начать обучение').evaluate(button=>button.getBoundingClientRect().width/button.parentElement.clientWidth);
    assert.ok(tutorialWidth<.7,'Tutorial CTA must fit its label');
    await byButton('Начать обучение').click();
    await page.getByRole('region',{name:'Интерактивное обучение'}).waitFor();
    await byButton('Далее').click();
    await heading('Спуск затвора').waitFor();
    await page.waitForFunction(async()=> (await window.focal.boot()).settings.onboarding.topic==='capture');
    const commands=await app.evaluate(()=>globalThis.fixture.commands);
    assert.ok(commands.some(cmd=>cmd.method==='connect'&&cmd.args.readOnly));
    assert.ok(commands.some(cmd=>cmd.method==='connect'&&!cmd.args.readOnly));
    assert.ok(!commands.some(cmd=>['capture','property','live','autofocus'].includes(cmd.method)));
    await app.close();
    [app,page]=await launch();
    page.on('pageerror',error=>errors.push(error.message));
    await heading('Осмотримся в Apertrove').waitFor();
    await byButton('Продолжить обучение').click();
    await heading('Спуск затвора').waitFor();
    for(let index=0;index<7;index++)await byButton('Далее').click().catch(async error=>{
      if(await byButton('Завершить').isVisible())return;
      throw error;
    });
    await byButton('Завершить').click();
    await heading('Всё готово к работе').waitFor();
    await page.screenshot({path:path.join(output,'ready.png')});
    await byButton('Открыть Apertrove').click();
    await byButton('Настройки').click();
    await byButton('Диагностика камеры').click();
    await heading('Познакомимся с камерой').waitFor();
    await page.getByText(/Последняя сохранённая проверка/).waitFor();
    await byButton('Закрыть').click();
    await byButton('Мастер настройки').click();
    await heading('Привет! Это Apertrove.').waitFor();
    await byButton('Настроить позже').click();
    assert.deepEqual(errors,[]);
    console.log('PASS SDK missing/ready, unplugged/Busy/retry, read-only probe, working connection, folder, tutorial resume, settings and shutdown');
  }catch(error){
    console.error('Renderer errors:',errors);
    await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});
    throw error;
  }finally{await app.close().catch(()=>{});}
})().catch(error=>{console.error(error);process.exitCode=1;});
