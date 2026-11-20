'use strict';
// Not the application worker: only the two lifecycle exports are bound here.
// Reached only by the opted-in external watchdog parent, never by npm test.
const fs=require('node:fs'),path=require('node:path');
const {validate}=require('./manifest.cjs');
const nonce=process.argv[3];
if(require.main!==module||!process.send||process.argv.length!==4||process.argv[2]!=='--native-worker'||nonce!==process.env.APERTROVE_N2_NONCE||!/^[a-f0-9]{48}$/.test(nonce||'')||process.execArgv.join(' ')!=='--max-old-space-size=128')throw Error('N2_WORKER_ADMISSION_DENIED');
process.once('message',message=>{
  const receipt={nativeLoaded:false,canonLoadAttempted:false,initialize:null,terminate:null,unloaded:false,comBalanced:false,cleanup:'UNKNOWN'};
  try{
    if(message?.nonce!==nonce)throw Error('N2_PARENT_HANDSHAKE_DENIED');
    const m=message.manifest,a=validate(m,{execute:true});
    const koffi=require(a.addon.path); // Exact reviewed .node, no package-loader fallback/download.
    if(koffi.version!==m.koffi.version)throw Error('NATIVE_KOFFI_VERSION_MISMATCH');
    const system32=path.join(process.env.SystemRoot,'System32');
    const kernel=koffi.load(path.join(system32,'kernel32.dll'));
    const restrict=kernel.func('int32 __stdcall SetDefaultDllDirectories(uint32 flags)');
    const add=kernel.func('void * __stdcall AddDllDirectory(str16 path)');
    const remove=kernel.func('int32 __stdcall RemoveDllDirectory(void *cookie)');
    const load=kernel.func('void * __stdcall LoadLibraryExW(str16 file, void *reserved, uint32 flags)');
    const address=kernel.func('void * __stdcall GetProcAddress(void *handle, str name)');
    const free=kernel.func('int32 __stdcall FreeLibrary(void *handle)');
    function bind(handle,name,signature){const pointer=address(handle,name);if(!pointer)throw Error('REQUIRED_EXPORT_MISSING: '+name);const prototype=koffi.proto(signature);return (...args)=>koffi.call(pointer,prototype,...args);}
    if(restrict(0x800|0x400)===0)throw Error('PROCESS_DLL_SEARCH_RESTRICTION_FAILED');
    const cookie=add(a.directory);if(!cookie)throw Error('REVIEWED_DLL_DIRECTORY_FAILED');
    let ole,uninitialize,lib,initialized=false,com=false,cleanupAllowed=true;
    try{
      // Explicit flags avoid Koffi's broader LoadLibraryEx fallback search.
      ole=load(path.join(system32,'ole32.dll'),null,0x800|0x100);if(!ole)throw Error('COM_LIBRARY_LOAD_FAILED');
      const initializeCOM=bind(ole,'CoInitializeEx','int32 __stdcall N2COMInitialize(void *reserved, uint32 flags)');
      uninitialize=bind(ole,'CoUninitialize','void __stdcall N2COMUninitialize()');
      receipt.comResult=initializeCOM(null,2);if(receipt.comResult<0)throw Error('COM_STA_INITIALIZATION_FAILED');com=true;
      // Recheck bytes immediately before load; no alternative DLL is attempted.
      validate(m,{execute:true});receipt.canonLoadAttempted=true;receipt.nativeLoaded='UNKNOWN';
      lib=load(a.dll.path,null,0x800|0x100);if(!lib)throw Error('CANON_LOAD_FAILED');receipt.nativeLoaded=true;
      const initialize=bind(lib,'EdsInitializeSDK','uint32 __stdcall N2InitializeSDK()');
      const terminate=bind(lib,'EdsTerminateSDK','uint32 __stdcall N2TerminateSDK()');
      receipt.initialize=initialize();initialized=receipt.initialize===0;
      if(initialized){receipt.terminate=terminate();if(receipt.terminate!==0)cleanupAllowed=false;}
      // A failed init/exception is not evidence that unloading is safe.
      else cleanupAllowed=false;
    }catch(error){cleanupAllowed=false;throw error;}
    finally{
      if(cleanupAllowed){if(lib){if(free(lib)===0)throw Error('CANON_UNLOAD_FAILED');receipt.unloaded=true;}if(com){uninitialize();receipt.comBalanced=true;}if(ole&&free(ole)===0)throw Error('COM_LIBRARY_UNLOAD_FAILED');if(remove(cookie)===0)throw Error('DLL_DIRECTORY_CLEANUP_FAILED');kernel.unload();receipt.cleanup='SOURCE_ZERO';}
      // On uncertain teardown retain dependencies until the dedicated process exits.
    }
  }catch(error){receipt.error=error.message;}
  const ok=receipt.cleanup==='SOURCE_ZERO'&&receipt.initialize===0&&receipt.terminate===0;
  process.send({type:'result',nonce,receipt},()=>process.exit(ok?0:1));
});
process.send({type:'ready',nonce});
