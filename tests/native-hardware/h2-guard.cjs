'use strict';
// Test-only fence. The caller supplies the reviewed real addon; importing this file is addon-free.
const fs=require('node:fs'),path=require('node:path'),{types}=require('node:util');
const allowed=Object.freeze(['EdsInitializeSDK','EdsTerminateSDK','EdsGetCameraList','EdsGetChildCount','EdsGetChildAtIndex','EdsGetDeviceInfo','EdsOpenSession','EdsCloseSession','EdsRelease','EdsGetPropertySize','EdsGetPropertyData','EdsGetPropertyDesc','EdsGetEvent','EdsSetPropertyData','EdsSendCommand','EdsCreateMemoryStream','EdsCreateEvfImageRef','EdsDownloadEvfImage','EdsGetPointer','EdsGetLength','EdsGetPosition','EdsSeek']);
const exposureIds=[0x402,0x405,0x406],snapshotIds=[0x400,...exposureIds,0x407,0x106,0x107,0x404,0x416,0x50e,0x500,0x501,0xb];
function createGuard({koffi,runtimePath,tracePath,controlPath,nonce,stageScope='FULL',onViolation=()=>{},readControl}){
  if(!['FULL','FOCUS_ONLY'].includes(stageScope))throw Error('H2_STAGE_SCOPE_INVALID');
  const counts=new Map(),denials=[],references=new WeakMap(),streams=new Set(),images=new Map(),owned=new Set(),usedTickets=new Set(),mutationBudgets=new Set(),snapshots={},descriptors={},records=[];let nextRef=0,downloadEpoch=0,current=null,stopped=false,lastTicket=0,camera=null,knownRestore=false,evfCycle=0;const evfRestores=new Set();
  const same=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
  const control=()=>{const value=readControl?readControl():JSON.parse(fs.readFileSync(controlPath,'utf8'));if(value.nonce!==nonce||!Number.isInteger(value.ticket)||value.ticket<lastTicket)deny('control admission','invalid ticket');lastTicket=value.ticket;return value;};
  function record(value){const row={atUtc:new Date().toISOString(),pid:process.pid,...value};if(records.length>=60000)throw Error('H2_TRACE_LIMIT');records.push(row);if(tracePath)fs.appendFileSync(tracePath,JSON.stringify(row)+'\n');return row;}
  function deny(kind,name){const value={kind,name};denials.push(value);stopped=true;record({phase:'DENIED',...value});onViolation(value);throw Object.assign(Error('H2_NATIVE_DENIED: '+kind+' '+name),{code:'H2_NATIVE_DENIED'});}
  function opaque(value){if(!references.has(value))references.set(value,'ref'+(++nextRef));return references.get(value);}
  function scalar(value){if(types.isExternal(value))return {opaqueRef:opaque(value)};if(typeof value==='bigint')return value.toString();if(Buffer.isBuffer(value))return {bufferBytes:value.length,...(value.length===4?{uint32:value.readUInt32LE()}: {})};if(Array.isArray(value))return value.map(scalar);if(value&&typeof value==='object')return value.values?{form:value.form,access:value.access,count:value.count,values:Array.from(value.values).slice(0,128)}:{outputObject:true};return value;}
  function permitTicket(name,args){
    const c=control(),key=c.ticket+':'+name+':'+args[1]+':'+(name==='EdsSetPropertyData'?args[4].readUInt32LE():args[2]);
    if(usedTickets.has(key))deny('duplicate mutation',name);
    if(name==='EdsSetPropertyData'){
      const id=args[1],value=args[4].readUInt32LE();
      if(stageScope==='FOCUS_ONLY'&&exposureIds.includes(id))deny('focus-only exposure mutation forbidden',id);
      if(exposureIds.includes(id)){if(!c.write||c.write.id!==id||c.write.value!==value||!['exposure','restore'].includes(c.phase))deny('exposure ticket',id);const budget=c.phase+':'+id;if(mutationBudgets.has(budget))deny('one exposure/restore attempt',id);if(!Number.isInteger(snapshots[id]?.initial))deny('missing original exposure',id);if(c.phase==='restore'&&value!==snapshots[id].initial)deny('restore must equal original',id);if(c.phase==='exposure'&&(value===snapshots[id].initial||!descriptors[id]?.values?.map(v=>v>>>0).includes(value)))deny('descriptor target',id);mutationBudgets.add(budget);}
      else if([0x500,0x501].includes(id)){const original=snapshots[id]?.initial,start=c.phase==='live-start',restorePhase=['live-stop','cleanup','live','af','lens'].includes(c.phase),expected=start?(id===0x500?(original|2)>>>0:1):original;if(!Number.isInteger(original)||value!==expected||!start&&!restorePhase)deny('EVF restoration/value',value);if(start&&id===0x500)evfCycle++;if(!start){const debt=evfCycle+':'+id;if(!evfCycle||evfRestores.has(debt))deny('one original EVF restore per cycle',id);evfRestores.add(debt);}}
      else deny('property write',id);
    }else{
      const id=args[1],value=args[2];
      const owedOff=id===0x102&&value===0&&counts.get('AF_ON')===1&&!counts.get('AF_OFF')&&args[0]===camera;
      if(!owedOff&&(args[0]!==camera||!(snapshots[0x500]?.current&2)||snapshots[0x501]?.current!==1||snapshots[0x416]?.current!==1||![0,1,2].includes(snapshots[0x404]?.current)))deny('AF/lens native prerequisites',id);
      if(id===0x102){if(c.phase!=='af'||![0,1].includes(value))deny('AF phase/parameter',value);const label=value===1?'AF_ON':'AF_OFF';if(counts.get(label)||value===0&&counts.get('AF_ON')!==1)deny('one AF on/off attempt',name);counts.set(label,1);}
      else if(id===0x103){if(c.phase!=='lens'||![1,0x8001].includes(value)||c.direction!==(value===1?'near':'far'))deny('lens step',value);const label=value===1?'LENS_NEAR':'LENS_FAR';if(counts.get(label))deny('one lens step',label);counts.set(label,1);}
      else deny('command (shutter forbidden)',id);
    }
    usedTickets.add(key);
  }
  function wrapFunction(real,name,library){return function(...args){
    const canon=library==='Canon';if(canon&&!allowed.includes(name))return deny('Canon invocation',name);
    if(!canon&&!['SetDllDirectoryW','CoInitializeEx','CoUninitialize','memcpy'].includes(name))return deny('system invocation',name);
    const owedOff=name==='EdsSendCommand'&&args[1]===0x102&&args[2]===0&&counts.get('AF_ON')===1&&!counts.get('AF_OFF')&&args[0]===camera;
    const owedRestore=knownRestore&&name==='EdsSetPropertyData'&&[0x500,0x501].includes(args[1])&&Buffer.isBuffer(args[4])&&args[4].length===4&&args[4].readUInt32LE()===snapshots[args[1]]?.initial;
    const restoreRead=knownRestore&&name==='EdsGetPropertyData'&&[0x500,0x501].includes(args[1]);
    if(stopped&&!owedOff&&!owedRestore&&!restoreRead&&!['EdsCloseSession','EdsRelease','EdsTerminateSDK','SetDllDirectoryW','CoUninitialize'].includes(name))return deny('stopped series',name);
    const count=(counts.get(name)||0)+1;if(['EdsInitializeSDK','EdsTerminateSDK','EdsOpenSession','EdsCloseSession','CoInitializeEx','CoUninitialize'].includes(name)&&count>1)return deny('single-cycle budget',name);
    if(name==='SetDllDirectoryW'&&args[0]!==null&&!same(args[0],path.dirname(runtimePath)))return deny('DLL directory',name);
    if(name==='CoInitializeEx'&&(args[0]!==null||args[1]!==2))return deny('COM apartment',name);
    if(name==='EdsGetPropertyData'&&(!Number.isInteger(args[3])||args[3]<1||args[3]>262144||!Buffer.isBuffer(args[4])||args[4].length!==args[3]||args[1]===0x104))return deny('property output / unqualified FocusInfo',name);
    if(name==='EdsGetPropertySize'&&args[1]===0x104)return deny('unqualified FocusInfo',name);
    if(name==='EdsSetPropertyData'){if(args[2]!==0||args[3]!==4||!Buffer.isBuffer(args[4])||args[4].length!==4)return deny('property write buffer',name);permitTicket(name,args);}
    if(name==='EdsSendCommand')permitTicket(name,args);
    if(name==='EdsOpenSession'&&!owned.has(args[0]))return deny('unowned camera session',name);
    if(name==='EdsCreateMemoryStream'&&args[0]!==2*1024*1024)return deny('EVF stream size',args[0]);
    if(['EdsCreateEvfImageRef','EdsSeek','EdsGetPointer','EdsGetLength','EdsGetPosition'].includes(name)&&!streams.has(args[0]))return deny('unknown EVF stream',name);
    if(name==='EdsRelease'&&(!owned.has(args[0])||args[0]===current?.pointer))return deny('unowned or borrowed reference release',name);
    if(name==='EdsSeek'&&(args[1]!==0||args[2]!==0))return deny('stream seek',name);
    if(name==='EdsDownloadEvfImage'){if(!images.has(args[1])||!['live-start','live','af','lens','live-stop'].includes(control().phase))return deny('EVF image/phase',name);current=null;}
    if(name==='EdsGetPointer'&&!current?.downloaded)return deny('pointer before fresh EVF',name);
    if(['EdsGetPointer','EdsGetPosition','EdsGetLength'].includes(name)&&args[0]!==current?.stream)return deny('different frame stream',name);
    if(name==='memcpy'){
      if(!current||current.copied||args[1]!==current.pointer||!Buffer.isBuffer(args[0])||args[0].length!==args[2]||!Number.isSafeInteger(args[2])||args[2]<1||args[2]>20*1024*1024||!Number.isSafeInteger(current.length)||args[2]>current.length||args[2]!==((current.position>0)?current.position:current.length))return deny('EVF memcpy bounds/freshness',name);
      current.copied=true;
    }
    // A borrowed EVF pointer may only be followed by its size queries and one bounded copy.
    if(current?.pointer&&!current.copied&&!['EdsGetPosition','EdsGetLength','memcpy'].includes(name))return deny('native call between pointer and copy',name);
    counts.set(name,count);record({phase:'before',library,name,args:args.map(scalar),downloadEpoch});
    try{
      const result=real(...args);
      if(name==='EdsOpenSession'&&result===0)camera=args[0];
      if(['EdsGetCameraList','EdsGetChildAtIndex'].includes(name)&&result===0){const out=args.at(-1)[0];if(!types.isExternal(out))deny('invalid owned reference',name);owned.add(out);}
      if(name==='EdsCreateMemoryStream'&&result===0){if(!types.isExternal(args[1][0]))deny('invalid stream output',name);streams.add(args[1][0]);owned.add(args[1][0]);}
      if(name==='EdsCreateEvfImageRef'&&result===0){if(!types.isExternal(args[1][0]))deny('invalid image output',name);images.set(args[1][0],args[0]);owned.add(args[1][0]);}
      if(name==='EdsDownloadEvfImage'&&result===0)current={downloaded:true,stream:images.get(args[1]),epoch:++downloadEpoch,pointer:null,length:null,position:null,copied:false};
      if(name==='EdsGetPointer'&&result===0){if(!types.isExternal(args[1][0]))deny('invalid borrowed pointer',name);current.pointer=args[1][0];}
      if(name==='EdsGetPosition'&&result===0&&current)current.position=Number(args[1][0]);
      if(name==='EdsGetLength'&&result===0&&current)current.length=Number(args[1][0]);
      if(name==='EdsGetPropertyData'&&result===0&&snapshotIds.includes(args[1])&&args[4].length===4){const value=args[4].readUInt32LE();snapshots[args[1]]={initial:snapshots[args[1]]?.initial??value,current:value};}
      if(name==='EdsGetPropertyDesc'&&result===0){const desc=scalar(args[2]);if(!Number.isInteger(desc.count)||desc.count<0||desc.count>128||desc.values?.length<desc.count)deny('invalid descriptor count',name);descriptors[args[1]]={...desc,values:desc.values.slice(0,desc.count)};}
      if(name==='EdsRelease'){owned.delete(args[0]);streams.delete(args[0]);images.delete(args[0]);if(!streams.size)current=null;}
      record({phase:'after',library,name,result:scalar(result),resultHex:Number.isInteger(result)?'0x'+(result>>>0).toString(16).padStart(8,'0'):null,outputs:args.map(scalar),downloadEpoch});
      // BUSY stops this series; ObjectNotReady is the documented EVF readiness poll only.
      const probe=['EdsGetPropertySize','EdsGetPropertyData','EdsGetPropertyDesc'].includes(name),notReady=name==='EdsDownloadEvfImage'&&result===0xa102;
      if(canon&&(result===0x81||name==='EdsRelease'&&result===0xffffffff||name!=='EdsRelease'&&!probe&&!notReady&&result!==0)){stopped=true;knownRestore=result!==0x81&&name!=='EdsRelease';record({phase:'STOP',name,result});onViolation({kind:'critical native result',name,result});throw Object.assign(Error('H2_NATIVE_STOP: '+name),{code:'H2_NATIVE_STOP',knownNativeFailure:true});}
      return result;
    }catch(error){stopped=true;current=null;if(!error.knownNativeFailure)knownRestore=false;record({phase:error.knownNativeFailure?'controlled-stop':'throw',library,name,error:String(error.message)});if(!error.knownNativeFailure)onViolation({kind:'native exception',name,error:String(error.message)});throw error;}
  };}
  const wrapped=new Proxy(koffi,{get(target,key){
    if(key==='load')return file=>{const name=String(file),canon=same(name,runtimePath),system=['kernel32.dll','ole32.dll','msvcrt.dll'].includes(name.toLowerCase());if(!canon&&!system)return deny('library load',name);record({phase:'library-load-before',file:name,library:canon?'Canon':name});const library=target.load(file);record({phase:'library-load-after',file:name,library:canon?'Canon':name});return new Proxy(library,{get(lib,property){if(property==='func')return(...signature)=>{const symbol=signature.length===1?String(signature[0]).match(/([A-Za-z_]\w*)\s*\(/)?.[1]:signature[1];if(!symbol)return deny('unparsed symbol','');return wrapFunction(lib.func(...signature),symbol,canon?'Canon':name);};if(property==='unload')return()=>{record({phase:'unload-before',file:name});const value=lib.unload();record({phase:'unload-after',file:name});return value;};const value=Reflect.get(lib,property,lib);return typeof value==='function'?value.bind(lib):value;}});};
    if(key==='register')return(_callback,type)=>{record({phase:'callback-trampoline-allocation'});return target.register(()=>deny('unexpected callback delivery','Canon callback'),type);};
    if(key==='unregister')return callback=>{record({phase:'callback-trampoline-release'});return target.unregister(callback);};
    if(['call','as','encode','view'].includes(key))return()=>deny('unadmitted Koffi primitive',String(key));const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  }});
  return {koffi:wrapped,evidence:()=>({counts:Object.fromEntries(counts),denials:[...denials],records:records.length,snapshots,descriptors,stopped}),record};
}
module.exports={allowed,createGuard};
