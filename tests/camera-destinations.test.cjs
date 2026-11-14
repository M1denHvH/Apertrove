const {test}=require('node:test');
const assert=require('node:assert/strict');
const {configureDestination,isUnsupportedCommand}=require('../electron/camera-destinations.cjs');
test('Canon models that do not support saving to both destinations fall back to host',()=>{
 const calls=[];const result=configureDestination((id,value)=>{calls.push([id,value]);if(value===3)throw Object.assign(Error('not supported'),{code:7});});assert.equal(result,2);assert.deepEqual(calls,[[0xb,3],[0xb,2]]);
 assert.equal(configureDestination(()=>{throw Object.assign(Error('unavailable'),{code:0x50});}),null);
});
test('Busy and file errors are not mistaken for unsupported commands or disabled capture',()=>{
 for(const code of [0x81,0x20]){let calls=0;assert.throws(()=>configureDestination(()=>{calls++;throw Object.assign(Error('real failure'),{code});}),/real failure/);assert.equal(calls,1);assert.equal(isUnsupportedCommand(code),false);}
 assert.equal(isUnsupportedCommand(7),true);assert.equal(isUnsupportedCommand(0x80000007),true);assert.equal(isUnsupportedCommand(0x2005),true);
});
