import { t, localized } from "./i18n.js";
import React, { useEffect, useId, useState } from 'react';
import { Camera, Check, ChevronDown, FolderOpen, Gauge, Images, Monitor, Moon, Palette, Sun } from 'lucide-react';
import { ACCENTS } from './appearance';
import LcdReadout from './LcdReadout';
import './appearance-controls.css';

const themes = localized(() => ([
  ['light', t("appearance.light"), Sun],
  ['dark', t("appearance.dark"), Moon],
  ['system', t("appearance.system"), Monitor]
]));
const designs = localized(() => ([
  ['current', 'Studio', t("appearance.compact_panels")],
  ['classic', 'Canon Classic', t("appearance.eos_inspired_display")],
  ['modern', 'Modern', t("appearance.soft_cards")]
]));

function WorkspaceSample({ theme, design }) {
  return <div className="appearance-sample" data-appearance-sample data-theme={theme} data-design={design} aria-hidden="true">
    <div className="sample-navigation"><FolderOpen/><Camera/><Images/></div>
    <div className="sample-workspace">
      <strong>{t("appearance.capture")}</strong>
      <span className="sample-live"><Camera/><span>Live View</span></span>
    </div>
    <div className="sample-settings">
      <div className="sample-exposure"><small>{t("appearance.aperture")}</small>{design==='classic'?<LcdReadout kind="aperture" value="f/2.8"/>:<b>f/2.8</b>}</div>
      <span className="sample-capture"><Camera/><span>{t("appearance.take_photo")}</span></span>
    </div>
  </div>;
}

function SelectionMark() {
  return <Check className="appearance-check" size={14} aria-hidden="true"/>;
}

function AccentControl({ value, onAccent, onChange }) {
  const [hex, setHex] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const errorId = useId();
  const customSelected = !ACCENTS().some(color=>color.value===value);
  useEffect(() => { setHex(value); setInvalid(false); }, [value]);
  const commit = () => {
    const color = hex.trim().toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(color)) { setInvalid(true); return; }
    setInvalid(false);
    setHex(color);
    if (color !== value) onChange('accentColor',color);
  };
  return <div className="appearance-accent" style={{'--swatch-ink':onAccent}}>
    <span className="appearance-label">{t("appearance.accent_color")}</span>
    <div className="appearance-accent-row">
      <div className="accent-options" role="group" aria-label={t("appearance.accent_palette")}>
        {ACCENTS().map(color=><button key={color.value} type="button" className="accent-swatch"
          style={{'--swatch':color.value}} title={color.name} aria-label={t("appearance.accent", { v0: color.name })} aria-pressed={value===color.value}
          onClick={()=>onChange('accentColor',color.value)}><SelectionMark/></button>)}
      </div>
      <div className="custom-accent">
        <label className="color-picker-label" title={t("appearance.choose_a_custom_color")}>
          <input type="color" aria-label={t("appearance.custom_accent_color")} value={value} onChange={event=>onChange('accentColor',event.target.value)}/>
          <span className="accent-swatch custom-swatch" data-selected={customSelected} style={{'--swatch':value}} aria-hidden="true">
            <Palette className="custom-swatch-icon" size={15}/><SelectionMark/>
          </span>
        </label>
        <label className="hex-label"><span>HEX</span><input aria-label={t("appearance.accent_color_code")} aria-invalid={invalid}
          aria-describedby={invalid?errorId:undefined} value={hex} maxLength={7}
          onChange={event=>{setHex(event.target.value);setInvalid(false);}} onBlur={commit}
          onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();commit();}}}/></label>
        <button type="button" className="text-button" onClick={()=>{setHex(ACCENTS()[0].value);setInvalid(false);onChange('accentColor',ACCENTS()[0].value);}}>{t("appearance.reset")}</button>
      </div>
    </div>
    {invalid&&<p id={errorId} role="alert" className="color-validation">{t("appearance.enter_a_color_in_rrggbb_format")}</p>}
  </div>;
}

function AppearanceControls({ settings, appearance, onChange }) {
  const descriptionId = useId();
  return <div className="appearance-controls">
    <div className="appearance-choice">
      <span className="appearance-label">{t("appearance.color_theme")}</span>
      <div className="appearance-options" role="group" aria-label={t("appearance.color_theme")}>
        {themes().map(([value,label,Icon])=><button key={value} type="button" className="appearance-option" aria-label={t("appearance.theme", { v0: label })}
          title={value==='system'?t("appearance.apertrove_follows_your_system_s_appearance"):undefined}
          aria-pressed={settings.theme===value} onClick={()=>onChange('theme',value)}>
          <WorkspaceSample theme={value==='system'?appearance.systemTheme:value} design={settings.design}/>
          <span className="appearance-option-name"><span><Icon size={14}/><strong>{label}</strong></span><SelectionMark/></span>
        </button>)}
      </div>
    </div>
    <div className="appearance-choice">
      <span className="appearance-label">{t("appearance.interface_style")}</span>
      <div className="appearance-options" role="group" aria-label={t("appearance.interface_style")}>
        {designs().map(([value,label,description])=><button key={value} type="button" className="appearance-option"
          aria-label={t("appearance.style", { v0: label })} aria-pressed={settings.design===value} onClick={()=>onChange('design',value)}>
          <WorkspaceSample theme={appearance.resolvedTheme} design={value}/>
          <span className="appearance-option-name"><span><strong>{label}</strong></span><SelectionMark/></span>
          <small className="appearance-option-note">{description}</small>
        </button>)}
      </div>
    </div>
    <AccentControl value={settings.accentColor} onAccent={appearance.onAccent} onChange={onChange}/>
    <div className="appearance-performance">
      <Gauge size={18} aria-hidden="true"/>
      <div><strong>{t("appearance.performance_mode")}</strong><p id={descriptionId}>{t("appearance.reduce_decorative_effects_to_keep_the_interface_responsive")}</p></div>
      <button type="button" className={`toggle${settings.performanceMode?' on':''}`} role="switch" aria-label={t("appearance.performance_mode")}
        aria-checked={settings.performanceMode} aria-describedby={descriptionId}
        onClick={()=>onChange('performanceMode',!settings.performanceMode)}><span/></button>
    </div>
  </div>;
}

export function AppearanceSettings({ settings, appearance, onChange, splashControl }) {
  return <section className="settings-card appearance-card">
    <div className="appearance-heading"><h3><Palette size={18}/>{t("appearance.appearance")}</h3></div>
    <AppearanceControls settings={settings} appearance={appearance} onChange={onChange}/>
    {splashControl}
  </section>;
}

export function WelcomeAppearance({ settings, appearance, onChange }) {
  return <details className="welcome-appearance">
    <summary><Palette size={18}/><strong>{t("appearance.make_apertrove_yours")}</strong><ChevronDown size={16}/></summary>
    <div className="welcome-appearance-body">
      <p>{t("appearance.choose_an_appearance_you_ll_enjoy_working_in")}</p>
      <AppearanceControls settings={settings} appearance={appearance} onChange={onChange}/>
    </div>
  </details>;
}
