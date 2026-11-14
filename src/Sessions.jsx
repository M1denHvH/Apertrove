import { t, date as formatDate, legacy } from "./i18n.js";
import React,{useState} from 'react';
import {Plus,Camera,Images,FolderOpen,Pencil,Search,CalendarDays,Trash2,AlertCircle} from 'lucide-react';
const date=value=>formatDate(value,{day:'numeric',month:'short',year:'numeric'});
export function SessionHub({data,onCreate,onOpen,onEdit,onDelete,busy}){
  const [query,setQuery]=useState('');
  const sessions=data.sessions.filter(s=>`${s.name} ${s.client} ${s.description}`.toLowerCase().includes(query.toLowerCase())).slice().sort((a,b)=>new Date(b.updated||b.created)-new Date(a.updated||a.created));
  const createButton=<button className="btn dark" onClick={onCreate} disabled={busy}><Plus size={16}/>{t("sessions.create_session")}</button>;
  if(!data.sessions.length)return <div className="content-page sessions-page sessions-empty">
    <div className="page-empty">
      <FolderOpen size={34} strokeWidth={1.5}/>
      <h2>{t("sessions.no_sessions_yet")}</h2>
      <p>{t("sessions.create_a_session_to_start_shooting")}</p>
      {createButton}
    </div>
  </div>;
  return <div className="content-page sessions-page">
    <div className="session-toolbar">
      <label className="search"><Search size={15}/><input aria-label={t("sessions.search_sessions")} placeholder={t("sessions.name_or_client")} value={query} onChange={e=>setQuery(e.target.value)}/></label>
      <span className="session-total">{t('count.sessions',{count:sessions.length})}</span>
      {createButton}
    </div>
    <div className="sessions-grid">
      {sessions.map(session=>{const photos=data.photos.filter(p=>p.sessionId===session.id),cover=photos.slice().reverse().find(p=>p.thumb);return <article className="session-card" key={session.id}>
        <button className="session-cover" onClick={()=>onOpen(session.id,'library')} disabled={busy} aria-label={t("sessions.photos", { v0: session.name })}>{cover?<img src={cover.thumb} alt=""/>:<Camera size={44} strokeWidth={1}/>}<span className="session-file-count"><Images size={12}/>{photos.length}</span>{data.sessionId===session.id&&<span className="session-current">{t("sessions.open")}</span>}</button>
        <div className="session-card-body"><div className="session-card-title"><div><h3>{session.name}</h3><span>{session.client||t("sessions.personal_session")}</span></div><div className="session-card-tools"><button className="icon-btn" aria-label={t("sessions.configure_session", { v0: session.name })} title={t("sessions.session_settings")} onClick={()=>onEdit(session)} disabled={busy}><Pencil size={15}/></button><button className="icon-btn session-delete-icon" aria-label={t("sessions.delete_session", { v0: session.name })} title={t("sessions.delete_session_2")} onClick={()=>onDelete(session)} disabled={busy}><Trash2 size={15}/></button></div></div>{session.description&&<p className="session-description">{session.description}</p>}<div className="session-card-meta"><span><CalendarDays size={12}/>{date(session.updated||session.created)}</span><span title={session.captureFolder}><FolderOpen size={12}/>{session.captureFolder?.split(/[\\/]/).filter(Boolean).at(-1)}</span></div><div className="session-card-actions"><button className="btn quiet" onClick={()=>onOpen(session.id,'library')} disabled={busy}><Images size={14}/>{t("sessions.photos_2")}</button><button className="btn dark" onClick={()=>onOpen(session.id,'capture')} disabled={busy}><Camera size={14}/>{t("sessions.resume_shooting")}</button></div></div>
      </article>;})}</div>{query&&!sessions.length&&<div className="page-empty small-empty"><Search size={25}/><p>{t("sessions.no_matching_sessions")}</p><button className="btn" onClick={()=>setQuery('')}>{t("sessions.clear_search")}</button></div>}</div>;
}
export function SessionDialog({entry,settings,onSave,onClose,onDelete,busy,api}){
  const [form,setForm]=useState({name:entry?.name||'',client:entry?.client||'',description:entry?.description||'',folder:entry?.captureFolder||settings.onboarding?.workspace?.folder||'',autofocus:entry?.autofocus??settings.autofocus,grid:entry?.grid??settings.grid,createSubfolder:!entry&&settings.setupSessionSubfolder!==false});
  const [choosing,setChoosing]=useState(false);const change=(key,value)=>setForm(old=>({...old,[key]:value}));
  return <form className="session-form" onSubmit={event=>{event.preventDefault();onSave({...form,...(entry?{id:entry.id}:{})});}}>
    <div className="session-form-grid"><label className="form-label">{t("sessions.session_name")}<input autoFocus required maxLength={100} value={form.name} onChange={e=>change('name',e.target.value)} placeholder={t("sessions.for_example_october_catalog")}/></label><label className="form-label">{t("sessions.client")}<input maxLength={160} value={form.client} onChange={e=>change('client',e.target.value)} placeholder={t("sessions.optional")}/></label></div>
    <label className="form-label">{t("sessions.session_folder")}<div className="session-folder-input"><input aria-label={t("sessions.session_folder")} value={form.folder} onChange={e=>change('folder',e.target.value)} placeholder={t("sessions.pictures_apertrove")}/><button type="button" className="btn" disabled={choosing||busy} onClick={async()=>{setChoosing(true);try{const folder=await api.chooseSessionFolder();if(folder)change('folder',folder);}finally{setChoosing(false);}}}><FolderOpen size={16}/>{t("sessions.choose")}</button></div></label>
    {!entry&&<label className="session-check"><input type="checkbox" checked={form.createSubfolder} onChange={e=>change('createSubfolder',e.target.checked)}/>{t("sessions.create_a_subfolder_with_the_date_and_session")}</label>}
    
    <label className="form-label">{t("sessions.notes")}<textarea rows={3} maxLength={1200} value={form.description} onChange={e=>change('description',e.target.value)} placeholder={t("sessions.lighting_backdrop_shot_list")}/></label>
    <div className="session-option-row"><label className="session-check"><input type="checkbox" checked={!!form.autofocus} onChange={e=>change('autofocus',e.target.checked)}/>{t("sessions.autofocus_before_capture")}</label><label className="session-check"><input type="checkbox" checked={!!form.grid} onChange={e=>change('grid',e.target.checked)}/>{t("sessions.composition_grid")}</label></div>
    <div className="modal-actions">{entry&&<button className="btn danger-quiet session-edit-delete" type="button" disabled={busy||choosing} onClick={()=>onDelete(entry)}><Trash2 size={15}/>{t("sessions.delete_session_2")}</button>}<button className="btn" type="button" onClick={onClose}>{t("sessions.cancel")}</button><button className="btn dark" disabled={!form.name.trim()||busy||choosing}><Plus size={15}/>{busy?t("sessions.saving"):entry?t("sessions.save_settings"):t("sessions.create_session_2")}</button></div>
  </form>;
}

export function SessionDeleteDialog({entry,count,onDelete,onClose,busy,progress}){
  const [deletePhotos,setDeletePhotos]=useState(false),[errors,setErrors]=useState([]);
  return <form className="session-delete-form" onSubmit={async event=>{event.preventDefault();setErrors([]);try{const result=await onDelete(deletePhotos);if(result?.errors?.length)setErrors(result.errors);}catch(error){setErrors([{message:String(error.message||error).replace(/^Error invoking remote method '[^']+': Error: /,'')}]);}}}>
    <div className="session-delete-summary"><span><FolderOpen size={22}/></span><div><strong>{entry.name}</strong><small>{t('count.files',{count})}</small></div></div>
    <label className="session-check session-delete-choice"><input type="checkbox" checked={deletePhotos} disabled={busy} onChange={event=>setDeletePhotos(event.target.checked)}/><span>{t("sessions.delete_session_and_its_photos")}</span></label>
    <p className="session-delete-hint">{deletePhotos?t("sessions.photos_will_move_to_the_windows_recycle_bin"):t("sessions.photos_will_stay_in_the_library_and_on")}</p>
    {busy&&<p className="session-delete-progress" role="status">{progress?.total?t("sessions.processed_of", { v0: progress.done, v1: progress.total }):t("sessions.deleting_session")}</p>}
    {errors.length>0&&<div className="session-delete-errors" role="alert"><AlertCircle size={17}/><div><strong>{t("sessions.couldn_t_finish_deleting_the_session")}</strong><ul>{errors.map((error,index)=><li key={index}>{error.name&&<b>{error.name}: </b>}{legacy(error.message)}</li>)}</ul></div></div>}
    <div className="modal-actions"><button className="btn" type="button" onClick={onClose} disabled={busy}>{t("sessions.cancel")}</button><button className="btn danger" disabled={busy}><Trash2 size={15}/>{busy?t("sessions.deleting"):errors.length?t("sessions.retry_deletion"):t("sessions.delete_session_2")}</button></div>
  </form>;
}
