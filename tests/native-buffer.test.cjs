const {test}=require('node:test');
const assert=require('node:assert/strict');
const koffi=require('koffi');
const {copyNativeBuffer}=require('../electron/native-buffer.cjs');
test('Native SDK bytes are copied into owned memory and survive the native allocation',()=>{
 const pointer=koffi.alloc('uint8_t',1024);let copy;
 try{const bytes=Array.from({length:1024},(_,i)=>i%256);koffi.encode(pointer,koffi.array('uint8_t',1024),bytes);copy=copyNativeBuffer(pointer,1024);assert.deepEqual(Array.from(copy),bytes);koffi.encode(pointer,koffi.array('uint8_t',1024),new Array(1024).fill(0));assert.equal(copy[255],255);}finally{koffi.free(pointer);}
 assert.equal(copy[511],255);
});
test('Native buffer copy rejects unsafe sizes and null pointers',()=>{
 assert.throws(()=>copyNativeBuffer(null,5),/Некорректный/);assert.throws(()=>copyNativeBuffer(1n,-1),/Некорректный/);assert.throws(()=>copyNativeBuffer(1n,1024**3),/Некорректный/);assert.equal(copyNativeBuffer(null,0).length,0);
});
