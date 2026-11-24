'use strict';
// Actual Electron browser surface and authenticated WebSocket server, with only
// memory camera ports. This run never discovers, initializes or connects EDSDK.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require('playwright'),{createRemoteServer}=require('../electron/remote-server.cjs');
const root=path.resolve(__dirname,'..'),base=path.join(root,'qa/hold-controls');fs.mkdirSync(base,{recursive:true});const fixture=fs.mkdtempSync(path.join(base,'remote-'));
const calls=[],errors=[],checks=[],state={locale:'en-US',camera:{connected:true,model:'Demo camera',mode:'M',properties:{shutter:{value:12,writable:true,choices:[{value:12,label:'Bulb'}]},afMode:{value:0}},capabilities:{capture:true,bulb:true,focus:true},bulb:{status:'idle',available:true},focusHold:{status:'idle'}},session:{name:'Demo',count:0},presets:[],cameras:[],busy:false};
let startDelay=0,server,app;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
server=createRemoteServer({getState:()=>state,command:async(name,args)=>{
 calls.push({name,args});
 if(name==='flashSupport')return {available:false};
 if(name==='bulbStart'||name==='focusStart'){const key=name==='bulbStart'?'bulb':'focusHold';state.camera[key]={...state.camera[key],status:'starting'};state.busy=true;server.publishState();if(startDelay)await sleep(startDelay);state.camera[key].status=key==='bulb'?'exposing':'holding';server.publishState();return state.camera[key];}
 if(name==='bulbStop'||name==='focusStop'){const key=name==='bulbStop'?'bulb':'focusHold';state.camera[key].status='idle';state.busy=false;server.publishState();return state.camera[key];}
 throw Error('Unexpected camera command '+name);
}});
(async()=>{try{
 const info=await server.start({host:'127.0.0.1',port:0});app=await _electron.launch({args:[root],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,NODE_OPTIONS:'',NODE_PATH:'',FOCAL_TEST_DATA:path.join(fixture,'profile'),FOCAL_TEST_ONBOARDING:'0'}});
 const desktop=await app.firstWindow();await desktop.waitForSelector('.app-shell');const boot=await desktop.evaluate(()=>window.focal.boot());assert.equal(boot.camera.connected,false);assert.equal(boot.camera.sdkPath??null,null);
 const opened=app.waitForEvent('window');await app.evaluate(({BrowserWindow},url)=>{new BrowserWindow({width:420,height:900,webPreferences:{contextIsolation:true,nodeIntegration:false}}).loadURL(url);},info.url);let hud=await opened;hud.on('pageerror',e=>errors.push(e.message));hud.setDefaultTimeout(6000);await hud.waitForFunction(()=>document.querySelector('#connection-text').textContent==='Connected');
 async function count(name){return calls.filter(call=>call.name===name).length;}
 async function pointer(id,kind,type='mouse'){await hud.locator('#'+id).dispatchEvent(kind,{pointerId:9,pointerType:type,isPrimary:true,button:0,bubbles:true});}
 async function finished(name,before){await hud.waitForFunction(()=>document.querySelector('#bulb-hold')?.disabled===false);assert.equal(await count(name),before+1);}
 let before=await count('bulbStop');startDelay=200;await pointer('bulb-hold','pointerdown','touch');await pointer('bulb-hold','pointerup','touch');await finished('bulbStop',before);checks.push('touch release before start acknowledgement pairs one end');startDelay=0;
 before=await count('bulbStop');await pointer('bulb-hold','pointerdown');await hud.waitForTimeout(150);await hud.evaluate(()=>window.dispatchEvent(new PointerEvent('pointerup',{pointerId:9,bubbles:true})));await finished('bulbStop',before);checks.push('release outside bulb button ends exposure');
 for(const event of ['pointercancel','lostpointercapture']){before=await count('bulbStop');await pointer('bulb-hold','pointerdown');await pointer('bulb-hold',event);await finished('bulbStop',before);checks.push(event+' ends bulb once');}
 before=await count('bulbStop');await hud.locator('#bulb-hold').focus();await hud.keyboard.down('Space');await hud.waitForTimeout(300);await hud.keyboard.up('Space');await finished('bulbStop',before);checks.push('keyboard hold has one start/end');
 state.camera.properties.shutter.value=112;server.publishState();await hud.waitForFunction(()=>document.querySelector('#near').disabled===false);
 for(const id of ['near','far']){before=await count('focusStop');await pointer(id,'pointerdown','touch');await hud.waitForTimeout(150);await hud.evaluate(()=>window.dispatchEvent(new Event('blur')));await hud.waitForFunction(()=>document.querySelector('#near').disabled===false);assert.equal(await count('focusStop'),before+1);assert.equal(calls.filter(call=>call.name==='focusStart').at(-1).args.direction,id);checks.push(id+' touch/blur sends matching focus stop');}
 before=await count('focusStop');await pointer('near','pointerdown');await hud.waitForTimeout(80);await hud.close();for(let i=0;i<60&&await count('focusStop')===before;i++)await sleep(30);assert.equal(await count('focusStop'),before+1);checks.push('closing remote transport releases owned focus hold');
 assert.deepEqual(errors,[]);await app.close();app=null;await server.stop();
 const report={status:'PASS',fixture,checks,calls,rendererErrors:errors,nativeCalls:0,limitations:['Memory camera ports; this is no hardware compatibility claim.']};fs.writeFileSync(path.join(fixture,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(error){fs.writeFileSync(path.join(fixture,'failure.json'),JSON.stringify({error:error.stack,errors,calls},null,2));throw error;}finally{await app?.close();await server.stop();}})().catch(error=>{console.error(error);process.exitCode=1;});
