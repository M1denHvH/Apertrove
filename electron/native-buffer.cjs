const koffi=require('koffi');
const memcpy=koffi.load('msvcrt.dll').func('void *memcpy(void *dest, const void *src, size_t count)');
function copyNativeBuffer(pointer,length){
  if(!Number.isSafeInteger(length)||length<0||length>512*1024*1024||(!pointer&&length))throw Error('Некорректный буфер Canon SDK.');
  // Electron forbids ArrayBuffers backed by external native memory. Allocate in
  // V8 first and copy through FFI instead of creating an unmanaged memory view.
  const buffer=Buffer.allocUnsafe(length);
  if(length)memcpy(buffer,pointer,length);
  return buffer;
}
module.exports={copyNativeBuffer};
