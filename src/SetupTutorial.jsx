import { t, localized, legacy } from "./i18n.js";
import React, { useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Info, X } from 'lucide-react';
import './onboarding.css';

const lessons = localized(() => ([
  ['live','capture',t("tutorial.frame_your_shot"),'.live-controls .btn',t("tutorial.live_view_shows_what_the_camera_sees_so"),'liveView'],
  ['capture','capture',t("tutorial.shutter_release"),'.capture-button-group .btn, .header-actions .shutter',t("tutorial.when_the_shot_is_ready_click_the_shutter"),'capture'],
  ['exposure','capture',t("tutorial.control_exposure"),'.exposure-grid',t("tutorial.shutter_speed_aperture_and_iso_are_together_each")],
  ['presets','presets',t("tutorial.camera_presets"),'.preset-grid .preset-card, .presets-toolbar .btn',t("tutorial.save_a_set_of_settings_you_like_so")],
  ['library','library',t("tutorial.find_your_photos"),'.library-toolbar',t("tutorial.find_a_session_filename_or_rating_click_a")],
  ['sessions','sessions',t("tutorial.keep_shoots_organized"),'.session-toolbar .btn, .sessions-empty .btn',t("tutorial.create_a_session_for_a_new_shoot_each")],
  ['inspector','library',t("tutorial.view_on_a_second_screen"),'[data-tutorial="inspector"]',t("tutorial.shot_inspector_shows_the_latest_photo_from_your")],
  ['lighting','lighting',t("tutorial.plan_your_lighting"),'.lighting-sections',t("tutorial.use_lighting_studio_to_pick_colors_for_background")],
  ['remote','remote',t("tutorial.shoot_from_your_phone"),'.remote-control-card',t("tutorial.start_web_remote_then_open_it_on_a")]
]));

export function lessonPage(topic) { return (lessons().find(lesson=>lesson[0]===topic)||lessons()[0])[1]; }

export default function SetupTutorial({ topic, data, onTopic, onClose }) {
  const index = Math.max(0,lessons().findIndex(lesson=>lesson[0]===topic));
  const [,page,title,selector,text,capability] = lessons()[index];
  const [anchor,setAnchor] = useState(null);
  const coach=useRef(null);
  useLayoutEffect(()=>{
    const target=document.querySelector(selector) || document.querySelector('.nav-item[aria-current="page"]');
    const scroller=document.querySelector('main');
    if(target && !target.classList.contains('nav-item'))target.scrollIntoView({block:'nearest'});
    function measure(){
      if(!target)return setAnchor(null);
      const r=target.getBoundingClientRect();
      const left=Math.max(2,r.left-4), top=Math.max(48,r.top-4);
      const right=Math.min(innerWidth-2,r.right+4), bottom=Math.min(innerHeight-30,r.bottom+4);
      if(right<=left||bottom<=top)return setAnchor(null);
      const coachRect=coach.current?.getBoundingClientRect();
      setAnchor({
        bounds:{left,top,width:right-left,height:bottom-top},
        nearTop:bottom>innerHeight-(coachRect?.height||200)-50,
        nearLeft:left>410&&right>innerWidth-390
      });
    }
    measure();
    coach.current?.focus({preventScroll:true});
    const observer=new ResizeObserver(measure);
    if(target)observer.observe(target);
    scroller?.addEventListener('scroll',measure,true);
    window.addEventListener('resize',measure);
    return()=>{observer.disconnect();scroller?.removeEventListener('scroll',measure,true);window.removeEventListener('resize',measure);};
  },[topic,selector,data.sessionId]);
  const diagnosed=data.settings.onboarding.report;
  const finding=capability&&diagnosed?.model===data.camera.model&&diagnosed?.rows.find(row=>row.id===capability);
  const blocked=capability&&data.camera.capabilities?.[capability]===false;
  const hint=page==='capture'&&!data.sessionId?t("tutorial.the_capture_panel_appears_after_you_create_a")
    :capability&&!data.camera.connected?t("tutorial.try_this_control_when_your_camera_is_connected")
    :blocked?finding?.status==='unsupported'?t("tutorial.this_camera_doesn_t_support_the_feature"):legacy(data.camera.capabilities?.reason)||t("tutorial.this_feature_is_temporarily_unavailable_camera_diagnostics_can")
    :topic==='exposure'&&!Object.values(data.camera.properties||{}).some(item=>item.writable)?t("tutorial.the_camera_hasn_t_offered_any_values_for"):null;
  const move=next=>onTopic(lessons()[next][0]);
  return <>
    {anchor&&<div className="tutorial-spot" style={anchor.bounds} aria-hidden="true"/>}
    <section ref={coach} tabIndex={-1} className={['tutorial-coach',anchor?.nearTop&&'near-top',anchor?.nearLeft&&'near-left'].filter(Boolean).join(' ')} aria-label={t("tutorial.interactive_tutorial")}
      onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();onClose(false);}}}>
      <header><span>{t('common.tutorial_progress',{current:index+1,total:lessons().length})}</span><button className="icon-btn" title={t("tutorial.close_tips")} aria-label={t("tutorial.exit_tutorial")} onClick={()=>onClose(false)}><X size={17}/></button></header>
      <div className="tutorial-track" aria-hidden="true"><span style={{'--lesson-progress':(index+1)/lessons().length}}/></div>
      <h2>{title}</h2><p>{text}</p>{hint&&<p className="tutorial-hint"><Info size={15}/>{hint}</p>}
      <footer>{index>0&&<button className="btn quiet" onClick={()=>move(index-1)}><ArrowLeft size={15}/>{t("tutorial.back")}</button>}
        <button className="btn dark" onClick={()=>index===lessons().length-1?onClose(true):move(index+1)}>{index===lessons().length-1?t("tutorial.finish"):t("tutorial.next")} <ArrowRight size={15}/></button>
      </footer>
    </section>
  </>;
}
