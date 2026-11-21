// No mechanical flash-popup command is qualified for the installed Canon SDK.
// FlashOn describes a captured image; Flash_Firing controls firing settings.
// Neither establishes a supported mechanism for raising a built-in flash.
const REASON='FLASH_POPUP_PROTOCOL_UNQUALIFIED';
const unavailable=()=>({available:false,canAttempt:false,accepted:false,raised:null,reason:REASON,error:'Подъём встроенной вспышки недоступен: команда для этой камеры и версии SDK не квалифицирована.'});
function createFlashBridge(){
  return {probe:async()=>unavailable(),cached:async()=>unavailable(),popup:async()=>{const error=Error(unavailable().error);error.code=REASON;throw error;}};
}
function flashAvailability(){return unavailable();}
async function withFlashConnection(){const error=Error(unavailable().error);error.code=REASON;throw error;}
module.exports={createFlashBridge,withFlashConnection,flashAvailability};
