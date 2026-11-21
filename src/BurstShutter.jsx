import { t } from "./i18n.js";
import React,{useState} from 'react';import {Camera,Square} from 'lucide-react';
export default function BurstShutter({job,disabled,onStart,onStop}){
  const [pressed,setPressed]=useState(false);
  const active=job&&['holding','transferring'].includes(job.status);
  const holding=pressed||job?.status==='holding',unconfirmed=job?.status==='unconfirmed'||job?.confirmation==='UNVERIFIED';
  const start=event=>{if(disabled||active||pressed||event.button!==undefined&&event.button!==0)return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);setPressed(true);onStart();};
  const stop=()=>{setPressed(false);onStop();};
  const keyDown=event=>{if(!['Space','Enter'].includes(event.code))return;event.preventDefault();event.stopPropagation();if(event.repeat||disabled||active||pressed)return;setPressed(true);onStart();};
  const keyUp=event=>{if(!['Space','Enter'].includes(event.code))return;event.preventDefault();event.stopPropagation();stop();};
  return <div className="native-burst-control"><button className="btn shutter" disabled={!holding&&(disabled||job?.status==='transferring')} aria-label={holding?t("burstShutter.release_to_stop"):t("burstShutter.hold_for_continuous_shooting")} onPointerDown={start} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop} onKeyDown={keyDown} onKeyUp={keyUp} onBlur={stop}>{active||pressed?<Square size={16}/>:<Camera size={16}/>} {job?.status==='transferring'?t("burstShutter.saving_burst"):holding?t("burstShutter.release_to_stop"):t("burstShutter.hold_for_burst")}<kbd>Space</kbd></button><small role="status">{unconfirmed?t('operation.capture_unverified'):job?.status==='completed'?t("burstShutter.saved_photos", { v0: job.shots }):t("burstShutter.continuous_shooting_stops_after_5_s")}</small></div>;
}
