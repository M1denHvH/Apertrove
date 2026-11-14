const {execFile}=require('node:child_process');
const path=require('node:path');
function createFlashBridge(run=execFile){
  const support=new Map();
  async function invoke(model,probe){
    if(typeof model!=='string'||!model.trim()||model.length>160)throw Error('Сначала подключите камеру.');
    const script=path.join(__dirname.replace(/app\.asar(?=[\\/])/,'app.asar.unpacked'),'flash-wia.ps1');
    const args=['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-Model',model,...(probe?['-Probe']:[])];
    return new Promise((resolve,reject)=>run('powershell.exe',args,{windowsHide:true,timeout:12000,maxBuffer:65536,encoding:'utf8'},(error,stdout,stderr)=>{
      if(error)return reject(Error(`Не удалось ${probe?'проверить':'поднять'} встроенную вспышку. ${String(stderr||error.message).replace(/\s+/g,' ').trim().slice(0,450)}`));
      try{const data=JSON.parse(stdout.trim());if(typeof data.available!=='boolean')throw Error('Неверный ответ WIA.');resolve(data);}catch(error){reject(error);}
    }));
  }
  async function probe(model,{force=false}={}){
    if(force)support.delete(model);
    if(!support.has(model)){
      const pending=invoke(model,true).catch(error=>({available:false,error:error.message}));
      support.set(model,pending);
      pending.then(result=>{if(!result.available&&support.get(model)===pending)support.delete(model);});
    }
    return support.get(model);
  }
  async function popup(model){const result=await invoke(model,false);if(result.available)support.set(model,Promise.resolve(result));return result;}
  return {probe,cached:model=>support.get(model)||Promise.resolve({available:null,canAttempt:true}),popup};
}
function flashAvailability(camera,detection={}){
  if(!camera.connected)return {available:false,canAttempt:false};
  if(camera.capabilities?.capture===false)return {available:false,canAttempt:false};
  // Canon Basic Zone modes control the built-in flash automatically. Unknown
  // modes are left to the camera rather than being incorrectly ruled out.
  const basic=['Auto','9','10','11','12','13','14','15','16','17','18','19','20','21','22'].includes(String(camera.mode));
  if(basic)return {available:false,canAttempt:false,error:'Подъём вспышки доступен в P, Tv, Av, M или Bulb.'};
  return detection.available?{available:true,canAttempt:true}:{available:null,canAttempt:true};
}
async function withFlashConnection(io,wasLive){
  let result,error;
  try{await io.disconnect();result=await io.popup();}catch(cause){error=cause;}
  try{await io.reconnect();if(wasLive)await io.restoreLive();}catch(cause){throw Error(`${error?error.message+' ':''}Не удалось восстановить соединение после вспышки: ${cause.message}`);}
  if(error)throw error;return result;
}
module.exports={createFlashBridge,withFlashConnection,flashAvailability};
