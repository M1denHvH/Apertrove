const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const root = path.resolve(__dirname,'..');
const output = path.join(root,'qa','iris-appearance');
const runId = Date.now();
const motionSwitch = 'Режим производительности';

async function launch(systemTheme, profile = path.join(output,`profile-${runId}-${systemTheme}`)) {
  await fs.mkdir(profile,{recursive:true});
  const launcher = path.join(profile,'launch.cjs');
  await fs.writeFile(launcher,`
    const { nativeTheme } = require('electron');
    nativeTheme.themeSource = ${JSON.stringify(systemTheme)};
    require(${JSON.stringify(path.join(root,'electron','main.cjs'))});
  `);
  const app = await _electron.launch({args:[launcher],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,FOCAL_TEST_DATA:profile,FOCAL_TEST_ONBOARDING:'1'}});
  try { return {app,page:await app.firstWindow(),profile}; }
  catch(error) { await app.close().catch(()=>{}); throw error; }
}

async function firstPaint(page, expected) {
  const startup=await page.evaluate(()=>{
    const elements=[...document.head.querySelectorAll('script,link[rel=stylesheet]')];
    const appearance=window.focal?.initialAppearance??window.shotInspector?.initialAppearance;
    return {beforeStyles:elements[0]?.getAttribute('src')==='./appearance-startup.js'&&!elements[0].defer&&!elements[0].async,
      snapshot:{theme:appearance.resolvedTheme,mode:appearance.theme,design:appearance.design,accent:appearance.accentColor,performance:appearance.performanceMode}};
  });
  assert.equal(startup.beforeStyles,true);
  assert.deepEqual(startup.snapshot,expected);
  await expectAppearance(page,expected);
}

const expectAppearance = (page, value) => page.waitForFunction(expected=>{
  const root=document.documentElement;
  return root.dataset.theme===expected.theme && root.dataset.themeMode===expected.mode && root.dataset.design===expected.design &&
    root.style.getPropertyValue('--accent-color')===expected.accent && root.hasAttribute('data-performance-mode')===expected.performance;
},value);

async function observeMotion(page, duration) {
  return page.evaluate(duration=>new Promise(resolve=>{
    const iris=document.querySelector('.optics-iris');
    const hole=iris.querySelector('polygon');
    const blade=document.getElementById(iris.querySelector('use').getAttribute('href').slice(1));
    const rim=document.querySelector('.optics-rim');
    const samples=[];
    let start;
    function tick(time) {
      start??=time;
      const points=hole.getAttribute('points');
      const transform=iris.getAttribute('transform');
      const [x,y]=points.split(' ',2).map(Number);
      samples.push({time:time-start,radius:Math.hypot(x-160,y-107),points,transform,blade:blade.getAttribute('d')});
      if(time-start<duration)requestAnimationFrame(tick);
      else resolve({samples,rim:rim.getAttribute('transform'),blades:[...iris.querySelectorAll('use')].map(use=>use.getAttribute('transform'))});
    }
    requestAnimationFrame(tick);
  }),duration);
}

function checkCycle({samples,rim,blades}) {
  assert.equal(rim,null);
  assert.deepEqual(blades,Array.from({length:6},(_,index)=>`rotate(${60*index} 160 107)`));
  const start=samples.findIndex((frame,index)=>frame.radius>=23.01&&samples[index-1]?.radius<23.01)-1;
  const full=samples.findIndex((frame,index)=>index>start&&frame.radius>36.99);
  const finish=samples.findIndex((frame,index)=>index>full&&frame.radius<23.01);
  assert.ok(start>=0&&full>start&&finish>full);
  const rise=samples.slice(start,full+1);
  const holdEnd=samples.findIndex((frame,index)=>index>full&&frame.radius<36.99);
  const fall=samples.slice(holdEnd-1,finish+1);
  assert.ok(rise.at(-1).time-rise[0].time>1480);
  assert.ok(fall.at(-1).time-fall[0].time>1280);
  assert.ok(fall[0].time-rise.at(-1).time>=550);
  for(const [frames,direction] of [[rise,1],[fall,-1]]) {
    assert.ok(new Set(frames.map(frame=>frame.points)).size>=48,'Opening and closing should each pass through dozens of distinct geometries');
    for(let index=1;index<frames.length;index++){
      assert.ok((frames[index].radius-frames[index-1].radius)*direction>=-.002,JSON.stringify({direction,previous:frames[index-1],current:frames[index]}));
      assert.ok(Math.abs(frames[index].radius-frames[index-1].radius)<1.7);
    }
  }
  for(const {radius,points} of samples){
    const coordinates=points.split(' ').map(Number);
    const vertices=Array.from({length:6},(_,index)=>coordinates.slice(index*2,index*2+2));
    const center=vertices.reduce(([x,y],[vx,vy])=>[x+vx/6,y+vy/6],[0,0]);
    assert.ok(Math.hypot(center[0]-160,center[1]-107)<.002);
    for(const [x,y] of vertices)assert.ok(Math.abs(Math.hypot(x-160,y-107)-radius)<.002);
  }
  return {rise,fall};
}

async function contactSheet(page,{rise,fall}) {
  const captured=[];
  for(const [frames,label] of [[rise,'Opening'],[fall,'Closing']]) {
    for(const [index,progress] of [0,.25,.5,.75,1].entries()) {
      const frame=frames.reduce((best,frame)=>{
        const target=frames[0].time+(frames.at(-1).time-frames[0].time)*progress;
        return Math.abs(frame.time-target)<Math.abs(best.time-target)?frame:best;
      });
      await page.evaluate(({points,transform,blade})=>{
        const iris=document.querySelector('.optics-iris');
        iris.querySelector('polygon').setAttribute('points',points);
        document.getElementById(iris.querySelector('use').getAttribute('href').slice(1)).setAttribute('d',blade);
        if(transform)iris.setAttribute('transform',transform);else iris.removeAttribute('transform');
      },frame);
      const image=await page.locator('.setup-artwork').screenshot({scale:'css',animations:'disabled'});
      const input=await sharp(image).resize(220,148,{fit:'contain',background:'#151a18'}).png().toBuffer();
      const left=index*226, top=captured.length<10?30:214;
      const caption=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="220" height="29"><text x="8" y="20" font-size="14" fill="#edf4ee" font-family="Segoe UI">${label} · ${progress*100}%</text></svg>`);
      captured.push({input:caption,left,top:top-29},{input,left,top});
    }
  }
  await sharp({create:{width:1124,height:365,channels:3,background:'#171b19'}}).composite(captured).png().toFile(path.join(output,'cycle.png'));
}

(async()=>{
  await fs.mkdir(output,{recursive:true});
  const defaults={mode:'system',design:'current',accent:'#7f9c69',performance:false};
  let {app,page,profile}=await launch('light');
  try {
    await firstPaint(page,{...defaults,theme:'light'});
    await app.evaluate(({nativeTheme})=>{nativeTheme.themeSource='dark';});
    await expectAppearance(page,{...defaults,theme:'dark'});
  } finally { await app.close(); }
  ({app,page,profile}=await launch('dark'));
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try {
    await firstPaint(page,{...defaults,theme:'dark'});
    await page.locator('.optics-iris').waitFor();
    const metrics=()=>app.evaluate(async ({BrowserWindow})=>{
      const debug=BrowserWindow.getAllWindows()[0].webContents.debugger;
      if(!debug.isAttached()){debug.attach('1.3');await debug.sendCommand('Performance.enable');}
      return Object.fromEntries((await debug.sendCommand('Performance.getMetrics')).metrics.map(metric=>[metric.name,metric.value]));
    });
    const before=await metrics();
    const animated=await observeMotion(page,9200);
    const after=await metrics();
    const cycle=checkCycle(animated);
    await page.evaluate(()=>window.focal.settings({performanceMode:true}));
    await expectAppearance(page,{...defaults,theme:'dark',performance:true});
    const quietBefore=await metrics();
    const quiet=await observeMotion(page,9200);
    const quietAfter=await metrics();
    assert.equal(new Set(quiet.samples.map(frame=>frame.points)).size,1);
    assert.equal(quiet.samples[0].transform,null);
    await contactSheet(page,cycle);
    await page.getByText('Сделаем Apertrove вашим',{exact:true}).click();
    const control=page.getByRole('switch',{name:motionSwitch});
    assert.equal(await control.getAttribute('aria-checked'),'true');
    const samples=await page.locator('[data-appearance-sample]').count();
    assert.equal(samples,6);
    await page.getByRole('button',{name:'Тема: Светлая'}).click();
    await expectAppearance(page,{...defaults,theme:'light',mode:'light',performance:true});
    for(const [design,label] of [['classic','Canon Classic'],['modern','Modern'],['current','Studio']]){
      await page.getByRole('button',{name:`Оформление: ${label}`}).click();
      await expectAppearance(page,{...defaults,theme:'light',mode:'light',design,performance:true});
    }
    const hex=page.getByRole('textbox',{name:'Код акцентного цвета'});
    await hex.fill('#bad');await hex.press('Enter');
    await page.getByRole('alert').filter({hasText:'формате #RRGGBB'}).waitFor();
    await hex.fill('#000000');await hex.press('Enter');
    await expectAppearance(page,{...defaults,theme:'light',mode:'light',accent:'#000000',performance:true});
    await page.getByRole('button',{name:'Сбросить',exact:true}).click();
    await expectAppearance(page,{...defaults,theme:'light',mode:'light',performance:true});
    await page.getByLabel('Свой акцентный цвет').fill('#ce879d');
    await page.getByRole('button',{name:'Оформление: Modern'}).click();
    await page.getByRole('button',{name:'Тема: Тёмная'}).click();
    const expected={theme:'dark',mode:'dark',design:'modern',accent:'#ce879d',performance:true};
    await expectAppearance(page,expected);
    assert.equal(await page.locator('.sample-capture').first().evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(206, 135, 157)');
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1024,720));
    await page.waitForFunction(()=>innerWidth===1024&&innerHeight===720);
    await page.locator('.setup-content').evaluate(content=>{content.scrollTop=0;});
    const layout=await page.locator('.setup-content').evaluate(content=>[content.scrollWidth-content.clientWidth,document.querySelector('.setup-footer').getBoundingClientRect().bottom]);
    assert.ok(layout[0]<=1&&layout[1]<=720);
    await page.screenshot({path:path.join(output,'personalization.png'),scale:'css'});
    await control.click();
    await expectAppearance(page,{...expected,performance:false});
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].focus());
    await page.locator('.setup-content').evaluate(content=>{content.scrollTop=0;});
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.waitForFunction(()=>!document.querySelector('.optics-iris').hasAttribute('transform'));
    const reduced=await observeMotion(page,250);
    assert.equal(new Set(reduced.samples.map(frame=>frame.points)).size,1);
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.waitForFunction(()=>document.querySelector('.optics-iris').hasAttribute('transform'));
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].minimize());
    await page.waitForTimeout(100);
    const points=()=>page.locator('.optics-opening').getAttribute('points');
    const parked=await points();
    await page.waitForTimeout(300);
    assert.equal(await points(),parked);
    await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.restore();win.focus();});
    await page.waitForFunction(parked=>document.querySelector('.optics-opening').getAttribute('points')!==parked,parked);
    await control.click();
    await expectAppearance(page,expected);
    await page.getByRole('button',{name:'Начать настройку',exact:true}).click();
    await page.locator('.optics-iris').waitFor({state:'detached'});
    await page.getByRole('button',{name:'Назад',exact:true}).click();
    await page.locator('.optics-iris').waitFor();
    await page.getByText('Сделаем Apertrove вашим',{exact:true}).click();
    assert.equal(await control.getAttribute('aria-checked'),'true');
    await page.getByRole('button',{name:'Настроить позже',exact:true}).click();
    await page.getByRole('button',{name:'Библиотека',exact:true}).click();
    const windowEvent=app.waitForEvent('window');
    await page.getByRole('button',{name:'Открыть Shot Inspector',exact:true}).click();
    const inspector=await windowEvent;
    await firstPaint(inspector,expected);
    await page.evaluate(()=>window.focal.settings({performanceMode:false,theme:'system'}));
    await expectAppearance(inspector,{...expected,mode:'system',performance:false});
    await app.evaluate(({nativeTheme})=>{nativeTheme.themeSource='light';});
    await expectAppearance(inspector,{...expected,mode:'system',theme:'light',performance:false});
    await page.evaluate(()=>window.focal.settings({theme:'dark',performanceMode:true}));
    await expectAppearance(inspector,expected);
    assert.deepEqual(errors,[]);
    await app.close();
    ({app,page}=await launch('light',profile));
    await firstPaint(page,expected);
    await page.getByRole('button',{name:'Настройки',exact:true}).click();
    assert.equal(await page.getByRole('switch',{name:motionSwitch}).getAttribute('aria-checked'),'true');
    const info={
      openingSamples:new Set(cycle.rise.map(frame=>frame.points)).size,
      closingSamples:new Set(cycle.fall.map(frame=>frame.points)).size,
      activeFrameIntervalsMs:animated.samples.slice(1).map((frame,i)=>frame.time-animated.samples[i].time).sort((a,b)=>a-b),
      standard:{layout:after.LayoutCount-before.LayoutCount,layoutMs:1000*(after.LayoutDuration-before.LayoutDuration),style:after.RecalcStyleCount-before.RecalcStyleCount,taskMs:1000*(after.TaskDuration-before.TaskDuration)},
      performance:{layout:quietAfter.LayoutCount-quietBefore.LayoutCount,layoutMs:1000*(quietAfter.LayoutDuration-quietBefore.LayoutDuration),style:quietAfter.RecalcStyleCount-quietBefore.RecalcStyleCount,taskMs:1000*(quietAfter.TaskDuration-quietBefore.TaskDuration)}
    };
    info.medianFrameIntervalMs=info.activeFrameIntervalsMs[Math.floor(info.activeFrameIntervalsMs.length/2)];
    info.p95FrameIntervalMs=info.activeFrameIntervalsMs[Math.floor(info.activeFrameIntervalsMs.length*.95)];
    delete info.activeFrameIntervalsMs;
    await fs.writeFile(path.join(output,'measurement.json'),JSON.stringify(info,null,2));
    console.log('PASS first paint (light/dark/System, restored manual choice), onboarding controls, inspector sync, reduced motion and background pause');
    console.log(info);
  } finally { await app.close().catch(()=>{}); }
})().catch(error=>{console.error(error);process.exitCode=1;});
