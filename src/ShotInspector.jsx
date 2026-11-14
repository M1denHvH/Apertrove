import { t, useLocale, setLocale, legacy, number } from "./i18n.js";
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Camera, Copy, FolderOpen, ImageOff, Maximize, Minus, PanelRight, Pin, Plus, RefreshCw } from 'lucide-react';
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import './style.css';
import './theme.css';
import './designs.css';
import './interface.css';
import './shot-inspector.css';
import '../electron/remote/appearance.js';
import { flatten, readable } from './PhotoMetadata';
import { shotGroups } from './shot-metadata';

const api = window.shotInspector;
const prefKey = 'shot-inspector-view';
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const zero = { x: 0, y: 0 };
function preferences() {
  try {
    const value = JSON.parse(localStorage.getItem(prefKey));
    return { panel: value?.panel !== false, zoom: Number.isFinite(value?.zoom) ? clamp(value.zoom, .0001, 8) : 'fit' };
  } catch { return { panel: true, zoom: 'fit' }; }
}

function Histogram({ bins, source }) {
  const max = Math.max(1, ...bins.flat());
  return <section className="shot-histogram">
    <h2>{t("inspector.rgb_histogram")}</h2>
    <svg viewBox="0 0 256 62" preserveAspectRatio="none" role="img" aria-label={t("inspector.red_green_and_blue_channel_distribution")}>
      {bins.map((values, index) => <polyline key={index} points={values.map((v, i) => `${i * 256 / (values.length - 1)},${61 - Math.sqrt(v / max) * 60}`).join(' ')} fill="none" stroke={['#eb7477', '#62b988', '#68a1e5'][index]} strokeWidth="2" vectorEffect="non-scaling-stroke"/>)}
    </svg>
    <small>{source === 'embedded' ? t("inspector.embedded_raw_jpeg_preview") : t("inspector.displayed_image_in_srgb")}</small>
  </section>;
}

function Inspector() {
  const locale=useLocale();
  const [prefs] = useState(preferences);
  const [latest, setLatest] = useState(null);
  const [pinned, setPinned] = useState(null);
  const [details, setDetails] = useState({});
  const [size, setSize] = useState(null);
  const [viewport, setViewport] = useState({ width: 1, height: 1, dpr: window.devicePixelRatio });
  const [zoom, setZoom] = useState(prefs.zoom);
  const [panel, setPanel] = useState(prefs.panel);
  const [offset, setOffset] = useState(zero);
  const [dragging, setDragging] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);
  const [bootError, setBootError] = useState(false);
  const [booting, setBooting] = useState(true);
  const stage = useRef(null);
  const drag = useRef(null);
  const revision = useRef(0);
  const displayed = pinned || latest;
  const id = displayed?.id ?? null;

  useEffect(() => {
    let active = true, received = false;
    function apply(state) {
      setLocale(state.locale);
      globalThis.ApertroveAppearance.apply(state.appearance);
      setLatest(state.latest);
      if (state.removedId) setPinned(old => old?.id === state.removedId ? null : old);
      setBooting(false);
    }
    const off = api.onState(state => { received = true; apply(state); });
    api.boot().then(state => { if (active && !received) apply(state); })
      .catch(() => { if (active && !received) { setBootError(true); setBooting(false); } });
    return () => { active = false; off(); };
  }, []);

  useEffect(() => {
    try { localStorage.setItem(prefKey, JSON.stringify({ panel, zoom })); } catch {}
  }, [panel, zoom]);

  useLayoutEffect(() => {
    const node = stage.current;
    let density;
    const measure = () => {
      density?.removeEventListener('change', measure);
      density = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      density.addEventListener('change', measure);
      setViewport({ width: node.clientWidth, height: node.clientHeight, dpr: window.devicePixelRatio });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => { observer.disconnect(); density?.removeEventListener('change', measure); };
  }, []);

  useLayoutEffect(() => {
    const ticket = ++revision.current;
    let active = true, timer;
    const off = api.onDetails(message => {
      if (message.revision === ticket && message.id === id) setDetails(old => ({ ...old, ...message }));
    });
    setDetails({});
    setSize(null);
    setOffset(zero);
    setNotice('');
    drag.current = null;
    setDragging(false);
    const request = () => {
      api.view(id, ticket).then(result => {
        if (active && result?.busy) timer = setTimeout(request, 250);
      }).catch(() => { if (active) setDetails({ loadFailed: true, done: true }); });
    };
    request();
    return () => { active = false; clearTimeout(timer); off(); };
  }, [id, retry]);

  const fit = size ? Math.min(viewport.width / size.width, viewport.height / size.height) : 1;
  const scale = zoom === 'fit' ? fit : zoom / viewport.dpr;
  const limitX = size ? Math.max(0, (size.width * scale - viewport.width) / 2) : 0;
  const limitY = size ? Math.max(0, (size.height * scale - viewport.height) / 2) : 0;
  const x = clamp(offset.x, -limitX, limitX);
  const y = clamp(offset.y, -limitY, limitY);

  function zoomTo(value, pointer) {
    if (!size) return;
    const next = value === 'fit' ? 'fit' : clamp(value, Math.min(.05, fit * viewport.dpr), 8);
    if (!pointer || next === 'fit') setOffset(zero);
    else {
      const ratio = next / viewport.dpr / scale;
      const box = stage.current.getBoundingClientRect();
      const anchorX = pointer.clientX - box.left - box.width / 2;
      const anchorY = pointer.clientY - box.top - box.height / 2;
      const maxX = Math.max(0, (size.width * next / viewport.dpr - viewport.width) / 2);
      const maxY = Math.max(0, (size.height * next / viewport.dpr - viewport.height) / 2);
      setOffset({ x: clamp(anchorX + (x - anchorX) * ratio, -maxX, maxX), y: clamp(anchorY + (y - anchorY) * ratio, -maxY, maxY) });
    }
    setZoom(next);
  }

  function changeZoom(factor, pointer) {
    zoomTo(scale * viewport.dpr * factor, pointer);
  }
  const toggleFit = () => zoomTo(zoom === 'fit' ? 1 : 'fit');
  const togglePin = () => setPinned(value => value ? null : latest);
  function shortcuts(event) {
    if (event.ctrlKey || event.altKey || event.metaKey || event.target.closest('input,textarea,select')) return;
    const action = { '0': () => zoomTo('fit'), '1': () => zoomTo(1), '+': () => changeZoom(1.25), '=': () => changeZoom(1.25),
      '-': () => changeZoom(.8) }[event.key] || { KeyP: togglePin, KeyI: () => setPanel(value => !value) }[event.code];
    if (action && (!event.repeat || ['+', '=', '-'].includes(event.key))) { event.preventDefault(); action(); }
  }
  function endDrag() { drag.current = null; setDragging(false); }

  const groups = useMemo(() => shotGroups(displayed?.name, details.report), [displayed?.name, details.report, locale]);
  const tags = useMemo(() => showTags && details.report ? flatten(details.report.metadata) : [], [showTags, details.report, locale]);
  async function copy() {
    try {
      await api.copy(groups.map(([title, rows]) => [title, ...rows.map(([key, value]) => `${key}: ${value}`)].join('\n')).join('\n\n'));
      setNotice(() => () => (t("inspector.technical_details_copied")));
    } catch { setNotice(() => () => (t("inspector.couldn_t_copy_the_details"))); }
  }
  const photoError = details.loadFailed ? t("inspector.photo_unavailable_try_loading_it_again") : legacy(details.error);
  const imageError = details.imageFailed ? t("inspector.couldn_t_open_the_image") : photoError;
  const source = details.image?.source;

  return <div className="shot-shell" onKeyDown={shortcuts} tabIndex={-1} ref={node => { if (node && document.activeElement === document.body) node.focus(); }}>
    <header className="shot-toolbar">
      <div className="shot-title"><strong>Shot Inspector</strong><span title={displayed?.name}>{displayed?.name || t("inspector.latest_photo")}</span></div>
      <div className="shot-actions" role="group" aria-label={t("inspector.zoom")}>
        <button className="btn" disabled={!size} aria-pressed={zoom === 'fit'} title={t("inspector.fit_to_window_0")} onClick={() => zoomTo('fit')}><Maximize size={15}/>Fit</button>
        <button className="btn" disabled={!size} aria-pressed={zoom === 1} title={t("inspector.actual_pixels_1")} onClick={() => zoomTo(1)}>100%</button>
        <button className="icon-btn" aria-label={t("inspector.zoom_out")} title={t("inspector.zoom_out_2")} disabled={!size} onClick={() => changeZoom(.8)}><Minus size={16}/></button>
        <button className="icon-btn" aria-label={t("inspector.zoom_in")} title={t("inspector.zoom_in_2")} disabled={!size} onClick={() => changeZoom(1.25)}><Plus size={16}/></button>
        <span className="shot-scale">{size ? number(scale * viewport.dpr, {style:'percent',maximumFractionDigits:1}) : '—'}</span>
      </div>
      <div className="shot-actions">
        <button className="icon-btn" aria-label={t("inspector.pin_photo")} title={t("inspector.pin_photo_p")} aria-pressed={!!pinned} disabled={!displayed} onClick={togglePin}><Pin size={17}/></button>
        <button className="icon-btn" aria-label={t("inspector.metadata")} title={t("inspector.metadata_panel_i")} aria-pressed={panel} onClick={() => setPanel(value => !value)}><PanelRight size={17}/></button>
      </div>
    </header>
    <div className={`shot-body ${panel ? 'has-metadata' : ''}`}>
      <div ref={stage} className={`shot-stage ${dragging ? 'dragging' : limitX || limitY ? 'pannable' : ''}`}
        onDoubleClick={event => { if (event.target.closest('button')) return; toggleFit(); }}
        onWheel={event => { if (size) changeZoom(Math.exp(-clamp(event.deltaY * (event.deltaMode ? 18 : 1), -180, 180) * .0025), event); }}
        onPointerDown={event => {
          if (event.button !== 0 || !(limitX || limitY) || event.target.closest('button')) return;
          drag.current = { id: event.pointerId, x: event.clientX - x, y: event.clientY - y };
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
        }}
        onPointerMove={event => {
          if (drag.current?.id === event.pointerId) setOffset({ x: clamp(event.clientX - drag.current.x, -limitX, limitX), y: clamp(event.clientY - drag.current.y, -limitY, limitY) });
        }}
        onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}>
        {details.image && !imageError && <img key={details.image.url} data-loaded={size ? '' : undefined} src={details.image.url} alt={displayed?.name} draggable="false"
          style={size ? { width: size.width, height: size.height, transform: `translate3d(${x}px,${y}px,0) scale(${scale})` } : { visibility: 'hidden' }}
          onLoad={event => {
            const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
            setSize({ width, height });
          }} onError={() => setDetails(old => ({ ...old, imageFailed: true }))}/>}
        {!size && <div className="shot-empty" role="status">
          {imageError || bootError ? <ImageOff size={30}/> : <Camera size={30}/>}
          <strong>{imageError || (bootError ? t("inspector.couldn_t_open_shot_inspector") : booting || id ? t("inspector.loading_photo") : t("inspector.no_photos_from_the_camera_yet"))}</strong>
          {!booting && !id && !bootError && <p>{t("inspector.take_a_photo_with_transfer_to_this_computer")}</p>}
          {imageError && <button className="btn" onClick={() => setRetry(value => value + 1)}><RefreshCw size={14}/>{t("inspector.retry")}</button>}
        </div>}
        {source === 'embedded' && size && <span className="shot-image-label">{t("inspector.raw_embedded_jpeg_preview")}</span>}
      </div>
      {panel && <aside className="shot-meta" aria-label={t("inspector.technical_details")}>
        <div className="shot-meta-actions">
          <button className="icon-btn" aria-label={t("inspector.show_original_in_folder")} title={t("inspector.show_original_in_folder")} disabled={!details.fileAvailable}
            onClick={() => api.reveal(id).catch(() => setNotice(() => () => (t("inspector.the_original_was_moved_or_deleted"))))}><FolderOpen size={17}/></button>
          <button className="icon-btn" aria-label={t("inspector.copy_technical_details")} title={t("inspector.copy_technical_details")} disabled={!details.report} onClick={copy}><Copy size={16}/></button>
          <span role="status">{typeof notice==='function'?notice():notice}</span>
        </div>
        {displayed && !details.report && <p>{legacy(details.reportError) || photoError || t("inspector.reading_exif")}</p>}
        {!displayed && <p>{t("inspector.technical_details_will_appear_with_the_photo")}</p>}
        {groups.map(([title, rows]) => <section className="shot-meta-section" key={title}><h2>{title}</h2><dl>
          {rows.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}
        </dl></section>)}
        {details.histogram && <Histogram bins={details.histogram} source={source}/>}
        {details.report && <details className="shot-tags" open={showTags} onToggle={event => setShowTags(event.currentTarget.open)}>
          <summary>{t("inspector.all_available_tags")}</summary>
          {showTags && <><dl>{tags.map(({ key, value }) => <div key={key}><dt>{key}</dt><dd>{readable(value)}</dd></div>)}</dl>
            {!tags.length && <p>{t("inspector.there_are_no_exif_tags_or_other_metadata")}</p>}
            {details.report.errors.map(error => <p key={error}>{legacy(error)}</p>)}</>}
        </details>}
      </aside>}
    </div>
    {pinned && <footer className="shot-pin-status" role="status"><Pin size={13}/>{t("inspector.photo_pinned")}<button className="text-button" onClick={togglePin}>{t("inspector.follow_new_photos")}</button></footer>}
  </div>;
}

createRoot(document.getElementById('root')).render(<Inspector/>);
