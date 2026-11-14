import { t, date, legacy } from "./i18n.js";
import React,{useState} from 'react';
import {Trash2,X,Check,ImageOff,ArrowUpRight,AlertCircle} from 'lucide-react';
import './photo-actions.css';

export function PhotoCard({photo,arriving,selectionMode,checked,onToggle,onDelete,onOpen,disabled,size,children}){
  return <article data-arriving={arriving ? '' : undefined} className={`photo-card library-photo-card${checked?' marked':''}${selectionMode?' selecting':''}`}>
    <button className="photo-card-image" aria-label={selectionMode?t("photoActions.mark_photo", { v0: photo.name }):t("photoActions.open", { v0: photo.name })} onClick={()=>selectionMode?onToggle(photo.id):onOpen(photo.id)} disabled={selectionMode&&disabled}>{photo.thumb?<img src={photo.thumb} alt={photo.name}/>:<ImageOff size={32}/>}<span className="photo-format">{photo.name.split('.').pop().toUpperCase()}</span>{!selectionMode&&<span className="photo-open"><ArrowUpRight size={19}/></span>}</button>
    {selectionMode&&<label className="photo-mark"><input type="checkbox" aria-label={t("photoActions.select_photo", { v0: photo.name })} checked={checked} disabled={disabled} onChange={()=>onToggle(photo.id)}/><span><Check size={14}/></span></label>}
    <button className="photo-delete-button" aria-label={t("photoActions.delete", { v0: photo.name })} title={t("photoActions.delete_photo")} onClick={()=>onDelete([photo.id])} disabled={disabled}><Trash2 size={15}/></button>
    <div className="photo-card-info"><strong title={photo.name}>{photo.name}</strong><span>{size}</span></div><div className="photo-card-bottom">{children}<span>{date(photo.date,{day:'numeric',month:'short'})}</span></div>
  </article>;
}
export function PhotoSelectionBar({count,onSelectAll,onClear,onDelete,disabled}){
  return <div className="photo-selection-bar"><span role="status">{t("photoActions.selected")}<strong>{count}</strong></span><div><button className="btn quiet" disabled={disabled} onClick={onSelectAll}><Check size={15}/>{t("photoActions.select_all")}</button><button className="btn danger-quiet" disabled={!count||disabled} onClick={onDelete}><Trash2 size={15}/>{t("photoActions.delete_selected")}</button><button className="icon-btn" aria-label={t("photoActions.clear_selection")} title={t("photoActions.clear_selection")} disabled={disabled} onClick={onClear}><X size={17}/></button></div></div>;
}
export function PhotoDeleteDialog({photos,onDelete,onClose,busy,progress}){
  const [errors,setErrors]=useState([]),count=photos.length;
  return <form className="photo-delete-form" onSubmit={async event=>{event.preventDefault();if(busy||!count)return;setErrors([]);try{const result=await onDelete(photos.map(photo=>photo.id));if(result?.errors?.length)setErrors(result.errors);}catch(error){setErrors([{message:String(error.message||error).replace(/^Error invoking remote method '[^']+': Error: /,'')}]);}}}>
    <div className="photo-delete-summary"><div className="photo-delete-thumbs">{photos.slice(0,4).map(photo=><span key={photo.id}>{photo.thumb?<img src={photo.thumb} alt=""/>:<ImageOff size={22}/>}</span>)}</div><strong>{count===1?photos[0].name:t('count.photos',{count})}</strong></div>
    <p className="photo-delete-hint">{t("photoActions.files_will_move_to_the_windows_recycle_bin")}</p>
    {count>1&&<details className="photo-delete-file-list"><summary>{t("photoActions.file_list")}</summary><ul>{photos.map(photo=><li key={photo.id}>{photo.name}</li>)}</ul></details>}
    {busy&&<p className="photo-delete-progress" role="status">{progress?.total?t("photoActions.processed_of", { v0: progress.done, v1: progress.total }):t("photoActions.deleting_photos")}</p>}
    {errors.length>0&&<div className="session-delete-errors" role="alert"><AlertCircle size={17}/><div><strong>{t("photoActions.some_photos_couldn_t_be_deleted")}</strong><ul>{errors.map((error,index)=><li key={index}>{error.name&&<b>{error.name}: </b>}{legacy(error.message)}</li>)}</ul></div></div>}
    <div className="modal-actions"><button className="btn" type="button" disabled={busy} onClick={onClose}>{t("photoActions.cancel")}</button><button className="btn danger" disabled={busy||!count}><Trash2 size={15}/>{busy?t("photoActions.deleting"):errors.length?t("photoActions.retry_deletion"):count===1?t("photoActions.delete_photo"):t("photoActions.delete_photos", { v0: count })}</button></div>
  </form>;
}
