// Camera commands are deliberately separate from the transport so the actual SDK
// command IDs, capability checks and read-back behaviour can be verified without USB.
const {PROPS,WHITE_BALANCE_COLOR_TEMPERATURE,valueLabel,resolveValue}=require('./camera-values.cjs');
const {createServoFocus}=require('./servo-focus.cjs');
const COMMANDS=Object.freeze({autofocus:0x102,driveLens:0x103,shutter:4});
const LABELS={meteringMode:'Замер экспозиции',imageQuality:"Формат снимка",driveMode:'Режим съёмки',afMode:'Режим AF',liveAfMode:'Метод Live View',iso:'ISO',aperture:'Диафрагма',shutter:'Выдержка',compensation:'Экспокоррекция',whiteBalance:'Баланс белого',colorTemperature:'Цветовая температура',pictureStyle:'Picture Style'};
function createCameraControl(io){
  const wait=io.wait||((ms)=>new Promise(resolve=>setTimeout(resolve,ms)));
  let active=false,autofocusing=false;
  const servoControl=createServoFocus({...io,isBusy:()=>active,onState:io.onServo,onUnknown:io.onServoUnknown});
  async function setFocusMode(value){
    let last;
    for(const pause of [0,100,180,300,450,600]){if(pause)await wait(pause);io.ensure();try{io.set(PROPS.afMode,value);if(io.get(PROPS.afMode)===value)return;}catch(error){last=error;if(error.code!==0x81)throw error;}}
    throw last||Error('Камера не подтвердила режим AF.');
  }
  async function exclusive(fn){
    io.ensure();if(io.isCapturing()||active||servoControl.isBusy()||servoControl.isHeld())throw Error('Дождитесь завершения текущей команды камеры.');
    active=true;try{return await fn();}finally{active=false;}
  }
  async function property({key,value}){
    servoControl.stop();
    return exclusive(async()=>{
      if(!Object.hasOwn(PROPS,key)||!Number.isInteger(value)||value<0||value>0xffffffff)throw Error('Некорректный параметр камеры.');
      if(key==='shutter'&&value===0x0c&&io.canBulb?.()!==true)throw Error('BULB недоступен: протокол этой камеры и версии SDK не квалифицирован.');
      const properties=io.refresh().properties,p=properties[key];
      const target=resolveValue(key,value,p?.allowed||[]);
      const colorTemperature=key==='colorTemperature';
      const kelvinMode=()=>io.get(PROPS.whiteBalance)===WHITE_BALANCE_COLOR_TEMPERATURE;
      if(!p?.writable||target===undefined||colorTemperature&&
        (properties.whiteBalance?.value!==WHITE_BALANCE_COLOR_TEMPERATURE||!kelvinMode()))
        throw Error(`Параметр «${LABELS[key]}» недоступен в текущем режиме камеры. Проверьте режим камеры и объектив.`);
      io.set(PROPS[key],target);
      for(const pause of [0,80,160,300,500,800]){
        if(pause)await wait(pause);io.ensure();
        if((!colorTemperature||kelvinMode())&&io.get(PROPS[key])===target){
          const label=valueLabel(key,target)||`0x${target.toString(16)}`;
          io.log?.('success',`${LABELS[key]}: ${label} — подтверждено камерой.`);
          return io.refresh();
        }
      }
      io.refresh();throw Error(`Камера не подтвердила новое значение «${LABELS[key]}». Проверьте режим съёмки и повторите.`);
    });
  }
  async function focus({direction,step=1}){
    return exclusive(async()=>{
      if(io.canFocus?.()===false)throw Error('Объектив в MF. Переведите его переключатель в AF для электронного управления.');
      if(io.requiresLiveFocus?.()&&!io.isLive())throw Error('Для управления фокусом включите Live View.');
      if(!['near','far'].includes(direction)||!Number.isInteger(step)||step<1||step>3)throw Error('Выберите направление и шаг фокусировки от 1 до 3.');
      const drive=()=>io.command(COMMANDS.driveLens,(direction==='far'?0x8000:0)|step,'Доводка фокуса. Проверьте AF на объективе');
      if(!io.isLive()){if(!io.previewFocus)throw Error('Для управления фокусом включите Live View.');await io.previewFocus(drive);}else drive();
      return {direction,step};
    });
  }
  async function autofocus({preview=true}={}){
    return exclusive(async()=>{
      if(typeof preview!=='boolean')throw Error('Некорректная настройка превью AF.');
      if(io.canFocus?.()===false)throw Error('Объектив в MF. Переведите его переключатель в AF.');
      if(io.requiresLiveFocus?.()&&!io.isLive())throw Error('Для автофокуса включите Live View.');
      const native=!io.isLive(),originalAF=native?io.get(PROPS.afMode):undefined;
      let changedAF=false,started=false,result,confirmedSample;
      const now=io.now||Date.now,start=now(),timeout=12000;
      let previousSequence=io.focusState?.()?.sequence,successes=0,failures=0;
      autofocusing=true;io.onAutofocus?.({status:'focusing'});
      try{
        // A separate AF request must reach a lock even if the dial is AI Servo.
        // Restore the user's AF mode after releasing the half-press.
        if(native&&[1,2].includes(originalAF)&&io.refresh().properties.afMode?.allowed?.includes(0)){changedAF=true;await setFocusMode(0);await wait(100);}
        // A binding exception can occur after native dispatch; the owed stop
        // must still be attempted once, without treating the ON as confirmed.
        started=true;io.command(native?COMMANDS.shutter:COMMANDS.autofocus,1,'Запуск автофокуса');
        if(io.focusConfirmationAvailable?.()===false){
          // Control-only validation cannot interpret an unqualified FocusInfo layout.
          // One bounded live-AF pulse records execution, not optical focus success.
          await wait(1000);io.ensure();
          if(!io.isLive())throw Error('Live View остановлен во время автофокуса.');
          result={status:'unverified',confirmed:false,durationMs:now()-start,method:'live',reason:'FOCUS_METADATA_UNQUALIFIED'};
        }
        // Keep AF pressed until fresh EVF metadata confirms focus. The event and
        // frame pumps must keep running while this asynchronous command waits.
        while(!result&&now()-start<timeout){
          await wait(100);io.ensure();
          if(!native&&!io.isLive())throw Error('Live View остановлен во время автофокуса.');
          if(native)io.pollFocus?.();
          const sample=io.focusState?.();
          if(!sample||sample.sequence===previousSequence)continue;
          previousSequence=sample.sequence;
          if(now()-start<700)continue; // Ignore cached focus from a previous AF.
          successes=sample.status==='focused'?successes+1:0;
          failures=sample.status==='failed'?failures+1:0;
          if(successes>=2){confirmedSample=sample;result={status:'focused',confirmed:true,durationMs:now()-start,method:native?'viewfinder':'live'};break;}
          if(failures>=3&&now()-start>=1800)throw Error('Камера не смогла навести резкость. Выберите контрастный объект и проверьте AF на объективе.');
        }
        if(!result)throw Error('За 12 секунд камера не подтвердила фокус. Проверьте AF на объективе, освещение и область фокусировки.');
      }catch(e){io.onAutofocus?.({status:'failed',message:e.message});throw e;
      }finally{
        try{if(started)io.command(native?COMMANDS.shutter:COMMANDS.autofocus,0,'Завершение команды автофокуса');}
        catch(e){io.onAutofocus?.({status:'failed',message:e.message});throw e;}
        finally{try{if(changedAF){await setFocusMode(originalAF);io.refresh();}}catch(error){io.onAutofocus?.({status:'failed',message:error.message});throw error;}finally{autofocusing=false;}}
      }
      if(native&&preview&&io.previewFocus){try{await io.previewFocus(null,confirmedSample);result.previewReceived=true;}catch(error){result.previewError=error.message;io.log?.('error',`Превью AF: ${error.message}`);}finally{if(changedAF){if(io.get(PROPS.afMode)!==originalAF)await setFocusMode(originalAF);io.refresh();}}}
      io.onAutofocus?.(result);io.log?.(result.confirmed?'success':'info',result.confirmed?'Автофокус: резкость подтверждена камерой.':'Команда AF выполнена; попадание в фокус не подтверждено.');return result;
    });
  }
  return {property,focus,autofocus,servo:servoControl.set,stopServo:servoControl.stop,servoDisconnected:servoControl.disconnected,servoConnected:servoControl.connected,servoState:servoControl.snapshot,isServoBusy:servoControl.isBusy,isServoHeld:servoControl.isHeld,releaseAfterCapture:servoControl.releaseAfterCapture,isBusy:()=>active||servoControl.isBusy(),canStream:()=>!active||autofocusing};
}
module.exports={createCameraControl,COMMANDS};
