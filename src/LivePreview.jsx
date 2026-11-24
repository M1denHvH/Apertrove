import { t } from "./i18n.js";
import '../electron/remote/focus-overlay.js';
import '../electron/remote/composition-overlay.js';
import {histogramFromImageData,histogramPath,createLatestFrameProcessor} from '../electron/live-histogram.cjs';
import React,{useEffect,useRef,useState} from 'react';
import {ChartColumn,RotateCw,RotateCcw} from 'lucide-react';

function LiveHistogram({data,enabled,available=true}){
  return enabled&&<div className="live-histogram-widget">
    {data?<svg viewBox="0 0 260 65" preserveAspectRatio="none" aria-label={t("desktop.live_histogram")} role="img">
      <path d="M0 64H260M65 0V65M130 0V65M195 0V65" stroke="#edf0f2" strokeWidth="1"/>
      <path d={histogramPath(data.red)} fill="none" stroke="#c56e77" strokeWidth="1.2"/>
      <path d={histogramPath(data.green)} fill="none" stroke="#7fa06f" strokeWidth="1.2"/>
      <path d={histogramPath(data.blue)} fill="none" stroke="#7397bd" strokeWidth="1.2"/>
    </svg>:<span className="live-histogram-empty">{t(!available?"desktop.unavailable":"desktop.live_histogram_waiting")}</span>}
    {data&&<span className="live-histogram-note">{t("desktop.live_histogram_software")}</span>}
  </div>;
}

export default function LivePreview({zoom=1,composition,histogramEnabled=false,onHistogramToggle=()=>{},orientation}){
  const guides=useRef(composition),focus=useRef(null),canvas=useRef(null),fps=useRef(null),empty=useRef(null),histogramEnabledRef=useRef(false);
  const stage=useRef(null),frameSize=useRef({width:0,height:0});
  const [frame,setFrame]=useState({width:0,height:0}),[viewport,setViewport]=useState({width:0,height:0}),[manualRotation,setManualRotation]=useState(null);
  const [histogram,setHistogram]=useState(null),[histogramAvailable,setHistogramAvailable]=useState(true);
  const automatic=orientation?.available===true&&orientation.source==='camera'&&[0,90,180,270].includes(orientation.rotation);
  const rotation=manualRotation??(automatic?orientation.rotation:0),mode=manualRotation===null&&automatic?'auto':'manual';
  const portrait=rotation%180!==0,rotatedWidth=portrait?frame.height:frame.width,rotatedHeight=portrait?frame.width:frame.height;
  const fit=rotatedWidth&&rotatedHeight?Math.min(viewport.width/rotatedWidth,viewport.height/rotatedHeight):0;
  useEffect(()=>{
    const observer=new ResizeObserver(entries=>{const {width,height}=entries[0].contentRect;setViewport({width,height});});
    observer.observe(stage.current);return()=>observer.disconnect();
  },[]);
  useEffect(()=>{histogramEnabledRef.current=histogramEnabled;if(!histogramEnabled)setHistogram(null);},[histogramEnabled]);
  useEffect(()=>{guides.current=composition;},[composition]);
  useEffect(()=>{
    const stopFocus=window.focal.onFocus(data=>{focus.current=data;});
    let cancelled=false,frames=0,since=performance.now(),total=0,lastHistogramAt=0,image;
    const sampleCanvas=document.createElement('canvas');
    const sampleContext=sampleCanvas.getContext('2d',{willReadFrequently:true});
    setHistogramAvailable(!!sampleContext);
    const processFrame=async bytes=>{
      try{
        image=await createImageBitmap(new Blob([bytes],{type:'image/jpeg'}));
        if(cancelled||!canvas.current)return;
        const c=canvas.current;
        if(c.width!==image.width||c.height!==image.height){c.width=image.width;c.height=image.height;}
        if(frameSize.current.width!==image.width||frameSize.current.height!==image.height){frameSize.current={width:image.width,height:image.height};setFrame(frameSize.current);}
        const ctx=c.getContext('2d',{alpha:false});
        ctx.drawImage(image,0,0);
        globalThis.ApertroveComposition.drawComposition(ctx,c.width,c.height,guides.current);
        globalThis.ApertroveFocus.drawFocus(ctx,c.width,c.height,focus.current);
        c.dataset.frames=String(++total);if(empty.current)empty.current.hidden=true;frames++;
        const now=performance.now();
        if(sampleContext&&histogramEnabledRef.current&&now-lastHistogramAt>=250){
          const scale=Math.min(1,160/image.width,120/image.height);
          sampleCanvas.width=Math.max(1,Math.round(image.width*scale));
          sampleCanvas.height=Math.max(1,Math.round(image.height*scale));
          try{
            sampleContext.drawImage(image,0,0,sampleCanvas.width,sampleCanvas.height);
            const pixels=sampleContext.getImageData(0,0,sampleCanvas.width,sampleCanvas.height);
            if(!cancelled&&histogramEnabledRef.current)setHistogram(histogramFromImageData(pixels));
          }finally{sampleCanvas.width=0;sampleCanvas.height=0;}
          lastHistogramAt=now;
        }
        if(now-since>=1000){
          const value=(frames*1000/(now-since)).toFixed(1);
          if(fps.current)fps.current.textContent=value+' FPS';
          c.dataset.fps=value;frames=0;since=now;
        }
      }catch{/* Empty or undecodable frames are ignored without affecting Live View. */}
      finally{if(image)image.close();image=null;}
    };
    const processor=createLatestFrameProcessor(processFrame);
    const unsubscribe=window.focal.onFrame(bytes=>{if(!cancelled)processor.submit(bytes);});
    return()=>{cancelled=true;processor.stop();sampleCanvas.width=0;sampleCanvas.height=0;unsubscribe();stopFocus();};
  },[]);
  return <><div ref={stage} className="live-frame-stage"><canvas ref={canvas} className="preview-image live-canvas" aria-label={t("livePreview.live_view_image")} data-frames="0" data-rotation={rotation} data-orientation-mode={mode} style={{width:frame.width*fit,height:frame.height*fit,transform:`translate(-50%,-50%) rotate(${rotation}deg) scale(${zoom})`}}/></div><span ref={empty} className="live-loading">{t("livePreview.waiting_for_a_frame")}</span><span className="live-fps" ref={fps}>— FPS</span><LiveHistogram data={histogram} enabled={histogramEnabled} available={histogramAvailable}/><div className="live-preview-controls">
    <button type="button" className="icon-btn live-histogram-toggle" title={t(histogramAvailable||histogramEnabled?'desktop.live_histogram_toggle':'desktop.unavailable')} aria-label={t('desktop.live_histogram_toggle')} aria-pressed={histogramEnabled} disabled={!histogramAvailable&&!histogramEnabled} onClick={()=>onHistogramToggle(!histogramEnabled)}><ChartColumn size={16} aria-hidden="true"/></button>
    <button type="button" className="icon-btn live-rotate-toggle" title={t(mode==='auto'?'desktop.live_rotation_auto':'desktop.live_rotation_manual',{angle:rotation})} aria-label={t('desktop.live_rotate')} onClick={()=>setManualRotation((rotation+90)%360)}><RotateCw size={16} aria-hidden="true"/></button>
    {automatic&&manualRotation!==null&&<button type="button" className="icon-btn live-rotation-auto" title={t('desktop.live_rotation_restore_auto')} aria-label={t('desktop.live_rotation_restore_auto')} onClick={()=>setManualRotation(null)}><RotateCcw size={16} aria-hidden="true"/></button>}
  </div></>;
}
