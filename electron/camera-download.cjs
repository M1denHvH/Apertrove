const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const fail=(code,message)=>Object.assign(Error(message),{code});
function safeName(value){const name=path.basename(String(value).replaceAll('\\','/')).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'');return name&&!/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)?name:'camera-file';}
function createCameraDownload(io,{filesystem=fs,chunkBytes=1024*1024}={}){
  if(!Number.isInteger(chunkBytes)||chunkBytes<512||chunkBytes%512)throw TypeError('Download chunk must be a positive multiple of 512.');
  async function download(ref,folder,{cancelled=()=>false,progress=()=>{}}={}){
    const info=io.info(ref),size=Number(info.size);if(info.folder||!Number.isSafeInteger(size)||size<1)throw fail('CARD_FILE_INVALID','Invalid camera file size.');
    const name=safeName(info.name);filesystem.mkdirSync(folder,{recursive:true});const temporary=path.join(folder,'.apertrove-'+randomUUID()+'.partial');
    let descriptor=null,completed=false,target=null,position=0;
    try{
      descriptor=filesystem.openSync(temporary,'wx');
      while(position<size){
        if(cancelled())throw fail('OPERATION_CANCELLED','Camera export cancelled.');
        const count=Math.min(chunkBytes,size-position),bytes=io.chunk(ref,count);
        if(!Buffer.isBuffer(bytes)||bytes.length!==count)throw fail('CARD_DOWNLOAD_SHORT','The camera returned an incomplete file.');
        let written=0;while(written<bytes.length){const count=filesystem.writeSync(descriptor,bytes,written,bytes.length-written);if(!Number.isInteger(count)||count<=0)throw fail('CARD_WRITE_FAILED','The export folder could not be written.');written+=count;}
        position+=count;progress(position);await io.yield();
      }
      if(cancelled())throw fail('OPERATION_CANCELLED','Camera export cancelled.');
      // Host-owned bytes are durably written before camera transfer completion.
      filesystem.fsyncSync(descriptor);io.complete(ref);completed=true;filesystem.closeSync(descriptor);descriptor=null;
      const ext=path.extname(name),stem=path.basename(name,ext);
      for(let suffix=0;suffix<100000;suffix++){
        target=path.join(folder,stem+(suffix?'_'+suffix:'')+ext);
        try{filesystem.linkSync(temporary,target);break;}catch(cause){if(cause.code!=='EEXIST')throw cause;target=null;}
      }
      if(!target)throw fail('CARD_NAME_CONFLICT','No unused export filename is available.');
      try{filesystem.unlinkSync(temporary);}catch(cause){io.cleanupIssue?.(cause);}return {path:target,size};
    }finally{
      if(!completed)try{io.cancel(ref);}catch{}
      if(descriptor!==null)try{filesystem.closeSync(descriptor);}catch{}
      try{filesystem.unlinkSync(temporary);}catch(cause){if(cause.code!=='ENOENT')io.cleanupIssue?.(cause);}
    }
  }
  return {download};
}
module.exports={createCameraDownload,safeName};
