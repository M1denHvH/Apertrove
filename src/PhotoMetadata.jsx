import { t, localized, number, error as localizeError, legacy, useLocale } from "./i18n.js";
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Search,Download,RefreshCw} from 'lucide-react';
const names=localized(() => ({Artist:t("metadata.artist"),Copyright:t("metadata.copyright"),Creator:t("metadata.creator"),CopyrightNotice:t("metadata.copyright"),Rights:t("metadata.usage_rights"),UsageTerms:t("metadata.terms_of_use"),CameraOwnerName:t("metadata.camera_owner"),OwnerName:t("metadata.owner"),Make:t("metadata.manufacturer"),Model:t("metadata.camera_model"),LensMake:t("metadata.lens_maker"),LensModel:t("metadata.lens"),LensSerialNumber:t("metadata.lens_serial_number"),BodySerialNumber:t("metadata.camera_serial_number"),Software:t("metadata.software"),DateTimeOriginal:t("metadata.date_taken"),CreateDate:t("metadata.created"),ModifyDate:t("metadata.modified"),ISO:'ISO',FNumber:t("metadata.aperture"),ExposureTime:t("metadata.shutter_speed"),FocalLength:t("metadata.focal_length"),ExposureCompensation:t("metadata.exposure_compensation"),ExposureProgram:t("metadata.exposure_program"),MeteringMode:t("metadata.metering_mode"),WhiteBalance:t("metadata.white_balance"),ColorSpace:t("metadata.color_space"),Orientation:t("metadata.orientation"),ImageDescription:t("metadata.description"),UserComment:t("metadata.comment"),ImageWidth:t("metadata.width"),ImageHeight:t("metadata.height"),ExifImageWidth:t("metadata.exif_width"),ExifImageHeight:t("metadata.exif_height"),GPSLatitude:t("metadata.latitude"),GPSLongitude:t("metadata.longitude"),GPSAltitude:t("metadata.gps_altitude"),name:t("metadata.filename"),bytes:t("metadata.size_bytes"),modified:t("metadata.modified_2"),width:t("metadata.width_px"),height:t("metadata.height_px"),format:t("metadata.format"),space:t("metadata.color_space"),density:t("metadata.density_dpi"),channels:t("metadata.channels"),depth:t("metadata.bit_depth"),hasAlpha:t("metadata.alpha_channel"),hasProfile:t("metadata.icc_profile"),isProgressive:t("metadata.progressive"),orientation:t("metadata.file_orientation")}));
export function flatten(value,prefix='',rows=[]){
  for(const [key,item] of Object.entries(value||{})){
    const full=prefix?`${prefix}.${key}`:key;
    if(item&&typeof item==='object'&&!Array.isArray(item)&&item.type!=='binary')flatten(item,full,rows);
    else rows.push({key:full,name:names()[key]||key,value:item});
  }
  return rows;
}
export function readable(value){if(value===null)return '—';if(value?.type==='binary')return t("metadata.binary_block_bytes", { v0: number(value.bytes) });if(Array.isArray(value))return value.map(item=>typeof item==='object'?JSON.stringify(item):String(item)).join(', ');if(typeof value==='boolean')return value?t("metadata.yes"):t("metadata.no");return typeof value==='object'?JSON.stringify(value):String(value);}
export default function PhotoMetadata({photo}){
  const locale=useLocale();
  const [data,setData]=useState(null),[error,setError]=useState(''),[query,setQuery]=useState(''),[tab,setTab]=useState('all');
  const [exportError,setExportError]=useState(''),[exporting,setExporting]=useState(false),exportRequest=useRef(0);
  useEffect(()=>{let active=true;setData(null);setError('');setExportError('');setExporting(false);window.focal.photoMetadata({id:photo.id}).then(value=>{if(active)setData(value);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;exportRequest.current++;};},[photo.id]);
  async function exportJSON(){
    const request=++exportRequest.current;setExportError('');setExporting(true);
    try{await window.focal.exportMetadata({id:photo.id});}
    catch(e){if(request===exportRequest.current)setExportError(e?.message||String(e));}
    finally{if(request===exportRequest.current)setExporting(false);}
  }
  const rows=useMemo(()=>data?flatten({file:data.file,...data.metadata}):[],[data,locale]);
  const shown=rows.filter(row=>(tab==='all'||tab==='rights'?tab==='all'||/copyright|artist|creator|owner|rights|usage|credit|byline|contact|licens/i.test(row.key):row.key.toLowerCase().startsWith(tab))&&`${row.name} ${row.key} ${readable(row.value)}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="photo-metadata"><div className="metadata-toolbar"><label className="search"><Search size={14}/><input aria-label={t("metadata.search_metadata")} placeholder={t("metadata.name_value_or_tag")} value={query} onChange={e=>setQuery(e.target.value)}/></label><button className="btn quiet" disabled={!data||exporting} aria-busy={exporting} onClick={exportJSON}><Download size={14}/>JSON</button></div>{exportError&&<p className="equipment-error" role="alert">{localizeError(exportError)}</p>}<div className="metadata-tabs">{[['all',t("metadata.all_tags")],['rights',t("metadata.creator_and_rights")],['gps','GPS'],['file',t("metadata.file")]].map(([value,label])=><button className={tab===value?'active':''} key={value} onClick={()=>setTab(value)}>{label}</button>)}</div>
    {!data&&!error&&<div className="metadata-loading"><RefreshCw size={16} className="spin"/>{t("metadata.reading_metadata")}</div>}{error&&<p className="equipment-error">{localizeError(error)}</p>}{data&&<><div className="metadata-count">{number(shown.length)} / {t('count.metadata_fields',{count:rows.length})} · EXIF / IPTC / XMP / ICC</div><dl className="metadata-rows">{shown.map(row=><div key={row.key}><dt>{row.name}<small>{row.key}</small></dt><dd>{readable(row.value)}</dd></div>)}</dl>{!shown.length&&<p className="field-help">{t("metadata.no_matching_metadata_fields")}</p>}{data.errors.map(text=><p key={text} className="field-help">{legacy(text)}</p>)}</>}
  </div>;
}
