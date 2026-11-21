'use strict';
// Trusted named runners only. This reviewed VM/port fence is NOT an OS sandbox.
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {TextDecoder}=require('node:util');
const MODULES=Object.freeze(['electron/protected-export.cjs','electron/export-service.cjs','electron/library-recovery.cjs','electron/library-storage.cjs','electron/library-text.cjs','electron/library-schema.cjs','electron/library-bootstrap.cjs','electron/library-commits.cjs','electron/photo-import.cjs','electron/photo-name.cjs','electron/library.cjs','electron/metadata.cjs','electron/sessions.cjs','electron/workspace-settings.cjs','electron/onboarding.cjs']);
const inside=(root,file)=>{const r=path.relative(root,file);return r===''||(!path.isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+path.sep));};
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function coded(code){const e=Error(code);e.code=code;return e;}
function createFSGuard({repoRoot,fixtureRoot,ports={}}){
  const root=fs.realpathSync(repoRoot),base=fs.realpathSync(path.join(root,'qa','s2a','fixtures')),fixture=fs.realpathSync(fixtureRoot);
  if(!inside(base,fixture)||fixture===base||fs.lstatSync(fixtureRoot).isSymbolicLink())throw coded('S2A_FIXTURE_DENIED');
  const operations=[],attempts=[],sources=new Map(),graph=[],cache=new Map(),handles=new Set();
  const counters={operations:0,readBytes:0,writeBytes:0,openHandles:0,maxOpenHandles:0};
  const limits={operations:3000,fileBytes:1024*1024,readBytes:16*1024*1024,writeBytes:16*1024*1024,handles:8};
  let expected=false;
  function deny(kind,detail,code){attempts.push({kind,detail:String(detail),expected,code});throw coded(code);}
  function checked(file,operation){
    if(typeof file!=='string'||!path.isAbsolute(file))return deny('path',operation+':'+String(file),'S2A_PATH_DENIED');
    const absolute=path.resolve(file),ancestorMetadata=['lstat','realpath'].includes(operation)&&inside(absolute,fixture);
    if(!inside(fixture,absolute)&&!ancestorMetadata)return deny('path',operation+':'+absolute,'S2A_PATH_DENIED');
    if(ancestorMetadata)return absolute;
    let parent=operation==='lstat'?path.dirname(absolute):absolute;
    for(;;){
      try{
        const stat=fs.lstatSync(parent);
        // lstat inspects a link itself. File I/O must resolve within our fixture.
        const real=fs.realpathSync(parent);
        if(!inside(fixture,real))return deny('alias',operation+':'+absolute,'S2A_PATH_DENIED');
        if(stat.isFile()&&parent!==absolute)break; // retain real ENOTDIR below.
        break;
      }catch(error){if(error.code==='S2A_PATH_DENIED')throw error;if(!['ENOENT','ENOTDIR'].includes(error.code))throw error;const next=path.dirname(parent);if(next===parent)return deny('path',absolute,'S2A_PATH_DENIED');parent=next;}
    }
    return absolute;
  }
  function charge(operation,files=[],bytes=0){
    counters.operations++;if(bytes>limits.fileBytes||counters.operations>limits.operations)return deny('budget',operation,'S2A_BUDGET');
    if(operation==='readFile')counters.readBytes+=bytes;
    if(['writeFile','handle.writeFile','copyFile'].includes(operation))counters.writeBytes+=bytes;
    if(counters.readBytes>limits.readBytes||counters.writeBytes>limits.writeBytes)return deny('budget',operation,'S2A_BUDGET');
    operations.push({operation,paths:files.map(f=>path.relative(fixture,f)),bytes});
  }
  function statOptions(options){if(options!==undefined&&(!options||options.bigint!==true||Object.keys(options).length!==1))return deny('fs','stat options','S2A_FS_DENIED');return options;}
  function dataSize(data){if(typeof data==='string')return Buffer.byteLength(data);if(ArrayBuffer.isView(data))return data.byteLength;return deny('fs','non-byte write','S2A_FS_DENIED');}
  const methods={
    async readFile(file,options){const p=checked(file,'readFile');if(options!==undefined&&options!=='utf8')return deny('fs','read options','S2A_FS_DENIED');let size=0;try{const s=fs.statSync(p);if(s.isFile())size=s.size;}catch(error){if(!['ENOENT','ENOTDIR'].includes(error.code))throw error;}charge('readFile',[p],size);return fsp.readFile(p,options);},
    async stat(file,options){const p=checked(file,'stat');charge('stat',[p]);return fsp.stat(p,statOptions(options));},
    async lstat(file,options){const p=checked(file,'lstat');charge('lstat',[p]);return fsp.lstat(p,statOptions(options));},
    async realpath(file){const p=checked(file,'realpath');charge('realpath',[p]);return fsp.realpath(p);},
    async access(file){const p=checked(file,'access');charge('access',[p]);return fsp.access(p);},
    async mkdir(file,options){const p=checked(file,'mkdir');if(!options||options.recursive!==true||Object.keys(options).length!==1)return deny('fs','mkdir options','S2A_FS_DENIED');charge('mkdir',[p]);return fsp.mkdir(p,{recursive:true});},
    async writeFile(file,data,options){const p=checked(file,'writeFile');if(options!==undefined)return deny('fs','write options','S2A_FS_DENIED');charge('writeFile',[p],dataSize(data));return fsp.writeFile(p,data);},
    async copyFile(source,destination,flags){const from=checked(source,'copyFile source'),to=checked(destination,'copyFile destination');if(flags!==fs.constants.COPYFILE_EXCL)return deny('fs','copy flags','S2A_FS_DENIED');charge('copyFile',[from,to],fs.statSync(from).size);return fsp.copyFile(from,to,flags);},
    async rename(source,destination){const from=checked(source,'rename source'),to=checked(destination,'rename destination');charge('rename',[from,to]);return fsp.rename(from,to);},
    async open(file,flags){
      const p=checked(file,'open');if(flags!=='wx')return deny('fs','open '+String(flags),'S2A_FS_DENIED');if(handles.size>=limits.handles)return deny('budget','handles','S2A_BUDGET');charge('open',[p]);
      const handle=await fsp.open(p,'wx');handles.add(handle);counters.openHandles=handles.size;counters.maxOpenHandles=Math.max(counters.maxOpenHandles,handles.size);let closed=false;
      return Object.freeze({
        async writeFile(data){if(closed)throw coded('S2A_HANDLE_CLOSED');charge('handle.writeFile',[p],dataSize(data));return handle.writeFile(data);},
        async stat(options){if(closed)throw coded('S2A_HANDLE_CLOSED');charge('handle.stat',[p]);return handle.stat(statOptions(options));},
        async close(){if(closed)throw coded('S2A_HANDLE_CLOSED');charge('handle.close',[p]);await handle.close();closed=true;handles.delete(handle);counters.openHandles=handles.size;}
      });
    }
  };
  const facade=new Proxy(Object.freeze(methods),{get(target,key){if(Object.hasOwn(target,key))return target[key];return deny('fs',String(key),'S2A_FS_DENIED');}});
  const builtins=new Map([['node:fs/promises',facade],['node:fs',Object.freeze({constants:Object.freeze({COPYFILE_EXCL:fs.constants.COPYFILE_EXCL})})],['node:path',path],['node:crypto',Object.freeze({randomUUID:crypto.randomUUID,createHash:crypto.createHash})],['node:util',Object.freeze({TextDecoder})]]);
  for(const [name,value]of Object.entries(ports)){if(!['sharp','exifr'].includes(name))throw coded('S2A_PORT_DENIED');builtins.set(name,value);}
  function resolve(request,parent){if(builtins.has(request))return request;if(typeof request!=='string'||!request.startsWith('.'))return deny('import',String(request),'S2A_IMPORT_DENIED');const file=path.posix.normalize(path.posix.join(path.posix.dirname(parent),request));if(!MODULES.includes(file))return deny('import',file,'S2A_IMPORT_DENIED');return file;}
  function scan(file){
    if(sources.has(file))return;if(!MODULES.includes(file))return deny('import',file,'S2A_IMPORT_DENIED');const actual=fs.realpathSync(path.join(root,file));if(!inside(root,actual))return deny('source',file,'S2A_SOURCE_DENIED');
    const bytes=fs.readFileSync(actual),source=bytes.toString('utf8');
    if(/\bimport\s*(?:\(|['"{*])|\beval\s*\(|\bnew\s+Function\s*\(/.test(source))return deny('code',file,'S2A_DYNAMIC_DENIED');
    const matches=[...source.matchAll(/\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g)];if((source.match(/\brequire\s*\(/g)||[]).length!==matches.length)return deny('import',file,'S2A_COMPUTED_DENIED');
    sources.set(file,{source,sha256:sha(bytes)});for(const m of matches){const to=resolve(m[2],file);graph.push({from:file,request:m[2],to});if(!builtins.has(to))scan(to);}
  }
  const context=vm.createContext({Buffer,process:Object.freeze({platform:process.platform})},{codeGeneration:{strings:false,wasm:false}});
  function execute(file){if(builtins.has(file))return builtins.get(file);if(cache.has(file))return cache.get(file).exports;const module={exports:{}};cache.set(file,module);new vm.Script('(function(exports,require,module,__filename,__dirname){\n'+sources.get(file).source+'\n})',{filename:file}).runInContext(context,{timeout:1000})(module.exports,request=>execute(resolve(request,file)),module,path.join(root,file),path.dirname(path.join(root,file)));return module.exports;}
  function expectDenied(action,code){const before=attempts.length;expected=true;try{action();throw Error('Expected sentinel refusal');}catch(error){if(error.code!==code||attempts.length!==before+1)throw error;return attempts[before];}finally{expected=false;}}
  return {fs:facade,load(file){scan(file);return execute(file);},
    probeImport:request=>expectDenied(()=>resolve(request,'tests/s2a/probe.cjs'),'S2A_IMPORT_DENIED'),
    probePath:(file,operation='readFile')=>expectDenied(()=>checked(file,operation),'S2A_PATH_DENIED'),
    check(){if(attempts.some(a=>!a.expected))throw coded('S2A_UNEXPECTED_DENIAL');},
    async cleanup(){const failures=[];for(const handle of [...handles]){try{await handle.close();handles.delete(handle);}catch(error){failures.push(String(error.code||error.message));}}counters.openHandles=handles.size;if(failures.length)throw coded('S2A_HANDLE_CLEANUP_FAILED:'+failures.join(','));},
    evidence(){return {sourceHashes:Object.fromEntries([...sources].map(([name,value])=>[name,value.sha256])),graph,attempts,operations,counters:{...counters},limits:{...limits},kind:'closed reviewed VM with actual confined filesystem; not OS sandbox'};}
  };
}
function prepareFixture(repoRoot,prefix){
  const root=fs.realpathSync(repoRoot);for(const name of ['qa','qa/s2a','qa/s2a/fixtures']){const file=path.join(root,name);try{if(fs.lstatSync(file).isSymbolicLink()||!inside(root,fs.realpathSync(file)))throw coded('S2A_FIXTURE_DENIED');}catch(error){if(error.code!=='ENOENT')throw error;}}
  const base=path.join(root,'qa','s2a','fixtures');fs.mkdirSync(base,{recursive:true});return fs.mkdtempSync(path.join(base,prefix));
}
module.exports={createFSGuard,prepareFixture,inside,sha};
