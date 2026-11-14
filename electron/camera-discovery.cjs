const crypto=require('node:crypto');
const IMPORT_ONLY=new Set(['EOS M','EOS M2','EOS M3','EOS M5','EOS M6','EOS M10','EOS M100']);
function text(value){return (typeof value==='string'?value:Buffer.from(value||[]).toString('utf8')).replace(/\0.*$/s,'').trim();}
function describeCamera(info,index){
  const model=text(info.description)||'Canon',port=text(info.port);
  return {id:crypto.createHash('sha256').update(port||`${model}:${index}`).digest('hex').slice(0,20),index,model};
}
function modelCapabilities(model,hasLiveView){
  const normalized=String(model).replace(/^Canon\s+/i,'').trim().toUpperCase();
  const importOnly=IMPORT_ONLY.has(normalized);
  return {capture:!importOnly,liveView:!importOnly&&hasLiveView,focus:!importOnly,manualFocus:!importOnly&&hasLiveView,import:true,reason:importOnly?'Эта модель поддерживает импорт через EDSDK, но не дистанционную съёмку.':null};
}
function selectCamera(items,id){
  if(id){const found=items.find(c=>c.id===id);if(!found)throw Error('Выбранная камера не найдена. Обновите список устройств.');return found;}
  if(items.length===1)return items[0];
  if(items.length>1)throw Error('Обнаружено несколько камер. Выберите устройство в списке.');
  return null;
}
module.exports={describeCamera,modelCapabilities,selectCamera};
