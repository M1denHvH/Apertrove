const {test}=require('node:test');const assert=require('node:assert/strict');const {quietPeriod}=require('../electron/capture-timing.cjs');
test('Timer + continuous capture waits across long exposure gaps rather than finishing after the first file',()=>{assert.equal(quietPeriod(0,0x10),650);assert.ok(quietPeriod(7,0x3b)>1600);assert.ok(quietPeriod(7,0x10)>60000);});
