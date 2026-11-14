import { t, error as localizeError, legacy } from "./i18n.js";
import React,{useEffect,useState} from 'react';
import {RefreshCw,ArrowUpRight} from 'lucide-react';
import DeviceIllustration from './DeviceIllustration';
function EquipmentCard({card}){
  const [photo,setPhoto]=useState(null);
  useEffect(()=>{let alive=true;setPhoto(null);if(card.name&&card.source)window.focal.equipmentPhoto({kind:card.kind}).then(result=>{if(alive)setPhoto(result);}).catch(()=>{});return()=>{alive=false;};},[card.kind,card.name,card.source]);
  const facts=card.facts.filter(([label,value])=>!label.startsWith("Модель")&&value&&!/Не предостав|Не передан/.test(String(value))).map(([label,value])=>[legacy(label).replace(' · SDK',''),legacy(value)]);
  for(const row of photo?.facts||[])if(!facts.some(([label])=>label===row[0]||legacy(row[0])===t('equipment.aperture')&&label===t('equipment.aperture_blades')))facts.push(row.map(legacy));
  return <article className="equipment-card settings-card"><div className="equipment-card-head"><span className="eyebrow">{card.kind==='camera'?t("equipment.camera"):t("equipment.lens")}</span><span className={`equipment-online ${card.connected?'on':''}`}><i/>{card.connected?t("equipment.connected"):t("equipment.disconnected")}</span></div><div className="equipment-hero">{photo?<img src={photo.image} alt={card.name} onError={()=>setPhoto(null)}/>:<DeviceIllustration lens={card.kind==='lens'}/>}</div><div className="equipment-title"><h3>{card.name||(card.kind==='camera'?t("equipment.camera_2"):t("equipment.lens_2"))}</h3>{card.source&&<button className="equipment-manufacturer" title={t("equipment.manufacturer_s_website")} onClick={()=>window.focal.equipmentSource({kind:card.kind})}>{card.manufacturer}<ArrowUpRight size={12}/></button>}</div><dl className="equipment-facts">{facts.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><div className="equipment-stats">{card.stats.map(([label,value])=><div key={label}><strong>{legacy(value)}</strong><span>{legacy(label).replace(' · SDK','')}</span></div>)}</div></article>;
}
export default function Equipment({camera}){
  const [cards,setCards]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const refresh=async()=>{setBusy(true);try{setCards(await window.focal.equipment());setError('');}catch(e){setError(e.message);}finally{setBusy(false);}};
  useEffect(()=>{let timer;const off=window.focal.on(({type,data})=>{if(type==='photo'||type==='captureState'&&!data.active||type==='series'&&['completed','failed','cancelled'].includes(data.status)||type==='burst'&&['completed','failed'].includes(data.status)){clearTimeout(timer);timer=setTimeout(refresh,1000);}});return()=>{off();clearTimeout(timer);};},[]);
  useEffect(()=>{refresh();},[camera.model,camera.equipment?.lensName,camera.connected]);
  return <div className="content-page equipment-page"><div className="equipment-toolbar"><button className="btn" disabled={busy} onClick={refresh}><RefreshCw size={15} className={busy?'spin':''}/>{t("equipment.refresh")}</button></div>{error&&<p className="equipment-error">{localizeError(error)}</p>}<div className="equipment-grid">{cards&&['camera','lens'].map(kind=><EquipmentCard key={`${kind}-${cards[kind].name}`} card={cards[kind]}/>)}</div></div>;
}
