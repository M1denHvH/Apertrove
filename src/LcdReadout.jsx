import React from 'react';
import '../electron/remote/lcd.js';
export default function LcdReadout({kind,value}){
  const {segments,layout}=globalThis.ApertroveLcd,{width,items}=layout(kind,value);
  return <svg className="lcd-readout" viewBox={`0 0 ${width} 106`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">{items.map((item,index)=>item.type==='dot'?<circle key={index} cx={item.x+5} cy="94" r="6"/>:<g key={index} transform={`translate(${item.x},0)`}>{item.type==='quote'?<path d="M3 3H11V24H3ZM18 3H26V24H18Z"/>:[...item.segments].map(segment=><polygon key={segment} points={segments[segment]}/>)}</g>)}</svg>;
}
