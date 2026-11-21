const fsp=require('node:fs/promises');
const path=require('node:path');

function exportError(code,message,details={},cause){
  const error=Error(message);error.code=code;Object.assign(error,details);
  if(cause)error.cause=cause;
  return error;
}

// NEW outputs only. Exclusive creation and the owned handle are the write barrier.
// Canonical paths and identity checks detect known aliases; they are not an OS
// sandbox or a claim of resistance to hostile Windows namespace/ACL races.
function createProtectedExport({getRegistry,serialize=operation=>operation(),fs=fsp,platform=process.platform}){
  if(typeof getRegistry!=='function'||typeof serialize!=='function')throw TypeError('Export requires an explicit protected registry and serializer.');
  const paths=platform==='win32'?path.win32:path.posix;
  const active=new Map(),incomplete=new Map();
  const key=file=>{
    const resolved=paths.resolve(file);
    return platform==='win32'?resolved.toLowerCase():resolved;
  };
  const within=(directory,file)=>{
    const relative=paths.relative(key(directory),key(file));
    return relative===''||(!paths.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+paths.sep));
  };
  function destinationPath(file){
    if(typeof file!=='string'||!file||file.includes('\0')||!paths.isAbsolute(file)||/[\\/]$/.test(file))throw exportError('EXPORT_PATH','Choose an absolute output filename in a regular folder.');
    if(platform==='win32'){
      const windows=file.replaceAll('/','\\');
      if(/^\\\\[?.]\\/.test(windows))throw exportError('EXPORT_PATH','Device and extended namespace output paths are not supported. Choose a regular folder.');
      if(!/^(?:[a-z]:\\|\\\\[^\\]+\\[^\\]+\\)/i.test(windows))throw exportError('EXPORT_PATH','Choose a fully qualified drive or UNC output filename.');
      const root=paths.parse(file).root;
      const tail=file.slice(root.length);
      if((/^[a-z]:/i.test(windows)?windows.slice(2):windows).includes(':'))throw exportError('EXPORT_PATH','Alternate data streams are not supported for exports. Choose a new ordinary filename.');
      if(/[<>"|?*\x00-\x1f]/.test(tail))throw exportError('EXPORT_PATH','Choose an ordinary Windows output filename without reserved characters.');
      for(const component of tail.split(/[\\/]+/)){
        if(component==='.'||component==='..')continue;
        if(!component||/[. ]$/.test(component)||/^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(component))throw exportError('EXPORT_PATH','Ambiguous or reserved Windows output names are not supported. Choose a new ordinary filename.');
      }
    }
    const resolved=paths.resolve(file);
    if(resolved===paths.parse(resolved).root)throw exportError('EXPORT_PATH','Choose an output file, not a filesystem root.');
    return resolved;
  }
  async function inspectParent(destination){
    const parent=paths.dirname(destination);
    let current=parent;
    for(;;){
      let stat;
      try{stat=await fs.lstat(current);}catch(cause){throw exportError('EXPORT_PARENT','The output folder is not accessible. Choose an existing regular folder.',{},cause);}
      if(stat.isSymbolicLink())throw exportError('EXPORT_ALIAS','Choose a regular output folder without symbolic links or junctions.');
      if(!stat.isDirectory())throw exportError('EXPORT_PARENT','The output folder is not a directory.');
      const next=paths.dirname(current);if(next===current)break;current=next;
    }
    try{return {parent,canonicalParent:paths.resolve(await fs.realpath(parent))};}
    catch(cause){throw exportError('EXPORT_PARENT','The output folder cannot be resolved. Choose an existing regular folder.',{},cause);}
  }
  async function plan(destination,{existingOwned=false}={}){
    const registry=await getRegistry();
    if(!registry||!Array.isArray(registry.files)||!Array.isArray(registry.directories))throw TypeError('Protected registry requires files and directories arrays.');
    const files=registry.files.filter(file=>typeof file==='string'&&file).map(file=>paths.resolve(file));
    const directories=registry.directories.filter(file=>typeof file==='string'&&file).map(file=>paths.resolve(file));
    const protectedError=()=>exportError('EXPORT_PROTECTED','Choose a new output file outside registered originals and protected application data.');
    if(files.some(file=>key(file)===key(destination))||directories.some(directory=>within(directory,destination)))throw protectedError();
    const parent=await inspectParent(destination);
    const canonicalDestination=paths.join(parent.canonicalParent,paths.basename(destination));
    const canonicalParents=new Map();
    const optionalRealpath=async file=>{try{return paths.resolve(await fs.realpath(file));}catch{return null;}};
    const canonicalFile=async file=>{
      const existing=await optionalRealpath(file);if(existing)return existing;
      const directory=paths.dirname(file),directoryKey=key(directory);
      if(!canonicalParents.has(directoryKey))canonicalParents.set(directoryKey,optionalRealpath(directory));
      const resolved=await canonicalParents.get(directoryKey);
      return resolved?paths.join(resolved,paths.basename(file)):null;
    };
    // Failure to identify an unrelated original is not a reason to disable a
    // new export: wx still refuses every existing destination, including aliases.
    for(const directory of directories){const canonical=await optionalRealpath(directory);if(canonical&&within(canonical,canonicalDestination))throw protectedError();}
    for(const file of files){const canonical=await canonicalFile(file);if(canonical&&key(canonical)===key(canonicalDestination))throw protectedError();}
    if(!existingOwned){
      try{await fs.lstat(destination);}
      catch(error){if(error.code==='ENOENT')return {...parent,canonicalDestination};throw error;}
      throw exportError('EXPORT_EXISTS','This file already exists. Choose a new filename; overwriting existing files is not supported safely.');
    }
    return {...parent,canonicalDestination};
  }
  function identity(stat){
    if(!stat)return null;
    const numeric=value=>typeof value==='bigint'?value:typeof value==='number'&&Number.isSafeInteger(value)?BigInt(value):null;
    const dev=numeric(stat.dev),ino=numeric(stat.ino);
    return dev!==null&&ino!==null&&ino>0n?String(dev)+':'+String(ino):null;
  }
  async function verifyOwned(handle,destination,expectedParent,byteLength,expectedIdentity=null){
    const current=await inspectParent(destination);
    if(key(current.canonicalParent)!==key(expectedParent))throw exportError('EXPORT_PATH_CHANGED','The output folder changed during export. The new file was retained for inspection.');
    const visible=await fs.lstat(destination,{bigint:true});
    if(visible.isSymbolicLink()||!visible.isFile()||Number(visible.nlink)>1)throw exportError('EXPORT_PATH_CHANGED','The output path or links changed during export. No pathname cleanup was attempted.');
    let owned;
    if(typeof handle?.stat==='function'){try{owned=await handle.stat({bigint:true});}catch{}}
    const ownedId=identity(owned)||expectedIdentity,visibleId=identity(visible);
    if(ownedId&&visibleId&&ownedId!==visibleId)throw exportError('EXPORT_PATH_CHANGED','The output file identity changed during export. No pathname cleanup was attempted.');
    const visibleSize=typeof visible.size==='bigint'?visible.size:typeof visible.size==='number'&&Number.isSafeInteger(visible.size)?BigInt(visible.size):null;
    if(visibleSize!==null&&visibleSize!==BigInt(byteLength))throw exportError('EXPORT_PATH_CHANGED','The output file size changed during export. The file was retained for inspection.');
    return ownedId;
  }
  function begin(destination,canonicalDestination){
    const keys=[...new Set([key(destination),key(canonicalDestination)])];
    if(keys.some(value=>active.has(value)))throw exportError('EXPORT_BUSY','An export to this filename is already running. Choose another filename or wait.');
    let settle;
    const operation={destination,keys,done:new Promise(resolve=>{settle=resolve;}),settle:result=>settle(result)};
    for(const value of keys){incomplete.delete(value);active.set(value,operation);}
    return operation;
  }
  async function writeNew(file,produceBytes){
    if(typeof produceBytes!=='function')throw TypeError('Export requires an explicit byte producer.');
    const destination=destinationPath(file);
    return serialize(async()=>{
      const initial=await plan(destination);
      const operation=begin(destination,initial.canonicalDestination);
      let handle,created=false,complete=false,failure;
      try{
        const bytes=await produceBytes();
        if(typeof bytes!=='string'&&!ArrayBuffer.isView(bytes))throw exportError('EXPORT_CONTENT','The export producer did not return file bytes.');
        const byteLength=typeof bytes==='string'?Buffer.byteLength(bytes):bytes.byteLength;
        if(byteLength===0)throw exportError('EXPORT_CONTENT','The export producer returned an empty output.');
        const final=await plan(destination);
        if(key(final.canonicalParent)!==key(initial.canonicalParent))throw exportError('EXPORT_PATH_CHANGED','The output folder changed before creation. Choose the destination again.');
        try{handle=await fs.open(destination,'wx');created=true;}
        catch(cause){if(cause.code==='EEXIST')throw exportError('EXPORT_EXISTS','This file was created by another operation. Choose a new filename.',{},cause);throw cause;}
        // A fresh registry catches late additions even when a caller's serializer
        // is a no-op. Main also serializes this with registration commits.
        await plan(destination,{existingOwned:true});
        await handle.writeFile(bytes);
        const ownedIdentity=await verifyOwned(handle,destination,final.canonicalParent,byteLength);
        await handle.close();handle=null;
        await verifyOwned(null,destination,final.canonicalParent,byteLength,ownedIdentity);
        complete=true;return destination;
      }catch(cause){
        failure=cause&&typeof cause.code==='string'&&cause.code.startsWith('EXPORT_')?cause:exportError('EXPORT_FAILED','The export could not be completed. Check any incomplete output and choose a new filename.',{},cause);
        failure.destination=destination;failure.outputRetained=created;throw failure;
      }finally{
        if(handle){try{await handle.close();}catch{}}
        if(created&&!complete){
          const record={destination,keys:operation.keys,error:failure};for(const value of operation.keys)incomplete.set(value,record);
        }
        for(const value of operation.keys)if(active.get(value)===operation)active.delete(value);
        operation.settle({ok:complete,error:failure,outputRetained:created&&!complete});
      }
    });
  }
  async function waitForPath(file){
    if(typeof file!=='string'||(!active.size&&!incomplete.size))return;
    const keys=[key(file)];
    try{keys.push(key(await fs.realpath(file)));}
    catch{try{keys.push(key(paths.join(await fs.realpath(paths.dirname(paths.resolve(file))),paths.basename(file))));}catch{}}
    for(;;){
      const failed=keys.map(value=>incomplete.get(value)).find(Boolean);
      if(failed){
        let missing=false;try{await fs.lstat(failed.destination);}catch(error){if(error.code==='ENOENT')missing=true;else throw error;}
        if(missing){for(const value of failed.keys)if(incomplete.get(value)===failed)incomplete.delete(value);}
        else throw exportError('EXPORT_INCOMPLETE','This filename belongs to an incomplete export retained after failure. Inspect or remove it before retrying an export, or choose another import file; no original was deleted.',{destination:failed.destination,outputRetained:true},failed.error);
      }
      const pending=keys.map(value=>active.get(value)).find(Boolean);
      if(!pending)return;
      await pending.done;
    }
  }
  return {
    writeNew,
    writeJSON:(destination,value)=>writeNew(destination,()=>JSON.stringify(value,null,2)),
    async save(result,produceBytes){
      if(result?.canceled===true)return null;
      if(!result||typeof result.filePath!=='string')throw exportError('EXPORT_PATH','No export filename was selected.');
      return writeNew(result.filePath,produceBytes);
    },
    waitForPath
  };
}

module.exports={createProtectedExport};
