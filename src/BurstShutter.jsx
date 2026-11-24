import { t, legacy } from "./i18n.js";
import React,{useEffect,useRef,useState} from 'react';import {Camera,Square} from 'lucide-react';
import {createShutterInput} from '../electron/shutter-input.cjs';
export default function BurstShutter({job,disabled,onStart,onStop}){
  const [pressed,setPressed]=useState(false);
  const callbacks=useRef({onStart,onStop});callbacks.current={onStart,onStop};
  const owner=useRef(null);if(!owner.current)owner.current=createShutterInput({start:input=>callbacks.current.onStart(input),stop:input=>callbacks.current.onStop(input),onChange:setPressed});
  useEffect(()=>{
    const releasePointer=event=>owner.current.release(event.type,event.pointerId);
    const releaseKey=event=>{if(['Space','Enter'].includes(event.code))owner.current.release('keyup',event.code);};
    const release=event=>owner.current.release(event.type);
    const visibility=()=>{if(document.hidden)owner.current.release('hidden');};
    window.addEventListener('pointerup',releasePointer,true);window.addEventListener('pointercancel',releasePointer,true);window.addEventListener('keyup',releaseKey,true);
    window.addEventListener('blur',release);window.addEventListener('pagehide',release);document.addEventListener('visibilitychange',visibility);
    return()=>{owner.current.dispose();window.removeEventListener('pointerup',releasePointer,true);window.removeEventListener('pointercancel',releasePointer,true);window.removeEventListener('keyup',releaseKey,true);window.removeEventListener('blur',release);window.removeEventListener('pagehide',release);document.removeEventListener('visibilitychange',visibility);};
  },[]);
  const active=job&&['holding','transferring'].includes(job.status);
  const holding=pressed||job?.status==='holding',unconfirmed=job?.status==='unconfirmed'||job?.confirmation==='UNVERIFIED';
  const start=event=>{if(disabled||active||event.button!==0)return;event.preventDefault();try{event.currentTarget.setPointerCapture(event.pointerId);}catch{}owner.current.press('pointer',event.pointerId);};
  const stop=event=>owner.current.release(event.type);
  const keyDown=event=>{if(!['Space','Enter'].includes(event.code))return;event.preventDefault();event.stopPropagation();if(event.repeat||disabled||active)return;owner.current.press('keyboard',event.code);};
  const keyUp=event=>{if(!['Space','Enter'].includes(event.code))return;event.preventDefault();event.stopPropagation();owner.current.release('keyup',event.code);};
  return <div className="native-burst-control"><button className="btn shutter" title={t("burstShutter.continuous_shooting_stops_after_5_s")} disabled={!holding&&(disabled||job?.status==='transferring')} aria-label={holding?t("burstShutter.release_to_stop"):t("burstShutter.hold_for_continuous_shooting")} onPointerDown={start} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop} onKeyDown={keyDown} onKeyUp={keyUp} onBlur={stop}>{active||pressed?<Square size={16}/>:<Camera size={16}/>} {job?.status==='transferring'?t("burstShutter.saving_burst"):holding?t("burstShutter.release_to_stop"):t("burstShutter.hold_for_burst")}<kbd>Space</kbd></button>{unconfirmed&&<small role="status">{t('operation.capture_unverified')}</small>}{job?.status==='failed'&&<small role="alert">{legacy(job.error)}</small>}</div>;
}
