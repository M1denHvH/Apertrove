import { t, localized } from "./i18n.js";
import React,{useState} from 'react';
const pages=localized(() => ([
  [t("parameterGuide.exposure"),[
    [t("parameterGuide.shutter_speed"),t("parameterGuide.how_long_the_shutter_stays_open_at_1")],
    [t("parameterGuide.aperture"),t("parameterGuide.a_lower_f_number_lets_in_more_light")],
    ['ISO',t("parameterGuide.iso_controls_signal_gain_iso_100_produces_less")],
    [t("parameterGuide.exposure_compensation"),t("parameterGuide.adjusts_the_target_brightness_in_auto_exposure_1")]
  ]],
  [t("parameterGuide.modes_and_color"),[
    [t("parameterGuide.m_manual"),t("parameterGuide.you_set_shutter_speed_aperture_and_iso_manual")],
    ['Av / Tv / P',t("parameterGuide.in_av_you_choose_aperture_and_the_camera")],
    [t("parameterGuide.white_balance"),t("parameterGuide.corrects_for_the_color_of_the_light_daylight")],
    ['Picture Style',t("parameterGuide.changes_contrast_sharpness_and_color_in_jpegs_and")]
  ]],
  [t("parameterGuide.focus_and_series"),[
    ['One Shot / AI Servo / AI Focus',t("parameterGuide.one_shot_focuses_on_a_stationary_subject_ai")],
    [t("parameterGuide.quick_live_face_detection"),t("parameterGuide.quick_uses_dedicated_phase_detection_sensors_and_can")],
    [t("parameterGuide.lens_af_mf_switch"),t("parameterGuide.the_physical_af_mf_switch_may_limit_remote")],
    [t("parameterGuide.preset_series"),t("parameterGuide.each_step_applies_and_checks_settings_then_takes")]
  ]]
]));
export default function ParameterGuide(){const [tab,setTab]=useState(0);return <div className="parameter-guide"><div className="guide-tabs" role="tablist">{pages().map(([title],index)=><button key={title} role="tab" aria-selected={tab===index} className={tab===index?'active':''} onClick={()=>setTab(index)}>{title}</button>)}</div><div className="guide-articles">{pages()[tab][1].map(([title,text])=><article key={title}><h3>{title}</h3><p>{text}</p></article>)}</div><div className="guide-example"><span>{t("parameterGuide.equivalent_exposures")}</span><strong>1/125 · f/4 · ISO 100 <b>≈</b> 1/250 · f/2.8 · ISO 100</strong><small>{t("parameterGuide.opening_the_aperture_by_one_stop_compensates_for")}</small></div></div>;}
