const {test}=require('node:test');const assert=require('node:assert/strict');
const {prepareSeries,runSeries}=require('../electron/preset-series.cjs');
const camera={connected:true,properties:{iso:{value:0x48,writable:true,allowed:[0x48,0x50,0x58]},shutter:{value:0x60,writable:true,allowed:[0x60,0x70]}}};
const presets=[{id:'a',name:'A',values:{iso:0x50}},{id:'b',name:'B',values:{iso:0x58,shutter:0x70}}];
const job=()=>({id:'series',status:'running',done:0,count:2,cancelled:false});
test('A preset queue validates every step before capture and keeps repeat/order semantics',()=>{
  assert.deepEqual(prepareSeries(['b','a','a'],presets,camera).steps.map(p=>p.presetId),['b','a','a']);
  assert.throws(()=>prepareSeries(['a','bad'],presets,camera));
  assert.throws(()=>prepareSeries(['a'],[{id:'a',name:'Bad',values:{iso:999}}],camera));
});
test('Exactly one capture follows each verified preset, then all original values are restored',async()=>{
  const values={iso:0x48,shutter:0x60},shots=[];const state=job();
  await runSeries(prepareSeries(['a','b'],presets,camera),{property:async({key,value})=>{values[key]=value;},capture:async metadata=>shots.push({...values,metadata}),progress:()=>{}},state);
  assert.equal(shots.length,2);assert.equal(shots[0].iso,0x50);assert.equal(shots[1].iso,0x58);assert.equal(shots[1].shutter,0x70);assert.equal(shots[1].metadata.index,1);assert.deepEqual(values,{iso:0x48,shutter:0x60});assert.equal(state.status,'completed');
});
test('Cancellation during a frame saves that frame, prevents subsequent shots and restores exposure',async()=>{
  const state=job(),writes=[];let shots=0;
  await runSeries(prepareSeries(['a','b'],presets,camera),{property:async p=>writes.push(p),capture:async()=>{shots++;state.cancelled=true;},progress:()=>{}},state);
  assert.equal(shots,1);assert.equal(state.done,1);assert.equal(state.status,'cancelled');assert.deepEqual(writes.at(-2),{key:'iso',value:0x48});assert.deepEqual(writes.at(-1),{key:'shutter',value:0x60});
});
test('Failed property writes never release the shutter, and restoration failures are visible',async()=>{
  const state=job();let shots=0;
  await runSeries(prepareSeries(['a'],presets,camera),{property:async()=>{throw Error('write refused');},capture:async()=>{shots++;},progress:()=>{}},state);
  assert.equal(shots,0);assert.equal(state.status,'failed');assert.equal(state.restoreErrors.length,1);
});
test('A native timer/burst mode is changed to single-shot for the queue and restored afterwards',async()=>{
  const state=job(),writes=[];const plan=prepareSeries(['a'],presets,{...camera,properties:{...camera.properties,driveMode:{value:1,allowed:[0,1,16],writable:true}}});
  await runSeries(plan,{property:async p=>writes.push(p),capture:async()=>{},progress:()=>{}},state);assert.deepEqual(writes[0],{key:'driveMode',value:0});assert.ok(writes.some(p=>p.key==='driveMode'&&p.value===1));assert.equal(state.status,'completed');
});
