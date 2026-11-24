const path=require('node:path');
const {randomUUID}=require('node:crypto');
const PROFILE_SHA256='35c5fd7564cf8eee3bc41004a0ab21d96caccb36ea1a1ddb512caf7b1c046627';
const text=value=>(typeof value==='string'?value:Buffer.from(value||[]).toString('utf8')).replace(/\0.*$/s,'').trim();
const error=(code,message)=>Object.assign(Error(message),{code});
function cardProfile({sha256,version,architecture}={}){return sha256===PROFILE_SHA256&&version==='3.18.40.0'&&architecture==='x64';}
function parseCardVolume(bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length!==280)throw error('CARD_METADATA_INVALID','The camera returned invalid storage information.');
  // This exact runtime shifts PTP byte capacities right by 10 before exposing
  // EdsVolumeInfo. Convert its KiB fields once at the qualified native boundary.
  const convert=offset=>{const value=bytes.readBigUInt64LE(offset)*1024n;return value<=BigInt(Number.MAX_SAFE_INTEGER)?Number(value):null;};
  return {type:bytes.readUInt32LE(0),access:bytes.readUInt32LE(4),capacity:convert(8),free:convert(16),label:bytes.subarray(24,280)};
}
function metadata(info){
  const name=text(info.name),size=Number(info.size),extension=path.extname(name).slice(1).toUpperCase();
  if(!name||!Number.isSafeInteger(size)||size<0)throw error('CARD_METADATA_INVALID','The camera returned invalid file information.');
  // Canon's dateTime representation is retained as a raw value until its epoch
  // and timezone are qualified. Never label a guessed timestamp as capture date.
  return {name,size:info.folder?null:size,format:Number.isInteger(info.format)?info.format:null,extension:info.folder?'':extension,date:null,dateTimeRaw:Number.isInteger(info.dateTime)?info.dateTime:null,kind:info.folder?'folder':'file',thumbnailAvailable:!info.folder&&/^(JPE?G|CR2|CR3|CRW|HEIF?|HIF|MOV|MP4)$/i.test(extension)};
}
function createCameraCard(io){
  const nodes=new Map(),keys=new Map();let epoch=null,revision=0,exporting=false;
  function reset(){nodes.clear();keys.clear();epoch=io.epoch();revision++;}
  function connected(){io.ensure();if(epoch!==io.epoch())reset();}
  function supported(){return io.qualified()===true;}
  function node(id){const item=nodes.get(id);if(!item||item.epoch!==epoch)throw error('CARD_LIST_STALE','Refresh the camera card and select the files again.');return item;}
  function remember(indices,data){
    const key=indices.join('/');if(keys.has(key)){const item=nodes.get(keys.get(key));Object.assign(item,data);return item;}
    if(nodes.size>=20000)throw error('CARD_LIST_LIMIT','Refresh the card to browse more files.');
    const item={id:randomUUID(),indices:[...indices],epoch,...data};nodes.set(item.id,item);keys.set(key,item.id);return item;
  }
  function view(item){const {indices,epoch,...publicItem}=item;return {...publicItem};}
  function withRef(item,run){
    let parent=io.camera(),owned=null;const traversed=[];
    try{for(const index of item?.indices||[]){const child=io.child(parent,index),previous=owned;owned=child;parent=child;if(previous)io.release(previous);traversed.push(index);
      const known=nodes.get(keys.get(traversed.join('/')));
      if(known&&known.kind!=='volume'){const current=metadata(io.info(child));if(current.name!==known.name||current.kind!==known.kind||current.size!==known.size)throw error('CARD_LIST_STALE','The camera card changed. Refresh the folder.');}
    }return run(parent);}
    finally{if(owned)io.release(owned);}
  }
  async function list({parentId=null,offset=0,limit=80,refresh=false}={}){
    connected();if(!supported())return {status:'unsupported',epoch,revision,parentId:null,breadcrumbs:[],items:[],offset:0,total:0,nextOffset:null};
    if(exporting)throw error('OPERATION_BUSY','Wait for the camera export to finish.');
    if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>200)throw error('CARD_PAGE_INVALID','Invalid camera card page.');
    if(refresh){const chain=[];let current=parentId?node(parentId):null;while(current){chain.unshift({...current});current=current.parentId?node(current.parentId):null;}reset();parentId=null;for(const saved of chain){const {id,epoch,...data}=saved;const restored=remember(saved.indices,{...data,parentId});parentId=restored.id;}offset=0;}
    const parent=parentId?node(parentId):null;if(parent?.kind==='file')throw error('CARD_NOT_FOLDER','Select a camera folder.');
    const result=withRef(parent,ref=>{
      const total=io.count(ref),items=[];if(!Number.isInteger(total)||total<0||total>10000000)throw error('CARD_COUNT_INVALID','Invalid camera item count.');
      for(let index=offset;index<Math.min(total,offset+limit);index++){
        let child;try{
          child=io.child(ref,index);let data;
          if(!parent){const v=io.volume(child);data={kind:'volume',name:text(v.label)||'Camera card',size:null,format:null,extension:'',date:null,thumbnailAvailable:false,volume:{label:text(v.label),type:v.type,access:v.access,capacity:Number(v.capacity),free:Number(v.free)}};}
          else data=metadata(io.info(child));
          items.push(view(remember([...(parent?.indices||[]),index],{...data,parentId})));
        }catch(cause){if(cause.code==='OPERATION_UNKNOWN_TERMINATION')throw cause;items.push({id:null,parentId,kind:'unavailable',name:'Unavailable item',error:cause.message,index});}
        finally{if(child)io.release(child);}
      }
      return {total,items};
    });
    const breadcrumbs=[];let ancestor=parent;while(ancestor){breadcrumbs.unshift({id:ancestor.id,name:ancestor.name});ancestor=ancestor.parentId?nodes.get(ancestor.parentId):null;}
    const noStorage=!parent&&(result.total===0||result.items.length>0&&result.items.every(item=>item.kind==='volume'&&item.volume.type===0));
    return {status:noStorage?'no-storage':'ready',epoch,revision,parentId,breadcrumbs,...result,...(noStorage?{items:[],total:0}:{}),offset,nextOffset:!noStorage&&offset+limit<result.total?offset+limit:null};
  }
  async function thumbnail({id}={}){
    connected();if(!supported())throw error('CARD_UNSUPPORTED','Camera card access is unavailable for this SDK.');if(exporting)throw error('OPERATION_BUSY','Wait for the camera export to finish.');
    const item=node(id);if(item.kind!=='file'||!item.thumbnailAvailable||typeof io.thumbnail!=='function')return {id,mime:'image/jpeg',bytes:null,unavailable:true};
    try{const bytes=withRef(item,ref=>io.thumbnail(ref));if(!Buffer.isBuffer(bytes)||bytes.length<3||bytes.length>8*1024*1024||bytes[0]!==255||bytes[1]!==216)throw error('CARD_THUMBNAIL_INVALID','The camera preview is unavailable.');return {id,mime:'image/jpeg',bytes,unavailable:false};}
    catch(cause){if(cause.code==='OPERATION_UNKNOWN_TERMINATION')throw cause;return {id,mime:'image/jpeg',bytes:null,unavailable:true};}
  }
  async function exportFiles({ids,folder}={},operation={}){
    connected();if(!supported())throw error('CARD_UNSUPPORTED','Camera card access is unavailable for this SDK.');
    if(exporting)throw error('OPERATION_BUSY','A camera export is already running.');
    if(!Array.isArray(ids)||ids.length<1||ids.length>10000||ids.some(id=>typeof id!=='string')||!path.isAbsolute(folder||''))throw error('CARD_EXPORT_INVALID','Choose files and an export folder.');
    const selected=[...new Set(ids)].map(id=>node(id));if(selected.some(item=>item.kind!=='file'))throw error('CARD_EXPORT_INVALID','Only files can be exported.');
    const startEpoch=epoch,files=[],failures=[];let cancelled=false;exporting=true;
    const cancelledNow=()=>operation.cancellation?.isRequested?.()===true||operation.cancellation?.requested===true||io.epoch()!==startEpoch||!io.connected();
    const progress=patch=>io.progress?.({operationId:operation.operationId,total:selected.length,done:files.length,bytes:files.reduce((sum,file)=>sum+file.size,0),totalBytes:selected.reduce((sum,file)=>sum+file.size,0),...patch});
    try{
      for(const item of selected){
        if(cancelledNow()){cancelled=true;break;}
        progress({status:'transferring',currentId:item.id,currentName:item.name,currentBytes:0});
        let held;
        try{
          // Resolve a fresh SDK reference for this operation, never retain every
          // item in a card containing thousands of files.
          held=withRef(item,ref=>io.retain(ref));
          const result=await io.download(held,folder,{cancelled:cancelledNow,progress:currentBytes=>progress({status:'transferring',currentId:item.id,currentName:item.name,currentBytes})});
          files.push({id:item.id,name:path.basename(result.path),path:result.path,size:item.size});
        }catch(cause){if(cause.code==='OPERATION_UNKNOWN_TERMINATION')throw cause;if(cancelledNow()||cause.code==='OPERATION_CANCELLED'){cancelled=true;break;}failures.push({id:item.id,error:cause.message});}
        finally{if(held)io.release(held);}
        await io.yield();
      }
      const completedIds=new Set(files.map(item=>item.id));const status=cancelled?'cancelled':failures.length?'partial':'completed';
      progress({status,currentId:null,currentName:null});return {status,files,failures,cancelled,remainingIds:selected.filter(item=>!completedIds.has(item.id)).map(item=>item.id)};
    }finally{exporting=false;}
  }
  return {list,thumbnail,export:exportFiles,reset,isBusy:()=>exporting,stats:()=>({nodes:nodes.size,revision,epoch})};
}
module.exports={createCameraCard,cardProfile,parseCardVolume,metadata};
