const {resolveValue}=require('./camera-values.cjs');
const LABELS={iso:'ISO',shutter:'Выдержка',aperture:'Диафрагма',whiteBalance:'Баланс белого',compensation:'Экспокоррекция',pictureStyle:'Picture Style',afMode:'Режим AF',liveAfMode:'Метод Live View'};
function prepareSeries(ids,presets,camera){
  if(!Array.isArray(ids)||ids.length<1||ids.length>100)throw Error('Добавьте от 1 до 100 пресетов в очередь.');
  if(!camera.connected)throw Error('Сначала подключите камеру.');
  const original={},setup={};const drive=camera.properties.driveMode;
  if(drive&&drive.value!==0){if(!drive.writable||!drive.allowed?.includes(0))throw Error('Для очереди пресетов камера должна поддерживать одиночный режим съёмки.');setup.driveMode=0;original.driveMode=drive.value;}
  const steps=ids.map(id=>{
    const preset=presets.find(p=>p.id===id);if(!preset)throw Error('Пресет из очереди удалён. Обновите очередь.');
    const values={};
    for(const [key,value] of Object.entries(preset.values)){
      if(key==='driveMode'&&value!==0)throw Error('В очереди пресетов разрешён одиночный режим: один кадр на шаг.');
      const property=camera.properties[key],target=resolveValue(key,value,property?.allowed||[]);
      if(!property?.writable||target===undefined||!Number.isInteger(property.value))throw Error(`«${preset.name}»: ${LABELS[key]||key} недоступна в текущем режиме камеры. Исправьте пресет до запуска серии.`);
      values[key]=target;original[key]=property.value;
    }
    if(!Object.keys(values).length)throw Error(`В пресете «${preset.name}» нет параметров.`);
    return {presetId:preset.id,name:preset.name,values};
  });
  return {steps,original,setup};
}
async function runSeries(plan,io,job){
  const restoreErrors=[];let failure,unconfirmed=false;
  try{
    for(const [key,value] of Object.entries(plan.setup||{}))await io.property({key,value});
    for(let index=0;index<plan.steps.length;index++){
      if(job.cancelled)break;
      const step=plan.steps[index];job.index=index;job.current=step.name;job.phase='applying';io.progress({...job});
      for(const [key,value] of Object.entries(step.values)){if(job.cancelled)break;await io.property({key,value});}
      if(job.cancelled)break;
      job.phase='capturing';io.progress({...job});const receipt=await io.capture({seriesId:job.id,presetId:step.presetId,presetName:step.name,index,total:plan.steps.length,startedAt:job.startedAt});
      job.requested=(job.requested||0)+1;
      if(receipt?.confirmation==='CONFIRMED')job.done++;else{unconfirmed=true;job.confirmation='UNVERIFIED';job.observedTransfers=(job.observedTransfers||0)+(receipt?.observedTransfers||0);}
      io.progress({...job});await io.waitImports?.();
    }
  }catch(error){failure=error;}
  finally{
    job.phase='restoring';io.progress({...job});
    for(const [key,value] of Object.entries(plan.original))try{await io.property({key,value});}catch(error){restoreErrors.push(`${LABELS[key]||key}: ${error.message}`);}
    job.phase='done';job.restoreErrors=restoreErrors;job.status=failure||restoreErrors.length?'failed':job.cancelled?'cancelled':unconfirmed?'unconfirmed':'completed';
    job.error=failure?.message||(restoreErrors.length?'Не все исходные настройки удалось восстановить.':null);io.progress({...job});
  }
  return job;
}
module.exports={prepareSeries,runSeries};
