import { t } from "./i18n.js";
import '../electron/remote/focus-overlay.js';
import '../electron/remote/composition-overlay.js';
import React,{useEffect,useRef} from 'react';
export default function LivePreview({zoom=1,composition}){
  const guides=useRef(composition),focus=useRef(null),canvas=useRef(null),fps=useRef(null),empty=useRef(null);
  useEffect(()=>{guides.current=composition;},[composition]);
  useEffect(()=>{
    const stopFocus=window.focal.onFocus(data=>{focus.current=data;});
    let cancelled=false,frames=0,since=performance.now(),total=0;
    const unsubscribe=window.focal.onFrame(async bytes=>{
      if(cancelled)return;
      const image=await createImageBitmap(new Blob([bytes],{type:'image/jpeg'}));
      try{if(cancelled||!canvas.current)return;const c=canvas.current;if(c.width!==image.width||c.height!==image.height){c.width=image.width;c.height=image.height;}const ctx=c.getContext('2d',{alpha:false});ctx.drawImage(image,0,0);globalThis.ApertroveComposition.drawComposition(ctx,c.width,c.height,guides.current);globalThis.ApertroveFocus.drawFocus(ctx,c.width,c.height,focus.current);c.dataset.frames=String(++total);if(empty.current)empty.current.hidden=true;frames++;const now=performance.now();if(now-since>=1000){const value=(frames*1000/(now-since)).toFixed(1);if(fps.current)fps.current.textContent=`${value} FPS`;c.dataset.fps=value;frames=0;since=now;}}
      finally{image.close();}
    });
    return()=>{cancelled=true;unsubscribe();stopFocus();};
  },[]);
  return <><canvas ref={canvas} className="preview-image live-canvas" aria-label={t("livePreview.live_view_image")} data-frames="0" style={{transform:`scale(${zoom})`}}/><span ref={empty} className="live-loading">{t("livePreview.waiting_for_a_frame")}</span><span className="live-fps" ref={fps}>— FPS</span></>;
}
