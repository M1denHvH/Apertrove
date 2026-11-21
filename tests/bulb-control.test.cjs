const {test}=require('node:test'),assert=require('node:assert/strict');
const {createBulbControl,UNQUALIFIED}=require('../electron/bulb-control.cjs');
function rig(overrides={}){const calls=[],states=[];const control=createBulbControl({qualified:true,
  lock:async()=>calls.push('lock'),start:async()=>calls.push('start'),end:async()=>calls.push('end'),unlock:async()=>calls.push('unlock'),onState:s=>states.push(s),...overrides});return {control,calls,states};}
test('production BULB rejects an unqualified adapter before any dispatch',async()=>{
  let calls=0;const b=createBulbControl({lock:()=>calls++,start:()=>calls++});await assert.rejects(b.start(),error=>error.code===UNQUALIFIED);assert.equal(calls,0);assert.equal(b.snapshot().available,false);assert.equal((await b.stop()).status,'idle');
});
test('qualified synthetic lifecycle pairs UI lock with unlock and uses only camera elapsed events',async()=>{
  const r=rig();await r.control.start();assert.equal(r.control.snapshot().status,'exposing');assert.equal(r.control.snapshot().elapsedSeconds,null);assert.equal(r.control.isBusy(),true);
  assert.equal(r.control.event(2),true);assert.equal(r.control.event(1),false);assert.equal(r.control.event(NaN),false);assert.equal(r.control.snapshot().elapsedSource,'camera-event');
  await assert.rejects(r.control.start(),/Предыдущая/);await r.control.stop();assert.equal(r.control.snapshot().status,'idle');assert.equal(r.control.isBusy(),false);assert.deepEqual(r.calls,['lock','start','end','unlock']);
  assert.equal(r.control.event(3),false);await r.control.stop();assert.equal(r.calls.length,4);
});
test('failed start and lock failure always unwind the owed lock',async()=>{
  for(const point of ['lock','start']){const calls=[],r=rig({[point]:async()=>{calls.push(point);throw Error('failed '+point);},unlock:async()=>calls.push('unlock'),end:async()=>calls.push('end')});
    await assert.rejects(r.control.start(),new RegExp('failed '+point));assert.equal(calls.at(-1),'unlock');assert.equal(r.control.isBusy(),false);assert.equal(r.control.snapshot().status,'error');
    assert.equal(calls.includes('end'),point==='start');}
});
test('failed end still unlocks but retains unknown exposure and prevents another start',async()=>{
  const r=rig({end:async()=>{throw Error('end failed');}});await r.control.start();await assert.rejects(r.control.stop(),/end failed/);assert.equal(r.calls.at(-1),'unlock');assert.equal(r.control.snapshot().confirmation,'unknown');assert.equal(r.control.isBusy(),true);await assert.rejects(r.control.start(),/Предыдущая/);
});
test('failed unlock is retried on stop without repeating accepted exposure end',async()=>{
  let count=0;const r=rig({unlock:async()=>{if(++count===1)throw Error('unlock failed');}});await r.control.start();await assert.rejects(r.control.stop(),/unlock failed/);await r.control.stop();assert.equal(count,2);assert.equal(r.calls.filter(x=>x==='end').length,1);assert.equal(r.control.snapshot().status,'idle');
});
test('disconnect retains an unknown result; shutdown best-effort ends and unlocks an active exposure',async()=>{
  const r=rig();await r.control.start();const state=r.control.disconnected();assert.equal(state.confirmation,'unknown');assert.equal(state.status,'error');assert.equal(r.control.isBusy(),true);await assert.rejects(r.control.start());
  const active=rig();await active.control.start();await active.control.shutdown();assert.deepEqual(active.calls,['lock','start','end','unlock']);
});

test('repeated disconnect notifications preserve an unknown exposure without sending more native commands',async()=>{
  const r=rig();await r.control.start();const calls=r.calls.length;
  r.control.disconnected();r.control.disconnected();await r.control.shutdown();
  assert.equal(r.control.snapshot().status,'error');assert.equal(r.control.snapshot().confirmation,'unknown');assert.equal(r.control.isBusy(),true);assert.equal(r.calls.length,calls);
});
test('disconnect invalidates delayed lock/start/end/unlock completions without inventing stopped or exposing state',async()=>{
  for(const point of ['lock','start','end','unlock']){
    let release,entered;const atPoint=new Promise(resolve=>entered=resolve),calls=[];
    const r=rig({[point]:async()=>{calls.push(point);entered();await new Promise(resolve=>release=resolve);}});
    let operation;
    if(['lock','start'].includes(point))operation=r.control.start();else{await r.control.start();operation=r.control.stop();}
    await atPoint;r.control.disconnected();release();await assert.rejects(operation,/Соединение потеряно/);
    assert.equal(r.control.snapshot().status,'error',point);assert.equal(r.control.snapshot().confirmation,'unknown',point);assert.equal(r.control.isBusy(),true);
    await assert.rejects(r.control.start(),/Соединение потеряно/);assert.equal(calls.length,1);
  }
});
test('shutdown during a delayed start waits for admission then ends and unlocks exactly once',async()=>{
  let release,entered;const atStart=new Promise(resolve=>entered=resolve),r=rig({start:async()=>{entered();await new Promise(resolve=>release=resolve);}});
  const start=r.control.start();await atStart;const close=r.control.shutdown();release();await start;await close;
  assert.equal(r.control.snapshot().status,'idle');assert.deepEqual(r.calls,['lock','end','unlock']);
});

test('shutdown joins a delayed stop without double end or unlock',async()=>{
  let entered,release;const atEnd=new Promise(resolve=>entered=resolve),calls=[];
  const r=rig({end:async()=>{calls.push('end');entered();await new Promise(resolve=>release=resolve);},unlock:async()=>calls.push('unlock')});
  await r.control.start();const stop=r.control.stop();await atEnd;const close=r.control.shutdown();release();await Promise.all([stop,close]);
  assert.deepEqual(calls,['end','unlock']);assert.equal(r.control.snapshot().status,'idle');
});
test('camera exposure time cannot be accepted while lock/start is pending',async()=>{
  let release,entered;const atLock=new Promise(resolve=>entered=resolve),r=rig({lock:async()=>{entered();await new Promise(resolve=>release=resolve);}});
  const starting=r.control.start();await atLock;assert.equal(r.control.event(42),false);assert.equal(r.control.snapshot().elapsedSeconds,null);
  release();await starting;assert.equal(r.control.event(1),true);assert.equal(r.control.snapshot().elapsedSeconds,1);await r.control.stop();
});
