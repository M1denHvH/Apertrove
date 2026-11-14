const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const profile = path.join(root, 'qa', `appearance-matrix-${Date.now()}-profile`);
const output = path.join(root, 'qa', 'unified-appearance');
const sizes = [[1920,1080],[1600,900],[1366,768],[1280,720],[1024,768]];
const designs = ['current','classic','modern'];
const themes = [['light','light'],['dark','dark'],['system','light'],['system','dark']];
const accents = ['#7f9c69','#669dd8','#ce879d','#ffffff','#000000'];
const model = 'Canon EOS 2000D — студийная камера';
const lens = 'SIGMA 150–600mm F5–6.3 DG OS HSM | Contemporary + Canon EF Mount Adapter, версия для студийной съёмки';
const report = { model, lens, description:model, firmware:'1.3.0', mode:'M', battery:83, sdkVersion:'3.18.40.0', checkedAt:'2026-11-13T06:00:00Z',
  storage:[{type:2,access:2,label:'SDXC',free:2**35,capacity:2**36}],
  rows:Array.from({length:36},(_,i)=>({ id:String(i),group:['Экспозиция и параметры','Live View','Носители и передача'][Math.floor(i/12)],
    label:i===0?'Выдержка':'Свойство '+(i+1),status:['ready','temporary','unknown','error','unsupported','unimplemented'][i%6],
    detail:'Проверка свойства. Подробности доступны после подключения камеры к компьютеру.' }))
};
const launch = () => _electron.launch({args:[root],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,FOCAL_TEST_DATA:profile}});

(async()=>{
  await fs.mkdir(profile,{recursive:true});
  await fs.mkdir(output,{recursive:true});
  await fs.writeFile(path.join(profile,'library.json'),JSON.stringify({sessions:[],presets:[],photos:[],settings:{onboarding:{completed:true,report}}}));
  let app=await launch();
  const errors=[];
  try {
    let main=await app.firstWindow();
    main.on('pageerror',error=>errors.push(error.message));
    await main.waitForSelector('.app-shell');
    await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('focal:listCameras');ipcMain.handle('focal:listCameras',()=>[{id:'fixture',model:'Canon EOS 2000D — камера для теста выбора'}]);});
    const inspectorEvent=app.waitForEvent('window');
    await main.getByRole('button',{name:'Библиотека',exact:true}).click();
    await main.getByRole('button',{name:'Открыть Shot Inspector',exact:true}).click();
    const inspector=await inspectorEvent;
    inspector.on('pageerror',error=>errors.push(error.message));
    await inspector.waitForSelector('.shot-shell');
    await main.getByRole('button',{name:'Настройки',exact:true}).click();
    await main.getByRole('button',{name:'Диагностика камеры',exact:true}).click();
    await main.getByRole('region',{name:'Отчёт о возможностях'}).waitFor();
    async function appearance(page,{design,theme,resolved,accent}) {
      await page.waitForFunction(({design,theme,resolved,accent})=>{
        const root=document.documentElement;
        return root.dataset.design===design&&root.dataset.theme===resolved&&root.dataset.themeMode===theme
          &&root.style.getPropertyValue('--accent-color')===accent;
      },{design,theme,resolved,accent},{timeout:6000}).catch(async error=>{
        const actual=await page.evaluate(()=>({...document.documentElement.dataset,accent:document.documentElement.style.getPropertyValue('--accent-color')}));
        throw Error(`Appearance differs: ${JSON.stringify({design,theme,resolved,accent,actual})}`,{cause:error});
      });
    }
    let count=0;
    for(const design of designs)for(const [theme,resolved] of themes){
      const accent=accents[(count/5)%accents.length];
      await app.evaluate(({nativeTheme},resolved)=>{nativeTheme.themeSource=resolved;},resolved);
      await main.evaluate(value=>window.focal.settings(value),{design,theme,accentColor:accent});
      const expected={design,theme,resolved,accent};
      await Promise.all([appearance(main,expected),appearance(inspector,expected)]);
      for(const [width,height] of sizes){
        await app.evaluate(({BrowserWindow},[width,height])=>BrowserWindow.getAllWindows().find(win=>win.getTitle()==='Apertrove').setSize(width,height),[width,height]);
        await main.waitForFunction(([width,height])=>innerWidth===width&&innerHeight===height,[width,height]);
        const metrics=await main.evaluate(()=>{
          const content=document.querySelector('.setup-content'), footer=document.querySelector('.setup-footer'), scene=document.querySelector('.setup-artwork');
          const facts=document.querySelector('.capability-facts');
          content.scrollTop=content.scrollHeight;
          return {width:innerWidth,height:innerHeight,horizontal:content.scrollWidth-content.clientWidth,
            footer:footer.getBoundingClientRect().bottom, boundary:content.getBoundingClientRect().bottom-footer.getBoundingClientRect().top,
            scroll:content.scrollTop, factOverflow:Math.max(...[...facts.children].map(fact=>fact.scrollWidth-fact.clientWidth)),
            sceneOverflow:scene.getBoundingClientRect().right-content.getBoundingClientRect().right};
        });
        assert.ok(metrics.horizontal<=2&&metrics.factOverflow<=2&&metrics.sceneOverflow<=1&&metrics.footer<=metrics.height+1&&metrics.boundary<=1,JSON.stringify({expected,metrics}));
        count++;
        if(width===1366||width===1024&&theme==='light'&&design==='classic'){
          await main.locator('.setup-content').evaluate(el=>{el.scrollTop=0;});
          await main.screenshot({path:path.join(output,`${theme}-${resolved}-${design}${width===1024?'-compact':''}.png`),scale:'css'});
        }
      }
    }
    assert.equal(count,60);
    await app.evaluate(({nativeTheme})=>{nativeTheme.themeSource='light';});
    const osChange={design:'modern',theme:'system',resolved:'light',accent:accents[11%accents.length]};
    await Promise.all([appearance(main,osChange),appearance(inspector,osChange)]);
    await main.emulateMedia({reducedMotion:'reduce'});
    await main.getByRole('button',{name:'Закрыть',exact:true}).click();
    await main.getByRole('button',{name:'Мастер настройки',exact:true}).click();
    await main.getByRole('heading',{name:'Привет! Это Apertrove.'}).waitFor();
    assert.equal(await main.locator('.optics-iris').evaluate(node=>node.getAttribute('transform')),null);
    assert.equal(await main.locator('.optics-blade').count(),6);
    const last={theme:'dark',design:'classic',accentColor:'#669dd8'};
    await main.evaluate(value=>window.focal.settings(value),last);
    await app.close();
    app=await launch();
    main=await app.firstWindow();
    await appearance(main,{...last,resolved:'dark',accent:last.accentColor});
    await main.getByRole('button',{name:'Настройки',exact:true}).click();
    await main.getByRole('button',{name:'Мастер настройки',exact:true}).click();
    await appearance(main,{...last,resolved:'dark',accent:last.accentColor});
    assert.deepEqual(errors,[]);
    console.log('PASS 60 Electron layouts, 12 theme/style states, live main/inspector synchronization, persistence, reduced motion');
  } finally {await app.close().catch(()=>{});}
})().catch(error=>{console.error(error);process.exitCode=1;});
