import { t } from "./i18n.js";
import {frames} from './format';
import React from 'react';import {Camera,Square} from 'lucide-react';
export default function BurstShutter({job,disabled,onStart,onStop}){
  const active=job&&['holding','transferring'].includes(job.status);
  const start=event=>{if(event.button!==undefined&&event.button!==0)return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);onStart();};
  return <div className="native-burst-control"><button className="btn shutter" disabled={disabled||job?.status==='transferring'} aria-label={t("burstShutter.hold_for_continuous_shooting")} onPointerDown={start} onPointerUp={onStop} onPointerCancel={onStop} onLostPointerCapture={onStop}>{active?<Square size={16}/>:<Camera size={16}/>} {job?.status==='transferring'?t("burstShutter.saving_burst"):active?t("burstShutter.release_to_stop"):t("burstShutter.hold_for_burst")}<kbd>Space</kbd></button><small>{active?t("burstShutter.stops_after_5_s", { v0: frames(job.shots||0) }):job?.status==='completed'?t("burstShutter.saved_photos", { v0: job.shots }):t("burstShutter.continuous_shooting_stops_after_5_s")}</small></div>;
}
