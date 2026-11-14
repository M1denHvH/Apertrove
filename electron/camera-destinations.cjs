// EDSDK generic error IDs, as defined by Canon's EDSDKErrors.h.
const isUnsupportedCommand=code=>[0x1,0x7,0x2005].includes(Number(code)&0xffff);
const isUnavailableDestination=code=>isUnsupportedCommand(code)||[0x50,0x60].includes(Number(code)&0xffff);
function configureDestination(set, preferred){
  for(const value of preferred===2?[2]:[3,2]){try{set(0xb,value);return value;}catch(e){if(!isUnavailableDestination(e.code))throw e;}}
  return null;
}
module.exports={isUnsupportedCommand,configureDestination};
