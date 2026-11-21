const {test}=require('node:test'),assert=require('node:assert/strict');
const {createCameraCardActions}=require('../electron/camera-card-actions.cjs');
function rig(){
  const calls=[],events=[],imports=[],channel={rpc:{cancelMethod:method=>{calls.push(['cancel',method]);return 1;}},exited:false};let folder='synthetic-export',cancelled=false,fail=false,release,chooseGate;
  const actions=createCameraCardActions({exclusive:fn=>fn(),newId:()=> 'export-operation',getChannel:()=>channel,translate:key=>key,
    emit:(type,data)=>events.push({type,data}),choose:()=>chooseGate||Promise.resolve(folder),importFiles:async(files,context)=>{imports.push({files,context});return {added:files.length};},
    call:async(method,args)=>{calls.push([method,args]);if(method==='cardThumbnail')return {id:args.id,mime:'image/jpeg',bytes:Buffer.from([0xff,0xd8,0xff,0xd9])};if(method==='cardList')return {status:'ready',items:[]};if(fail)throw Error('Read failure');if(release)await release;return {status:cancelled?'partial':'completed',cancelled,files:[{id:'one',path:'synthetic-export/one.jpg'}],failures:[],remainingIds:cancelled?['two']:[]};}});
  return {actions,calls,events,imports,channel,folder:value=>folder=value,cancelled:()=>cancelled=true,fail:()=>fail=true,chooseGate:()=>{chooseGate=new Promise(resolve=>release=resolve);return release;}};
}
test('card export writes files without adding them to Library',async()=>{const r=rig(),result=await r.actions.cardExport({ids:['one'],mode:'export'});assert.equal(result.status,'completed');assert.equal(r.imports.length,0);assert.equal(r.calls[0][0],'cardExport');});
test('explicit card import registers received files without inheriting the active Session',async()=>{const r=rig(),result=await r.actions.cardExport({ids:['one'],mode:'import'});assert.equal(result.imported.added,1);assert.equal(r.imports[0].context.sessionId,null);});
test('cancelled destination choice never calls the camera',async()=>{const r=rig();r.folder(null);const result=await r.actions.cardExport({ids:['one']});assert.equal(result.cancelled,true);assert.deepEqual(r.calls,[]);assert.equal(r.actions.isActive(),false);});
test('cancellation targets only the active export and rejects a stale operation identifier',async()=>{const r=rig(),run=r.actions.cardExport({ids:['one','two']});const ignored=r.actions.cardExportCancel({operationId:'old'});assert.equal(ignored.cancelled,false);const stop=r.actions.cardExportCancel({operationId:'export-operation'});assert.equal(stop.cancelled,true);assert.deepEqual(r.calls.at(-1),['cancel','cardExport']);await run;});
test('partial exports retain successful files and pass only those to explicit Library import',async()=>{const r=rig();r.cancelled();const result=await r.actions.cardExport({ids:['one','two'],mode:'import'});assert.equal(result.status,'partial');assert.deepEqual(result.remainingIds,['two']);assert.deepEqual(r.imports[0].files,['synthetic-export/one.jpg']);});
test('card errors leave the workflow available for a retry and keep the error visible',async()=>{const r=rig();r.fail();await assert.rejects(r.actions.cardExport({ids:['one']}),/Read failure/);assert.equal(r.actions.isActive(),false);assert.equal(r.events.at(-1).data.status,'error');});
test('thumbnails cross the bridge as bounded data URLs without an original download',async()=>{const r=rig(),thumb=await r.actions.cardThumbnail({id:'one'});assert.match(thumb.image,/^data:image\/jpeg;base64,/);assert.equal(thumb.bytes,undefined);assert.equal(r.calls.length,1);assert.equal(r.calls[0][0],'cardThumbnail');});
test('selection validation rejects malformed or empty input before camera calls',async()=>{for(const ids of [[],null,[''],[4]]){const r=rig();await assert.rejects(r.actions.cardExport({ids}));assert.deepEqual(r.calls,[]);}});

test('the actual operation client cancels only the requested method and retains ownership until acknowledgement',async()=>{
  const {createOperationClient}=require('../electron/operation-lifecycle.cjs'),messages=[];
  const client=createOperationClient({generation:'card-worker',send:message=>messages.push(message),isExclusive:()=>false});
  const card=client.call('cardExport'),other=client.call('status');card.catch(()=>{});other.catch(()=>{});
  assert.equal(client.cancelMethod('cardExport'),1);assert.equal(messages.filter(message=>message.kind==='cancel').length,1);assert.equal(messages.at(-1).method,'cardExport');
  assert.equal(client.hasOutstanding({exclusiveOnly:false}),true);assert.equal(client.snapshot().operations.find(operation=>operation.method==='status').cancelRequested,false);client.terminate();await Promise.allSettled([card,other]);
});
