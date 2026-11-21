'use strict';
// No native modules: actual sequencing with a strictly injected fake SDK.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {enumerate,NAMES}=require('./h1a-lifecycle.cjs');
function fixture(overrides={}){
  const seen=[],pointer=Object.freeze({syntheticOpaqueRef:true});
  const fake={initialize(){return 0;},list(out){out[0]=pointer;return 0;},count(ref,out){assert.equal(ref,pointer);out[0]=1;return 0;},release(ref){assert.equal(ref,pointer);return 0;},terminate(){return 0;},...overrides};
  const sdk=Object.fromEntries(Object.entries(fake).map(([name,fn])=>[name,(...args)=>{seen.push(name);return fn(...args);}]))
  return {sdk,seen,pointer};
}
const run=f=>enumerate(f.sdk,{isOpaqueRef:value=>value===f.pointer});
test('opaque pointer validation is explicit and never guesses from a JavaScript shape',()=>{
  const f=fixture();assert.throws(()=>enumerate(f.sdk),/OPAQUE_POINTER_VALIDATOR_REQUIRED/);assert.deepEqual(f.seen,[]);
  const bad=fixture({list(out){out[0]=0x1234n;return 0;}});assert.equal(run(bad).outcome,'UNKNOWN');
});
test('one count-only cycle uses exact five calls, owns one list and cleanly terminates',()=>{
  const f=fixture(),r=run(f);
  assert.deepEqual(f.seen,['initialize','list','count','release','terminate']);
  assert.deepEqual(r.calls.map(x=>x.method),Object.values(NAMES));
  assert.equal(r.cameraCount,1);assert.equal(r.listReleased,true);assert.equal(r.cleanupEligible,true);assert.equal(r.outcome,'H1A_COUNT_RECORDED');
});
test('zero cameras is recorded honestly without retries or child enumeration',()=>{
  const f=fixture({count(ref,out){out[0]=0;return 0;}}),r=run(f);
  assert.equal(r.cameraCount,0);assert.equal(r.outcome,'H1A_COUNT_RECORDED');assert.equal(f.seen.length,5);
});
test('nonzero init never touches list/release/terminate or permits unload',()=>{
  const f=fixture({initialize:()=>0x80}),r=run(f);
  assert.deepEqual(f.seen,['initialize']);assert.equal(r.initialize,0x80);assert.equal(r.outcome,'FAILED');assert.equal(r.cleanupEligible,false);
});
test('list failure never treats the unspecified output as an owned reference',()=>{
  const f=fixture({list(out){out[0]=0xdeadn;return 0x81;}}),r=run(f);
  assert.deepEqual(f.seen,['initialize','list','terminate']);assert.equal(r.listAcquired,false);assert.equal(r.release,null);assert.equal(r.list,0x81);assert.equal(r.outcome,'FAILED');assert.equal(r.cleanupEligible,true);
});
test('known count error stops enumeration but releases exactly the known list before termination',()=>{
  const f=fixture({count:()=>0x82}),r=run(f);
  assert.deepEqual(f.seen,['initialize','list','count','release','terminate']);assert.equal(r.count,0x82);assert.equal(r.cameraCount,null);assert.equal(r.outcome,'FAILED');assert.equal(r.cleanupEligible,true);
});
for(const pointer of [null,undefined,0n,0,42,'opaque',{}])test('success with invalid pointer '+String(pointer)+' stops without release/terminate',()=>{
  const f=fixture({list(out){out[0]=pointer;return 0;}}),r=run(f);
  assert.equal(r.outcome,'UNKNOWN');assert.deepEqual(f.seen,['initialize','list']);assert.equal(r.cleanupEligible,false);
});
for(const raw of [0xffffffff,1,5])test('nonzero release '+raw+' is UNKNOWN, never repeated and never followed by terminate',()=>{
  const f=fixture({release:()=>raw}),r=run(f);
  assert.equal(r.release,raw);assert.equal(r.outcome,'UNKNOWN');assert.equal(r.listReleased,false);assert.equal(r.cleanupEligible,false);assert.deepEqual(f.seen,['initialize','list','count','release']);
});
for(const method of ['initialize','list','count','release','terminate'])test('throwing '+method+' preserves UNKNOWN and never makes another SDK call',()=>{
  const f=fixture({[method](){throw Error('synthetic binding exception');}}),r=run(f);
  assert.equal(r.outcome,'UNKNOWN');assert.equal(r.cleanupEligible,false);assert.equal(f.seen.at(-1),method);assert.equal(r.calls.at(-1).threw,true);
});
for(const raw of [-1,undefined,NaN,0n,0x100000000])test('invalid native uint32 '+String(raw)+' closes admission',()=>{
  const f=fixture({initialize:()=>raw}),r=run(f);
  assert.equal(r.outcome,'UNKNOWN');assert.deepEqual(f.seen,['initialize']);assert.equal(r.cleanupEligible,false);
});
test('invalid outCount is UNKNOWN and does not release an untrusted native state',()=>{
  const f=fixture({count(ref,out){out[0]=-1;return 0;}}),r=run(f);
  assert.equal(r.outcome,'UNKNOWN');assert.deepEqual(f.seen,['initialize','list','count']);assert.equal(r.cameraCount,null);
});
test('nonzero terminate preserves raw code and forbids DLL unload',()=>{
  const f=fixture({terminate:()=>0x83}),r=run(f);
  assert.equal(r.terminate,0x83);assert.equal(r.outcome,'UNKNOWN');assert.equal(r.cleanupEligible,false);
});
test('worker declares exactly the five admitted Canon exports, with typed outputs and no callbacks/structs',()=>{
  const source=fs.readFileSync(path.join(__dirname,'worker.cjs'),'utf8');
  const symbols=[...source.matchAll(/bind\(lib,'(Eds\w+)'/g)].map(match=>match[1]);
  assert.deepEqual(symbols,Object.values(NAMES));assert.match(source,/_Out_ void \*\*outList/);assert.match(source,/_Out_ uint32 \*outCount/);assert.doesNotMatch(source,/koffi\.(?:struct|register)|EdsGetChildAtIndex|EdsOpenSession|EdsSetProperty|EdsSendCommand/);
  assert.match(source,/require\('node:util'\)/);assert.match(source,/isOpaqueRef:utilTypes\.isExternal/);assert.doesNotMatch(source,/koffi\.(?:address|decode)\(/);
});
test('controller uses H1A authorization and existing independent supervision before manifest delivery',()=>{
  const source=fs.readFileSync(path.join(__dirname,'run.cjs'),'utf8');
  assert.match(source,/--authorize-h1a --camera-connected --canon-apps-closed/);assert.doesNotMatch(source,/--authorize-native-n2|--camera-disconnected/);
  assert.match(source,/require\('\.\.\/native-n1\/supervised-process\.cjs'\)/);assert.match(source,/timeoutMs:15000/);
  assert.ok(source.indexOf("supervisor.request('assign'")<source.indexOf('child.send({nonce,manifest'));
  assert.match(source,/EOS_2000D_PASSIVE_IDENTIFICATION_REQUIRED/);
  assert.match(source,/protocolError='JOB_STATUS_QUERY_FAILED'/);assert.match(source,/!summary\.jobQueryError&&!summary\.process\.terminationRequested/);
});
