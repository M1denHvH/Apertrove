const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const {createCameraCard}=require('../electron/camera-card.cjs');
const unknown=()=>Object.assign(Error('Native result unknown'),{code:'OPERATION_UNKNOWN_TERMINATION'});
function rig(){const item={name:'IMG.JPG',size:4,folder:0},volume={label:'SD',type:2,children:[item]},camera={children:[volume]};let calls=0,refs=0;
 const io={ensure:()=>{},epoch:()=>1,qualified:()=>true,camera:()=>camera,connected:()=>true,count:ref=>ref.children?.length||0,child:(ref,index)=>{calls++;refs++;return ref.children[index];},volume:ref=>ref,info:ref=>ref,release:()=>refs--,retain:ref=>{refs++;return ref;},yield:async()=>{},thumbnail:()=>{throw unknown();},download:async()=>{throw unknown();}};
 return {io,card:createCameraCard(io),calls:()=>calls,refs:()=>refs};}
test('unknown child results stop enumeration immediately instead of becoming ordinary missing items',async()=>{const r=rig();let calls=0;r.io.count=()=>80;r.io.child=()=>{calls++;throw unknown();};await assert.rejects(r.card.list(),{code:'OPERATION_UNKNOWN_TERMINATION'});assert.equal(calls,1);assert.equal(r.refs(),0);});
test('unknown thumbnail and download results retain UNKNOWN ownership rather than hiding it',async()=>{for(const method of ['thumbnail','export']){const r=rig(),top=await r.card.list(),page=await r.card.list({parentId:top.items[0].id}),id=page.items[0].id;await assert.rejects(method==='thumbnail'?r.card.thumbnail({id}):r.card.export({ids:[id],folder:path.resolve('synthetic')}),{code:'OPERATION_UNKNOWN_TERMINATION'});assert.equal(r.refs(),0);assert.equal(r.card.isBusy(),false);}});
test('worker native card gate refuses a second call after an unknown native result',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../electron/camera-worker.cjs'),'utf8'),start=source.indexOf('function cardNative('),end=source.indexOf('function cardInfo(',start);let calls=0;
 const context=vm.createContext({teardownUncertain:false,operationError:(code,message)=>Object.assign(Error(message),{code}),observed:(_method,_phase,fn)=>fn()});new vm.Script(source.slice(start,end)+'\nthis.call=cardNative;').runInContext(context);
 assert.throws(()=>context.call('EdsGetChildCount',()=>{calls++;return undefined;}),{code:'OPERATION_UNKNOWN_TERMINATION'});assert.throws(()=>context.call('EdsGetChildCount',()=>{calls++;return 0;}),{code:'OPERATION_UNKNOWN_TERMINATION'});assert.equal(calls,1);
});

test('qualified volume capacities convert Canon KiB into exact host bytes without precision loss',()=>{
 const {parseCardVolume}=require('../electron/camera-card.cjs'),bytes=Buffer.alloc(280);bytes.writeUInt32LE(2);bytes.writeUInt32LE(2,4);bytes.writeBigUInt64LE(7815168n,8);bytes.writeBigUInt64LE(5838144n,16);bytes.write('SD',24);
 const result=parseCardVolume(bytes);assert.equal(result.capacity,8002732032);assert.equal(result.free,5978259456);bytes.writeBigUInt64LE(0xffffffffffffffffn,8);assert.equal(parseCardVolume(bytes).capacity,null);
});

test('desktop readiness stays busy through post-connect persistence and publishes the final release',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../electron/main.cjs'),'utf8'),start=source.indexOf('function setControlBusy('),end=source.indexOf('const lastReceivedPhotoId',start),events=[];
 const context=vm.createContext({controlBusy:false,backgroundControl:false,nativeOwned:()=>false,workerState:null,emit:(type,value)=>events.push({type,value}),remote:{publishState(){}}});new vm.Script(source.slice(start,end)+'\nthis.set=setControlBusy;').runInContext(context);
 context.set(true);assert.equal(events.at(-1).type,'operationState');assert.equal(events.at(-1).value.busy,true);context.set(false);assert.equal(events.at(-1).value.busy,false);
});

test('card read errors remain in remaining IDs so the same selection can be retried',async()=>{
 const r=rig(),top=await r.card.list(),page=await r.card.list({parentId:top.items[0].id}),id=page.items[0].id;
 r.io.download=async()=>{throw Error('Synthetic disk full');};const failed=await r.card.export({ids:[id],folder:path.resolve('synthetic')});assert.deepEqual(failed.remainingIds,[id]);assert.equal(failed.failures.length,1);
 r.io.download=async()=>({path:path.resolve('synthetic/IMG.JPG')});const retry=await r.card.export({ids:failed.remainingIds,folder:path.resolve('synthetic')});assert.equal(retry.files.length,1);assert.deepEqual(retry.remainingIds,[]);
});
