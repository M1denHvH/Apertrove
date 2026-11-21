'use strict';
// Real production utility worker, instrumented only by a trusted test bootstrap.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module');
const root=path.resolve(__dirname,'../..'),file=process.env.APERTROVE_H1_CONFIG;
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
if(!file||!path.isAbsolute(file)||process.env.NODE_OPTIONS||process.env.NODE_PATH)throw Error('H1_WORKER_ADMISSION_REQUIRED');
const config=JSON.parse(fs.readFileSync(file,'utf8'));
if(config.nonce!==process.env.APERTROVE_H1_NONCE||config.kind!=='H1_REAL_ELECTRON_READ_ONLY'||hash(config.runtime.path)!==config.runtime.sha256||hash(config.addon.path)!==config.addon.sha256)throw Error('H1_WORKER_IDENTITY_MISMATCH');
for(const [name,digest] of Object.entries(config.sourceHashes))if(hash(path.join(root,name))!==digest)throw Error('H1_WORKER_SOURCE_CHANGED: '+name);
const trace=path.join(config.output,'native-trace.jsonl'),evidence=path.join(config.output,'native-worker.json');
const rawLoad=Module._load,rawAddon=rawLoad.call(Module,config.addon.path,module,false);
const {createGuard}=require('./h1-guard.cjs');
const guard=createGuard({koffi:rawAddon,runtimePath:config.runtime.path,tracePath:trace,onViolation:value=>{fs.writeFileSync(path.join(config.output,'native-denial.json'),JSON.stringify(value));}});
Module._load=function(request,parent,isMain){
  if(request==='koffi')return guard.koffi;
  if(/\.node$/i.test(String(request)))throw Error('H1_UNEXPECTED_ADDON_LOAD');
  return rawLoad.apply(this,arguments);
};
guard.record({phase:'worker-entry',generation:process.argv.find(arg=>arg.startsWith('--apertrove-generation=')),runtime:config.runtime,addon:config.addon});
const save=()=>{try{fs.writeFileSync(evidence,JSON.stringify({pid:process.pid,exitCode:process.exitCode??0,...guard.evidence()},null,2)+'\n');}catch{}};
process.on('exit',save);process.on('uncaughtExceptionMonitor',error=>{guard.record({phase:'uncaughtException',error:String(error.stack||error)});save();});
require('../../electron/camera-worker.cjs');
