'use strict';
// Test-only invocation fence around the actual pinned Koffi addon. No native import here.
const fs=require('node:fs'),path=require('node:path'),{types}=require('node:util');
const allowed=Object.freeze(['EdsInitializeSDK','EdsTerminateSDK','EdsGetCameraList','EdsGetChildCount','EdsGetChildAtIndex','EdsGetDeviceInfo','EdsOpenSession','EdsCloseSession','EdsRelease','EdsGetPropertySize','EdsGetPropertyData','EdsGetPropertyDesc','EdsGetEvent']);
function createGuard({koffi,runtimePath,tracePath,onViolation=()=>{}}){
  const counts=new Map(),denials=[],records=[],references=new WeakMap();let nextReference=0;
  const same=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
  function record(value){const row={atUtc:new Date().toISOString(),pid:process.pid,...value};if(records.length>=20000)throw Error('H1_TRACE_LIMIT');records.push(row);if(tracePath)fs.appendFileSync(tracePath,JSON.stringify(row)+'\n');return row;}
  function deny(kind,name){const value={kind,name};denials.push(value);record({phase:'DENIED',...value});onViolation(value);throw Object.assign(Error('H1_NATIVE_DENIED: '+kind+' '+name),{code:'H1_NATIVE_DENIED'});}
  function scalar(value){
    if(types.isExternal(value)){if(!references.has(value))references.set(value,'ref'+(++nextReference));return {opaqueRef:references.get(value)};}
    return typeof value==='bigint'?value.toString():Buffer.isBuffer(value)?{bufferBytes:value.length}:Array.isArray(value)?value.map(scalar):value&&typeof value==='object'?{outputObject:true}:value;
  }
  function wrapFunction(real,name,library){
    return function(...args){
      const canon=library==='Canon';
      if(canon&&!allowed.includes(name))return deny('Canon invocation',name);
      if(!canon&&!['SetDllDirectoryW','CoInitializeEx','CoUninitialize'].includes(name))return deny('system invocation',name);
      const count=(counts.get(name)||0)+1;
      if(['EdsInitializeSDK','EdsTerminateSDK','EdsOpenSession','EdsCloseSession','CoInitializeEx','CoUninitialize'].includes(name)&&count>1)return deny('single-cycle budget',name);
      if(name==='SetDllDirectoryW'&&args[0]!==null&&!same(args[0],path.dirname(runtimePath)))return deny('DLL search directory',name);
      if(name==='CoInitializeEx'&&(args[0]!==null||args[1]!==2))return deny('COM apartment',name);
      if(name==='EdsGetPropertyData'&&(!Number.isInteger(args[3])||args[3]<1||args[3]>262144||!Buffer.isBuffer(args[4])||args[4].length!==args[3]))return deny('property output bound',name);
      counts.set(name,count);record({phase:'before',library,name,args:args.map(scalar)});
      try{const result=real(...args);record({phase:'after',library,name,result:scalar(result),resultHex:Number.isInteger(result)?'0x'+(result>>>0).toString(16).padStart(8,'0'):null,outputs:args.map(scalar)});return result;}
      catch(error){record({phase:'throw',library,name,error:String(error.message)});throw error;}
    };
  }
  const wrapped=new Proxy(koffi,{get(target,key){
    if(key==='load')return file=>{
      const name=String(file),canon=same(name,runtimePath),system=['kernel32.dll','ole32.dll','msvcrt.dll'].includes(name.toLowerCase());
      if(!canon&&!system)return deny('library load',name);
      record({phase:'library-load-before',file:name,library:canon?'Canon':name});
      const library=target.load(file);record({phase:'library-load-after',file:name,library:canon?'Canon':name});
      return new Proxy(library,{get(lib,property){
        if(property==='func')return(...signature)=>{
          const symbol=signature.length===1?String(signature[0]).match(/([A-Za-z_]\w*)\s*\(/)?.[1]:signature[1];
          if(!symbol)return deny('unparsed symbol',String(signature[0]));
          return wrapFunction(lib.func(...signature),symbol,canon?'Canon':name);
        };
        if(property==='unload')return()=>{record({phase:'unload-before',file:name});const result=lib.unload();record({phase:'unload-after',file:name});return result;};
        const value=Reflect.get(lib,property,lib);return typeof value==='function'?value.bind(lib):value;
      }});
    };
    // Production allocates three local callback trampolines. None may be handed to Canon in H1.
    if(key==='register')return(_callback,type)=>{record({phase:'callback-trampoline-allocation'});return target.register(()=>deny('unexpected callback delivery','Canon callback'),type);};
    if(key==='unregister')return callback=>{record({phase:'callback-trampoline-release'});return target.unregister(callback);};
    if(['call','as','encode','view'].includes(key))return()=>deny('unadmitted Koffi primitive',String(key));
    const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  }});
  return {koffi:wrapped,evidence:()=>({counts:Object.fromEntries(counts),denials:[...denials],records:records.length}),record};
}
module.exports={allowed,createGuard};
