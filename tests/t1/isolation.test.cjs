const assert=require('node:assert/strict');
const {invocation,syntheticPath}=require('./policy.cjs');
const {memoryStore}=require('./fixtures.cjs');
test('isolation: fixed synthetic original hash is stable',()=>{
  assert.equal(memoryStore().original(),'da381ef36d441db6211d2cfe7b27c94e031831bcdf4c579e27d1f3003a0faec6');
});
test('isolation: missing/invalid tier and scope are rejected',()=>{
  for(const a of [[],['--tier','T2','--scope','synthetic','tests/t1/isolation.test.cjs'],['--tier','T1','--scope','production','tests/t1/isolation.test.cjs']])assert.throws(()=>invocation(a),{code:'T1_SCOPE_DENIED'});
});
test('isolation: unknown, wildcard, traversal and duplicate entrypoints are rejected',()=>{
  for(const f of [[],['tests/hardware.cjs'],['tests/t1/*.cjs'],['../main.cjs'],['tests/t1/isolation.test.cjs','tests/t1/isolation.test.cjs']])assert.throws(()=>invocation(['--tier','T1','--scope','synthetic',...f]),{code:'T1_ENTRYPOINT_DENIED'});
});
test('isolation: forbidden imports hit own sentinel before module resolution',()=>{
  assert.throws(()=>require('electron'),{code:'T1_IMPORT_DENIED'});
  assert.throws(()=>require('koffi'),{code:'T1_IMPORT_DENIED'});
  assert.throws(()=>require('sharp'),{code:'T1_IMPORT_DENIED'});
  assert.throws(()=>require('node:fs'),{code:'T1_IMPORT_DENIED'});
  assert.throws(()=>require('fs/promises'),{code:'T1_IMPORT_DENIED'});
  assert.throws(()=>require('node:child_process'),{code:'T1_IMPORT_DENIED'});
  assert.throws(()=>require('node:worker_threads'),{code:'T1_IMPORT_DENIED'});
  assert.throws(()=>require('node:http'),{code:'T1_IMPORT_DENIED'});
  assert.throws(()=>require('node:net'),{code:'T1_IMPORT_DENIED'});
  assert.throws(()=>require('node:vm'),{code:'T1_IMPORT_DENIED'});
  assert.throws(()=>require('node:module'),{code:'T1_IMPORT_DENIED'});
  assert.throws(()=>require('../../electron/camera-worker.cjs'),{code:'T1_IMPORT_DENIED'});
  assert.throws(()=>require('../../electron/sdk-environment.cjs'),{code:'T1_IMPORT_DENIED'});
  assert.throws(()=>require('unknown-test-package'),{code:'T1_IMPORT_DENIED'});
});
test('isolation: no process/fetch/Buffer/timers; virtual FS denies production paths',()=>{
  assert.equal(typeof process,'undefined');assert.equal(typeof fetch,'undefined');assert.equal(typeof Buffer,'undefined');assert.equal(typeof setTimeout,'undefined');
  for(const p of ['C:/production-profile/library.json','/synthetic/s1/../real/library.json','/tmp/library.json'])assert.throws(()=>syntheticPath(p),{code:'T1_PATH_DENIED'});
  assert.equal(syntheticPath('/synthetic/s1/library.json'),'/synthetic/s1/library.json');
});
