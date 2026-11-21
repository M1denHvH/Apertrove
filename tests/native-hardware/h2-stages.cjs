'use strict';
// Drives only the real preload APIs; all persistence belongs to the isolated synthetic profile.
const fs=require('node:fs'),path=require('node:path');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function runStages({app,page,output,nonce,controlPath,record}){
  let ticket=0,activeWrite=null,known=true,live=false;const exposure=[],result={exposure,live:null,af:null,lens:[]};
  const control=(phase,extra={})=>{const next=controlPath+'.next';fs.writeFileSync(next,JSON.stringify({nonce,ticket:++ticket,phase,...extra}));fs.renameSync(next,controlPath);};
  const call=async(method,args)=>{if(fs.existsSync(path.join(output,'native-denial.json')))throw Error('H2_NATIVE_STOP_RECORDED');try{const value=await page.evaluate(async({method,args})=>window.focal[method](args),{method,args});record({method,args,result:value});return value;}catch(error){record({method,args,error:String(error.message)});throw error;}};
  const state=()=>call('boot');
  const assert=(value,message)=>{if(!value)throw Error(message);};
  const scalarSnapshot=()=>{const rows=fs.readFileSync(path.join(output,'native-trace.jsonl'),'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);const values={};for(const row of rows)if(row.name==='EdsGetPropertyData'&&row.phase==='after'&&row.result===0&&row.outputs?.[4]?.uint32!==undefined)values[row.outputs[1]]=row.outputs[4].uint32;return values;};
  const propertiesRestored=(a,b)=>['iso','shutter','aperture','whiteBalance','afMode','liveAfMode'].every(key=>a.camera.properties[key]?.value===b.camera.properties[key]?.value)&&a.camera.mode===b.camera.mode;
  try{
    control('snapshot');const connected=await call('cameraWorking',{controlsOnly:true});
    assert(connected.connected&&connected.working&&connected.controlsOnly&&connected.saveTo===null&&connected.capabilities.capture===false&&connected.eventsRegistered===false,'H2_CONTROLS_ONLY_INVARIANT');
    const initial=await state();result.initial=initial.camera;result.initialRaw=scalarSnapshot();
    // SaveTo and both EVF scalars must be freshly observed before any camera mutation.
    assert([0xb,0x500,0x501].every(id=>Number.isInteger(result.initialRaw[id])),'H2_FRESH_EVF_SAVETO_SNAPSHOT_REQUIRED');
    for(const [key,id]of [['iso',0x402],['shutter',0x406],['aperture',0x405]]){
      const p=(await state()).camera.properties[key],row={key,id,initial:p?.value,descriptorCode:p?.descriptorCode,allowed:p?.allowed};exposure.push(row);
      if(!p?.writable||!Number.isInteger(p.value)||!Array.isArray(p.allowed)||!p.allowed.includes(p.value)){row.status='SKIPPED_NOT_WRITABLE';continue;}
      const target=[...p.allowed].filter(value=>value!==p.value&&value!==0&&Number.isInteger(value)).sort((a,b)=>Math.abs(a-p.value)-Math.abs(b-p.value))[0];
      if(target===undefined){row.status='SKIPPED_NO_ALTERNATIVE';continue;}
      row.target=target;activeWrite={key,id,value:p.value};control('exposure',{write:{id,value:target}});
      const changed=await call('property',{key,value:target});row.readBack=changed.properties[key]?.value;assert(row.readBack===target,'H2_EXPOSURE_READBACK_FAILED');
      control('restore',{write:{id,value:p.value}});const restored=await call('property',{key,value:p.value});row.restored=restored.properties[key]?.value;assert(row.restored===p.value,'H2_EXPOSURE_RESTORATION_FAILED');activeWrite=null;row.status='CHANGED_READBACK_RESTORED';
    }
    result.afterExposure=(await state()).camera;assert(propertiesRestored(initial,{camera:result.afterExposure}),'H2_EXPOSURE_BASELINE_NOT_RESTORED');
    result.whiteBalance={value:initial.camera.properties.whiteBalance?.value,allowed:initial.camera.properties.whiteBalance?.allowed,kelvin:initial.camera.properties.colorTemperature,policy:'READ_ONLY; Kelvin availability follows descriptors/current WB'};
    // Observe metadata only; JPEG decode/draw/histogram remain in the existing LivePreview component.
    await page.evaluate(()=>{window.__h2Frames={count:0,first:null,last:null};window.__h2Off=window.focal.onFrame(bytes=>{const row={at:Date.now(),bytes:bytes.byteLength};window.__h2Frames.count++;window.__h2Frames.first??=row;window.__h2Frames.last=row;});});
    await page.locator('.sidebar').getByRole('button',{name:'Capture',exact:true}).click();
    control('live-start');const liveStartAt=Date.now();await call('live',{enabled:true});live=true;control('live');
    await page.waitForFunction(()=>Number(document.querySelector('.live-canvas')?.dataset.frames)>0,null,{timeout:6500});
    const first=await page.locator('.live-canvas').evaluate(canvas=>({at:Date.now(),width:canvas.width,height:canvas.height,frames:Number(canvas.dataset.frames)}));assert(first.width>0&&first.height>0,'H2_JPEG_CANVAS_DIMENSIONS');
    const toggle=page.locator('.live-histogram-widget button');if(await toggle.getAttribute('aria-pressed')!=='true')await toggle.click();
    await page.waitForFunction(()=>document.querySelectorAll('.live-histogram-widget svg path').length===4,null,{timeout:4500});
    const samples=[];for(let n=0;n<10;n++){await wait(500);samples.push(await page.locator('.live-canvas').evaluate(canvas=>({at:Date.now(),frames:Number(canvas.dataset.frames),fps:canvas.dataset.fps,width:canvas.width,height:canvas.height})));}
    result.live={liveStartAt,first,samples,frames:await page.evaluate(()=>window.__h2Frames),histogram:{paths:await page.locator('.live-histogram-widget svg path').count(),implementation:'existing software JPEG RGB histogram; source interval 250 ms'},transportLatencyKind:'worker timestamp to renderer frame arrival; excludes optical/exposure latency'};
    await toggle.click();assert(await toggle.getAttribute('aria-pressed')==='false','H2_HISTOGRAM_OFF_FAILED');result.live.histogram.off=true;
    await page.screenshot({path:path.join(output,'h2-live-view.png')});
    control('live-stop');await call('live',{enabled:false});live=false;result.afterLive=(await state()).camera;result.afterLiveRaw=scalarSnapshot();
    assert(!result.afterLive.live&&[0x500,0x501,0xb].every(id=>result.afterLiveRaw[id]===result.initialRaw[id]),'H2_EVF_RESTORATION_FAILED');
    assert(propertiesRestored(initial,await state()),'H2_STATE_CHANGED_BEFORE_AF');
    // One AF pulse and one small step each direction; never a shutter/viewfinder fallback.
    if(![0,1,2].includes(initial.camera.properties.afMode?.value)||initial.camera.equipment?.lensAttached!==true){result.af={status:'SKIPPED_LENS_OR_MODE'};}
    else{
      control('live-start');await call('live',{enabled:true});live=true;control('live');
      await page.waitForFunction(()=>Number(document.querySelector('.live-canvas')?.dataset.frames)>0,null,{timeout:6500});
      const beforeAf=scalarSnapshot();assert((beforeAf[0x500]&2)!==0&&beforeAf[0x501]===1,'H2_CURRENT_LIVE_READBACK_REQUIRED');
      control('af');result.af=await call('autofocus',{preview:false});assert(result.af?.confirmed===false&&result.af?.status==='unverified','H2_UNQUALIFIED_FOCUS_CONFIRMATION');
      for(const direction of ['near','far']){control('lens',{direction});const value=await call('focus',{direction,step:1});result.lens.push({direction,result:value,meaning:'SDK command acceptance; no optical focus proof'});}
      control('live-stop');await call('live',{enabled:false});live=false;
    }
    const final=await state();result.final=final.camera;result.finalRaw=scalarSnapshot();assert(propertiesRestored(initial,final)&&[0x500,0x501,0xb].every(id=>result.finalRaw[id]===result.initialRaw[id]),'H2_FINAL_RESTORATION_FAILED');
    control('cleanup');await call('disconnect');result.disconnected=(await state()).camera;assert(!result.disconnected.connected,'H2_DISCONNECT_FAILED');
    await page.evaluate(()=>window.__h2Off?.());result.completed=true;return result;
  }catch(error){
    result.error=String(error.stack||error);known=!/UNKNOWN|NATIVE_STOP|NATIVE_DENIED|closed|crash|restoration/i.test(error.message)&&!fs.existsSync(path.join(output,'native-denial.json'));
    result.restoration={attempted:false,knownFailure:known};
    if(known){try{if(activeWrite){control('restore',{write:{id:activeWrite.id,value:activeWrite.value}});const restored=await call('property',{key:activeWrite.key,value:activeWrite.value});assert(restored.properties[activeWrite.key]?.value===activeWrite.value,'RESTORE_FAILED');result.restoration.exposureRestored=true;}if(live){control('live-stop');await call('live',{enabled:false});}result.restoration.attempted=true;control('cleanup');await call('disconnect');}catch(cleanupError){result.restoration.error=String(cleanupError.message);}}
    return result;
  }
}
module.exports={runStages};
