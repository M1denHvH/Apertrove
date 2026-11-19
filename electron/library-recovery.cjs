// Bounded previous-generation retention. Callers serialize writes to each library.
// A fulfilled write acknowledges application-level replacement, not power-loss durability.
const defaultFS=require('node:fs/promises');
const path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {decodeLibraryBytes}=require('./library-text.cjs');
const {validateLibrary}=require('./library-schema.cjs');

function libraryPath(filename){
  if(typeof filename!=='string'||!path.isAbsolute(filename))throw TypeError('Library path must be absolute.');
  return filename;
}
function previousPath(filename){
  libraryPath(filename);
  const base=path.basename(filename).replace(/\.json$/i,'');
  return path.join(path.dirname(filename),base+'.previous.json');
}
function error(code,message){const result=Error(message);result.code=code;return result;}
function sameJSON(left,right){
  if(left===right)return true;
  if(!left||!right||typeof left!=='object'||typeof right!=='object'||Array.isArray(left)!==Array.isArray(right))return false;
  if(Array.isArray(left)&&left.length!==right.length)return false;
  const keys=Object.keys(left);
  return keys.length===Object.keys(right).length&&keys.every(key=>Object.hasOwn(right,key)&&sameJSON(left[key],right[key]));
}
const BACKUP_FAILURES=new Set(['LIBRARY_BACKUP_UNUSABLE','EACCES','EPERM','ENOSPC','EIO','EBADF','EBUSY','ENOTDIR','EISDIR','EEXIST','EMFILE','ENFILE','ENOMEM','EROFS','EDQUOT','ENAMETOOLONG','ENOENT']);
function classifyLibraryBytes(bytes){
  let sha256,text;
  try{sha256=createHash('sha256').update(bytes).digest('hex');text=decodeLibraryBytes(bytes);}
  catch{return {kind:'UNREADABLE',...(sha256?{sha256}:{}),code:'INVALID_UTF8'};}
  let value;
  try{value=JSON.parse(text);}catch{return {kind:'CORRUPT',sha256,reason:'json'};}
  return {...validateLibrary(value),sha256};
}

function createLibraryRecovery({fs=defaultFS,id=randomUUID}={}){
  if(typeof id!=='function')throw TypeError('Recovery requires an explicit temporary-file identity factory.');
  async function slot(filename){
    let bytes;
    try{bytes=await fs.readFile(filename);}
    catch(failure){
      if(failure?.code==='ENOENT')return {kind:'MISSING'};
      return {kind:'UNREADABLE',...(typeof failure?.code==='string'?{code:failure.code}:{})};
    }
    return {...classifyLibraryBytes(bytes),bytes};
  }
  const summary=({bytes,...result})=>result;
  async function inspectLibraryRecovery(filename){
    libraryPath(filename);
    const primary=await slot(filename),previous=await slot(previousPath(filename));
    const firstRun=primary.kind==='MISSING'&&previous.kind==='MISSING';
    return {
      primary:summary(primary),previous:summary(previous),firstRun,
      selection:primary.kind==='VALID'?'primary':'none',
      reason:primary.kind==='VALID'?'PRIMARY_AUTHORITATIVE':firstRun?'EMPTY':primary.kind==='UNSUPPORTED_VERSION'?'UNSUPPORTED_VERSION':'EXPLICIT_RECOVERY_REQUIRED',
      recoverablePrevious:previous.kind==='VALID'&&!['VALID','UNSUPPORTED_VERSION'].includes(primary.kind)
    };
  }
  async function readPrimaryLibraryText(filename){
    libraryPath(filename);
    try{return decodeLibraryBytes(await fs.readFile(filename));}
    catch(failure){
      if(failure?.code!=='ENOENT')throw failure;
      const previous=await slot(previousPath(filename));
      if(previous.kind!=='MISSING')throw error('LIBRARY_RECOVERY_REQUIRED','A prior library exists; explicit recovery is required before creating a new library.');
      throw failure;
    }
  }
  async function unchanged(filename,expected){
    const current=await slot(filename);
    if(current.kind!==expected.kind||current.sha256!==expected.sha256)throw error('LIBRARY_CHANGED','Library recovery material changed during persistence.');
    // Unreadable slots are never safe replacement targets even if their error codes match.
    if(!['VALID','MISSING'].includes(current.kind))throw error('LIBRARY_CHANGED','Library recovery material cannot be safely replaced.');
  }
  async function replace(filename,bytes,phase,check){
    const token=id();
    if(typeof token!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(token))throw error('LIBRARY_TEMP_ID_INVALID','Invalid library temporary-file identity.');
    const temporary=filename+'.'+phase+'.'+token+'.tmp';
    const handle=await fs.open(temporary,'wx');
    let failed;
    try{await handle.writeFile(bytes);}
    catch(failure){failed=failure;}
    try{await handle.close();}
    catch(failure){failed??=failure;try{await handle.close();}catch{/* Retain the first failure and the owned temporary file. */}}
    if(failed)throw failed;
    await check();
    // Final operation: nothing that can turn an acknowledged replacement into a
    // rejected registration may run after this rename. Failed temps are retained.
    await fs.rename(temporary,filename);
  }
  async function writeLibraryGeneration(filename,candidate,{allowBackupDegradation=false}={}){
    libraryPath(filename);
    // Snapshot/validate before any I/O; preserve unknown JSON-compatible fields.
    let text,copy;
    try{text=JSON.stringify(candidate,null,2);copy=JSON.parse(text);}
    catch{throw error('LIBRARY_CANDIDATE_INVALID','Library candidate is not serializable.');}
    if(validateLibrary(copy).kind!=='VALID'||copy.version!==2)throw error('LIBRARY_CANDIDATE_INVALID','Library candidate is not a supported prepared library.');
    const primary=await slot(filename),backupName=previousPath(filename),previous=await slot(backupName);
    if(primary.kind==='VALID'&&primary.version===2&&sameJSON(JSON.parse(decodeLibraryBytes(primary.bytes)),copy)){
      // An unchanged validated primary needs no replacement or backup rotation.
      // Preserve unusable previous material while allowing an idempotent boot.
      await unchanged(filename,primary);return {primaryChanged:false,backupWarning:!['VALID','MISSING'].includes(previous.kind)?'LIBRARY_BACKUP_UNUSABLE':null};
    }
    if(primary.kind==='UNSUPPORTED_VERSION')throw error('LIBRARY_UNSUPPORTED_VERSION','A newer library version cannot be replaced.');
    if(primary.kind==='MISSING'&&previous.kind!=='MISSING')throw error('LIBRARY_RECOVERY_REQUIRED','A prior library exists; explicit recovery is required before creating a new library.');
    if(!['VALID','MISSING'].includes(primary.kind))throw error('LIBRARY_PRIMARY_UNUSABLE','The existing library must be recovered before persistence.');
    const usablePrevious=['VALID','MISSING'].includes(previous.kind);
    if(!usablePrevious&&!allowBackupDegradation)throw error('LIBRARY_BACKUP_UNUSABLE','The previous library must be retained for explicit recovery.');
    await fs.mkdir(path.dirname(filename),{recursive:true});
    let backupWarning=null;
    if(primary.kind==='VALID'){
      try{
        if(!usablePrevious)throw error('LIBRARY_BACKUP_UNUSABLE','The previous library must be retained for explicit recovery.');
        await replace(backupName,primary.bytes,'backup',()=>unchanged(backupName,previous));
      }catch(failure){
        if(!allowBackupDegradation||!BACKUP_FAILURES.has(failure?.code))throw failure;
        backupWarning=failure.code;
      }
    }
    const acknowledgement={primaryChanged:true,backupWarning};
    await replace(filename,text,'primary',async()=>{
      await unchanged(filename,primary);
      if(backupWarning){
        const observed=await slot(backupName);
        if(observed.kind!==previous.kind||observed.sha256!==previous.sha256||observed.code!==previous.code)throw error('LIBRARY_CHANGED','Library recovery material changed during persistence.');
      }else await unchanged(backupName,primary.kind==='VALID'?{kind:'VALID',sha256:primary.sha256}:previous);
    });
    return acknowledgement;
  }
  return {inspectLibraryRecovery,readPrimaryLibraryText,writeLibraryGeneration};
}

module.exports={previousPath,classifyLibraryBytes,createLibraryRecovery,...createLibraryRecovery()};
