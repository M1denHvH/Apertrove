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

function importRig(){
  const calls=[],imports=[],files=['one','two'].map(id=>({id,name:id+'.jpg',path:'synthetic-export/'+id+'.jpg'}));let serial=0,fail=true,importHook=null,choices=0;
  const channel={rpc:{cancelMethod:()=>0}};
  const actions=createCameraCardActions({exclusive:fn=>fn(),newId:()=>String(++serial),getChannel:()=>channel,emit:()=>{},choose:async()=>{choices++;return 'synthetic-export';},
    call:async(method,args)=>{calls.push({method,args});return {status:'completed',files:files.filter(file=>args.ids.includes(file.id)),failures:[],remainingIds:[]};},
    importFiles:async(paths,context)=>{imports.push({paths,context});if(importHook)await importHook();if(fail)throw Error('Library registration failed');return {added:1};}});
  return {actions,calls,imports,channel,choices:()=>choices,recover:()=>fail=false,hook:value=>importHook=value};
}
test('failed Library registration retains saved originals and retry does not download or choose again',async()=>{
  const r=importRig(),first=await r.actions.cardExport({ids:['one','two'],mode:'import'});
  assert.equal(first.status,'partial');assert.deepEqual(first.remainingIds,['one','two']);assert.equal(first.imported.errors.length,2);assert.equal(first.files.length,2);
  r.recover();const second=await r.actions.cardExport({ids:first.remainingIds,mode:'import',retryOperationId:first.operationId});
  assert.equal(second.status,'completed');assert.equal(second.imported.added,2);assert.deepEqual(second.remainingIds,[]);assert.equal(r.calls.length,1);assert.equal(r.choices(),1);assert.ok(r.imports.every(item=>item.context.sessionId===null));
});
test('cancelling Library registration preserves completed work and retries only its saved unfinished file',async()=>{
  const r=importRig();r.recover();r.hook(async()=>{r.hook(null);r.actions.cardExportCancel();});
  const first=await r.actions.cardExport({ids:['one','two'],mode:'import'});
  assert.equal(first.cancelled,true);assert.equal(first.imported.added,1);assert.deepEqual(first.remainingIds,['two']);
  const second=await r.actions.cardExport({ids:first.remainingIds,mode:'import',retryOperationId:first.operationId});
  assert.equal(second.imported.added,1);assert.equal(second.status,'completed');assert.equal(r.calls.length,1);assert.equal(r.imports.length,2);assert.deepEqual(r.imports[1].paths,['synthetic-export/two.jpg']);
});
test('a partial import receipt cannot supply saved files to a fresh unrelated export',async()=>{
  const r=importRig(),first=await r.actions.cardExport({ids:['one'],mode:'import'});r.recover();
  await r.actions.cardExport({ids:['one'],mode:'export',retryOperationId:first.operationId});
  assert.equal(r.calls.length,2);assert.equal(r.choices(),2);
});
test('a rejected pending download preserves the earlier partial import receipt for the next retry',async()=>{
  const calls=[],channel={},one={id:'one',name:'one.jpg',path:'synthetic-export/one.jpg'},two={id:'two',name:'two.jpg',path:'synthetic-export/two.jpg'};let round=0,failImport=true;
  const actions=createCameraCardActions({exclusive:fn=>fn(),newId:()=>String(++round),getChannel:()=>channel,choose:async()=> 'synthetic-export',emit:()=>{},
    call:async(_method,args)=>{calls.push(args.ids);if(round===2)throw Error('Read temporarily unavailable');return round===1?{status:'partial',files:[one],failures:[{id:'two',error:'Read error'}],remainingIds:['two']}:{status:'completed',files:[two],failures:[],remainingIds:[]};},
    importFiles:async()=>{if(failImport)throw Error('Registration failed');return {added:1};}});
  const first=await actions.cardExport({ids:['one','two'],mode:'import'});
  await assert.rejects(actions.cardExport({ids:first.remainingIds,mode:'import',retryOperationId:first.operationId}),/Read temporarily/);failImport=false;
  const result=await actions.cardExport({ids:first.remainingIds,mode:'import',retryOperationId:first.operationId});
  assert.equal(result.imported.added,2);assert.equal(result.status,'completed');assert.deepEqual(calls,[['one','two'],['two'],['two']]);
});

test('the actual operation client cancels only the requested method and retains ownership until acknowledgement',async()=>{
  const {createOperationClient}=require('../electron/operation-lifecycle.cjs'),messages=[];
  const client=createOperationClient({generation:'card-worker',send:message=>messages.push(message),isExclusive:()=>false});
  const card=client.call('cardExport'),other=client.call('status');card.catch(()=>{});other.catch(()=>{});
  assert.equal(client.cancelMethod('cardExport'),1);assert.equal(messages.filter(message=>message.kind==='cancel').length,1);assert.equal(messages.at(-1).method,'cardExport');
  assert.equal(client.hasOutstanding({exclusiveOnly:false}),true);assert.equal(client.snapshot().operations.find(operation=>operation.method==='status').cancelRequested,false);client.terminate();await Promise.allSettled([card,other]);
});
