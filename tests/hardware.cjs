// Explicit hardware check: no shutter release. Exposure is always restored.
const {fork}=require('node:child_process');
const fs=require('node:fs/promises');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const child=fork(path.join(root,'electron/camera-worker.cjs'),[],{stdio:['ignore','pipe','pipe','ipc']});
let seq=0,frames=0,state,readyResolve;
const pending=new Map(),ready=new Promise(r=>readyResolve=r);
const report={time:new Date().toISOString(),connected:false,checks:[],restoration:[],errors:[],shutterReleased:false};
child.stdout.on('data',d=>process.stdout.write(d));child.stderr.on('data',d=>process.stderr.write(d));
child.on('message',m=>{
  if(m.event==='ready')readyResolve();
  if(m.event==='frame')frames++;
  if(m.event==='status')state=m.data;
  if(m.event==='log'&&m.data.level==='error')console.log('CAMERA',m.data.message);
  if(m.id){const p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error)):p.resolve(m.result);}}
});
child.on('exit',code=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error(`Camera worker exited (${code})`));}pending.clear();});
function call(method,args={}){const id=++seq;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error(`Timeout: ${method}`));},15000);pending.set(id,{resolve,reject,timer});child.send({id,method,args});});}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const pass=(name,details)=>{report.checks.push({name,details});console.log('PASS',name,JSON.stringify(details||{}));};
(async()=>{await fs.mkdir(path.join(root,'qa'),{recursive:true});
  await ready;
  try{
    const until=Date.now()+60000;let attempt=0;
    do{attempt++;try{state=await call('connect',{folder:path.join(root,'qa/captures')});}catch(e){report.lastConnectionError=e.message;}if(state?.connected)break;if(attempt===1||attempt%5===0)console.log('Waiting for USB camera...',attempt);await wait(2000);}while(Date.now()<until);
    if(!state?.connected){report.errors.push(report.lastConnectionError||state?.error||'Camera not detected');return;}
    report.connected=true;report.model=state.model;report.mode=state.mode;report.sdkPath=state.sdkPath;
    report.originalValues=Object.fromEntries(Object.entries(state.properties).map(([k,p])=>[k,p.value]));
    pass('Camera session opened',{model:state.model,mode:state.mode,battery:state.battery});
    for(const key of ['shutter','aperture','iso','compensation','whiteBalance','pictureStyle']){
      state=await call('status');const p=state.properties[key],original=p?.value;
      const alternatives=(p?.allowed||[]).filter(v=>v!==original&&v!==0xffffffff);
      if(!p?.writable||!alternatives.length){report.checks.push({name:key,status:'not-writable',mode:state.mode});console.log('UNAVAILABLE',key,'mode',state.mode);continue;}
      const index=p.allowed.indexOf(original),candidate=p.allowed[index+1]??alternatives.at(-1);let attempted=false;
      try{attempted=true;const changed=await call('property',{key,value:candidate});if(changed.properties[key].value!==candidate)throw Error('Read-back mismatch');pass(`Read/write ${key}`,{original,temporary:candidate});}
      catch(e){report.errors.push(`${key}: ${e.message}`);console.log('FAIL',key,e.message);}
      finally{
        if(attempted){try{await call('property',{key,value:original});const restored=await call('status');if(restored.properties[key].value!==original)throw Error('Restore read-back mismatch');report.restoration.push({key,value:original,restored:true});console.log('RESTORED',key,original);}catch(e){report.restoration.push({key,value:original,restored:false,error:e.message});report.errors.push(`RESTORE ${key}: ${e.message}`);console.log('RESTORE FAILED',key,e.message);}}
      }
    }
    try{
      await call('live',{enabled:true});const end=Date.now()+6000;while(!frames&&Date.now()<end)await wait(150);
      if(!frames)throw Error('No Live View frames were delivered');pass('Live View frames received',{frames});
      for(const direction of ['near','far']){await call('focus',{direction,step:1});pass(`Manual focus ${direction} command accepted`);await wait(250);}
      await call('autofocus');pass('Live View autofocus command accepted');
    }catch(e){report.errors.push(`Live View / focus: ${e.message}`);console.log('FAIL Live View / focus',e.message);}
    finally{try{if(state?.connected)await call('live',{enabled:false});}catch{}}
  }finally{
    await fs.writeFile(path.join(root,'qa/Apertrove-camera-report.json'),JSON.stringify(report,null,2));
    try{await call('shutdown');}catch{}child.kill();console.log('HARDWARE REPORT',JSON.stringify(report));
  }
})().catch(e=>{console.error(e);child.kill();process.exitCode=1;});
