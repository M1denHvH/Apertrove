// Main-side card workflow: explicit export and Library import share one native
// producer, while only the latter registers exported files as unassigned photos.
function createCameraCardActions({exclusive,call,getChannel,choose,importFiles,emit,newId,translate=key=>key}){
  let active=null,lastImport=null;
  const publish=patch=>{if(!active)return;Object.assign(active,patch);emit('cardExportProgress',{...active,channel:undefined});};
  async function cardThumbnail(args){
    const result=await exclusive(()=>call('cardThumbnail',args),{background:true});
    const bytes=result?.bytes&&Buffer.from(result.bytes);
    if(!bytes||!bytes.length)return {...result,bytes:undefined,image:null,unavailable:true};
    if(bytes.length>4*1024*1024)throw Error(translate('card.preview_too_large'));
    return {...result,bytes:undefined,image:'data:'+(result.mime||'image/jpeg')+';base64,'+bytes.toString('base64')};
  }
  const cancelled=ids=>({status:'cancelled',cancelled:true,files:[],failures:[],remainingIds:ids});
  async function cardExport(args={}){
    if(active)throw Error(translate('operation.busy'));
    const ids=args.ids;
    if(!Array.isArray(ids)||!ids.length||ids.length>10000||ids.some(id=>typeof id!=='string'||!id||id.length>256))throw Error(translate('card.invalid_selection'));
    if(!['export','import'].includes(args.mode||'export'))throw Error(translate('card.invalid_selection'));
    return exclusive(async()=>{
      const owner={operationId:newId(),channel:getChannel(),status:'choosing',total:ids.length,done:0,cancelled:false};active=owner;publish({});
      try{
        // Retain only the last partial import receipt. Its already saved files
        // can be registered again without downloading a second copy from camera.
        const retry=args.mode==='import'&&args.retryOperationId&&lastImport?.operationId===args.retryOperationId&&lastImport.channel===owner.channel?lastImport:null;
        if(!retry)lastImport=null;
        const folder=retry?.folder||args.folder||await choose();
        if(!folder||owner.cancelled)return {...cancelled(ids),operationId:owner.operationId};
        if(getChannel()!==owner.channel||owner.channel?.exited)throw Error(translate('operation.stale'));
        publish({status:'exporting'});
        const selected=[...new Set(ids)],saved=selected.flatMap(id=>retry?.files.get(id)?[retry.files.get(id)]:[]),pending=selected.filter(id=>!retry?.files.has(id));
        const result=pending.length?await call('cardExport',{ids:pending,folder},{timeoutMs:1800000}):{status:'completed',files:[],failures:[],remainingIds:[]};
        result.files=[...saved,...(result.files||[])];
        let imported=null;
        if(args.mode==='import'&&result.files?.length){
          imported={added:0,skipped:0,errors:[]};publish({status:'importing'});const unfinished=new Map(result.files.map(file=>[file.id,file]));
          for(const file of result.files){
            if(owner.cancelled){result.status='partial';result.cancelled=true;break;}
            let item;
            try{item=await importFiles([file.path],{sessionId:null,dest:folder});}
            catch(error){item={errors:[{name:file.name,message:error.message}]};}
            imported.added+=item.added||0;imported.skipped+=item.skipped||0;imported.errors.push(...(item.errors||[]));
            if(!item.errors?.length)unfinished.delete(file.id);
          }
          if(unfinished.size){
            result.status='partial';result.remainingIds=[...new Set([...(result.remainingIds||[]),...unfinished.keys()])];
            lastImport={operationId:owner.operationId,channel:owner.channel,folder,files:unfinished};
          }else if(lastImport===retry)lastImport=null;
        }
        if(imported?.errors?.length){result.failures=[...(result.failures||[]),...imported.errors.map(error=>({id:result.files.find(file=>file.name===error.name)?.id||null,error:error.message}))];result.status='partial';}
        publish({status:result.status||'completed',done:result.files?.length||0,failures:result.failures||[],remainingIds:result.remainingIds||[]});
        return {...result,imported,operationId:owner.operationId,folder};
      }catch(error){publish({status:'error',error:error.message});throw error;}
      finally{if(active===owner)active=null;}
    });
  }
  function cardExportCancel({operationId}={}){
    if(!active||operationId&&active.operationId!==operationId)return {cancelled:false};
    active.cancelled=true;
    const count=active.channel?.rpc.cancelMethod('cardExport')||0;publish({status:'cancelling'});return {cancelled:true,pending:count>0,operationId:active.operationId};
  }
  function progress(data){if(active)publish({...data,operationId:active.operationId});}
  return {cardList:args=>exclusive(()=>call('cardList',args)),cardThumbnail,cardExport,cardExportCancel,progress,isActive:()=>!!active};
}
module.exports={createCameraCardActions};
