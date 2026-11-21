import React from 'react';
import {Focus,Play,Square} from 'lucide-react';
import {t,legacy,number} from './i18n.js';
import './camera-lifecycle-controls.css';

export const servoHeld=camera=>camera.servo?.enabled!==false&&['starting','running','stopping','error'].includes(camera.servo?.status);
export const bulbHeld=camera=>['starting','exposing','stopping'].includes(camera.bulb?.status)||camera.bulb?.status==='error'&&camera.bulb?.confirmation==='unknown';
export const isBulbMode=camera=>camera.mode==='Bulb'||camera.properties?.shutter?.choices?.some(choice=>choice.value===camera.properties.shutter.value&&/^bulb$/i.test(choice.label));

export function ServoToggle({camera,busy,locked,onChange}){
  const servo=camera.servo||{},held=servoHeld(camera),unknown=servo.enabled===null;
  const pending=['starting','stopping'].includes(servo.status);
  const disabled=!camera.connected||!!busy||pending||!held&&(locked||camera.capabilities?.servo!==true||camera.properties?.afMode?.value===3||camera.controlsOnly&&!camera.live);
  const status=servo.status==='starting'?t('desktop.servo_starting'):servo.status==='stopping'?t('desktop.servo_stopping'):unknown?t('desktop.servo_unknown'):held?t('desktop.servo_active'):servo.error?legacy(servo.error):null;
  return <div className="servo-control">
    <button type="button" className={'btn servo-toggle'+(held?' live-on':'')} aria-label={t('desktop.servo_toggle')} aria-pressed={held} aria-busy={pending} disabled={disabled} title={camera.controlsOnly&&!camera.live?t('desktop.start_live_view'):camera.capabilities?.servo===true?t('desktop.servo_toggle'):t('desktop.servo_unavailable')} onClick={()=>onChange(!held)}><Focus size={15} aria-hidden="true"/>{t('desktop.servo_toggle')}</button>
    {status&&<p className={'camera-operation-note'+(unknown||servo.error?' error':'')} role={unknown||servo.error?'alert':'status'}>{status}</p>}
  </div>;
}

export function BulbControl({camera,busy,locked,onStart,onStop}){
  const bulb=camera.bulb||{},held=bulbHeld(camera),pending=['starting','stopping'].includes(bulb.status);
  const available=camera.capabilities?.bulb===true&&bulb.available===true;
  if(!held&&bulb.status!=='error'&&!isBulbMode(camera)&&!available)return null;
  const elapsed=Number.isFinite(bulb.elapsedSeconds)&&bulb.elapsedSeconds>=0&&bulb.elapsedSource==='camera-event'?number(bulb.elapsedSeconds,{maximumFractionDigits:1}):null;
  const status=bulb.status==='starting'?t('desktop.bulb_starting'):bulb.status==='stopping'?t('desktop.bulb_stopping'):bulb.status==='exposing'?t('desktop.bulb_exposing'):null;
  return <div className="bulb-control" data-state={bulb.status||'idle'}>
    <div className="bulb-control-row"><span className="bulb-mode">BULB</span><button type="button" className={'btn '+(held?'danger-quiet':'quiet')} aria-label={t(held?'desktop.bulb_stop':'desktop.bulb_start')} disabled={!camera.connected||!!busy||pending||!held&&(!available||locked)} title={!available?t('desktop.bulb_unavailable'):undefined} onClick={held?onStop:onStart}>{held?<Square size={14} aria-hidden="true"/>:<Play size={14} aria-hidden="true"/>}{t(held?'desktop.bulb_stop':'desktop.bulb_start')}</button></div>
    {status&&<div className="bulb-status" role="status"><span>{status}</span><output aria-label={t('desktop.bulb_elapsed')}>{elapsed===null?t('desktop.bulb_waiting'):elapsed+' s'}</output></div>}
    {bulb.status==='error'?<p className="camera-operation-note error" role="alert">{legacy(bulb.error)||t('desktop.bulb_unknown')}</p>:!available&&<p className="camera-operation-note">{t('desktop.bulb_unavailable')}</p>}
  </div>;
}
