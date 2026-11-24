import React,{useEffect,useRef,useState} from 'react';
import {createShutterInput} from '../electron/shutter-input.cjs';
// Own input synchronously: rerenders, IPC latency and disabled states cannot eat
// pointer-up. Start errors still send the matching safety release.
export default function HoldButton({onStart,onStop,connected=true,disabled=false,children,...props}){
  const [held,setHeld]=useState(false),callbacks=useRef({onStart,onStop});callbacks.current={onStart,onStop};
  const owner=useRef(null);if(!owner.current)owner.current=createShutterInput({start:input=>callbacks.current.onStart(input),stop:input=>Promise.resolve(callbacks.current.onStop(input)).catch(()=>{}),onChange:setHeld});
  useEffect(()=>{
    const pointer=e=>owner.current.release(e.type,e.pointerId),key=e=>{if(['Space','Enter'].includes(e.code))owner.current.release('keyup',e.code);},leave=e=>owner.current.release(e.type),hidden=()=>{if(document.hidden)owner.current.release('hidden');};
    window.addEventListener('pointerup',pointer,true);window.addEventListener('pointercancel',pointer,true);window.addEventListener('keyup',key,true);window.addEventListener('blur',leave);window.addEventListener('pagehide',leave);document.addEventListener('visibilitychange',hidden);
    return()=>{owner.current.dispose();window.removeEventListener('pointerup',pointer,true);window.removeEventListener('pointercancel',pointer,true);window.removeEventListener('keyup',key,true);window.removeEventListener('blur',leave);window.removeEventListener('pagehide',leave);document.removeEventListener('visibilitychange',hidden);};
  },[]);
  useEffect(()=>{if(!connected)owner.current.release('disconnect');},[connected]);
  const release=e=>owner.current.release(e.type),press=e=>{if(disabled||!connected||e.button!==0)return;e.preventDefault();try{e.currentTarget.setPointerCapture(e.pointerId);}catch{}owner.current.press('pointer',e.pointerId);};
  return <button {...props} type="button" disabled={!held&&(!connected||disabled)} data-held={held} aria-pressed={held} style={{touchAction:'none',userSelect:'none',...props.style}} onPointerDown={press} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release} onBlur={release} onKeyDown={e=>{if(!['Space','Enter'].includes(e.code))return;e.preventDefault();e.stopPropagation();if(!e.repeat&&!disabled&&connected)owner.current.press('keyboard',e.code);}} onKeyUp={e=>{if(['Space','Enter'].includes(e.code)){e.preventDefault();e.stopPropagation();owner.current.release('keyup',e.code);}}} onClick={e=>e.preventDefault()}>{children}</button>;
}
