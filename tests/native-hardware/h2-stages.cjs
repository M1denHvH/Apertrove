'use strict';
// Drives only the real preload APIs; all persistence belongs to the isolated synthetic profile.
const fs=require('node:fs'),path=require('node:path');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const comparedIds=[0x402,0x406,0x405,0x106,0x403,0x404,0x50e,0x400,0xb,0x500,0x501];
function postStopEvidence(rows,initial){
  const reads={},writes={};rows.forEach((row,sequence)=>{if(row.phase!=='after'||row.result!==0)return;if(row.name==='EdsGetPropertyData'&&row.outputs?.[4]?.uint32!==undefined)reads[row.outputs[1]]={value:row.outputs[4].uint32,atUtc:row.atUtc,sequence};if(row.name==='EdsSetPropertyData'&&[0x500,0x501].includes(row.outputs?.[1]))writes[row.outputs[1]]={value:row.outputs[4]?.uint32,atUtc:row.atUtc,sequence};});
  const restored=[0x500,0x501].every(id=>writes[id]?.value===initial[id]),afterSequence=Math.max(...[0x500,0x501].map(id=>writes[id]?.sequence??Infinity));
  const failures=comparedIds.filter(id=>Number.isInteger(initial[id])&&(!reads[id]||reads[id].sequence<=afterSequence||reads[id].value!==initial[id]));
  return {confirmed:restored&&failures.length===0,restorationAcks:writes,afterSequence,reads:Object.fromEntries(comparedIds.map(id=>[id,reads[id]??null])),failures};
}
async function runStages({app,page,output,nonce,controlPath,record,stageScope='FULL'}){
  if(!['FULL','FOCUS_ONLY'].includes(stageScope))throw Error('H2_STAGE_SCOPE_INVALID');
  let ticket=0,activeWrite=null,known=true,live=false;const exposure=[],result={stageScope,exposure,live:null,af:null,lens:[]};
  const control=(phase,extra={})=>{const next=controlPath+'.next';fs.writeFileSync(next,JSON.stringify({nonce,ticket:++ticket,phase,...extra}));fs.renameSync(next,controlPath);};
  const call=async(method,args)=>{if(fs.existsSync(path.join(output,'native-denial.json')))throw Error('H2_NATIVE_STOP_RECORDED');try{const value=await page.evaluate(async({method,args})=>window.focal[method](args),{method,args});record({method,args,result:value});return value;}catch(error){record({method,args,error:String(error.message)});throw error;}};
  const state=()=>call('boot');
  const assert=(value,message)=>{if(!value)throw Error(message);};
  const traceRows=()=>fs.readFileSync(path.join(output,'native-trace.jsonl'),'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const scalarSnapshot=()=>{const values={};for(const row of traceRows())if(row.name==='EdsGetPropertyData'&&row.phase==='after'&&row.result===0&&row.outputs?.[4]?.uint32!==undefined)values[row.outputs[1]]=row.outputs[4].uint32;return values;};
  const propertiesRestored=(a,b)=>['iso','shutter','aperture','whiteBalance','meteringMode','afMode','liveAfMode'].every(key=>a.camera.properties[key]?.value===b.camera.properties[key]?.value)&&a.camera.mode===b.camera.mode;
  const settleReadback=async initial=>{
    const start=Date.now(),samples=[];let snapshot=await state(),evidence=postStopEvidence(traceRows(),result.initialRaw);
    const matched=()=>evidence.confirmed&&propertiesRestored(initial,snapshot);
    samples.push({at:Date.now(),confirmed:matched(),failures:evidence.failures});
    while(!matched()&&Date.now()-start<1000){
      await wait(Math.min(100,1000-(Date.now()-start)));if(Date.now()-start>=1000)break;
      // The controls-only disabled path performs fresh reads with no EVF writes or releases.
      let timer;try{await Promise.race([call('live',{enabled:false}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('UNKNOWN_POST_STOP_READBACK_DEADLINE')),Math.max(1,1000-(Date.now()-start)));})]);}finally{clearTimeout(timer);}
      snapshot=await state();evidence=postStopEvidence(traceRows(),result.initialRaw);samples.push({at:Date.now(),confirmed:matched(),failures:evidence.failures});
    }
    return {snapshot,evidence:{...evidence,confirmed:matched(),settlementMs:Date.now()-start,samples,policy:'One EVF stop; at most 1000 ms of subsequent read-only refresh; unchanged baseline'}};
  };
  try{
    control('snapshot');const connected=await call('cameraWorking',{controlsOnly:true});
    assert(connected.connected&&connected.working&&connected.controlsOnly&&connected.saveTo===null&&connected.capabilities.capture===false&&connected.eventsRegistered===false,'H2_CONTROLS_ONLY_INVARIANT');
    const initial=await state();result.initial=initial.camera;result.initialRaw=scalarSnapshot();
    assert(initial.camera.model==='Canon EOS 2000D','H2_EXACT_CAMERA_MODEL_REQUIRED');
    // SaveTo and both EVF scalars must be freshly observed before any camera mutation.
    assert([0xb,0x500,0x501].every(id=>Number.isInteger(result.initialRaw[id])),'H2_FRESH_EVF_SAVETO_SNAPSHOT_REQUIRED');
    if(stageScope==='FULL')for(const [key,id]of [['iso',0x402],['shutter',0x406],['aperture',0x405]]){
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
    if(stageScope==='FULL'){
    control('live-start');const liveStartAt=Date.now();await call('live',{enabled:true});live=true;control('live');
    await page.waitForFunction(()=>Number(document.querySelector('.live-canvas')?.dataset.frames)>0,null,{timeout:6500});
    const first=await page.locator('.live-canvas').evaluate(canvas=>({at:Date.now(),width:canvas.width,height:canvas.height,frames:Number(canvas.dataset.frames)}));assert(first.width>0&&first.height>0,'H2_JPEG_CANVAS_DIMENSIONS');
    const toggle=page.locator('.live-histogram-widget button');if(await toggle.getAttribute('aria-pressed')!=='true')await toggle.click();
    await page.waitForFunction(()=>document.querySelectorAll('.live-histogram-widget svg path').length===4,null,{timeout:4500});
    const samples=[];for(let n=0;n<10;n++){await wait(500);samples.push(await page.locator('.live-canvas').evaluate(canvas=>({at:Date.now(),frames:Number(canvas.dataset.frames),fps:canvas.dataset.fps,width:canvas.width,height:canvas.height})));}
    result.live={liveStartAt,first,samples,frames:await page.evaluate(()=>window.__h2Frames),histogram:{paths:await page.locator('.live-histogram-widget svg path').count(),implementation:'existing software JPEG RGB histogram; source interval 250 ms'},transportLatencyKind:'worker timestamp to renderer frame arrival; excludes optical/exposure latency'};
    await toggle.click();assert(await toggle.getAttribute('aria-pressed')==='false','H2_HISTOGRAM_OFF_FAILED');result.live.histogram.off=true;
    await page.screenshot({path:path.join(output,'h2-live-view.png')});
    control('live-stop');await call('live',{enabled:false});live=false;const afterLive=await settleReadback(initial);result.afterLive=afterLive.snapshot.camera;result.afterLiveRaw=scalarSnapshot();
    result.afterLiveReadback=afterLive.evidence;assert(result.afterLiveReadback.confirmed,'H2_POST_STOP_FRESH_READBACK_REQUIRED');
    assert(!result.afterLive.live&&[0x500,0x501,0xb].every(id=>result.afterLiveRaw[id]===result.initialRaw[id]),'H2_EVF_RESTORATION_FAILED');
    assert(propertiesRestored(initial,await state()),'H2_STATE_CHANGED_BEFORE_AF');
    }else result.skipped={exposure:'Previously verified A retained in pinned original receipt; no exposure writes admitted',liveMeasurement:'Previously verified B retained; no repeat five-second measurement'};
    // One AF pulse and one small step each direction; never a shutter/viewfinder fallback.
    if(![0,1,2].includes(initial.camera.properties.afMode?.value)||initial.camera.equipment?.lensAttached!==true){result.af={status:'SKIPPED_LENS_OR_MODE'};}
    else{
      control('live-start');await call('live',{enabled:true});live=true;control('live');
      await page.waitForFunction(()=>Number(document.querySelector('.live-canvas')?.dataset.frames)>0,null,{timeout:6500});
      result.focusPreview=await page.locator('.live-canvas').evaluate(canvas=>({at:Date.now(),width:canvas.width,height:canvas.height,decodedFrames:Number(canvas.dataset.frames)}));
      assert(result.focusPreview.width>0&&result.focusPreview.height>0&&result.focusPreview.decodedFrames>0,'H2_FOCUS_FRESH_DECODED_FRAME_REQUIRED');
      const beforeAf=scalarSnapshot();assert((beforeAf[0x500]&2)!==0&&beforeAf[0x501]===1,'H2_CURRENT_LIVE_READBACK_REQUIRED');
      control('af');result.af=await call('autofocus',{preview:false});assert(result.af?.confirmed===false&&result.af?.status==='unverified','H2_UNQUALIFIED_FOCUS_CONFIRMATION');
      for(const direction of ['near','far']){control('lens',{direction});const value=await call('focus',{direction,step:1});result.lens.push({direction,result:value,meaning:'SDK command acceptance; no optical focus proof'});}
      control('live-stop');await call('live',{enabled:false});live=false;
    }
    const settled=await settleReadback(initial),final=settled.snapshot;result.final=final.camera;result.finalRaw=scalarSnapshot();assert(propertiesRestored(initial,final)&&[0x500,0x501,0xb].every(id=>result.finalRaw[id]===result.initialRaw[id]),'H2_FINAL_RESTORATION_FAILED');
    result.finalReadback=settled.evidence;assert(result.finalReadback.confirmed,'H2_FINAL_FRESH_READBACK_REQUIRED');
    control('cleanup');await call('disconnect');result.disconnected=(await state()).camera;assert(!result.disconnected.connected,'H2_DISCONNECT_FAILED');
    await page.evaluate(()=>window.__h2Off?.());result.completed=true;return result;
  }catch(error){
    result.error=String(error.stack||error);known=!/UNKNOWN|NATIVE_STOP|NATIVE_DENIED|closed|crash|restoration/i.test(error.message)&&!fs.existsSync(path.join(output,'native-denial.json'));
    result.restoration={attempted:false,knownFailure:known};
    if(known){try{if(activeWrite){control('restore',{write:{id:activeWrite.id,value:activeWrite.value}});const restored=await call('property',{key:activeWrite.key,value:activeWrite.value});assert(restored.properties[activeWrite.key]?.value===activeWrite.value,'RESTORE_FAILED');result.restoration.exposureRestored=true;}if(live){control('live-stop');await call('live',{enabled:false});}result.restoration.attempted=true;control('cleanup');await call('disconnect');}catch(cleanupError){result.restoration.error=String(cleanupError.message);}}
    return result;
  }
}
module.exports={runStages,postStopEvidence};
