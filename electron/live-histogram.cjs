'use strict';

// Software histogram for already-decoded preview pixels. It deliberately has
// no camera, filesystem, or native dependencies so the renderer can reuse it.
function histogramFromImageData(imageData,{bins=64,step=4}={}){
  const width=Number(imageData?.width),height=Number(imageData?.height);
  const data=imageData?.data;
  if(!Number.isInteger(width)||width<1||!Number.isInteger(height)||height<1||
    !data||typeof data.length!=='number'||!Number.isInteger(bins)||bins<2||bins>256||
    !Number.isInteger(step)||step<1)return null;
  const redCounts=new Array(bins).fill(0),greenCounts=new Array(bins).fill(0),blueCounts=new Array(bins).fill(0);
  let samples=0;
  for(let y=0;y<height;y+=step)for(let x=0;x<width;x+=step){
    const offset=(y*width+x)*4;
    if(offset+2>=data.length)continue;
    if(data[offset+3]===0)continue;
    redCounts[Math.min(bins-1,Math.floor((Number(data[offset])||0)*bins/256))]++;
    greenCounts[Math.min(bins-1,Math.floor((Number(data[offset+1])||0)*bins/256))]++;
    blueCounts[Math.min(bins-1,Math.floor((Number(data[offset+2])||0)*bins/256))]++;
    samples++;
  }
  const maximum=Math.max(1,...redCounts,...greenCounts,...blueCounts);
  return {
    bins,samples,
    red:redCounts.map(value=>value/maximum),
    green:greenCounts.map(value=>value/maximum),
    blue:blueCounts.map(value=>value/maximum),
    redCounts,greenCounts,blueCounts
  };
}

function histogramPath(values,width=260,height=65){
  if(!Array.isArray(values)||values.length<2)return '';
  const base=height-1;
  return values.map((value,index)=>{
    const x=index*(width/(values.length-1));
    const y=base-Math.max(0,Math.min(1,Number(value)||0))*(height-5);
    return (index?'L':'M')+x.toFixed(2)+' '+y.toFixed(2);
  }).join(' ');
}

function createLatestFrameProcessor(processFrame,{onError=()=>{}}={}){
  if(typeof processFrame!=='function')throw TypeError('A frame processor is required.');
  let latest=null,busy=false,stopped=false;
  const pump=async()=>{
    if(stopped||busy||latest===null)return;
    busy=true;const frame=latest;latest=null;
    try{await processFrame(frame);}catch(error){try{onError(error);}catch{}}
    finally{busy=false;if(!stopped&&latest!==null)void pump();}
  };
  return Object.freeze({
    submit(frame){if(stopped)return false;latest=frame;void pump();return true;},
    stop(){stopped=true;latest=null;},
    snapshot(){return {busy,hasLatest:latest!==null,stopped};}
  });
}

module.exports={histogramFromImageData,histogramPath,createLatestFrameProcessor};
