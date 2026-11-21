const assert=require('node:assert/strict');
const {createBootController}=require('../../electron/boot-state.js');
const locale=require('../../electron/i18n/runtime.js');
const ru=require('../../electron/i18n/locales/ru-RU.json'),en=require('../../electron/i18n/locales/en-US.json');
const ready=()=>({bootFailure:null,locale:'en-US',settings:{grid:false},photos:[],sessions:[],presets:[],ok:false});
test('UI pure: boot rejection, explicit retry, success, cached ready and preserved ok:false',async()=>{
  const phases=[];let calls=0;const data=ready(),c=createBootController({load:()=>{if(++calls===1)return Promise.reject(Error('fixture'));return data;},onState:s=>phases.push(s.phase)});
  await c.request();assert.equal(c.snapshot().phase,'failed');await c.request();assert.deepEqual(phases,['loading','failed','retrying','ready']);assert.equal(c.snapshot().data,data);await c.request();assert.equal(calls,2);
});
test('UI pure: repeated structured failures never auto-retry or reset',async()=>{
  let calls=0;const c=createBootController({load:async()=>{calls++;return {bootFailure:{kind:'CORRUPT'},locale:'ru-RU'};},onState:()=>{}});
  await c.request();await Promise.resolve();assert.equal(calls,1);assert.equal(c.snapshot().error.kind,'CORRUPT');await c.request();assert.equal(calls,2);assert.equal(c.snapshot().phase,'failed');
});
test('UI pure: concurrent request is singleflight',async()=>{
  let release,calls=0;const c=createBootController({load:()=>{calls++;return new Promise(r=>{release=r;});},onState:()=>{}}),one=c.request(),two=c.request();assert.equal(one,two);await Promise.resolve();release(ready());await one;assert.equal(calls,1);
});
test('UI pure: dispose suppresses late resolve/reject and future requests',async()=>{
  for(const reject of [false,true]){let finish;const phases=[],c=createBootController({load:()=>new Promise((r,f)=>{finish=reject?f:r;}),onState:s=>phases.push(s.phase)}),job=c.request();await Promise.resolve();c.dispose();finish(reject?Error('fixture'):ready());await job;await c.request();assert.deepEqual(phases,['loading']);}
});
test('UI pure: sync throw and malformed payloads cannot become ready',async()=>{
  for(const load of [()=>{throw Error('fixture');},async()=>null,async()=>({...ready(),settings:[]}),async()=>({...ready(),bootFailure:undefined}),async()=>({...ready(),photos:null})]){const c=createBootController({load,onState:()=>{}});await c.request();assert.equal(c.snapshot().phase,'failed');}
});
test('UI pure: RU/EN locale fallback and recovery messages exist independently of store',async()=>{
  for(const [preference,expected] of [['ru-RU','ru-RU'],['en-US','en-US'],['xx','en-US']]){const c=createBootController({locale:preference,load:async()=>({...ready(),locale:'invalid'}),onState:()=>{}});await c.request();assert.equal(c.snapshot().locale,expected);}
  assert.equal(locale.resolve('system',['ru-RU']),'ru-RU');assert.equal(locale.resolve('system',['en-US']),'en-US');assert.equal(locale.resolve('system',['xx']),'en-US');
  for(const key of ['boot.failed','boot.retry','boot.retrying','boot.corrupt','boot.unreadable','boot.unsupported_version','boot.prepare_failed','boot.persist_failed','boot.runtime_failed','boot.safety_note']){assert.equal(typeof ru[key],'string');assert.equal(typeof en[key],'string');assert.ok(ru[key]);assert.ok(en[key]);}
});
