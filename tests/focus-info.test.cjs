const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseFocusInfo}=require('../electron/focus-info.cjs');
function info(points){const buffer=Buffer.alloc(4120);buffer.writeUInt32LE(points.length,16);points.forEach(([valid,selected,result],i)=>{const offset=20+i*32;buffer.writeUInt32LE(valid,offset);buffer.writeUInt32LE(selected,offset+4);buffer.writeUInt32LE(result,offset+8);});return buffer;}
test('EOS 2000D focus metadata only considers valid selected points',()=>{
  assert.equal(parseFocusInfo(info([[1,1,0],[1,1,1]])).status,'focused');
  assert.equal(parseFocusInfo(info([[1,0,1],[0,1,1],[1,1,0]])).status,'unknown');
  assert.equal(parseFocusInfo(info([[1,1,18]])).status,'failed');
  assert.equal(parseFocusInfo(info([[1,1,17]])).status,'focused');
  assert.equal(parseFocusInfo(info([[1,1,16]])).status,'unknown');
});
test('Malformed metadata is never read beyond its buffer',()=>{
  assert.equal(parseFocusInfo(Buffer.alloc(100)).status,'unknown');const buffer=info([]);buffer.writeUInt32LE(129,16);assert.equal(parseFocusInfo(buffer).status,'unknown');
});
test('Modern SDK focus arrays are decoded without the legacy 128-point ceiling',()=>{
  const buffer=Buffer.alloc(24+1053*32);buffer.writeInt32LE(6000,8);buffer.writeInt32LE(4000,12);buffer.writeUInt32LE(1053,16);const offset=20+1052*32;
  for(const [delta,value] of [[0,1],[4,1],[8,1],[12,3000],[16,2000],[20,120],[24,80]])buffer.writeInt32LE(value,offset+delta);
  const result=parseFocusInfo(buffer);assert.equal(result.status,'focused');assert.equal(result.boxes[0].id,1052);assert.equal(result.boxes[0].x,.5);assert.equal(result.boxes[0].width,.02);
});
