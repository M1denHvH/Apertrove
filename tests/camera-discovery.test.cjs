const {test}=require('node:test');
const assert=require('node:assert/strict');
const {describeCamera,modelCapabilities,selectCamera}=require('../electron/camera-discovery.cjs');
test('Two identical models on different ports can be selected without choosing the wrong camera',()=>{
 const a=describeCamera({description:'Canon EOS R6\0',port:'USB:1\0'},0),b=describeCamera({description:'Canon EOS R6\0',port:'USB:2\0'},1);
 assert.notEqual(a.id,b.id);assert.equal(a.model,'Canon EOS R6');assert.equal(selectCamera([a,b],b.id),b);assert.throws(()=>selectCamera([a,b]),/несколько/);assert.throws(()=>selectCamera([a],b.id),/не найдена/);assert.equal(selectCamera([a]),a);assert.equal(selectCamera([]),null);
});
test('SDK models are accepted generically while Canon import-only exceptions retain their limitations',()=>{
 for(const model of ['Canon EOS 2000D','Canon EOS R1','Canon EOS R6 Mark III','Canon EOS M6 Mark II','Canon PowerShot G7 X Mark III'])assert.equal(modelCapabilities(model,true).capture,true);
 for(const model of ['Canon EOS M','Canon EOS M2','Canon EOS M3','Canon EOS M5','Canon EOS M6','Canon EOS M10','Canon EOS M100']){const c=modelCapabilities(model,true);assert.equal(c.capture,false);assert.equal(c.liveView,false);assert.equal(c.import,true);}
 assert.equal(modelCapabilities('Canon EOS R',false).liveView,false);
});
