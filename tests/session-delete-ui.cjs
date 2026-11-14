const {_electron}=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),sharp=require('sharp');
const {choose}=require('./select-control.cjs');
const root=path.resolve(__dirname,'..'),profile=path.join(root,'qa',`session-delete-${Date.now()}`),screens=path.join(root,'qa','session-delete-ui');
async function launch(){
  const app=await _electron.launch({...(process.env.FOCAL_BINARY?{executablePath:process.env.FOCAL_BINARY,args:[]}:{args:[root]}),env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,FOCAL_TEST_DATA:profile}});
  const page=await app.firstWindow();await page.waitForSelector('.app-shell');return {app,page};
}
(async()=>{
  await fs.mkdir(profile,{recursive:true});await fs.mkdir(screens,{recursive:true});let {app,page}=await launch();const errors=[];
  const capture=async file=>{const data=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toDataURL());await fs.writeFile(file,Buffer.from(data.split(',')[1],'base64'));};
  const monitor=()=>page.on('pageerror',error=>errors.push(error.message));monitor();
  const boot=()=>page.evaluate(()=>window.focal.boot());
  const hub=()=>page.getByRole('button',{name:'Фотосессии',exact:true}).click();
  const ask=name=>page.getByRole('button',{name:`Удалить сессию ${name}`,exact:true}).click();
  const confirm=()=>page.getByRole('dialog').getByRole('button',{name:'Удалить сессию',exact:true}).click();
  const create=name=>page.evaluate(name=>window.focal.session({name}),name);
  const importImage=async(name,color)=>{
    const file=path.join(profile,name);await sharp({create:{width:1200,height:800,channels:3,background:color}}).jpeg().toFile(file);
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);
    await page.evaluate(()=>window.focal.importFiles());return (await boot()).photos.at(-1);
  };
  try{
    const a=(await create('Сохраняем фотографии')).sessionId,p=await importImage('keep.jpg','#556677');
    await page.evaluate(id=>window.focal.photoUpdate({id,rating:5,edits:{exposure:.5}}),p.id);
    const b=(await create('Удаляем фотографии')).sessionId,q=await importImage('trash.jpg','#987654');
    const unrelated=path.join(path.dirname(q.path),'notes.txt');await fs.writeFile(unrelated,'keep');
    await hub();await ask('Сохраняем фотографии');assert.equal(await page.getByLabel('Удалить сессию вместе с фото',{exact:true}).isChecked(),false);
    await page.getByRole('button',{name:'Отмена',exact:true}).click();assert.equal((await boot()).sessions.length,2);
    await page.getByRole('button',{name:'Настроить сессию Сохраняем фотографии',exact:true}).click();await page.getByRole('button',{name:'Удалить сессию',exact:true}).click();await confirm();
    await page.getByRole('dialog').waitFor({state:'hidden'});let state=await boot();assert.equal(state.sessionId,b);assert.equal(state.sessions.some(s=>s.id===a),false);
    const kept=state.photos.find(photo=>photo.id===p.id);assert.equal(kept.sessionId,null);assert.equal(kept.rating,5);assert.equal(kept.edits.exposure,.5);await fs.access(p.path);await fs.access(p.thumbPath);
    await page.getByRole('button',{name:'Библиотека',exact:true}).click();await choose(page.getByRole('combobox',{name:'Сессия библиотеки',exact:true}),'unassigned');assert.equal(await page.locator('.photo-card').count(),1);assert.equal(await page.locator('.photo-card-info strong').textContent(),'keep.jpg');
    await choose(page.getByRole('combobox',{name:'Сессия библиотеки',exact:true}),b);assert.equal(await page.locator('.photo-card-info strong').textContent(),'trash.jpg');
    console.log('PASS cancel, delete from settings, retain photos/ratings/edits, unassigned and named session filters');
    await hub();await ask('Удаляем фотографии');await page.getByLabel('Удалить сессию вместе с фото',{exact:true}).check();await confirm();await page.getByRole('dialog').waitFor({state:'hidden'});
    state=await boot();assert.equal(state.sessionId,null);assert.equal(state.settings.captureFolder,'');assert.equal(state.sessions.length,0);assert.equal(state.photos.length,1);
    await assert.rejects(fs.access(q.path));await assert.rejects(fs.access(q.thumbPath));await fs.access(unrelated);await fs.access(path.dirname(q.path));await fs.access(path.join(profile,'trash.jpg'));
    await assert.rejects(page.evaluate(()=>window.focal.capture()),/фотосессию/);
    console.log('PASS checked deletion uses the real Windows Recycle Bin; unrelated files/folder and import source remain; active session cleared');

    const longName='Каталожная фотосессия с очень длинным названием для проверки ровных карточек и диалога удаления';
    const c=(await create(longName)).sessionId,ok=await importImage('ok.jpg','#765432'),fail=await importImage('locked.jpg','#367895');
    await hub();let layoutCases=0;
    for(const design of ['current','classic','modern'])for(const theme of ['light','dark'])for(const zoom of [1,1.25]){
      await app.evaluate(({BrowserWindow},zoom)=>{const w=BrowserWindow.getAllWindows()[0];w.setSize(1120,760);w.webContents.setZoomFactor(zoom);},zoom);
      await page.evaluate(settings=>window.focal.settings(settings),{design,theme});await ask(longName);
      const issues=await page.evaluate(()=>{
        const issues=[],modal=document.querySelector('.modal'),r=modal.getBoundingClientRect();
        if(r.left<10||r.right>innerWidth-10||r.top<10||r.bottom>innerHeight-10)issues.push('modal bounds');
        for(const el of document.querySelectorAll('.modal,.modal-actions,.session-card-tools,.session-card-title'))if(el.scrollWidth>el.clientWidth+3)issues.push('overflow '+el.className);
        return issues;
      });assert.deepEqual(issues,[],`${design}-${theme}-${zoom}`);layoutCases++;
      if(zoom===1.25&&theme==='dark')await capture(path.join(screens,`${design}-dark-delete.png`));
      await page.getByRole('button',{name:'Отмена',exact:true}).click();
    }
    console.log(`PASS ${layoutCases} confirmation/card layouts across every design and theme at 100/125%`);
    await app.evaluate(({shell},args)=>{
      const fs=process.getBuiltinModule('fs/promises'),path=process.getBuiltinModule('path');globalThis.__originalTrash=shell.trashItem;
      shell.trashItem=async file=>{if(file===args.ok){await new Promise(resolve=>{globalThis.__releaseTrash=resolve;});await fs.rename(file,path.join(args.profile,'test-recycle-ok.jpg'));}else throw Error('Файл занят другим приложением.');};
    },{ok:ok.path,profile});
    await ask(longName);await page.getByLabel('Удалить сессию вместе с фото',{exact:true}).check();await confirm();
    await page.waitForFunction(()=>document.querySelector('[role="dialog"]')?.getAttribute('aria-busy')==='true');
    assert.equal(await page.getByRole('button',{name:'Закрыть',exact:true}).isDisabled(),true);await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),1);
    await assert.rejects(page.evaluate(id=>window.focal.sessionOpen({id}),c),/Остановите/);
    await assert.rejects(page.evaluate(()=>window.focal.importFiles()),/Остановите/);
    await assert.rejects(page.evaluate(()=>window.focal.live({enabled:true})),/Дождитесь/);
    await app.evaluate(()=>globalThis.__releaseTrash());await page.getByRole('alert').waitFor();state=await boot();
    assert.equal(state.sessionId,c);assert.equal(state.photos.filter(photo=>photo.sessionId===c).length,1);await fs.access(fail.path);await assert.rejects(fs.access(ok.path));
    await capture(path.join(screens,'partial-failure.png'));
    await app.evaluate(({shell},profile)=>{const fs=process.getBuiltinModule('fs/promises'),path=process.getBuiltinModule('path');shell.trashItem=async file=>fs.rename(file,path.join(profile,'test-recycle-retry.jpg'));},profile);
    await page.getByRole('button',{name:'Повторить удаление',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
    assert.equal((await boot()).sessions.length,0);await fs.access(p.path);
    await app.evaluate(({shell})=>{shell.trashItem=globalThis.__originalTrash;});
    console.log('PASS busy dialog cannot close; camera/session/import operations blocked; partial failure keeps failed files and retry completes');
    const closing=(await create('Завершение удаления при выходе')).sessionId;await importImage('close.jpg','#abcdef');
    await app.evaluate(({shell},profile)=>{const fs=process.getBuiltinModule('fs/promises'),path=process.getBuiltinModule('path');shell.trashItem=async file=>{await new Promise(resolve=>{globalThis.__releaseCloseTrash=resolve;});await fs.rename(file,path.join(profile,'test-recycle-on-close.jpg'));};},profile);
    const deletion=page.evaluate(id=>window.focal.sessionDelete({id,deletePhotos:true}),closing).catch(()=>null);
    const deadline=Date.now()+5000;while(!await app.evaluate(()=>!!globalThis.__releaseCloseTrash)){if(Date.now()>deadline)throw Error('Deletion did not start');await new Promise(resolve=>setTimeout(resolve,20));}
    assert.equal(await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.close();w.close();return !w.isDestroyed();}),true);
    const closed=app.waitForEvent('close');await app.evaluate(()=>globalThis.__releaseCloseTrash());await closed;await deletion;
    console.log('PASS repeated app-close requests wait for deletion and persistence');
    ({app,page}=await launch());monitor();state=await boot();assert.equal(state.sessions.length,0);assert.equal(state.sessionId,null);assert.equal(state.photos.length,1);assert.equal(state.photos[0].sessionId,null);assert.equal(state.photos[0].rating,5);assert.deepEqual(errors,[]);
    console.log('PASS deletion and unassigned photos survive restart; no renderer errors; no camera commands executed');
  }catch(error){console.error('Dialog:',await page.getByRole('dialog').textContent().catch(()=>''));await capture(path.join(screens,'failure.png')).catch(()=>{});throw error;}finally{await app.close().catch(()=>{});}
})().catch(error=>{console.error(error);process.exitCode=1;});
