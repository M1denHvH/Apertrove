import React,{useCallback,useEffect,useRef,useState} from 'react';
import {Camera,ChevronRight,Download,File,FileImage,Film,Folder,FolderOpen,HardDrive,ImageOff,RefreshCw,Square,Upload,X} from 'lucide-react';
import {t,number,date,legacy} from './i18n.js';
import Modal from './Modal';
import './camera-card.css';

const cleanError=error=>legacy(String(error?.message||error||'').replace(/^Error invoking remote method '[^']+': (?:Error: )?/,''));
const fileSize=size=>Number.isFinite(size)?size>=1048576?`${number(size/1048576,{maximumFractionDigits:1})} MB`:`${number(size/1024,{maximumFractionDigits:0})} KB`:'—';
const fileDate=value=>value&&Number.isFinite(new Date(value).getTime())?date(value,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
const imageSource=result=>typeof result?.image==='string'&&/^data:image\/(?:jpeg|png|webp);base64,/.test(result.image)?result.image:null;
function thumbnailCache(previous,id,image){
  const next={...previous,[id]:image};
  // Browsing many pages must not keep every image in renderer memory. Evicted
  // thumbnails fall back to metadata until the next folder read or refresh.
  let characters=Object.values(next).reduce((sum,value)=>sum+(value?.length||0),0);
  for(const key of Object.keys(next)){
    if(Object.keys(next).length<=128&&characters<=24*1024*1024)break;
    if(key===id)continue;
    characters-=next[key]?.length||0;delete next[key];
  }
  return next;
}
const FileIcon=({item,...props})=>item.kind==='volume'?<HardDrive {...props}/>:item.kind==='folder'?<Folder {...props}/>:/^(mov|mp4|avi)$/i.test(item.extension||'')?<Film {...props}/>:item.extension?<FileImage {...props}/>:<File {...props}/>;

function Thumbnail({item,image,onVisible,onOpen,disabled,active,epoch}){
  const ref=useRef(null);
  useEffect(()=>{
    if(item.kind!=='file'||!item.thumbnailAvailable||!active||image!==undefined)return;
    const node=ref.current;
    if(!globalThis.IntersectionObserver){onVisible(item.id);return;}
    const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){onVisible(item.id);observer.disconnect();}},{rootMargin:'100px'});
    observer.observe(node);return()=>observer.disconnect();
  },[item.id,item.thumbnailAvailable,onVisible,active,epoch,image]);
  return <button ref={ref} className="camera-card-thumbnail" type="button" disabled={disabled} onClick={onOpen} aria-label={t(item.kind==='file'?'cameraCard.preview_file':'cameraCard.open_folder',{name:item.name})}>
    {image?<img src={image} alt=""/>:<FileIcon item={item} size={item.kind==='file'?22:25} strokeWidth={1.5}/>}
  </button>;
}

export default function CameraCard({camera,disabled=false,onConnect,onNotice,api=window.focal}){
  const [listing,setListing]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useState([]),[images,setImages]=useState({}),[preview,setPreview]=useState(null),[exporting,setExporting]=useState(false),[progress,setProgress]=useState(null),[receipt,setReceipt]=useState(null);
  const generation=useRef(0),alive=useRef(true),current=useRef(null),request=useRef(false),pendingNavigation=useRef(null),exportOwner=useRef(null),thumbnailQueue=useRef([]),thumbnailSeen=useRef(new Set()),thumbnailRunning=useRef(false),thumbnailSettled=useRef(Promise.resolve());
  current.current={camera,disabled,listing};
  const connected=camera.connected===true,canRead=connected&&camera.working!==false&&camera.controlsOnly!==true;
  const files=listing?.items?.filter(item=>item.kind==='file')||[],fileIds=files.map(item=>item.id),selectedSet=new Set(selected);

  const drainThumbnails=useCallback(async()=>{
    if(thumbnailRunning.current)return;
    thumbnailRunning.current=true;
    try{
      while(thumbnailQueue.current.length&&alive.current&&!exportOwner.current&&!request.current&&!current.current.disabled&&current.current.camera.connected){
        const {id,epoch}=thumbnailQueue.current.shift();
        if(epoch!==generation.current)continue;
        try{
          const operation=api.cardThumbnail({id});thumbnailSettled.current=operation.catch(()=>{});const result=await operation;
          if(alive.current&&epoch===generation.current)setImages(old=>thumbnailCache(old,id,imageSource(result)));
        }catch{/* A missing thumbnail leaves a file icon; listing and export stay usable. */}
      }
    }finally{thumbnailRunning.current=false;}
  },[api]);
  const queueThumbnail=useCallback(id=>{
    if(thumbnailSeen.current.has(id))return;
    thumbnailSeen.current.add(id);thumbnailQueue.current.push({id,epoch:generation.current});void drainThumbnails();
  },[drainThumbnails]);

  const load=useCallback(async(parentId=null,{append=false,refresh=false}={})=>{
    if(exportOwner.current||current.current.disabled||!current.current.camera.connected)return;
    if(request.current){pendingNavigation.current={parentId,append,refresh};return;}
    const epoch=++generation.current;request.current=true;setLoading(true);setError('');setPreview(null);
    thumbnailQueue.current=[];thumbnailSeen.current.clear();
    if(!append){setSelected([]);setImages({});setReceipt(null);}
    try{
      await thumbnailSettled.current;
      if(!alive.current||epoch!==generation.current||!current.current.camera.connected)return;
      const response=await api.cardList({parentId,offset:append?current.current.listing?.nextOffset||0:0,limit:80,refresh});
      if(!alive.current||epoch!==generation.current)return;
      const value={...response,items:Array.isArray(response.items)?response.items:[]};
      setListing(old=>append?{...value,items:[...(old?.items||[]),...value.items]}:value);
    }catch(cause){if(alive.current&&epoch===generation.current)setError(cleanError(cause));}
    finally{
      request.current=false;
      if(alive.current&&epoch===generation.current){setLoading(false);void drainThumbnails();}
      const pending=pendingNavigation.current;pendingNavigation.current=null;
      if(pending&&alive.current)void load(pending.parentId,pending);
    }
  },[api,drainThumbnails]);

  useEffect(()=>{
    alive.current=true;return()=>{alive.current=false;generation.current++;thumbnailQueue.current=[];if(exportOwner.current)void api.cardExportCancel({operationId:exportOwner.current.operationId}).catch(()=>{});};
  },[api]);
  useEffect(()=>{
    generation.current++;setListing(null);setSelected([]);setImages({});setPreview(null);setError('');setReceipt(null);setLoading(false);thumbnailQueue.current=[];thumbnailSeen.current.clear();
    if(!connected&&exportOwner.current)void api.cardExportCancel({operationId:exportOwner.current.operationId}).catch(()=>{});
    if(canRead)void load();
  },[connected,camera.cameraId,camera.connectedAt,canRead,load]);
  useEffect(()=>{
    if(!disabled&&canRead&&!request.current&&!exportOwner.current){
      if(!listing&&!error)void load();else void drainThumbnails();
    }
  },[disabled,canRead,listing,error,load,drainThumbnails]);
  useEffect(()=>api.on(({type,data})=>{
    if(type!=='cardExportProgress'||!exportOwner.current)return;
    const owner=exportOwner.current;if(owner.operationId&&data.operationId!==owner.operationId)return;
    owner.operationId=data.operationId;setProgress(data);
  }),[api]);

  const transfer=async(mode,ids=selected,retryOperationId)=>{
    if(!ids.length||exportOwner.current||request.current)return;
    const owner={operationId:null,mode};exportOwner.current=owner;thumbnailQueue.current=[];setExporting(true);setProgress({done:0,total:ids.length,status:'starting'});setReceipt(null);setError('');
    try{
      await thumbnailSettled.current;
      if(!alive.current||!current.current.camera.connected)return;
      const result=await api.cardExport({ids,mode,...(retryOperationId?{retryOperationId}:{})});
      if(!alive.current)return;
      setReceipt({...result,mode});
      if(result.status==='completed'){
        setSelected([]);onNotice?.(t(mode==='import'?'cameraCard.imported':'cameraCard.exported',{count:number(mode==='import'?result.imported?.added??result.files?.length??0:result.files?.length||0)}));
      }else setSelected(result.remainingIds||[]);
    }catch(cause){if(alive.current){setError(cleanError(cause));setReceipt({status:'failed',mode,operationId:retryOperationId,remainingIds:ids,files:[],failures:[]});}}
    finally{if(exportOwner.current===owner)exportOwner.current=null;if(alive.current){setExporting(false);setProgress(null);void drainThumbnails();}}
  };
  const cancel=async()=>{
    if(!exportOwner.current)return;
    setProgress(old=>({...old,status:'cancelling'}));
    try{await api.cardExportCancel({operationId:exportOwner.current.operationId});}catch(cause){setError(cleanError(cause));}
  };
  const toggle=id=>setSelected(old=>old.includes(id)?old.filter(value=>value!==id):[...old,id]);
  const open=item=>item.kind==='file'?setPreview(item):void load(item.id);
  const navigate=parentId=>{if(!loading&&!exporting)void load(parentId);};
  const allSelected=fileIds.length>0&&fileIds.every(id=>selectedSet.has(id));
  const isLocked=disabled||loading||exporting;
  const incomplete=receipt&&receipt.status!=='completed'&&(receipt.files?.length||receipt.failures?.length||receipt.remainingIds?.length);
  const byteProgress=Number.isFinite(progress?.totalBytes)&&progress.totalBytes>0,progressMax=byteProgress?progress.totalBytes:progress?.total||1;
  const progressValue=byteProgress?Math.min(progressMax,(progress.bytes||0)+(progress.currentName?progress.currentBytes||0:0)):progress?.done||0;
  const format=item=>item.kind==='volume'?t('cameraCard.volume'):item.kind==='folder'?t('cameraCard.folder'):(item.extension||t('cameraCard.unknown_format')).toUpperCase();

  return <section className="camera-card-browser" aria-label={t('cameraCard.source')} aria-busy={loading||exporting} onKeyDown={event=>{
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='a'&&!event.target.closest('input,textarea')&&!isLocked){event.preventDefault();event.stopPropagation();setSelected(fileIds);}
  }}>
    <div className="camera-card-toolbar">
      <nav className="camera-card-breadcrumbs" aria-label={t('cameraCard.location')}>
        <button type="button" disabled={!canRead||isLocked} onClick={()=>navigate(null)}><Camera size={16}/>{camera.model||t('cameraCard.source')}</button>
        {(listing?.breadcrumbs||[]).map(crumb=><React.Fragment key={crumb.id}><ChevronRight size={13} aria-hidden="true"/><button type="button" disabled={isLocked||crumb.id===listing.parentId} aria-current={crumb.id===listing.parentId?'location':undefined} onClick={()=>navigate(crumb.id)}>{crumb.name}</button></React.Fragment>)}
      </nav>
      <button type="button" className="btn quiet" disabled={!canRead||isLocked} onClick={()=>load(listing?.parentId??null,{refresh:true})}><RefreshCw size={15}/>{t('cameraCard.refresh')}</button>
    </div>
    {!canRead?<div className="camera-card-empty"><Camera size={38} strokeWidth={1.25}/><h2>{t(connected?'cameraCard.working_connection':'cameraCard.connect_camera')}</h2>{onConnect&&<button type="button" className="btn" disabled={disabled} onClick={onConnect}>{t('desktop.connect')}</button>}</div>:
      <>
        {error&&<div className="camera-card-error" role="alert"><span>{error}</span><button type="button" className="btn quiet" disabled={isLocked} onClick={()=>load(listing?.parentId??null)}>{t('cameraCard.retry')}</button></div>}
        {exporting&&<div className="camera-card-progress" role="status">
          <div><strong>{t(progress?.status==='cancelling'?'cameraCard.cancelling':'cameraCard.transferring',{done:number(progress?.done||0),total:number(progress?.total||selected.length)})}</strong><span title={progress?.currentName}>{progress?.currentName}{progress?.currentName&&Number.isFinite(progress.currentBytes)&&<small>{fileSize(progress.currentBytes)} / {fileSize(files.find(file=>file.id===progress.currentId)?.size)}</small>}</span></div>
          <progress aria-label={t('cameraCard.transfer_progress')} max={progressMax} value={progressValue}/>
          <button type="button" className="btn quiet" disabled={progress?.status==='cancelling'} onClick={cancel}><Square size={14}/>{t('cameraCard.cancel')}</button>
        </div>}
        {!loading&&listing?.status==='unsupported'?<div className="camera-card-empty"><HardDrive size={36} strokeWidth={1.25}/><h2>{t('cameraCard.unavailable')}</h2><p>{listing.reason?legacy(listing.reason):t('cameraCard.unsupported_runtime')}</p></div>:
          !loading&&listing?.status==='no-storage'?<div className="camera-card-empty"><HardDrive size={36} strokeWidth={1.25}/><h2>{t('cameraCard.no_card')}</h2></div>:
          <>
            {listing?.items?.length>0&&<>
              <div className="camera-card-selection">
                <label><input type="checkbox" checked={allSelected} disabled={!fileIds.length||isLocked} aria-label={t('cameraCard.select_loaded')} onChange={()=>setSelected(allSelected?[]:fileIds)}/><span>{selected.length?t('cameraCard.selected',{count:number(selected.length)}):t('cameraCard.items',{count:number(listing.total||listing.items.length)})}</span></label>
                <div><button type="button" className="btn" disabled={!selected.length||isLocked} onClick={()=>transfer('import')}><Upload size={15}/>{t('cameraCard.import_library')}</button><button type="button" className="btn dark" disabled={!selected.length||isLocked} onClick={()=>transfer('export')}><Download size={15}/>{t('cameraCard.export_folder')}</button></div>
              </div>
              <div className="camera-card-table" role="table" aria-label={t('cameraCard.files')}>
                <div className="camera-card-row camera-card-table-head" role="row"><span role="columnheader">{t('cameraCard.name')}</span><span role="columnheader">{t('cameraCard.type')}</span><span role="columnheader">{t('cameraCard.size')}</span><span role="columnheader">{t('cameraCard.date')}</span></div>
                {listing.items.map((item,index)=><div className={'camera-card-row'+(selectedSet.has(item.id)?' selected':'')+(item.kind==='unavailable'?' unavailable':'')} role="row" key={item.id??'unavailable-'+index}>
                  <div role="cell" className="camera-card-file-name">
                    {item.kind==='file'?<input type="checkbox" checked={selectedSet.has(item.id)} disabled={isLocked} aria-label={t('cameraCard.select_file',{name:item.name})} onChange={()=>toggle(item.id)}/>:<span className="camera-card-checkbox-space"/>}
                    <Thumbnail item={item} image={images[item.id]} onVisible={queueThumbnail} onOpen={()=>open(item)} disabled={isLocked||item.kind==='unavailable'} active={!loading&&!exporting} epoch={generation.current}/>
                    <button type="button" className="camera-card-file-open" onClick={()=>open(item)} disabled={isLocked||item.kind==='unavailable'} title={item.error?cleanError(item.error):item.name}>{item.kind==='unavailable'?t('cameraCard.item_unavailable'):item.name}{item.kind==='unavailable'&&<small className="camera-card-item-error">{cleanError(item.error)||t('cameraCard.read_error')}</small>}{item.kind==='volume'&&item.volume?.capacity>0&&<small>{t('cameraCard.free_space',{free:fileSize(item.volume.free),capacity:fileSize(item.volume.capacity)})}</small>}</button>
                  </div>
                  <span role="cell" className="camera-card-type">{format(item)}</span><span role="cell" className="camera-card-size">{item.kind==='file'?fileSize(item.size):'—'}</span><span role="cell" className="camera-card-date">{fileDate(item.date)}</span>
                </div>)}
              </div>
            </>}
            {loading&&<div className="camera-card-skeleton" role="status" aria-label={t('cameraCard.loading')}>{[0,1,2,3].map(index=><span key={index}/>)}</div>}
            {!loading&&listing?.status==='ready'&&!listing.items.length&&<div className="camera-card-empty"><FolderOpen size={36} strokeWidth={1.25}/><h2>{t('cameraCard.empty_folder')}</h2></div>}
            {listing?.nextOffset!==null&&listing?.nextOffset!==undefined&&<button type="button" className="btn camera-card-load-more" disabled={isLocked} onClick={()=>load(listing.parentId,{append:true})}>{t('cameraCard.load_more')}</button>}
          </>}
        {incomplete&&!exporting&&<div className="camera-card-incomplete" role="status"><span>{t(receipt.status==='cancelled'?'cameraCard.cancelled_summary':'cameraCard.partial_summary',{done:number(receipt.files?.length||0),remaining:number(receipt.remainingIds?.length||0)})}{receipt.failures?.[0]?.error&&<small>{cleanError(receipt.failures[0].error)}</small>}</span>{receipt.remainingIds?.length>0&&<button type="button" className="btn quiet" disabled={isLocked} onClick={()=>transfer(receipt.mode,receipt.remainingIds,receipt.operationId)}>{t('cameraCard.retry_remaining')}</button>}<button type="button" className="icon-btn" aria-label={t('cameraCard.dismiss')} onClick={()=>setReceipt(null)}><X size={15}/></button></div>}
      </>}
    {preview&&<Modal title={preview.name} wide onClose={()=>setPreview(null)}><div className="camera-card-preview">{images[preview.id]?<img src={images[preview.id]} alt={preview.name}/>:<div><ImageOff size={38} strokeWidth={1.25}/><p>{t('cameraCard.preview_unavailable')}</p></div>}<dl><div><dt>{t('cameraCard.type')}</dt><dd>{format(preview)}</dd></div><div><dt>{t('cameraCard.size')}</dt><dd>{fileSize(preview.size)}</dd></div><div><dt>{t('cameraCard.date')}</dt><dd>{fileDate(preview.date)}</dd></div></dl><div className="camera-card-preview-actions"><button type="button" className="btn" disabled={isLocked} onClick={()=>{setPreview(null);void transfer('import',[preview.id]);}}><Upload size={15}/>{t('cameraCard.import_library')}</button><button type="button" className="btn dark" disabled={isLocked} onClick={()=>{setPreview(null);void transfer('export',[preview.id]);}}><Download size={15}/>{t('cameraCard.export_folder')}</button></div></div></Modal>}
  </section>;
}
