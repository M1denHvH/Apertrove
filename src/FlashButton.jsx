import { t, legacy } from "./i18n.js";
import React,{useEffect,useState} from 'react';
import {Zap} from 'lucide-react';
export default function FlashButton({camera,busy,onPopup}){
  const [support,setSupport]=useState(null);
  useEffect(()=>{let alive=true;setSupport(null);if(camera.connected)window.focal.flashSupport().then(result=>{if(alive)setSupport(result);}).catch(error=>{if(alive)setSupport({available:false,canAttempt:false,error:error.message});});return()=>{alive=false;};},[camera.connected,camera.cameraId,camera.model,camera.mode,camera.connectedAt]);
  const capability=camera.flash??support;
  const enabled=capability?.available||capability?.canAttempt;
  return <><button className="btn flash-popup" aria-label={t("flashButton.raise_the_built_in_flash")} title={enabled?t("flashButton.raise_the_built_in_flash"):legacy(capability?.error)||t("flashButton.built_in_flash_unavailable")} disabled={!camera.connected||!enabled||busy} onClick={onPopup}><Zap size={15}/>{busy==='flash'?t("flashButton.raising_flash"):t("flashButton.raise_flash")}</button>{capability?.accepted&&<p className="camera-operation-note" role="status">{t("flashButton.request_accepted_check_camera")}</p>}</>;
}
