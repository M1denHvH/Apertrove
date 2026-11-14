// A held shutter is always released on pointer-up, failure, shutdown or timeout.
function holdShutter(io,milliseconds){
  if(!Number.isFinite(milliseconds)||milliseconds<100||milliseconds>5000)throw Error('Burst duration must be between 100 and 5000 ms.');
  let ended=false,timer;const now=io.now||Date.now,start=now();
  try{io.press();}catch(error){try{io.release();}catch{}io.onReleased?.();throw error;}
  const release=()=>{if(ended)return;ended=true;(io.clearTimer||clearTimeout)(timer);try{io.release();}finally{io.onReleased?.();}};
  timer=(io.setTimer||setTimeout)(()=>{try{release();}catch(error){io.onError?.(error);}},Math.max(0,milliseconds-(now()-start)));
  return {release,isHolding:()=>!ended};
}
module.exports={holdShutter};
