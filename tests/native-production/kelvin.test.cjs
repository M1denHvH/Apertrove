'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {PROPS,WHITE_BALANCE_COLOR_TEMPERATURE,valueLabel,choices}=require('../../electron/camera-values.cjs');
const {createCameraControl}=require('../../electron/camera-control.cjs');
const {capabilityReport}=require('../../electron/camera-capabilities.cjs');

test('Kelvin property uses the Canon ID, WB enum, and dynamic labels',()=>{
  assert.equal(PROPS.colorTemperature,0x107);
  assert.equal(WHITE_BALANCE_COLOR_TEMPERATURE,9);
  assert.equal(valueLabel('whiteBalance',9),'Цветовая температура');
  assert.equal(valueLabel('colorTemperature',5200),'5200 K');
  assert.equal(valueLabel('colorTemperature',0x100000000),undefined);
  assert.deepEqual(choices('colorTemperature',[2800,5200],5200),[
    {value:2800,label:'2800 K'},{value:5200,label:'5200 K'}
  ]);
});

test('worker refresh never reads or describes color temperature outside WB 9',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../../electron/camera-worker.cjs'),'utf8');
  const start=source.indexOf('function refresh() {');
  const end=source.indexOf('\nfunction listCameras(',start);
  assert.ok(start>=0&&end>start);
  const getCalls=[],descCalls=[];
  const properties=new Map([[PROPS.whiteBalance,1],[PROPS.colorTemperature,5200]]);
  const state={properties:{},working:false,capabilities:{}};
  const context=vm.createContext({
    camera:{},state,PROPS,WHITE_BALANCE_COLOR_TEMPERATURE,choices,restricted:false,
    get(id){getCalls.push(id);return properties.get(id)??null;},
    readData:()=>null,textProperty:()=>null,
    sdk:{desc(_camera,id,output){descCalls.push(id);output.values=[2800,5200];output.count=2;return 0;}},
    status:()=>state
  },{codeGeneration:{strings:false,wasm:false}});
  new vm.Script(source.slice(start,end)+'\nthis.refresh=refresh;').runInContext(context,{timeout:1000});

  context.refresh();
  assert.ok(!getCalls.includes(PROPS.colorTemperature));
  assert.ok(!descCalls.includes(PROPS.colorTemperature));
  assert.equal(state.properties.colorTemperature.value,null);
  assert.deepEqual(Array.from(state.properties.colorTemperature.choices),[]);
  assert.equal(state.properties.colorTemperature.writable,false);

  properties.set(PROPS.whiteBalance,WHITE_BALANCE_COLOR_TEMPERATURE);
  context.refresh();
  assert.equal(descCalls.filter(id=>id===PROPS.colorTemperature).length,1);
  assert.deepEqual([...state.properties.colorTemperature.allowed],[2800,5200]);
  assert.deepEqual(state.properties.colorTemperature.choices.map(choice=>choice.label),['2800 K','5200 K']);
});

function kelvinRig({mode=9,descriptor=[2800,5200,10000],switchModeOnWrite=false}={}){
  const writes=[],values=new Map([[PROPS.whiteBalance,mode],[PROPS.colorTemperature,5200]]);
  const properties={whiteBalance:{value:mode,writable:true,allowed:[mode]},
    colorTemperature:{value:5200,writable:descriptor.length>0,allowed:descriptor}};
  const control=createCameraControl({
    ensure:()=>{},isCapturing:()=>false,isLive:()=>true,refresh:()=>({properties}),
    get:id=>values.get(id),set:(id,value)=>{writes.push([id,value]);values.set(id,value);if(id===PROPS.colorTemperature&&switchModeOnWrite)values.set(PROPS.whiteBalance,1);},
    wait:async()=>{}
  });
  return {control,writes};
}

test('Kelvin writes require WB 9 and an offered descriptor value, then verify readback',async()=>{
  const r=kelvinRig();
  await r.control.property({key:'colorTemperature',value:5200});
  assert.deepEqual(r.writes,[[PROPS.colorTemperature,5200]]);
  const wrongMode=kelvinRig({mode:1});
  await assert.rejects(wrongMode.control.property({key:'colorTemperature',value:5200}),/недоступен/);
  assert.deepEqual(wrongMode.writes,[]);
  await assert.rejects(r.control.property({key:'colorTemperature',value:5300}),/недоступен/);
  assert.deepEqual(r.writes,[[PROPS.colorTemperature,5200]]);
});

test('changing white-balance mode during a Kelvin write is not reported as confirmed',async()=>{
  const r=kelvinRig({switchModeOnWrite:true});
  await assert.rejects(r.control.property({key:'colorTemperature',value:5200}),/не подтвердила/);
  assert.deepEqual(r.writes,[[PROPS.colorTemperature,5200]]);
});

test('setup capability report accounts for color temperature once and skips it outside WB 9',()=>{
  const read=(state)=>{const calls=[];const rows=capabilityReport({
    state,read:id=>{calls.push(id);return {code:1};},
    storage:{volumes:[],code:0},exports:{},restricted:false
  });return {calls,rows};};
  const unavailable=read({properties:{whiteBalance:{value:1},colorTemperature:{value:null}}});
  assert.ok(!unavailable.calls.includes(PROPS.colorTemperature));
  assert.equal(unavailable.rows.filter(row=>row.id==='colorTemperature').length,1);
  assert.equal(unavailable.rows.find(row=>row.id==='colorTemperature').status,'temporary');
  const available=read({properties:{whiteBalance:{value:9},colorTemperature:{value:5200,allowed:[5200],choices:[{value:5200,label:'5200 K'}],writable:true,descriptorCode:0}}});
  assert.equal(available.calls.filter(id=>id===PROPS.colorTemperature).length,1);
  assert.equal(available.rows.filter(row=>row.id==='colorTemperature').length,1);
});
