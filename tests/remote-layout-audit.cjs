const {_electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),sharp=require('sharp');
const {createRemoteServer}=require('../electron/remote-server.cjs');
const {normalize}=require('../electron/remote/appearance.js');
const root=path.resolve(__dirname,'..'),output=path.join(root,'qa','remote-layout'),profile=path.join(root,'qa',`remote-layout-${Date.now()}`);
const fixture={appearance:normalize({theme:'light'}),camera:{connected:true,model:'Canon EOS 2000D',cameraId:'test',mode:'M',battery:80,live:false,properties:{},capabilities:{capture:true,focus:true,liveView:true}},cameras:[{id:'test',model:'Canon EOS 2000D'},{id:'other',model:'Canon EOS R6 Mark II · Длинное название подключённой камеры'}],session:{name:'Каталожная съёмка',count:98765,queueLength:100},presets:[{id:'test',name:'Длинное название пользовательского пресета для студийного портрета'}]};
for(const [key,value,labels] of [['shutter',1,['1/8000','30″']],['aperture',1,['f/2.8','f/22']],['iso',1,['12800','Auto']],['whiteBalance',0,['Авто','Люминесцентный']],['pictureStyle',0,['Портрет','Пользовательский стиль']],['imageQuality',0,['RAW + JPEG L · Fine','JPEG L · Fine']],['driveMode',0,['Одиночная','Серийная']],['afMode',0,['One Shot','AI Servo']],['liveAfMode',0,['Quick · фазовый','Live · контрастный']],['compensation',0,['0','+1']]])fixture.camera.properties[key]={value,writable:true,choices:labels.map((label,value)=>({label,value}))};
let sequence=0,cases=0;const errors=[];
async function inspect(page,label){
 const issues=await page.evaluate(()=>{
  const issues=[],visible=e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden',box=e=>e.getBoundingClientRect(),bar=document.querySelector('.capture-bar');
  if(document.documentElement.scrollWidth>innerWidth+1)issues.push('page horizontal overflow');
  const r=box(bar);if(r.left<-.5||r.right>innerWidth+.5||r.top<0||r.bottom>innerHeight+.5)issues.push('capture bar bounds');
  const parts=[...bar.children].map(box);if(parts[0].right>parts[1].left-3||parts[1].right>parts[2].left-3)issues.push('capture bar collision');
  for(const node of document.querySelectorAll('button,select,input,.panel,.focus-actions,.exposure,.camera-select,.interval-controls,.hud-header')){
   if(!visible(node))continue;const s=getComputedStyle(node);
   if(node.scrollWidth>node.clientWidth+2&&!['hidden','auto','scroll'].includes(s.overflowX))issues.push('overflow '+(node.id||node.className||node.tagName));
   const rect=box(node);if(rect.left<-.5||rect.right>innerWidth+.5)issues.push('outside viewport '+(node.id||node.className||node.tagName));
  }
  for(const selector of ['.exposure>label','.focus-actions>button','.camera-select>div>button']){
   const nodes=[...document.querySelectorAll(selector)].filter(visible),rects=nodes.map(box);
   if(rects.length&&rects.some(rect=>Math.abs(rect.top-rects[0].top)>1))issues.push('uneven row '+selector);
   for(let i=1;i<rects.length;i++)if(rects[i-1].right>rects[i].left+.5)issues.push('row collision '+selector);
  }
  const message=document.querySelector('#message');if(visible(message)&&box(message).bottom>r.top-5)issues.push('notification covers capture bar');
  const view=document.querySelector('.viewfinder'),canvas=document.querySelector('#preview');if(box(canvas).width>box(view).width+1)issues.push('canvas intrinsic size changed layout');
  return issues;
 });assert.deepEqual(issues,[],label);cases++;
}
(async()=>{
 await fs.mkdir(output,{recursive:true});const bytes=await sharp({create:{width:3000,height:2000,channels:3,background:'#35444c'}}).jpeg().toBuffer();
 const server=createRemoteServer({getState:()=>fixture,command:async name=>{if(name==='flashSupport')return {available:true,canAttempt:true};if(name==='flashPopup')throw Error('Камера временно занята. '+('Проверьте подключение и повторите команду. '.repeat(10)));return true;}}),info=await server.start({host:'127.0.0.1',port:0});let app,hud;
 try{
  app=await _electron.launch({args:[root],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,FOCAL_TEST_DATA:profile}});await app.firstWindow();const next=app.waitForEvent('window');await app.evaluate(({BrowserWindow},url)=>new BrowserWindow({width:430,height:900,webPreferences:{nodeIntegration:false,contextIsolation:true}}).loadURL(url),info.url);hud=await next;hud.on('pageerror',error=>errors.push(error.message));hud.on('console',m=>{if(m.type()==='error')errors.push(m.text());});await hud.locator('#connection-text').filter({hasText:'Подключено'}).waitFor();await hud.evaluate(()=>document.fonts.ready);
  for(const [width,height] of [[320,568],[360,640],[390,844],[430,932],[768,1024],[844,390],[1024,768],[1440,900]])for(const design of ['current','classic','modern'])for(const theme of ['light','dark']){
   await hud.setViewportSize({width,height});fixture.appearance=normalize({design,theme,accentColor:'#a08bd5'});
   for(const kind of ['compact','expanded','stream','focusing','series','error','disconnected']){
    fixture.session.name=`Каталожная фотосессия с очень длинным названием для проверки панели · ${++sequence}`;
    fixture.camera.connected=kind!=='disconnected';fixture.camera.live=kind==='stream';fixture.camera.autofocus=kind==='focusing'?{status:'focusing'}:null;fixture.busy=kind==='focusing';fixture.series=kind==='series'?{status:'running',done:12,count:100,current:'Длинное имя пресета'}:null;fixture.camera.error=kind==='error'?'Камера не ответила. Проверьте подключение и закройте другие программы для управления камерой.':null;
    server.publishState();await hud.waitForFunction(name=>document.querySelector('#session').textContent===name,fixture.session.name);
    const expanded=kind!=='compact';if(await hud.locator('#details').isVisible()!==expanded)await hud.locator('#more').click();
    if(kind==='stream'){const prior=await hud.locator('#preview').getAttribute('data-frames');server.publishFrame(bytes);await hud.waitForFunction(prior=>document.querySelector('#preview').dataset.frames!==prior,prior);}
    await hud.evaluate(()=>{document.querySelector('#message').hidden=true;window.scrollTo(0,0);});
    if(kind==='error'){await hud.waitForFunction(()=>!document.querySelector('#flash-popup').disabled);await hud.locator('#flash-popup').click();await hud.locator('#message.error').waitFor();}
    await hud.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const label=`${width}x${height} ${design} ${theme} ${kind}`;await inspect(hud,label);
    if(design==='classic')assert.equal(await hud.locator('.lcd-readout').first().evaluate(el=>getComputedStyle(el).fill),'rgb(20, 32, 14)');
    if(kind==='expanded'){
     for(const selector of ['#cameras','#interval','#af']){await hud.locator(selector).scrollIntoViewIfNeeded();const rect=await hud.locator(selector).boundingBox(),bar=await hud.locator('.capture-bar').boundingBox();assert.ok(rect.y>=0&&rect.y+rect.height<=bar.y-2,`${label} reachable ${selector}`);}
    }
    if((width===390||width===1440)&&(kind==='compact'||kind==='error')){await hud.evaluate(()=>window.scrollTo(0,0));await hud.screenshot({path:path.join(output,`${design}-${theme}-${width}-${kind}.png`)});}
   }
  }
  fixture.camera.connected=true;fixture.camera.live=false;fixture.busy=false;fixture.series=null;fixture.session.name='Полный экран';server.publishState();await hud.waitForFunction(()=>document.querySelector('#session').textContent==='Полный экран');await hud.setViewportSize({width:390,height:844});await hud.evaluate(()=>{document.querySelector('#viewfinder').requestFullscreen=undefined;});await hud.locator('#fullscreen').click();assert.equal(await hud.locator('.viewfinder.expanded').count(),1);const bounds=await hud.locator('.viewfinder').boundingBox();assert.equal(bounds.x,0);assert.equal(bounds.y,0);assert.equal(bounds.width,390);assert.equal(bounds.height,844);await hud.locator('#fullscreen').click();
  const before=await hud.evaluate(()=>document.documentElement.dataset.theme);await server.stop();await hud.locator('#connection-text').filter({hasText:'Нет связи'}).waitFor();assert.equal(await hud.locator('#shutter').isDisabled(),true);assert.equal(await hud.locator('#af').isDisabled(),true);assert.equal(await hud.evaluate(()=>document.documentElement.dataset.theme),before);assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify({cases,viewports:8,designs:3,themes:2,states:7,fullscreen:true,disconnect:true,errors},null,2));console.log(`PASS ${cases} web layouts: 320–1440px, portrait/landscape, all designs/themes, long text, stream, focus, series, errors, disconnect, reachable controls and fullscreen; no camera commands`);
 }finally{await hud?.close().catch(()=>{});await app?.close();await server.stop();}
})().catch(error=>{console.error(error);process.exitCode=1;});
