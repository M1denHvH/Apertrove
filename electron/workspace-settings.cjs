const PANELS=['camera','exposure','focus','histogram','presets'];
const SAFE_PRESETS={off:{top:0,bottom:0,left:0,right:0},reels:{top:14,bottom:35,left:6,right:6},stories:{top:14,bottom:20,left:6,right:6},tiktok:{top:12,bottom:25,left:6,right:18},shorts:{top:10,bottom:22,left:6,right:16},custom:{top:10,bottom:15,left:5,right:5}};
const clamp=(value,min,max,fallback)=>Number.isFinite(Number(value))?Math.max(min,Math.min(max,Number(value))):fallback;
function composition(input={},legacyGrid=false){
  const grid=['off','thirds','golden','diagonals'].includes(input.grid)?input.grid:legacyGrid?'thirds':'off';
  const safe=Object.hasOwn(SAFE_PRESETS,input.safe)?input.safe:'off';
  let ratio=['none','1:1','4:5','9:16'].includes(input.ratio)?input.ratio:'none';if(safe!=='off'&&ratio==='none')ratio='9:16';
  const margins={};for(const side of ['top','bottom','left','right'])margins[side]=clamp(input.margins?.[side],0,45,SAFE_PRESETS[safe][side]);
  return {grid,ratio,safe,margins,opacity:clamp(input.opacity,.15,1,.75),color:/^#[0-9a-f]{6}$/i.test(input.color||'')?input.color:'#ffffff',labels:input.labels!==false};
}
function workspace(input={}){
  const panels={};for(const key of [...PANELS,'preview','filmstrip'])panels[key]=typeof input.panels?.[key]==='boolean'?input.panels[key]:true;
  const order=[...new Set((Array.isArray(input.order)?input.order:[]).filter(key=>PANELS.includes(key)))];for(const key of PANELS)if(!order.includes(key))order.push(key);
  return {panels,order,inspectorWidth:clamp(input.inspectorWidth,270,600,340),inspectorHeight:input.inspectorHeight?clamp(input.inspectorHeight,260,1400,0):0};
}
module.exports={PANELS,SAFE_PRESETS,composition,workspace};
