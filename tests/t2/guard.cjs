// Closed reviewed production loader and filesystem sentinel; NOT an OS sandbox.
// Trusted runners own fixture setup/report I/O. Production receives only this facade.
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const {TextDecoder}=require('node:util');

const REVIEWED_MODULES=Object.freeze([
  'electron/library-storage.cjs','electron/library-text.cjs',
  'electron/library-bootstrap.cjs','electron/library-schema.cjs',
  'electron/boot-application.cjs','electron/sessions.cjs',
  'electron/workspace-settings.cjs','electron/photo-name.cjs',
  'electron/onboarding.cjs','electron/remote/appearance.js'
]);
const inside=(root,file)=>{const relative=path.relative(root,file);return relative===''||(!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep));};
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function refusal(code,message=code){const error=Error(message);error.code=code;return error;}

function createProductionGuard({repoRoot,fixtureRoot,allowedModules=REVIEWED_MODULES}){
  const root=fs.realpathSync(repoRoot),fixtures=fs.realpathSync(path.join(root,'qa','integration','fixtures'));
  const fixture=path.resolve(fixtureRoot),fixtureReal=fs.realpathSync(fixture);
  if(!inside(fixtures,fixture)||!inside(fixtures,fixtureReal))throw refusal('T2_FIXTURE_ROOT_DENIED');
  if(!Array.isArray(allowedModules)||allowedModules.some(file=>!REVIEWED_MODULES.includes(file)))throw refusal('T2_MODULE_POLICY_DENIED');
  const allowed=new Set(allowedModules),sources=new Map(),cache=new Map(),graph=[],attempts=[],operations=[];
  const budget={maxOperations:500,maxFileBytes:1024*1024,maxReadBytes:8*1024*1024,maxWriteBytes:8*1024*1024};
  const counters={operations:0,readBytes:0,writeBytes:0};
  let expected=false;
  function deny(type,detail,code){attempts.push({type,...detail,expected,code});throw refusal(code);}
  function checkedPath(file,operation){
    if(typeof file!=='string'||!path.isAbsolute(file))deny('path',{operation,path:typeof file==='string'?file:typeof file},'T2_PATH_DENIED');
    const resolved=path.resolve(file);
    if(!inside(fixture,resolved))deny('path',{operation,path:resolved},'T2_PATH_DENIED');
    let ancestor=resolved;
    while(true){
      try{
        fs.lstatSync(ancestor);
        let real;
        try{real=fs.realpathSync(ancestor);}
        catch{deny('path',{operation,path:resolved,ancestor},'T2_PATH_DENIED');}
        if(!inside(fixtureReal,real))deny('path',{operation,path:resolved,real},'T2_PATH_DENIED');
        break;
      }catch(error){
        if(error.code==='T2_PATH_DENIED')throw error;
        if(error.code!=='ENOENT'&&error.code!=='ENOTDIR')throw error;
        const parent=path.dirname(ancestor);
        if(parent===ancestor)deny('path',{operation,path:resolved},'T2_PATH_DENIED');
        ancestor=parent;
      }
    }
    return resolved;
  }
  function charge(operation,files,bytes=0){
    counters.operations++;
    if(counters.operations>budget.maxOperations||bytes>budget.maxFileBytes)deny('budget',{operation},'T2_RESOURCE_BUDGET');
    if(operation==='readFile')counters.readBytes+=bytes;
    if(operation==='writeFile')counters.writeBytes+=bytes;
    if(counters.readBytes>budget.maxReadBytes||counters.writeBytes>budget.maxWriteBytes)deny('budget',{operation},'T2_RESOURCE_BUDGET');
    operations.push({operation,paths:files.map(file=>path.relative(fixture,file)),bytes});
  }
  const fsMethods={
    async readFile(file,options){
      const target=checkedPath(file,'readFile');
      if(options!==undefined&&options!=='utf8')deny('filesystem',{operation:'readFile options'},'T2_FS_OPERATION_DENIED');
      // Bound the physical read before issuing it; directories retain their real OS error.
      let size=0;try{const stat=fs.statSync(target);if(stat.isFile())size=stat.size;}catch(error){if(error.code!=='ENOENT'&&error.code!=='ENOTDIR')throw error;}
      charge('readFile',[target],size);return fsp.readFile(target,options);
    },
    async mkdir(file,options){
      const target=checkedPath(file,'mkdir');
      if(!options||options.recursive!==true||Object.keys(options).some(key=>key!=='recursive'))deny('filesystem',{operation:'mkdir options'},'T2_FS_OPERATION_DENIED');
      charge('mkdir',[target]);return fsp.mkdir(target,{recursive:true});
    },
    async writeFile(file,data,options){
      const target=checkedPath(file,'writeFile');
      if(options!==undefined||(typeof data!=='string'&&!ArrayBuffer.isView(data)))deny('filesystem',{operation:'writeFile arguments'},'T2_FS_OPERATION_DENIED');
      const bytes=typeof data==='string'?Buffer.byteLength(data):data.byteLength;
      charge('writeFile',[target],bytes);return fsp.writeFile(target,data);
    },
    async rename(from,to){
      const source=checkedPath(from,'rename source'),target=checkedPath(to,'rename destination');
      charge('rename',[source,target]);return fsp.rename(source,target);
    }
  };
  const fsFacade=new Proxy(Object.freeze(fsMethods),{get(target,key){if(Object.hasOwn(target,key))return target[key];deny('filesystem',{operation:String(key)},'T2_FS_OPERATION_DENIED');}});
  const builtins=new Map([
    ['node:fs/promises',fsFacade],['node:path',path],
    ['node:crypto',Object.freeze({randomUUID:crypto.randomUUID})],
    ['node:util',Object.freeze({TextDecoder})]
  ]);
  function resolve(request,parent){
    if(builtins.has(request))return request;
    if(typeof request!=='string'||!request.startsWith('.'))deny('import',{parent,request},'T2_IMPORT_DENIED');
    const target=path.posix.normalize(path.posix.join(path.posix.dirname(parent),request));
    if(!allowed.has(target))deny('import',{parent,request},'T2_IMPORT_DENIED');
    return target;
  }
  function scan(file){
    if(sources.has(file))return;
    if(!allowed.has(file))deny('import',{parent:'entrypoint',request:file},'T2_IMPORT_DENIED');
    const filename=fs.realpathSync(path.join(root,file));
    if(!inside(root,filename))deny('source',{file},'T2_SOURCE_PATH_DENIED');
    const bytes=fs.readFileSync(filename),source=bytes.toString('utf8');
    if(/\bimport\s*(?:\(|['"{*])|\beval\s*\(|\bnew\s+Function\s*\(/.test(source))deny('source',{file},'T2_DYNAMIC_CODE_DENIED');
    const imports=[...source.matchAll(/\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g)];
    if((source.match(/\brequire\s*\(/g)||[]).length!==imports.length)deny('source',{file},'T2_COMPUTED_IMPORT_DENIED');
    sources.set(file,{source,sha256:hash(bytes)});
    for(const match of imports){const target=resolve(match[2],file);graph.push({from:file,request:match[2],target});if(!builtins.has(target))scan(target);}
  }
  const context=vm.createContext({},{codeGeneration:{strings:false,wasm:false}});
  function execute(file){
    if(builtins.has(file))return builtins.get(file);
    if(cache.has(file))return cache.get(file).exports;
    const module={exports:{}};cache.set(file,module);
    const localRequire=request=>execute(resolve(request,file));
    const wrapper=new vm.Script('(function(exports,require,module,__filename,__dirname){\n'+sources.get(file).source+'\n})',{filename:file});
    wrapper.runInContext(context,{timeout:1000})(module.exports,localRequire,module,file,path.posix.dirname(file));
    return module.exports;
  }
  function expectDenial(action,code){
    const start=attempts.length;expected=true;
    try{action();throw Error('Sentinel did not refuse');}
    catch(error){if(error.code!==code||attempts.length!==start+1)throw error;return {code,attempt:attempts[start]};}
    finally{expected=false;}
  }
  return {
    load(file){scan(file);return execute(file);},
    expectDeniedImport(request){return expectDenial(()=>resolve(request,'tests/t2/negative-probe.cjs'),'T2_IMPORT_DENIED');},
    expectDeniedPath(operation,file){return expectDenial(()=>checkedPath(file,operation),'T2_PATH_DENIED');},
    assertNoUnexpected(){if(attempts.some(item=>!item.expected))throw refusal('T2_UNEXPECTED_FORBIDDEN_ATTEMPT');},
    evidence(){return {kind:'closed reviewed VM CJS graph and real-filesystem facade; not OS sandbox',fixtureRoot:fixture,sourceHashes:Object.fromEntries([...sources].map(([file,value])=>[file,value.sha256])),graph,attempts,operations,counters:{...counters},budget:{...budget},nativeModulesLoaded:{value:0,evidence:'derived from closed import policy and --no-addons, not independent OS instrumentation'},limitations:['Reviewed source only; VM is not a boundary for hostile JavaScript.','Parent realpath checks do not claim atomic protection against concurrent OS alias replacement.']};}
  };
}

module.exports={createProductionGuard,REVIEWED_MODULES};
