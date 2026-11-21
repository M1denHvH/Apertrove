import React,{useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Focus,Play,Square,ChevronDown,Check} from 'lucide-react';
import {t,legacy,number} from './i18n.js';
import './camera-lifecycle-controls.css';
import HoldButton from './HoldButton.jsx';

export const servoHeld=camera=>!!camera.connected&&(camera.servo?.enabled===true||camera.servo?.enabled===null||['starting','stopping'].includes(camera.servo?.status));
export const bulbHeld=camera=>!!camera.connected&&(['starting','exposing','stopping'].includes(camera.bulb?.status)||camera.bulb?.status==='error'&&camera.bulb?.confirmation==='unknown');
export const isBulbMode=camera=>camera.mode==='Bulb'||camera.properties?.shutter?.choices?.some(choice=>choice.value===camera.properties.shutter.value&&/^bulb$/i.test(choice.label));

export function AFControl({camera,busy,locked,onChange,onOneShot}){
  const servo=camera.servo||{},held=servoHeld(camera),unknown=servo.enabled===null;
  const pending=['starting','stopping'].includes(servo.status);
  const unavailable=!camera.connected||!!busy||pending,focusUnavailable=camera.properties?.afMode?.value===3||camera.capabilities?.focus===false;
  const oneShotDisabled=unavailable||locked||held||focusUnavailable;
  const servoDisabled=unavailable||!held&&(locked||camera.capabilities?.servo!==true||focusUnavailable||camera.controlsOnly&&!camera.live);
  const status=servo.status==='starting'?t('desktop.servo_starting'):servo.status==='stopping'?t('desktop.servo_stopping'):unknown?t('desktop.servo_unknown'):servo.error?legacy(servo.error):null;
  const id=useId(),trigger=useRef(null),menu=useRef(null),[open,setOpen]=useState(false),[position,setPosition]=useState({});
  const close=(restore=true)=>{setOpen(false);if(restore)trigger.current?.focus({preventScroll:true});};
  const choose=action=>{close();action();};
  useLayoutEffect(()=>{if(!open)return;const place=()=>{const rect=trigger.current.getBoundingClientRect(),width=Math.min(220,innerWidth-24),up=innerHeight-rect.bottom<120&&rect.top>120;setPosition({position:'fixed',width,left:Math.max(12,Math.min(rect.right-width,innerWidth-width-12)),...(up?{bottom:innerHeight-rect.top+6}:{top:rect.bottom+6})});};place();menu.current?.querySelector('button:not(:disabled)')?.focus();window.addEventListener('resize',place);window.addEventListener('scroll',place,true);return()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};},[open]);
  useEffect(()=>{if(!open)return;const outside=event=>{if(!trigger.current?.contains(event.target)&&!menu.current?.contains(event.target))close(false);};document.addEventListener('pointerdown',outside,true);return()=>document.removeEventListener('pointerdown',outside,true);},[open]);
  useEffect(()=>{if(unavailable)setOpen(false);},[unavailable]);
  const menuKeyDown=event=>{
    if(event.key==='Tab'){close(false);return;}
    if(['ArrowUp','ArrowDown','Home','End','Escape'].includes(event.key)){event.preventDefault();event.stopPropagation();}
    if(event.key==='Escape'){close();return;}
    const items=Array.from(menu.current?.querySelectorAll('button:not(:disabled)')||[]);if(!items.length)return;
    const index=items.indexOf(document.activeElement);
    if(event.key==='Home')items[0].focus();else if(event.key==='End')items.at(-1).focus();else if(event.key==='ArrowDown'||event.key==='ArrowUp')items[(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length].focus();
  };
  return <div className="af-control" data-servo={held?'true':'false'} aria-busy={pending}>
    <div className={'af-control-buttons'+(held?' live-on':'')}>
      <button type="button" className={'btn af-primary'+(held?' live-on':'')} aria-label={t(held?'desktop.servo_stop':'desktop.autofocus')} aria-pressed={held} disabled={held?servoDisabled:oneShotDisabled} title={held?t(unknown?'desktop.servo_unknown':'desktop.servo_active'):t('desktop.af_one_shot')} onClick={()=>held?onChange(false):onOneShot()}><Focus size={15} aria-hidden="true"/>{held?'AI Servo':busy==='autofocus'?t('desktop.focusing'):'AF'}</button>
      <button ref={trigger} type="button" className="btn af-mode-toggle" aria-label={t('desktop.af_options')} title={t('desktop.af_options')} aria-haspopup="menu" aria-controls={open?id:undefined} aria-expanded={open} disabled={unavailable||oneShotDisabled&&servoDisabled} onClick={()=>setOpen(!open)} onKeyDown={event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();event.stopPropagation();setOpen(true);}}}><ChevronDown size={13} aria-hidden="true"/></button>
    </div>
    {status&&<p className={'camera-operation-note'+(unknown||servo.error?' error':'')} role={unknown||servo.error?'alert':'status'}>{status}</p>}
    {open&&createPortal(<div ref={menu} id={id} role="menu" aria-label={t('desktop.af_options')} className="ui-select-menu af-options" style={position} onKeyDown={menuKeyDown}>
      <button type="button" role="menuitem" disabled={oneShotDisabled} onClick={()=>choose(onOneShot)}><Focus size={15} aria-hidden="true"/><span>{t('desktop.af_one_shot')}</span></button>
      <button type="button" role="menuitemcheckbox" aria-checked={held} disabled={servoDisabled} title={camera.capabilities?.servo!==true?t('desktop.servo_unavailable'):undefined} onClick={()=>choose(()=>onChange(!held))}><span>{t('desktop.servo_toggle')}</span>{held&&<Check size={15} aria-hidden="true"/>}</button>
    </div>,document.body)}
  </div>;
}

export function BulbControl({camera,busy,locked,onStart,onStop}){
  const bulb=camera.bulb||{},held=bulbHeld(camera),pending=['starting','stopping'].includes(bulb.status);
  const available=camera.capabilities?.bulb===true&&bulb.available===true;
  if(!held&&bulb.status!=='error'&&!isBulbMode(camera)&&!available)return null;
  const elapsed=Number.isFinite(bulb.elapsedSeconds)&&bulb.elapsedSeconds>=0&&bulb.elapsedSource==='camera-event'?number(bulb.elapsedSeconds,{maximumFractionDigits:1}):null;
  const status=bulb.status==='starting'?t('desktop.bulb_starting'):bulb.status==='stopping'?t('desktop.bulb_stopping'):bulb.status==='exposing'?t('desktop.bulb_exposing'):null;
  return <div className="bulb-control" data-state={bulb.status||'idle'}>
    <div className="bulb-control-row"><span className="bulb-mode">BULB</span><HoldButton className={'btn '+(held?'danger-quiet':'quiet')} aria-label={t('desktop.bulb_hold')} connected={camera.connected} disabled={!!busy||pending||held||!available||locked||!isBulbMode(camera)} title={!available?t('desktop.bulb_unavailable'):!isBulbMode(camera)?t('desktop.bulb_requires_mode'):t('desktop.bulb_hold')} onStart={onStart} onStop={onStop}>{held?<Square size={14} aria-hidden="true"/>:<Play size={14} aria-hidden="true"/>}{t(held?'desktop.bulb_release':'desktop.bulb_hold')}</HoldButton>{bulb.status==='error'&&bulb.confirmation==='unknown'&&<button type="button" className="btn danger-quiet" disabled={!camera.connected||!!busy||pending} onClick={onStop}>{t('desktop.bulb_stop')}</button>}</div>
    {status&&<div className="bulb-status" role="status"><span>{status}</span><output aria-label={t('desktop.bulb_elapsed')}>{elapsed===null?t('desktop.bulb_waiting'):elapsed+' s'}</output></div>}
    {bulb.status==='error'?<p className="camera-operation-note error" role="alert">{legacy(bulb.error)||t('desktop.bulb_unknown')}</p>:!available&&<p className="camera-operation-note">{t('desktop.bulb_unavailable')}</p>}
  </div>;
}
