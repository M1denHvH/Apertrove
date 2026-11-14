import { t } from "./i18n.js";
import React,{useEffect,useLayoutEffect,useRef} from 'react';
import {X} from 'lucide-react';
import {gsap} from 'gsap';
import {motionDuration,withMotion} from './motion';
export default function Modal({title,subtitle,onClose,wide,children,dismissDisabled=false}){
  const dialog=useRef(null),previousFocus=useRef(document.activeElement),exit=useRef(null),closeCallback=useRef(onClose);
  closeCallback.current=onClose;
  const dismiss=()=>{
    if(dismissDisabled||exit.current)return;
    if(motionDuration('fast')<.1||matchMedia('(prefers-reduced-motion: reduce)').matches){onClose();return;}
    exit.current=gsap.to(dialog.current.parentElement,{opacity:.04,duration:motionDuration('fast'),overwrite:true,onComplete:()=>closeCallback.current()});
  };
  useLayoutEffect(()=>{
    const panel=dialog.current;
    const cleanup=withMotion(panel,()=>{
      gsap.timeline()
        .from(panel.parentElement,{opacity:0.55,duration:motionDuration('fast'),ease:'power2.out',clearProps:'opacity'},0)
        .from(panel,{y:4,opacity:0.7,duration:motionDuration('panel'),ease:'power3.out',clearProps:'transform,opacity'},0);
    });
    return ()=>{exit.current?.kill();exit.current=null;cleanup();};
  },[]);
  useEffect(()=>{
    const previous=previousFocus.current,node=dialog.current;
    const focusable=()=>[...node.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(element=>element.getClientRects().length);
    if(!node.contains(document.activeElement))focusable()[0]?.focus({preventScroll:true});
    const trap=event=>{if(event.key!=='Tab')return;const items=focusable(),first=items[0],last=items.at(-1);if(!first){event.preventDefault();return;}if(event.shiftKey&&(document.activeElement===first||!node.contains(document.activeElement))){event.preventDefault();last.focus();}else if(!event.shiftKey&&(document.activeElement===last||!node.contains(document.activeElement))){event.preventDefault();first.focus();}};
    node.addEventListener('keydown',trap);return()=>{node.removeEventListener('keydown',trap);if(previous?.isConnected)previous.focus({preventScroll:true});};
  },[title]);
  return <div className="modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)dismiss();}}><section ref={dialog} className={`modal${wide?' wide':''}`} role="dialog" aria-modal="true" aria-label={title} aria-busy={dismissDisabled||undefined} onKeyDown={event=>{if(event.key==='Escape'&&!event.defaultPrevented){event.preventDefault();event.stopPropagation();dismiss();}}}><div className="modal-head"><div><h2>{title}</h2>{subtitle&&<p title={subtitle}>{subtitle}</p>}</div><button className="icon-btn" title={t("modal.close")} aria-label={t("modal.close")} onClick={dismiss} disabled={dismissDisabled}><X size={17}/></button></div><div className="modal-body">{children}</div></section></div>;
}
