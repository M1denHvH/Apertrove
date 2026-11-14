import LanguageSettings from './LanguageSettings';
import { t, localized, legacy } from "./i18n.js";
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, Camera, Check, CircleAlert, Cpu, FolderOpen, Info, RefreshCw, TriangleAlert } from 'lucide-react';
import { gsap } from 'gsap';
import { motionDuration, withMotion } from './motion';
import Select from './Select';
import SetupArtwork from './SetupArtwork';
import { WelcomeAppearance } from './AppearanceControls';
import CapabilityReport, { formatSpace, SetupAccordion } from './SetupReport';
import './onboarding.css';

const steps = localized(() => ([
  ['welcome', t("onboarding.welcome"), t("onboarding.hi_this_is_apertrove"), t("onboarding.let_s_get_to_know_your_canon_and")],
  ['environment', t("onboarding.canon_components"), t("onboarding.set_up_canon_components"), t("onboarding.apertrove_uses_canon_edsdk_to_talk_to_your")],
  ['discovery', t("onboarding.camera"), t("onboarding.let_s_meet_your_camera"), t("onboarding.we_ll_see_which_controls_are_available_in")],
  ['connection', t("onboarding.connection"), t("onboarding.connect_for_shooting"), t("onboarding.choose_where_new_photos_should_be_saved")],
  ['workspace', t("onboarding.sessions"), t("onboarding.a_place_for_your_photos"), t("onboarding.choose_the_folder_where_apertrove_will_create_new")],
  ['tutorial', t("onboarding.tutorial"), t("onboarding.get_to_know_apertrove"), t("onboarding.see_where_to_frame_a_shot_set_exposure")],
  ['ready', t("onboarding.ready"), t("onboarding.you_re_all_set"), t("onboarding.now_you_can_focus_on_the_shot")]
]));
const message = error => String(error?.message || error).replace(/^Error invoking remote method '[^']+': Error: /,'');
const continueLabels = localized(() => ([t("onboarding.start_setup"), t("onboarding.check_the_camera"), t("onboarding.connection_setup"), t("onboarding.choose_a_folder"), t("onboarding.go_to_tutorial"), t("onboarding.finish_setup")]));
const components = localized(() => ({ ready:t("onboarding.ready_to_use"), error:t("onboarding.couldn_t_load"), architecture:t("onboarding.incompatible"), missing:t("onboarding.file_not_found"), unreadable:t("onboarding.couldn_t_read_file") }));
function recovery(detail, step, operation) {
  if (/занят|busy|EOS Utility.*повтор/i.test(detail)) return [t("onboarding.camera_is_busy"), t("onboarding.close_eos_utility_or_wait_for_the_camera")];
  if (/отключилась|прервано|не обнаружена|не найдена|disconnected|connection lost|not found/i.test(detail) && ['discovery','connection'].includes(step)) return [t("onboarding.camera_connection_lost"), t("onboarding.check_the_power_and_usb_cable_then_look")];
  if (step === 'workspace' && operation?.startsWith('onboarding.checking_write')) return [t("onboarding.apertrove_can_t_write_to_this_folder_yet"), t("onboarding.try_a_different_folder_or_check_its_write")];
  return [t("onboarding.the_check_didn_t_finish"), t("onboarding.try_again_or_continue_with_setup")];
}

function Result({ tone = 'neutral', title, children, icon: Icon, alert = false }) {
  const Mark = Icon || ({ success: Check, warning: TriangleAlert, error: CircleAlert }[tone] || Info);
  return <div className="setup-result" data-tone={tone} role={alert ? 'alert' : undefined}>
    <span className="setup-icon-tile">{tone==='success' && !Icon
      ? <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path className="setup-tick" pathLength="1" d="m5 12 4 4L19 6"/></svg>
      : <Mark size={19} strokeWidth={1.65} aria-hidden="true"/>}</span>
    <div><strong>{title}</strong>{children}</div>
  </div>;
}

export default function Onboarding({ initialStep, mode, data, onExit, onTutorial, onUpdate }) {
  const api = window.focal;
  const saved = data.settings.onboarding;
  const [index,setIndex] = useState(Math.max(0, steps().findIndex(step=>step[0]===(initialStep || saved.step))));
  const [devices,setDevices] = useState([]);
  const [selected,setSelected] = useState('');
  const [saveTo,setSaveTo] = useState(data.settings.savePreference===2?2:3);
  const [working,setWorking] = useState(data.camera.working===true);
  const [scanned,setScanned] = useState(false);
  const [busy,setBusy] = useState('');
  const [error,setError] = useState('');
  const screen = useRef(null);
  const content = useRef(null);
  const active = useRef(false);
  const autoEnvironment = useRef(false);
  const direction = useRef(1);
  const seenConnection = useRef(false);
  const [step,,title,description] = steps()[index];
  const environment = saved.environment;
  const report = saved.report;
  const camera = data.camera;
  const cameraReady = camera.connected && camera.working && [2,3].includes(camera.saveTo);
  const cameraStep = step==='discovery'||step==='connection';
  const matchingCamera = camera.connected && (!selected || selected===camera.cameraId);
  const matchedReport = matchingCamera && camera.model===report?.model;
  const sdkAvailable = environment?.status === 'ready';
  const workspaceReady = !!saved.workspace;
  const deviceFound = devices.find(item=>item.id===selected);
  const tone = error?'error':busy?'busy':step==='environment'&&environment
    ? sdkAvailable?'success':environment.status==='error'?'error':'warning'
    : step==='workspace'&&workspaceReady || step==='ready' || cameraStep&&matchingCamera&& (step==='discovery'||cameraReady) ? 'success'
    : step==='connection'&&matchingCamera&&working?'warning':'neutral';
  const errorCopy = error ? recovery(error.detail, step, error.operation) : null;
  useEffect(()=>{if(camera.connected)seenConnection.current=true;},[camera.connected]);

  const task = async (key,fn) => {
    if(active.current)return;
    active.current=true;setBusy(key);setError('');
    try{return await fn();}catch(error){setError({detail:message(error),operation:key});}
    finally{active.current=false;setBusy('');}
  };
  async function check(recheck=false) { await task("onboarding.checking_whether_the_canon_library_loads",()=>api.sdkEnvironment({recheck})); }
  async function scan() {
    setScanned(true);
    const entries=await api.listCameras();
    setDevices(entries);
    const id=entries.find(camera=>camera.id===selected)?.id || entries.find(camera=>camera.id===data.camera.cameraId)?.id || (entries.length===1?entries[0].id:'');
    setSelected(id);
    return id;
  }
  useEffect(()=>{
    if(step==='environment'&&!autoEnvironment.current){autoEnvironment.current=true;void check();}
    if(step!=='discovery'&&step!=='connection')return;
    const discover=()=>{if(!active.current&&!data.camera.connected&&environment?.status!=='missing'&&environment?.status!=='error')void task("onboarding.looking_for_your_canon_over_usb",scan);};
    discover();
    const interval=setInterval(()=>{
      if(environment?.status!=='ready'||data.camera.connected||active.current)return;
      active.current=true;
      void scan().catch(()=>{}).finally(()=>{active.current=false;});
    },3500);
    return()=>clearInterval(interval);
  },[step,environment?.status,data.camera.connected,selected]);

  useLayoutEffect(()=>{
    const node=content.current;
    node.scrollTop=0;
    node.querySelector('h1').focus({preventScroll:true});
    return withMotion(node,()=>{
      const standard=motionDuration('standard'), hero=motionDuration('hero');
      const timeline=gsap.timeline({defaults:{ease:'power3.out',clearProps:'transform,opacity'}});
      timeline.from('[data-setup-enter]',{y:7*direction.current,opacity:.58,duration:standard,stagger:.038},0);
      if(step==='ready')timeline.from('.optics-confirm',{scale:.84,opacity:.52,svgOrigin:'160 107',duration:hero},.04);
      timeline.from('.setup-artwork',{opacity:.67,duration:motionDuration('panel')},0);
      timeline.from(screen.current.querySelector('.setup-footer .setup-primary'),{x:4*direction.current,opacity:.7,duration:standard},.07);
    });
  },[step]);

  function move(next, skip=false) {
    return task("onboarding.saving_this_step",async()=>{
      const skipped=skip?[...new Set([...saved.skipped,step])]:saved.skipped;
      if(mode==='setup')await api.onboardingSave({step:steps()[next][0],skipped});
      direction.current=next<index?-1:1;
      setIndex(next);
    });
  }
  const finish=(skip=false)=>task("onboarding.saving_your_settings",async()=>{
    await api.cameraEndDiagnostics();
    if(mode==='setup')await api.onboardingSave({completed:true,step:'ready',...(skip?{skipped:steps().slice(0,-1).map(([id])=>id)}:{})});
    onExit();
  });

  return <section ref={screen} className="setup-screen" aria-labelledby="setup-heading" data-step={step}>
    <div className="setup-frame">
      {mode==='setup'&&<nav className="setup-progress" aria-label={t("onboarding.setup_steps")}>
        <ol>{steps().map(([id,label],i)=><li key={id} className={i<index?'passed':''} aria-current={index===i?'step':undefined} aria-label={label}><i/><span>{label}</span></li>)}</ol>
        <span className="setup-progress-count">{t('common.setup_progress',{current:index+1,total:steps().length})}</span>
      </nav>}
      <div ref={content} className={'setup-content setup-'+step} tabIndex={0} role="region" aria-label={t("onboarding.step_content")}>
        <div className="setup-stage">
          <div className="setup-intro">
            <h1 id="setup-heading" tabIndex={-1} data-setup-enter>{title}</h1>
            <p className="setup-description" data-setup-enter>{step==='ready'&&!cameraReady?t("onboarding.open_a_session_you_can_connect_a_camera"):description}</p>
            {(busy||errorCopy)&&<div className="setup-feedback-area">
              {busy&&<p className="setup-feedback" role="status"><span className="setup-pulse"/>{t(busy)}</p>}
              {errorCopy&&<Result tone="error" title={errorCopy[0]} alert><p>{errorCopy[1]}</p><SetupAccordion title={t("onboarding.details")}><p>{legacy(error.detail)}</p></SetupAccordion></Result>}
            </div>}
          </div>
          <SetupArtwork step={step} state={tone} performanceMode={data.settings.performanceMode}/>
        </div>
        <div className="setup-work" data-setup-enter>
          {step==='welcome'&&<LanguageSettings compact value={data.settings.language} onChange={language=>onUpdate({language})}/>}
          {step==='welcome'&&<WelcomeAppearance settings={data.settings} appearance={data.appearance} onChange={(key,value)=>onUpdate({[key]:value})}/>}
          {step==='environment'&&<>
            {environment&&<Result key={environment.status} tone={busy?'neutral':sdkAvailable?'success':environment.status==='error'?'error':'warning'}
              title={sdkAvailable?t("onboarding.canon_components_are_ready"):environment.status==='error'?t("onboarding.the_canon_library_couldn_t_load"):t("onboarding.we_couldn_t_find_the_canon_components_yet")}>
              <p>{busy?t("onboarding.this_is_the_result_of_the_previous_check"):sdkAvailable?t("onboarding.the_library_loaded_you_can_check_your_camera"):environment.status==='error'?t("onboarding.choose_the_folder_with_the_official_edsdk_or"):t("onboarding.install_eos_utility_for_your_camera_or_select")}</p>
            </Result>}
            {environment&&<SetupAccordion title={t("onboarding.what_apertrove_checked")} icon={Cpu} className="setup-checks">
              {sdkAvailable?<p>{environment.architecture} · {environment.version||t("onboarding.file_version_unknown")}{environment.file&&<small>{environment.file}</small>}</p>:environment.error&&<p>{legacy(environment.error)}</p>}
              {!!environment.checks?.length&&<ul>{environment.checks.map(item=><li key={item.file}><strong>{legacy(item.source)} · {item.architecture}</strong>{item.result&&<span>{components()[item.result]||item.result}</span>}<small>{legacy(item.error)||item.file}</small></li>)}</ul>}
            </SetupAccordion>}
            <div className="setup-actions">
              <button className="btn" disabled={!!busy} onClick={()=>check(true)}><RefreshCw size={15}/>{t("onboarding.check_again")}</button>
              <button className="btn" disabled={!!busy||camera.connected} onClick={()=>task("onboarding.checking_the_library_in_the_selected_folder",async()=>{if(await api.chooseFolder({kind:'sdkDir'}))await api.sdkEnvironment({recheck:true});})}><FolderOpen size={15}/>{t("onboarding.choose_sdk_folder")}</button>
              {!sdkAvailable&&<><button className="btn quiet" disabled={!!busy} onClick={()=>task("onboarding.opening_canon_s_website",()=>api.canonResource({resource:'utility'}))}>{t("onboarding.download_eos_utility")}<ArrowUpRight size={13}/></button>
              <button className="btn quiet" disabled={!!busy} onClick={()=>task("onboarding.opening_canon_s_website",()=>api.canonResource({resource:'sdk'}))}>{t("onboarding.official_edsdk")}<ArrowUpRight size={13}/></button></>}
            </div>
          </>}
          {cameraStep&&<>
            {matchingCamera&&!(step==='connection'&&working)&&!(step==='discovery'&&matchedReport)&&<Result key={camera.model} tone="success" title={camera.model}>
              <p>{step==='discovery'?t("onboarding.your_camera_is_connected_let_s_see_what"):t("onboarding.your_camera_is_connected_choose_where_to_save")}</p>
            </Result>}
            {!matchingCamera&&deviceFound&&<Result title={deviceFound.model} icon={Camera}><p>{t("onboarding.we_found_your_camera_over_usb_it_s")}</p></Result>}
            {!matchingCamera&&!deviceFound&&!devices.length&&!error&&<Result tone={!busy&&seenConnection.current?'warning':'neutral'} title={busy?t("onboarding.checking_the_usb_connection"):seenConnection.current?t("onboarding.the_camera_has_disconnected"):scanned?t("onboarding.we_haven_t_found_your_camera_yet"):t("onboarding.the_camera_isn_t_connected_yet")} icon={busy||!seenConnection.current?Camera:undefined}>
              <p>{busy?t("onboarding.your_camera_model_will_appear_here_when_it"):t("onboarding.turn_on_your_camera_and_connect_it_over")}</p>
            </Result>}
            <div className="setup-controls">
              {devices.length>0&&<Select aria-label={t("onboarding.camera_to_set_up")} value={selected} disabled={!!busy} onChange={event=>{setSelected(event.target.value);setWorking(false);}}>
                <option value="">{t("onboarding.choose_a_camera")}</option>{devices.map((camera,i)=><option key={camera.id} value={camera.id}>{camera.model}{devices.filter(item=>item.model===camera.model).length>1?` · ${i+1}`:''}</option>)}
              </Select>}
              {step==='connection'&&<fieldset className="setup-choice"><legend>{t("onboarding.save_photos_to")}</legend>
                {[[3,t("onboarding.card_and_computer"),t("onboarding.when_the_camera_supports_both_destinations")],[2,t("onboarding.computer_only"),t("onboarding.send_new_photos_to_this_computer")]].map(([value,name,note])=>
                  <label key={value}><input type="radio" name="setup-save-to" value={value} checked={saveTo===value} disabled={!!busy} onChange={()=>{setSaveTo(value);setWorking(false);}}/><span><strong>{name}</strong><small>{note}</small></span></label>)}
              </fieldset>}
            </div>
            <div className="setup-actions">
              <button className="btn" disabled={!!busy} onClick={()=>task("onboarding.looking_for_your_canon_over_usb",scan)}><RefreshCw size={15}/>{t("onboarding.find_cameras")}</button>
              {step==='discovery'?<button className="btn setup-primary" disabled={!!busy||!selected&&!camera.connected} onClick={()=>task("onboarding.getting_to_know_your_camera_reading_settings_and",()=>api.cameraDiagnose({cameraId:selected||undefined}))}>{t("onboarding.check_capabilities")}</button>
                :<button className="btn setup-primary" disabled={!!busy||!selected&&!camera.connected} onClick={()=>task("onboarding.connecting_for_shooting",async()=>{const result=await api.cameraWorking({cameraId:selected||camera.cameraId,savePreference:saveTo});setWorking(!!result.connected);})}>{working?t("onboarding.reconnect"):cameraReady?t("onboarding.apply_save_destination"):t("onboarding.connect_camera")}</button>}
              {mode==='diagnostics'&&<button className="btn quiet" disabled={!!busy} onClick={()=>move(1)}>{t("onboarding.check_sdk")}</button>}
            </div>
            {step==='connection'&&working&&matchingCamera&&<Result tone={cameraReady?'success':'warning'} title={cameraReady?t("onboarding.connected", { v0: camera.model }):t("onboarding.camera_connected_but_transfer_to_the_computer_is")}>
              <p>{camera.saveTo===3?t("onboarding.new_photos_will_save_to_the_card_and"):camera.saveTo===2?t("onboarding.new_photos_will_save_to_the_computer"):t("onboarding.the_camera_didn_t_confirm_it_can_save")}</p>
            </Result>}
            {step==='discovery'&&<CapabilityReport key={report?.checkedAt} report={report} connected={matchedReport}/>}
          </>}
          {step==='workspace'&&<div className="setup-workspace-grid">
            <section className="setup-workspace-panel" aria-label={t("onboarding.session_folder")}>
            {saved.workspace&&<Result tone="success" title={t("onboarding.your_session_folder_is_ready")}>
              <p className="setup-path" title={saved.workspace.folder}>{saved.workspace.folder}</p>
              {saved.workspace.freeBytes!=null&&<p>{t('common.space_available',{space:formatSpace(saved.workspace.freeBytes)})}</p>}
            </Result>}
            <div className="setup-actions">
              <button className="btn" disabled={!!busy} onClick={()=>task("onboarding.checking_write_access",()=>api.setupFolder({choose:true}))}><FolderOpen size={15}/>{t("onboarding.choose_folder")}</button>
              <button className="btn" disabled={!!busy} onClick={()=>task("onboarding.checking_write_access_and_free_space",()=>api.setupFolder())}>{workspaceReady?t("onboarding.check_folder_again"):t("onboarding.check_default_folder")}</button>
            </div>
            </section>
            <fieldset className="setup-preferences"><legend>{t("onboarding.how_you_work_with_photos")}</legend>
              <label><input type="checkbox" checked={data.settings.autoSelect} disabled={!!busy} onChange={event=>onUpdate({autoSelect:event.target.checked})}/>{t("onboarding.show_each_new_photo_as_it_arrives")}</label>
              <label><input type="checkbox" checked={data.settings.setupSessionSubfolder!==false} disabled={!!busy} onChange={event=>onUpdate({setupSessionSubfolder:event.target.checked})}/>{t("onboarding.create_a_subfolder_for_each_session")}</label>
            </fieldset>
          </div>}
          {step==='tutorial'&&<button className="btn setup-primary" disabled={!!busy} onClick={()=>task("onboarding.opening_the_tutorial",async()=>{await api.cameraEndDiagnostics();onTutorial(saved.topic);})}>{saved.topic==='live'?t("onboarding.start_tutorial"):t("onboarding.continue_tutorial")} <ArrowRight size={16}/></button>}
          {step==='ready'&&<ul className="setup-recap">
            <li>{cameraReady?<Check size={16}/>:<Info size={16}/>}<span>{cameraReady?t("onboarding.is_connected", { v0: camera.model }):t("onboarding.you_can_connect_a_camera_whenever_you_re")}</span></li>
            <li>{workspaceReady?<Check size={16}/>:<FolderOpen size={16}/>}<span>{workspaceReady?t("onboarding.session_folder_checked"):t("onboarding.you_can_choose_a_folder_when_you_create")}</span></li>
          </ul>}
        </div>
      </div>
      <footer className="setup-footer">
        {mode==='diagnostics'&&step==='environment'&&<button className="btn quiet" disabled={!!busy} onClick={()=>move(2)}><ArrowLeft size={15}/>{t("onboarding.camera_diagnostics")}</button>}
        {mode==='setup'&&index>0&&<button className="btn quiet" disabled={!!busy} onClick={()=>move(index-1)}><ArrowLeft size={15}/>{t("onboarding.back")}</button>}
        <span/>
        {mode==='setup'&&index<steps().length-1&&<button className="btn quiet setup-skip" disabled={!!busy} onClick={()=>index===0?finish(true):move(index+1,true)}>{index===0?t("onboarding.set_up_later"):step==='tutorial'?t("onboarding.do_this_later"):t("onboarding.skip_step")}</button>}
        {mode!=='setup'||step==='ready'?<button className="btn setup-primary" disabled={!!busy} onClick={()=>finish()}>{mode==='setup'?(cameraReady?t("onboarding.go_to_sessions"):t("onboarding.open_apertrove")):t("onboarding.close")} <ArrowRight size={16}/></button>
          :<button className="btn setup-primary" disabled={!!busy} onClick={()=>move(index+1)}>{continueLabels()[index]} <ArrowRight size={16}/></button>}
      </footer>
    </div>
  </section>;
}
