'use strict';
// Exact synthetic child provider. There is no native loader or fallback branch.
if(process.argv.length!==3||process.argv[2]!=='--s2c-fake-worker'||!process.send||process.env.NODE_OPTIONS||process.env.NODE_PATH||!process.execArgv.includes('--no-addons')||!process.execArgv.includes('--max-old-space-size=128'))throw Error('S2C_FAKE_ADMISSION_REFUSED');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),Module=require('node:module');
const ROOT=path.resolve(__dirname,'../..'),fixture=fs.realpathSync(process.env.APERTROVE_FAKE_FIXTURE||''),generation=process.env.APERTROVE_FAKE_GENERATION;
const inside=(base,file)=>{const r=path.relative(base,file);return r===''||!path.isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+path.sep);};
assert.ok(inside(fs.realpathSync(path.join(ROOT,'qa/s2c/fixtures')),fixture));assert.match(generation,/^s2c-fixture-[0-9]+$/);
const allowed=new Set(['operation-lifecycle','transfer-context','transfer-producer'].map(n=>path.join(ROOT,'electron',n+'.cjs').toLowerCase())),core=new Set(['assert/strict','fs','path','module']);
const nativeLoad=Module._load,nativeResolve=Module._resolveFilename,denials=[];let expected=false;
function deny(name){denials.push({name,expected});throw Object.assign(Error('S2C_FAKE_IMPORT_DENIED'),{code:'S2C_FAKE_IMPORT_DENIED'});}
Module._load=function(request,parent,isMain){const name=String(request).replace(/^node:/,'');if(Module.builtinModules.includes(name)){if(!core.has(name))return deny(name);return nativeLoad.apply(this,arguments);}if(/^(electron|koffi|sharp)(\/|$)|\.node$|\.dll$|camera-worker|native-buffer/i.test(request))return deny(request);const resolved=nativeResolve.call(Module,request,parent,isMain);if(!allowed.has(String(resolved).toLowerCase()))return deny(request);return nativeLoad.apply(this,arguments);};
Module._extensions['.node']=(_m,name)=>deny(name);process.dlopen=()=>deny('dlopen');
for(const name of ['koffi','electron','node:http']){expected=true;assert.throws(()=>require(name),e=>e.code==='S2C_FAKE_IMPORT_DENIED');expected=false;}
const {createOperationHost}=require('../../electron/operation-lifecycle.cjs'),{createTransferContexts}=require('../../electron/transfer-context.cjs'),{createTransferProducer}=require('../../electron/transfer-producer.cjs');
const send=value=>{assert.equal(denials.filter(v=>!v.expected).length,0);process.send(value);};
const contexts=createTransferContexts({recoveryDestination:path.join(fixture,'recovery'),newId:()=>generation});contexts.setRoute({sessionEpoch:1,sessionId:'synthetic-session',destination:path.join(fixture,'originals')});
const refs=new Map(),issues=[];let photoSequence=0,gate=null;
const sdk={retain(ref){refs.set(ref,(refs.get(ref)||0)+1);return refs.get(ref);},release(ref){const count=(refs.get(ref)||0)-1;assert.ok(count>=0);refs.set(ref,count);return count;}};
const producer=createTransferProducer({contexts,getEpoch:()=>1,getSdk:()=>sdk,isConnected:()=>true,onIssue:v=>issues.push(v.code),download:(ref,folder,_capture,context)=>{
 assert.match(ref,/^[a-z][a-z0-9-]{0,40}$/);assert.ok(inside(fixture,folder));fs.mkdirSync(folder,{recursive:true});const file=path.join(folder,ref+'.jpg'),bytes=Buffer.from('S2C_GENERATED_FILE:'+ref+'\n');assert.ok(bytes.length<1024);fs.writeFileSync(file,bytes,{flag:'wx'});send({event:'photo',generation,sessionEpoch:1,photoSequence:++photoSequence,data:{path:file,capture:true,context}});
}});
async function emit(name){refs.set(name,1);producer.admit(name);sdk.release(name);await producer.drain();assert.equal(refs.get(name),0);}
let host;
const handlers={
 hold:async(_a,ctx)=>{contexts.noteCapture({operationId:ctx.operationId,captureId:'synthetic-intent'});send({event:'held',generation,operationId:ctx.operationId});try{return await new Promise(resolve=>{gate=resolve;});}finally{contexts.settleCapture(ctx.operationId,{outcome:'UNVERIFIED'});}},
 burstStop:async({late=false}={})=>{if(late)await emit('late-after-timeout');gate?.({confirmation:'UNVERIFIED',observedTransfers:late?1:0});gate=null;return {released:true};},
 emit:async({name='before-crash'}={})=>{await emit(name);return {emitted:true};},
 status:({crash=false}={})=>{if(crash)process.exit(23);return {refs:[...refs.values()],issues:[...issues],rss:process.memoryUsage().rss};},
 producerFence:async()=>{host.stopAdmission();await host.whenIdle({exclusiveOnly:true});await producer.drain();producer.fence();return {drained:true,lastPhotoSequence:photoSequence,proof:'synthetic',refs:[...refs.values()],issues:[...issues]};},
 finalizeShutdown:()=>({closed:true,proof:'synthetic',lastPhotoSequence:photoSequence})
};
host=createOperationHost({generation,handlers,send,getSessionEpoch:()=>1});
process.on('message',message=>{if(message?.type==='fixture-close'){process.disconnect();return;}void host.receive(message).catch(error=>{send({event:'fixture-error',code:error.code||'FAILED'});process.exitCode=1;});});
const deadline=setTimeout(()=>{process.exitCode=1;process.disconnect();},15000);deadline.unref();
process.on('disconnect',()=>clearTimeout(deadline));
send({event:'ready',generation,provider:'SYNTHETIC_JS_ONLY',denials,source:'tests/s2c/fake-worker.cjs'});
