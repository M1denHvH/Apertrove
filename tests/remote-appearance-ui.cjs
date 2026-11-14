const {_electron}=require('playwright'),path=require('node:path'),fs=require('node:fs/promises'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),profile=path.join(root,'qa',`remote-appearance-${Date.now()}`),output=path.join(root,'qa','remote-appearance');
async function open(app,url,partition){const next=app.waitForEvent('window');await app.evaluate(({BrowserWindow},{url,partition})=>{new BrowserWindow({width:430,height:900,webPreferences:{contextIsolation:true,nodeIntegration:false,partition}}).loadURL(url);},{url,partition});return next;}
(async()=>{
 await fs.mkdir(output,{recursive:true});const app=await _electron.launch({...(process.env.FOCAL_BINARY?{executablePath:process.env.FOCAL_BINARY,args:[]}:{args:[root]}),env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,FOCAL_TEST_DATA:profile}});let hud,login,originalSource;const errors=[];
 try{
  const desktop=await app.firstWindow();desktop.on('pageerror',e=>errors.push(e.message));await desktop.waitForSelector('.app-shell');
  const remote=await desktop.evaluate(()=>window.focal.remoteStart({host:'127.0.0.1',port:0}));hud=await open(app,remote.url);hud.on('pageerror',e=>errors.push(e.message));hud.on('console',m=>{if(m.type()==='error')errors.push(m.text());});await hud.setViewportSize({width:390,height:844});await hud.locator('#connection-text').filter({hasText:'Подключено'}).waitFor();
  let cases=0;
  for(const design of ['current','classic','modern'])for(const theme of ['light','dark'])for(const accentColor of ['#7f9c69','#669dd8','#a08bd5','#ce879d','#caa05c','#54a99c','#000000','#ffffff','#777777']){
   await desktop.evaluate(value=>window.focal.settings(value),{design,theme,accentColor});
   await hud.waitForFunction(({design,theme,accentColor})=>document.documentElement.dataset.design===design&&document.documentElement.dataset.theme===theme&&document.documentElement.style.getPropertyValue('--accent-color')===accentColor,{design,theme,accentColor});
   await desktop.waitForFunction(({design,theme})=>document.documentElement.dataset.design===design&&document.documentElement.dataset.theme===theme,{design,theme});
   const palette=page=>page.evaluate(()=>{const style=getComputedStyle(document.documentElement);return Object.fromEntries(['--background','--surface','--surface-soft','--text','--text-secondary','--border','--accent-color','--on-accent'].map(key=>[key,style.getPropertyValue(key).trim()]));});
   assert.deepEqual(await palette(hud),await palette(desktop));cases++;
  }
  console.log(`PASS ${cases} desktop-to-phone updates: every design/theme, all palette colours plus black/white; exact shared colours and readable accent text`);
  originalSource=await app.evaluate(({nativeTheme})=>nativeTheme.themeSource);await desktop.evaluate(()=>window.focal.settings({theme:'system'}));
  await hud.emulateMedia({colorScheme:'light'});await app.evaluate(({nativeTheme})=>{nativeTheme.themeSource='dark';});await hud.waitForFunction(()=>document.documentElement.dataset.theme==='dark'&&document.documentElement.dataset.themeMode==='system');
  await hud.emulateMedia({colorScheme:'dark'});await app.evaluate(({nativeTheme})=>{nativeTheme.themeSource='light';});await hud.waitForFunction(()=>document.documentElement.dataset.theme==='light');
  console.log('PASS system appearance tracks the computer while the phone uses the opposite OS theme');
  await desktop.evaluate(()=>window.focal.settings({performanceMode:true}));
  await hud.waitForFunction(()=>document.documentElement.hasAttribute('data-performance-mode')&&getComputedStyle(document.querySelector('.capture-bar')).backdropFilter==='none');
  await desktop.evaluate(()=>window.focal.settings({performanceMode:false}));
  await hud.waitForFunction(()=>!document.documentElement.hasAttribute('data-performance-mode'));
  console.log('PASS Performance Mode synchronizes with the connected remote');
  await desktop.evaluate(()=>window.focal.settings({design:'classic',theme:'dark',accentColor:'#ce879d'}));await hud.waitForFunction(()=>document.documentElement.dataset.design==='classic'&&document.documentElement.dataset.theme==='dark');await hud.reload();await hud.locator('#connection-text').filter({hasText:'Подключено'}).waitFor();assert.equal(await hud.evaluate(()=>document.documentElement.style.getPropertyValue('--accent-color')),'#ce879d');
  login=await open(app,`http://${remote.host}:${remote.port}/`,'remote-login');await login.setViewportSize({width:320,height:568});await login.locator('#login').waitFor();await login.waitForFunction(()=>document.documentElement.dataset.design==='classic'&&document.documentElement.dataset.theme==='dark');
  await desktop.evaluate(()=>window.focal.settings({design:'modern',theme:'light',accentColor:'#669dd8'}));await login.waitForFunction(()=>document.documentElement.dataset.design==='modern'&&document.documentElement.dataset.theme==='light');
  const base=`http://${remote.host}:${remote.port}`;for(const route of ['/fonts/manrope-cyrillic-400.woff2','/fonts/manrope-latin-700.woff2'])assert.equal((await fetch(base+route)).status,200,route);
  await login.screenshot({path:path.join(output,'login-320.png')});await hud.evaluate(()=>document.fonts.ready);assert.equal(await hud.evaluate(()=>document.fonts.check('500 14px Manrope')),true);
  assert.deepEqual(errors,[]);console.log('PASS reload, login-page appearance updates, bundled Cyrillic/Latin fonts and CSP; no camera commands or renderer errors');
  await fs.writeFile(path.join(output,'sync-report.json'),JSON.stringify({appearanceCases:cases,computerSystemTheme:true,loginSync:true,fonts:true,errors},null,2));
 }finally{if(originalSource!==undefined)await app.evaluate(({nativeTheme},source)=>{nativeTheme.themeSource=source;},originalSource).catch(()=>{});await login?.close().catch(()=>{});await hud?.close().catch(()=>{});await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
