'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {histogramFromImageData,histogramPath,createLatestFrameProcessor}=require('../../electron/live-histogram.cjs');

test('RGB histogram counts known synthetic pixels and ignores transparent samples',()=>{
  const pixels=new Uint8ClampedArray([
    255,0,0,255, 0,255,0,255,
    0,0,255,255, 255,255,255,255,
    20,40,60,0
  ]);
  const result=histogramFromImageData({width:5,height:1,data:pixels},{bins:4,step:1});
  assert.equal(result.samples,4);
  assert.equal(result.redCounts[0],2);
  assert.equal(result.redCounts[3],2);
  assert.equal(result.greenCounts[0],2);
  assert.equal(result.greenCounts[3],2);
  assert.equal(result.blueCounts[0],2);
  assert.equal(result.blueCounts[3],2);
  assert.equal(histogramPath(result.red).startsWith('M0.00'),true);
});

test('sampling reduces work without changing the declared bin contract',()=>{
  const data=new Uint8ClampedArray(16*16*4).fill(255);
  const result=histogramFromImageData({width:16,height:16,data},{bins:8,step:4});
  assert.equal(result.bins,8);
  assert.equal(result.samples,16);
  assert.equal(result.redCounts[7],16);
  assert.equal(result.greenCounts[7],16);
  assert.equal(result.blueCounts[7],16);
});

test('latest-frame processor keeps one decode active and drops intermediate frames',async()=>{
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  let active=0,maxActive=0;
  const seen=[];
  const processor=createLatestFrameProcessor(async frame=>{
    active++;maxActive=Math.max(maxActive,active);
    if(frame==='a')await gate;
    seen.push(frame);active--;
  });
  processor.submit('a');processor.submit('b');processor.submit('c');
  assert.deepEqual(processor.snapshot(),{busy:true,hasLatest:true,stopped:false});
  release();
  for(let i=0;i<20&&seen.length<2;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(seen,['a','c']);
  assert.equal(maxActive,1);
  processor.stop();
  assert.equal(processor.submit('d'),false);
  assert.deepEqual(processor.snapshot(),{busy:false,hasLatest:false,stopped:true});
});

test('stopping before a pending frame resolves prevents another processor call',async()=>{
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  let calls=0;
  const processor=createLatestFrameProcessor(async()=>{calls++;await gate;});
  processor.submit('a');processor.submit('b');processor.stop();release();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,1);
  assert.equal(processor.snapshot().stopped,true);
});
