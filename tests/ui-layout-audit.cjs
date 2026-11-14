const {_electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),sharp=require('sharp'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),stamp=Date.now(),profile=path.join(root,'qa',`layout-${stamp}`),output=path.join(root,'qa',process.env.AUDIT_OUTPUT||'layout-audit');
const pages=['Фотосессии','Съёмка','Библиотека','Пресеты','Серия пресетов','Оборудование','Инструменты','Веб-пульт','Настройки'];
const results=[],errors=[];
async function inspect(page,label,context,app){
 const metrics=await page.evaluate(()=>{
  const box=element=>{const r=element.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
  const visible=element=>{const r=element.getBoundingClientRect(),s=getComputedStyle(element);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
  const issues=[],main=document.querySelector('main'),status=document.querySelector('.statusbar'),sidebar=document.querySelector('.sidebar');
  if(main.scrollWidth>main.clientWidth+2)issues.push({type:'horizontal-scroll',delta:main.scrollWidth-main.clientWidth});
  if(document.documentElement.scrollWidth>innerWidth+2)issues.push({type:'window-overflow'});
  const statusBox=box(status),mainBox=box(main),sideBox=box(sidebar);
  if(Math.abs(statusBox.x)>1)issues.push({type:'status-left',x:statusBox.x});
  if(mainBox.bottom>statusBox.y+1)issues.push({type:'status-overlaps-main',pixels:mainBox.bottom-statusBox.y});
  if(sideBox.bottom>statusBox.y+1)issues.push({type:'status-overlaps-sidebar',pixels:sideBox.bottom-statusBox.y});
  const preview=document.querySelector('.preview-panel');
  if(preview){
   const bounds=box(preview);
   for(const element of preview.querySelectorAll('.preview-toolbar,.preview-canvas,.capture-footer .btn')){
    if(!visible(element))continue;
    const r=box(element);
    if(r.x<bounds.x-1||r.right>bounds.right+1)issues.push({type:'preview-clipped',selector:element.className,pixels:r.right-bounds.right});
   }
  }
  const header=document.querySelector('.page-header');if(header?.children.length===2){const a=box(header.children[0]),b=box(header.children[1]);if(a.right>b.x-8)issues.push({type:'header-collision',overlap:a.right-b.x});}
  for(const element of document.querySelectorAll('.btn,.nav-item,.session-card-actions,.setting-row,.page-intro,.remote-actions,.session-bar,.equipment-title,.metadata-toolbar,.viewer-bottom,.modal-actions')){
   if(!visible(element))continue;const s=getComputedStyle(element);
   if(element.scrollWidth>element.clientWidth+3&&s.overflowX==='visible')issues.push({type:'control-overflow',selector:element.className,text:element.textContent.trim().slice(0,55),delta:element.scrollWidth-element.clientWidth});
  }
  const dialog=document.querySelector('.modal-backdrop>.modal,.viewer-backdrop>.viewer');if(dialog){const r=box(dialog);if(r.x<12||r.right>innerWidth-12||r.y<12||r.bottom>innerHeight-12)issues.push({type:'dialog-bounds',box:r});}
  const modal=document.querySelector('.modal');if(modal&&modal.scrollWidth>modal.clientWidth+2)issues.push({type:'dialog-overflow',delta:modal.scrollWidth-modal.clientWidth});
  return {issues,viewport:{width:innerWidth,height:innerHeight},status:statusBox,main:mainBox,sidebar:sideBox};
 });
 results.push({label,...context,...metrics});
 if(process.env.AUDIT_SCREENSHOTS==='1'&&(context.width===1120&&context.theme==='dark'||context.design==='current'&&context.width===1480&&context.theme==='light')){const file=path.join(output,`${context.design}-${context.theme}-${context.width}-${Math.round(context.zoom*100)}-${label}.png`);const data=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toDataURL());await fs.writeFile(file,Buffer.from(data.split(',')[1],'base64'));}
}
(async()=>{
 await fs.mkdir(profile,{recursive:true});await fs.mkdir(output,{recursive:true});
 const app=await _electron.launch({...(process.env.FOCAL_BINARY?{executablePath:process.env.FOCAL_BINARY,args:[]}:{args:[root]}),env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,FOCAL_TEST_DATA:profile}});const page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));
 try{
 await page.waitForSelector('.app-shell');await page.evaluate(()=>window.focal.session({name:'Каталог керамики · осенняя коллекция',client:'Студия предметной фотографии',description:'Предметная съёмка каталога, несколько вариантов света и цветового решения.'}));
 const files=[];for(let i=0;i<9;i++){const file=path.join(profile,`${i===0?'Предметная_съемка_новой_коллекции_керамики_для_каталога_и_социальных_сетей_2026':`Frame-${i}`}.jpg`);await sharp({create:{width:1200,height:800,channels:3,background:['#a09589','#66828a','#8d9677'][i%3]}}).withExif({IFD0:{Artist:'Apertrove QA',Copyright:'Test copyright',ImageDescription:`Frame ${i}`}}).jpeg().toFile(file);files.push(file);}
 await app.evaluate(({dialog},files)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:files});},files);await page.evaluate(()=>window.focal.importFiles());await page.evaluate(()=>window.focal.session({name:'Портретная фотосессия',client:'Иванова Анна'}));await page.evaluate(()=>window.focal.session({name:'Рекламная съёмка новой коллекции для студии и социальных сетей',client:'Название клиента с дополнительной информацией о проекте'}));const all=await page.evaluate(()=>window.focal.boot());await page.evaluate(id=>window.focal.sessionOpen({id}),all.sessions[0].id);await page.evaluate(()=>window.focal.seriesQueue({ids:['portrait','still','street','portrait']}));
 const camera={connected:true,live:false,model:'Canon EOS 2000D',mode:'M',battery:80,cameraId:'audit',properties:{},equipment:{lensName:'17-70mm F2.8-4 DC MACRO OS HSM | Contemporary 013'},capabilities:{liveView:true,focus:true,capture:true}};
 for(const [key,value,label] of [['shutter',0x70,'1/125'],['aperture',0x20,'f/2.8'],['iso',0x50,'200'],['compensation',0,'0'],['whiteBalance',0,'Авто'],['pictureStyle',0x82,'Портрет'],['imageQuality',0x00640013,'RAW + JPEG L · Fine'],['driveMode',0,'Одиночная'],['afMode',0,'One Shot'],['liveAfMode',0,'Quick · фазовый']])camera.properties[key]={value,writable:true,allowed:[value],choices:[{value,label}]};
 await app.evaluate(({BrowserWindow,ipcMain},camera)=>{BrowserWindow.getAllWindows()[0].webContents.send('focal:event',{type:'camera',data:camera});ipcMain.removeHandler('focal:equipmentPhoto');ipcMain.handle('focal:equipmentPhoto',()=>Promise.reject(Error('Offline fixture')));ipcMain.removeHandler('focal:equipment');ipcMain.handle('focal:equipment',()=>({camera:{kind:'camera',name:camera.model,connected:true,manufacturer:'Canon',source:null,facts:[['Прошивка','1.3.0'],['Матрица','22.3 × 14.9 мм CMOS'],['Байонет','Canon EF / EF-S']],stats:[['Снято в Apertrove','128'],['Кадров в библиотеке','9']]},lens:{kind:'lens',name:camera.equipment.lensName,connected:true,manufacturer:'Sigma',source:null,facts:[['Фокусное расстояние','17–70 мм'],['Светосила','f/2.8–4'],['Оптическая схема','16 элементов / 14 групп']],stats:[['Снято в Apertrove','128']]}}));},camera);
 for(const [width,height,zoom] of [[1480,960,1],[1120,760,1],[1120,760,1.25]])for(const design of ['current','classic','modern'])for(const theme of ['light','dark']){
  await app.evaluate(({BrowserWindow},{width,height,zoom})=>{const win=BrowserWindow.getAllWindows()[0];win.setSize(width,height);win.webContents.setZoomFactor(zoom);},{width,height,zoom});await page.evaluate(settings=>window.focal.settings(settings),{design,theme,showSplashes:true});
  const context={width,height,zoom,design,theme};
  for(let index=0;index<pages.length;index++){await page.getByRole('button',{name:pages[index],exact:true}).click();await page.locator('main').evaluate(el=>el.scrollTop=0);await page.waitForTimeout(30);await inspect(page,`page-${index}`,context,app);}
  await page.locator('.nav-item').filter({hasText:'Съёмка'}).click();
  const modals=[['workspace','Редактор панелей'],['composition','Композиционные направляющие'],['parameters','Гайд по параметрам']];
  for(const [name,button] of modals){await page.getByRole('button',{name:button,exact:true}).click();await inspect(page,`modal-${name}`,context,app);await page.getByRole('button',{name:'Закрыть',exact:true}).click();}
  await page.locator('.nav-item').filter({hasText:'Фотосессии'}).click();await page.getByRole('button',{name:'Создать фотосессию',exact:true}).click();await inspect(page,'modal-session',context,app);await page.getByRole('button',{name:'Закрыть',exact:true}).click();
  await page.locator('.nav-item').filter({hasText:'Пресеты'}).click();await page.getByRole('button',{name:'Изменить Мягкий портрет',exact:true}).click();await inspect(page,'modal-preset',context,app);await page.getByRole('button',{name:'Закрыть',exact:true}).click();
  await page.locator('.nav-item').filter({hasText:'Библиотека'}).click();await page.locator('.photo-open').last().dblclick();await inspect(page,'viewer',context,app);await page.getByRole('button',{name:'Все метаданные',exact:true}).click();await page.getByText('Test copyright',{exact:true}).waitFor();await inspect(page,'modal-metadata',context,app);await page.getByRole('button',{name:'Закрыть',exact:true}).click();await page.getByRole('button',{name:'Закрыть просмотр',exact:true}).click();
 }
 }finally{await app.close();}
 const issues=results.flatMap(result=>result.issues.map(issue=>({label:result.label,design:result.design,theme:result.theme,width:result.width,zoom:result.zoom,...issue})));
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({cases:results.length,issues,errors,results},null,2));
 console.log(JSON.stringify({cases:results.length,issues:issues.length,types:[...new Set(issues.map(issue=>issue.type))],errors},null,2));if(process.env.AUDIT_STRICT==='1'){assert.deepEqual(errors,[]);assert.deepEqual(issues,[]);}
})().catch(error=>{console.error(error);process.exitCode=1;});
