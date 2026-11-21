const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {captureDelivery}=require('../electron/capture-delivery.cjs');
const source=fs.readFileSync(path.join(__dirname,'../electron/main.cjs'),'utf8');
function rig({sessionId='A',nativeError=null,registered=true}={}){
  const logs=[],events=[],calls=[];let resolveRegistration;
  const store={sessionId,sessions:sessionId?[{id:sessionId}]:[],settings:{captureFolder:'synthetic',autofocus:false}},registration=new Promise(resolve=>resolveRegistration=resolve);
  const consumer={drain:()=>registration,receipt:id=>registered&&id==='file-1'?{transferId:id,path:'synthetic/frame.jpg',status:'COMMITTED'}:null};
  const context=vm.createContext({quitting:false,store,camera:{model:'Demo',equipment:{lensName:'Test'}},captureActive:false,captureMetadata:null,
    transferRoute:()=>({sessionId,destination:'synthetic'}),crypto:{randomUUID:()=> 'capture'},workerState:{consumer},captureDelivery,
    call:async(method,args)=>{calls.push({method,args});if(nativeError)throw nativeError;return {confirmation:'UNVERIFIED',nativeQuiescence:'UNKNOWN',observedTransfers:registered?1:0,observedTransferIds:registered?['file-1']:[]};},
    emit:(type,data)=>events.push({type,data}),log:(level,message)=>logs.push({level,message}),persist:async()=>{},t:key=>key,Error,Date},{codeGeneration:{strings:false,wasm:false}});
  const begin=source.indexOf('async function captureOnce('),end=source.indexOf('async function activateSession(',begin);assert.ok(begin>=0&&end>begin);
  new vm.Script(source.slice(begin,end)+'\nthis.captureOnce=captureOnce;').runInContext(context);
  return {run:()=>context.captureOnce(),logs,events,calls,context,resolveRegistration};
}
test('actual main waits for Library registration before returning a successful capture without a warning',async()=>{
  const r=rig();let settled=false;const pending=r.run().then(value=>{settled=true;return value;});await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);r.resolveRegistration();
  const result=await pending;assert.equal(result.confirmation,'CONFIRMED');assert.equal(result.nativeConfirmation,'UNVERIFIED');assert.deepEqual(r.logs,[]);assert.equal(r.context.captureActive,false);
});
test('actual main confirms a received photo without an active Session',async()=>{const r=rig({sessionId:null});r.resolveRegistration();assert.equal((await r.run()).confirmation,'CONFIRMED');assert.deepEqual(r.logs,[]);});
test('actual main preserves an unverified result when no original arrived',async()=>{const r=rig({registered:false});r.resolveRegistration();assert.equal((await r.run()).confirmation,'UNVERIFIED');assert.equal(r.logs[0].message,'operation.capture_unverified');});
test('actual main propagates shutter and disconnect errors and always clears operation state',async()=>{for(const code of ['SHUTTER_FAILED','DISCONNECTED']){const r=rig({nativeError:Object.assign(Error(code),{code})});await assert.rejects(r.run(),error=>error.code===code);assert.equal(r.context.captureActive,false);assert.equal(r.events.at(-1).data.active,false);}});
