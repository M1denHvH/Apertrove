// Trusted harness reads reviewed JS sources. Tested ports are memory-only.
// This closed CJS loader is a regression sentinel, NOT an OS/untrusted-code sandbox.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {invocation,MODULES,denied}=require('./t1/policy.cjs');
const root=path.resolve(__dirname,'..'),cache=new Map(),sources=new Map(),cases=[],graph=[],blocked=[];
const probes=new Set(['electron','koffi','sharp','node:fs','fs/promises','node:child_process','node:worker_threads','node:http','node:net','node:vm','node:module','../../electron/camera-worker.cjs','../../electron/sdk-environment.cjs','unknown-test-package']);
const builtins=new Map([['node:assert/strict',require('node:assert/strict')],['node:path',path],['node:crypto',crypto],['node:util',Object.freeze({TextDecoder:require('node:util').TextDecoder})]]);
let entries;
function resolve(request,parent){
  if(builtins.has(request))return request;
  if(typeof request!=='string'||!request.startsWith('.'))throw denied('T1_IMPORT_DENIED');
  const target=path.posix.normalize(path.posix.join(path.posix.dirname(parent),request));
  if(!MODULES.includes(target))throw denied('T1_IMPORT_DENIED');
  return target;
}
function scan(file,seen=new Set()){
  if(seen.has(file))return;seen.add(file);
  const real=fs.realpathSync(path.join(root,file));
  if(!real.startsWith(fs.realpathSync(root)+path.sep))throw denied('T1_SOURCE_PATH_DENIED');
  const source=fs.readFileSync(real,'utf8');sources.set(file,source);
  if(file.endsWith('.json')){JSON.parse(source);return;}
  if(/\bimport\s*(?:\(|['"{*])|\beval\s*\(|\bnew\s+Function\s*\(/.test(source))throw denied('T1_DYNAMIC_CODE_DENIED');
  const matches=[...source.matchAll(/\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g)];
  if((source.match(/\brequire\s*\(/g)||[]).length!==matches.length)throw denied('T1_COMPUTED_IMPORT_DENIED');
  for(const match of matches){
    const request=match[2];let target;
    try{target=resolve(request,file);}catch(error){
      if(file==='tests/t1/isolation.test.cjs'&&probes.has(request)){graph.push({from:file,request,negativeProbe:true});continue;}throw error;
    }
    graph.push({from:file,request,target});if(!builtins.has(target))scan(target,seen);
  }
}
const context=vm.createContext({test:(name,run)=>{if(typeof run!=='function'||cases.some(c=>c.name===name))throw Error('Invalid/duplicate case');cases.push({name,run});}},{codeGeneration:{strings:false,wasm:false}});
function load(file){
  if(builtins.has(file))return builtins.get(file);
  if(!sources.has(file))throw denied('T1_IMPORT_DENIED');
  if(cache.has(file))return cache.get(file).exports;
  const module={exports:{}};cache.set(file,module);
  if(file.endsWith('.json')){module.exports=JSON.parse(sources.get(file));return module.exports;}
  const localRequire=request=>{try{return load(resolve(request,file));}catch(error){if(error.code==='T1_IMPORT_DENIED')blocked.push({from:file,request});throw error;}};
  const script=new vm.Script('(function(exports,require,module,__filename,__dirname){\n'+sources.get(file)+'\n})',{filename:file});
  script.runInContext(context,{timeout:1000})(module.exports,localRequire,module,file,path.posix.dirname(file));
  return module.exports;
}
async function main(){
  try{
    entries=invocation(process.argv.slice(2));
    if(process.env.NODE_OPTIONS||process.env.NODE_PATH||!process.execArgv.includes('--no-addons'))throw denied('T1_STARTUP_ENV_DENIED');
    // Review/validate the complete literal graph before executing any test source.
    for(const file of entries)scan(file);
    for(const file of entries)load(file);
  }catch(error){console.error(JSON.stringify({status:'REFUSED',code:error.code||'T1_REVIEW_FAILED',message:error.message}));process.exitCode=2;return;}
  const results=[];
  for(const c of cases){
    let timer;try{
      await Promise.race([Promise.resolve().then(c.run),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('T1 case deadline exceeded')),2000);})]);
      results.push({name:c.name,status:'PASS'});console.log('PASS '+c.name);
    }catch(error){results.push({name:c.name,status:'FAIL',error:String(error.stack||error)});console.error('FAIL '+c.name+'\n'+String(error.stack||error));}
    finally{clearTimeout(timer);}
  }
  const failed=results.filter(x=>x.status==='FAIL').length;
  const report={tier:'T1',scope:'synthetic',entries,results,pass:results.length-failed,fail:failed,skip:0,exitCode:failed||!results.length?1:0,guard:{kind:'closed reviewed CJS loader, not OS sandbox',sourceHashes:Object.fromEntries([...sources].map(([f,s])=>[f,crypto.createHash('sha256').update(s).digest('hex')])),graph,blockedImports:blocked,nativeModulesLoaded:{value:0,evidence:'derived from exact closed loader; not independent OS instrumentation'},testedFilesystem:'memory-only',productionProfileAccess:'no adapter supplied'}};
  // Report output is trusted harness I/O, never exposed to test fixtures.
  const output=path.join(root,'qa','s1');fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'t1-results.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({tier:report.tier,pass:report.pass,fail:report.fail,skip:0,exitCode:report.exitCode,blockedImports:blocked.length}));process.exitCode=report.exitCode;
}
main().catch(error=>{console.error(error);process.exitCode=1;});
