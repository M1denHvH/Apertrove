import { t } from "./i18n.js";
import React,{useEffect,useRef,useState} from 'react';
import EosIcon from './EosIcon';
export default function ExposureCompensation({property,disabled,onChange}){
  const values=[...(property?.choices||[])].sort((a,b)=>((a.value>127?a.value-256:a.value)-(b.value>127?b.value-256:b.value)));
  const current=Math.max(0,values.findIndex(item=>item.value===property?.value));
  const [position,setPosition]=useState(current),sent=useRef(null);
  useEffect(()=>{setPosition(current);sent.current=null;},[current,property?.value]);
  const commit=()=>{const next=values[position];if(next&&next.value!==property?.value&&next.value!==sent.current){sent.current=next.value;Promise.resolve(onChange(next.value)).finally(()=>{sent.current=null;});}};
  return <div className="compensation-control"><div><span><EosIcon kind="compensation" size={15}/>{t("exposureCompensation.exposure_compensation")}</span><output>{values[position]?.label||'—'} <small>EV</small></output></div><input type="range" aria-label={t("exposureCompensation.exposure_compensation")} aria-valuetext={values[position]?.label||t("exposureCompensation.unavailable")} min="0" max={Math.max(1,values.length-1)} step="1" value={position} disabled={disabled||!property?.writable||values.length<2} onChange={event=>setPosition(Number(event.target.value))} onPointerUp={commit} onKeyUp={event=>{if(['ArrowLeft','ArrowRight','Home','End','PageUp','PageDown'].includes(event.key))commit();}} onBlur={commit}/><div className="compensation-scale"><span>{values[0]?.label||'−'}</span><span>0</span><span>{values.at(-1)?.label||'+'}</span></div></div>;
}
