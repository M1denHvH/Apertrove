import { t, localized } from "./i18n.js";
import React, { useState } from 'react';
import { Check, ChevronRight, Copy, Plus, Trash2 } from 'lucide-react';
import Select from './Select';
import { HARMONIES, hexToHsl, hslToHex, lightingPalette, wrapHue } from './lighting-colors.mjs';
import { CREATIVE_PRESETS, SCHEMES } from './lighting-guide';
import './lighting-studio.css';

const STORAGE_KEY = 'apertrove-lighting-palettes';
const HEX = /^#[0-9a-f]{6}$/i;
const MAX_FAVORITES = 40;
const sections = localized(() => ([['palette', t("lightingStudio.palette")], ['schemes', t("lightingStudio.lighting_setups")], ['presets', t("lightingStudio.recipes")]]));

function readFavorites() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(value) ? value.filter(item => item && typeof item.hex === 'string' && HEX.test(item.hex) && Object.hasOwn(HARMONIES, item.harmony)).slice(0, MAX_FAVORITES) : [];
  } catch { return []; }
}

function Wheel({ base, palette, onChange }) {
  function choose(event) {
    const { left, top, width, height } = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - left - width / 2;
    const y = event.clientY - top - height / 2;
    const distance = Math.hypot(x, y);
    onChange({ ...base, h: distance < 1 ? base.h : Math.round(wrapHue(Math.atan2(x, -y) * 180 / Math.PI)) % 360, s: Math.round(Math.min(100, distance / (width * .48) * 100)) });
  }
  return <div className="lighting-wheel-area">
    <div className="lighting-wheel" aria-hidden="true"
      onPointerDown={event => { if (event.button === 0) { event.currentTarget.setPointerCapture(event.pointerId); choose(event); } }}
      onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) choose(event); }}>
      {palette.map(({ hsl, role, hex }, index) => {
        const angle = hsl.h * Math.PI / 180;
        const radius = hsl.s * .48;
        return <span key={role} className={index === 0 ? 'base-marker' : ''} style={{ left: `${50 + Math.sin(angle) * radius}%`, top: `${50 - Math.cos(angle) * radius}%`, background: hex }}/>;
      })}
    </div>
    <div className="lighting-sliders">
      {[['h', t("lightingStudio.hue"), 359, '°'], ['s', t("lightingStudio.saturation"), 100, '%'], ['l', t("lightingStudio.lightness"), 100, '%']].map(([key, label, max, unit]) =>
        <label key={key}><span>{label}<output>{Math.round(base[key])}{unit}</output></span>
          <input type="range" aria-label={label} min="0" max={max} value={Math.round(base[key])} onChange={event => onChange({ ...base, [key]: Number(event.target.value) })}/>
        </label>
      )}
    </div>
  </div>;
}

function Swatches({ palette, onCopy, copied }) {
  return <div className="lighting-swatches">{palette.map(({ role, hex }) => (
    <button type="button" key={role} onClick={() => onCopy(hex)} title={t("lightingStudio.copy", { v0: hex })} aria-label={t("lightingStudio.copy_2", { v0: t(role).toLocaleLowerCase(), v1: hex })}>
      <span className="lighting-swatch" style={{ background: hex }}/>
      <span className="lighting-swatch-info"><span>{t(role)}</span><strong>{hex}</strong></span>
      {copied === hex ? <Check size={14}/> : <Copy size={14}/>}
    </button>
  ))}</div>;
}

function LightDiagram({ scheme, selected, onSelect }) {
  const { fixtures } = scheme;
  return <div className="lighting-diagram">
    <svg key={scheme.id} viewBox="0 0 480 330" role="img" aria-label={t("lightingStudio.overhead_view_of_subject_at_center_camera_below", { v0: scheme.name })}>
      <defs><marker id="studio-beam-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0 6 3 0 6Z" fill="context-stroke"/></marker></defs>
      <path className="lighting-backdrop-line" d="M72 49H408"/>
      <text x="240" y="34">{t("lightingStudio.backdrop")}</text>
      <path className="lighting-axis" d="M240 169V275"/>
      {fixtures.map(item => {
        const targetX = item.id === 'background' ? item.x : 240;
        const targetY = item.id === 'background' ? 55 : item.y > 151 ? 169 : 132;
        return <line key={item.id} x1={item.x} y1={item.y} x2={targetX} y2={targetY}
          className={selected === item.id ? 'lighting-beam selected' : 'lighting-beam'} markerEnd="url(#studio-beam-arrow)"/>;
      })}
      <path className="lighting-subject" d="M211 143Q240 120 269 143V152Q240 143 211 152Z"/>
      <circle className="lighting-subject" cx="240" cy="148" r="16"/>
      <path className="lighting-direction" d="M234 156l6 7 6-7"/>
      <text x="240" y="119">{t("lightingStudio.subject")}</text>
      <rect className="lighting-subject" x="222" y="271" width="36" height="18" rx="4"/>
      <path className="lighting-direction" d="M232 271v-6h16v6"/>
      <text x="240" y="309">{t("lightingStudio.camera")}</text>
      {fixtures.map((item, index) => <g key={item.id} onClick={() => onSelect(item.id)} className={`lighting-node ${selected === item.id ? 'selected' : ''}`}>
        <circle cx={item.x} cy={item.y} r="15"/>
        <text x={item.x} y={item.y + 4}>{index + 1}</text>
      </g>)}
    </svg>
    <div className="lighting-fixtures">{fixtures.map((item, index) =>
      <button key={item.id} className="btn" aria-pressed={selected === item.id} onClick={() => onSelect(item.id)}><span>{index + 1}</span>{item.label}</button>
    )}</div>
  </div>;
}

export default function LightingStudio() {
  const [section, setSection] = useState('palette');
  const [base, setBase] = useState(() => hexToHsl('#9A516B'));
  const [hexInput, setHexInput] = useState('#9A516B');
  const [harmony, setHarmony] = useState('complementary');
  const [favorites, setFavorites] = useState(readFavorites);
  const [schemeId, setSchemeId] = useState('loop');
  const [fixtureId, setFixtureId] = useState('key');
  const [presetIndex, setPresetIndex] = useState(0);
  const preset = CREATIVE_PRESETS()[presetIndex];
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState('');
  const palette = lightingPalette(base, harmony);
  const hex = palette[0].hex;
  const scheme = SCHEMES().find(item => item.id === schemeId);
  const fixture = scheme.fixtures.find(item => item.id === fixtureId);
  const presetScheme = SCHEMES().find(item => item.id === preset.scheme);
  const saved = favorites.some(item => item.hex === hex && item.harmony === harmony);
  const invalid = !HEX.test(hexInput);

  function updateBase(value) {
    setBase(value);
    setHexInput(hslToHex(value));
  }
  function apply(hexValue, rule) {
    updateBase(hexToHsl(hexValue, base.h));
    setHarmony(rule);
    setSection('palette');
  }
  function selectScheme(id) {
    setSchemeId(id);
    setFixtureId('key');
    setSection('schemes');
  }
  function changeFavorites(next) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); setFavorites(next); setNotice(''); }
    catch { setNotice(() => () => (t("lightingStudio.couldn_t_save_palettes_to_the_apertrove_profile"))); }
  }
  async function copy(hexValue) {
    try { await window.focal.copyColor({text:hexValue}); setCopied(hexValue); setNotice(() => () => (t("lightingStudio.copied", { v0: hexValue }))); }
    catch { setNotice(() => () => (t("lightingStudio.couldn_t_copy_the_hex_code"))); }
  }
  return <div className="content-page lighting-studio">
    <div className="segmented lighting-sections" role="group" aria-label={t("lightingStudio.lighting_tools")}>
      {sections().map(([id, label]) => <button key={id} className={id === section ? 'active' : ''} aria-pressed={id === section} onClick={() => { setSection(id); setNotice(''); }}>{label}</button>)}
    </div>
    <p className="lighting-notice" role="status">{typeof notice==='function'?notice():notice}</p>
    {section === 'palette' && <>
      <div className="lighting-layout">
        <section className="lighting-panel">
          <h2>{t("lightingStudio.key_color")}</h2>
          <Wheel base={base} palette={palette} onChange={updateBase}/>
          <label className="lighting-hex">HEX
            <input aria-label={t("lightingStudio.key_color_hex")} aria-invalid={invalid} value={hexInput} maxLength={7}
              onChange={event => { const next = event.target.value.toUpperCase(); setHexInput(next); if (HEX.test(next)) setBase(hexToHsl(next, base.h)); }}/>
          </label>
          {invalid && <p className="lighting-error">{t("lightingStudio.enter_a_hex_value_in_rrggbb_format")}</p>}
        </section>
        <section className="lighting-panel">
          <h2>{t("lightingStudio.color_harmony")}</h2>
          <Select aria-label={t("lightingStudio.color_harmony")} value={harmony} onChange={event => setHarmony(event.target.value)}>
            {Object.entries(HARMONIES).map(([id, rule]) => <option value={id} key={id}>{t(rule.label)}</option>)}
          </Select>
          <Swatches palette={palette} onCopy={copy} copied={copied}/>
          <p>{t(HARMONIES[harmony].note)}</p>
          <p>{base.s < 1 ? t("lightingStudio.the_key_color_is_neutral_increase_saturation_to") : t("lightingStudio.keep_the_key_light_neutral_for_natural_skin")}</p>
          <button className="btn" disabled={saved || invalid || favorites.length >= MAX_FAVORITES} onClick={() => changeFavorites([...favorites, { hex, harmony }])}><Plus size={16}/>{saved ? t("lightingStudio.palette_saved") : t("lightingStudio.save_palette")}</button>
          {favorites.length >= MAX_FAVORITES && !saved && <p>{t("lightingStudio.remove_one_of_the_40_saved_palettes_to")}</p>}
        </section>
      </div>
      {favorites.length > 0 && <section className="lighting-panel lighting-favorites">
        <h2>{t("lightingStudio.saved_palettes")}</h2>
        <ul>{favorites.map((item, index) => <li key={item.hex + item.harmony}>
          <button className="btn" onClick={() => apply(item.hex, item.harmony)}><span className="lighting-dot" style={{ background: item.hex }}/>{item.hex} · {t(HARMONIES[item.harmony].label)}</button>
          <button className="icon-btn" title={t("lightingStudio.delete_palette")} aria-label={t("lightingStudio.delete_palette_2", { v0: item.hex, v1: t(HARMONIES[item.harmony].label) })} onClick={() => changeFavorites(favorites.filter((_, i) => i !== index))}><Trash2 size={15}/></button>
        </li>)}</ul>
      </section>}
    </>}
    {section === 'schemes' && <div className="lighting-layout">
      <section className="lighting-panel">
        <h2>{t("lightingStudio.overhead_diagram")}</h2>
        <Select aria-label={t("lightingStudio.lighting_setup")} value={schemeId} onChange={event => selectScheme(event.target.value)}>
          {SCHEMES().map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </Select>
        <LightDiagram scheme={scheme} selected={fixtureId} onSelect={setFixtureId}/>
      </section>
      <section className="lighting-panel">
        <h2>{scheme.title}</h2>
        <div key={scheme.id+fixtureId} className="lighting-fixture-detail" aria-live="polite"><strong>{fixture.label}</strong><span>{fixture.height}</span><p>{fixture.detail}</p></div>
        <h3>{t("lightingStudio.set_up_the_lights")}</h3><ol>{scheme.steps.map(step => <li key={step}>{step}</li>)}</ol>
      </section>
    </div>}
    {section === 'presets' && <>
      <div className="lighting-presets" role="group" aria-label={t("lightingStudio.lighting_recipes")}>{CREATIVE_PRESETS().map((item,index) => <button key={item.name} className="btn" aria-pressed={item === preset} onClick={() => setPresetIndex(index)}>{item.name}</button>)}</div>
      <div className="lighting-layout">
        <section className="lighting-panel">
          <h2>{t("lightingStudio.palette_and_setup")}</h2>
          <Swatches palette={lightingPalette(hexToHsl(preset.hex), preset.harmony)} onCopy={copy} copied={copied}/>
          <div className="lighting-presets">
            <button className="btn" onClick={() => apply(preset.hex, preset.harmony)}>{t("lightingStudio.use_this_palette")}<ChevronRight size={14}/></button>
            <button className="btn" onClick={() => selectScheme(preset.scheme)}>{presetScheme.name} <ChevronRight size={14}/></button>
          </div>
        </section>
        <section className="lighting-panel"><h2>{preset.name}</h2><h3>{t("lightingStudio.equipment")}</h3><p>{preset.gear}</p>
          <h3>{t("lightingStudio.steps")}</h3><ol>{preset.steps.map(step => <li key={step}>{step}</li>)}</ol>
          <h3>{t("lightingStudio.the_look")}</h3><p>{preset.result}</p>
        </section>
      </div>
    </>}
  </div>;
}
