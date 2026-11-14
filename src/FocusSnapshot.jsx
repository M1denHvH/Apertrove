import { t } from "./i18n.js";
import React,{useEffect,useRef} from 'react';
import '../electron/remote/focus-overlay.js';
import '../electron/remote/composition-overlay.js';
export default function FocusSnapshot({snapshot,zoom=1,composition}){
  const canvas=useRef(null);
  useEffect(()=>{let cancelled=false;const img=new Image();img.onload=()=>{if(cancelled||!canvas.current)return;const c=canvas.current;c.width=img.naturalWidth;c.height=img.naturalHeight;const ctx=c.getContext('2d',{alpha:false});ctx.drawImage(img,0,0);globalThis.ApertroveComposition.drawComposition(ctx,c.width,c.height,composition);globalThis.ApertroveFocus.drawFocus(ctx,c.width,c.height,snapshot.focusInfo,snapshot.at);c.dataset.ready='true';};img.src=snapshot.image;return()=>{cancelled=true;};},[snapshot,composition]);
  return <><canvas ref={canvas} className="preview-image focus-snapshot" aria-label={t("focusSnapshot.preview_after_focusing")} style={{transform:`scale(${zoom})`}}/><span className="focus-snapshot-label">{t("focusSnapshot.af_preview")}</span></>;
}
