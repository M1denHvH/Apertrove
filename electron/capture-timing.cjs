const {valueLabel}=require('./camera-values.cjs');
function quietPeriod(driveMode,shutter){
  if(driveMode!==7)return 650;
  const label=valueLabel('shutter',shutter)||'',seconds=label.startsWith('1/')?1/Number(label.slice(2)):Number.parseFloat(label);
  // A camera-side timer sequence can have gaps longer than one ordinary transfer.
  // Include an equal-length dark frame for long-exposure noise reduction.
  return Math.max(1800,Number.isFinite(seconds)?seconds*2000+1500:5000);
}
module.exports={quietPeriod};
