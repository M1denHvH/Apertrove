'use strict';
// Only root's explicitly admitted H1A controller may deliver this worker a manifest.
const path=require('node:path');
const {types:utilTypes}=require('node:util');
const {validate}=require('./manifest.cjs');
const {enumerate}=require('./h1a-lifecycle.cjs');
const nonce=process.argv[3];
if(require.main!==module||!process.send||process.argv.length!==4||process.argv[2]!=='--h1a-worker'||nonce!==process.env.APERTROVE_H1A_NONCE||!/^[a-f0-9]{48}$/.test(nonce||'')||process.execArgv.join(' ')!=='--max-old-space-size=128')throw Error('H1A_WORKER_ADMISSION_DENIED');
const timer=setTimeout(()=>process.exit(2),15000);
process.once('disconnect',()=>process.exit(2));
process.once('message',message=>{
  clearTimeout(timer);
  let receipt={nativeLoaded:false,canonLoadAttempted:false,unloaded:false,comBalanced:false,outcome:'UNKNOWN',calls:[]};
  try{
    if(message?.nonce!==nonce)throw Error('H1A_PARENT_HANDSHAKE_DENIED');
    const m=message.manifest,a=validate(m,{execute:true});
    const koffi=require(a.addon.path);if(koffi.version!==m.baseAdmission.koffi.version)throw Error('NATIVE_KOFFI_VERSION_MISMATCH');
    const system32=path.join(process.env.SystemRoot,'System32'),kernel=koffi.load(path.join(system32,'kernel32.dll'));
    const restrict=kernel.func('int32 __stdcall SetDefaultDllDirectories(uint32 flags)'),add=kernel.func('void * __stdcall AddDllDirectory(str16 path)'),remove=kernel.func('int32 __stdcall RemoveDllDirectory(void *cookie)');
    const load=kernel.func('void * __stdcall LoadLibraryExW(str16 file, void *reserved, uint32 flags)'),address=kernel.func('void * __stdcall GetProcAddress(void *handle, str name)'),free=kernel.func('int32 __stdcall FreeLibrary(void *handle)');
    function bind(handle,name,signature){const pointer=address(handle,name);if(!pointer)throw Error('REQUIRED_EXPORT_MISSING: '+name);const prototype=koffi.proto(signature);return (...args)=>koffi.call(pointer,prototype,...args);}
    if(restrict(0x800|0x400)===0)throw Error('PROCESS_DLL_SEARCH_RESTRICTION_FAILED');
    const cookie=add(a.directory);if(!cookie)throw Error('REVIEWED_DLL_DIRECTORY_FAILED');
    const ole=load(path.join(system32,'ole32.dll'),null,0x800|0x100);if(!ole)throw Error('COM_LIBRARY_LOAD_FAILED');
    const initializeCOM=bind(ole,'CoInitializeEx','int32 __stdcall H1ACOMInitialize(void *reserved, uint32 flags)'),uninitialize=bind(ole,'CoUninitialize','void __stdcall H1ACOMUninitialize()');
    receipt.comResult=initializeCOM(null,2);if(receipt.comResult<0)throw Error('COM_STA_INITIALIZATION_FAILED');
    validate(m,{execute:true});receipt.canonLoadAttempted=true;receipt.nativeLoaded='UNKNOWN';
    const lib=load(a.dll.path,null,0x800|0x100);if(!lib)throw Error('CANON_LOAD_FAILED');receipt.nativeLoaded=true;
    const sdk={
      initialize:bind(lib,'EdsInitializeSDK','uint32 __stdcall H1AInitialize()'),
      list:bind(lib,'EdsGetCameraList','uint32 __stdcall H1AList(_Out_ void **outList)'),
      count:bind(lib,'EdsGetChildCount','uint32 __stdcall H1ACount(void *list, _Out_ uint32 *outCount)'),
      release:bind(lib,'EdsRelease','uint32 __stdcall H1ARelease(void *list)'),
      terminate:bind(lib,'EdsTerminateSDK','uint32 __stdcall H1ATerminate()')
    };
    receipt={...receipt,...enumerate(sdk,{isOpaqueRef:utilTypes.isExternal})};
    if(receipt.cleanupEligible){
      if(free(lib)===0)throw Error('CANON_UNLOAD_FAILED');receipt.unloaded=true;
      uninitialize();receipt.comBalanced=true;
      if(free(ole)===0)throw Error('COM_LIBRARY_UNLOAD_FAILED');if(remove(cookie)===0)throw Error('DLL_DIRECTORY_CLEANUP_FAILED');kernel.unload();receipt.cleanup='SOURCE_ZERO';
    }
  }catch(error){receipt.outcome='UNKNOWN';receipt.error=String(error.message||error).slice(0,256);}
  const ok=receipt.outcome==='H1A_COUNT_RECORDED'&&receipt.cleanup==='SOURCE_ZERO'&&receipt.unloaded&&receipt.comBalanced;
  process.send({type:'result',nonce,receipt},()=>process.exit(ok?0:1));
});
process.send({type:'ready',nonce,pid:process.pid});
