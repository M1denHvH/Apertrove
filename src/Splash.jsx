import { t } from "./i18n.js";
import React,{useState} from 'react';
import {SPLASHES} from './splashes';
export default function Splash(){
  const next=previous=>{let index=Math.floor(Math.random()*SPLASHES().length);if(index===previous)index=(index+1)%SPLASHES().length;return index;};
  const [index,setIndex]=useState(()=>next(-1));
  return <button className="splash" title={t("splash.another_photography_easter_egg")} aria-label={t("splash.show_a_different_photography_easter_egg")} onClick={()=>setIndex(next)}>{SPLASHES()[index]}</button>;
}
