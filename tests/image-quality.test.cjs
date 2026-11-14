const {test}=require('node:test');
const assert=require('node:assert/strict');
const {imageQualityLabel}=require('../electron/image-quality.cjs');
const {PROPS,choices}=require('../electron/camera-values.cjs');
const {createCameraControl}=require('../electron/camera-control.cjs');
const {clearBackground}=require('../electron/product-media.cjs');
test('EDSDK file formats distinguish RAW, compressed RAW, JPEG size/quality and RAW+JPEG',()=>{
  assert.equal(PROPS.imageQuality,0x100);
  assert.equal(imageQualityLabel(0x0013ff0f),'JPEG L · Fine');
  assert.equal(imageQualityLabel(0x0064ff0f),'RAW');
  assert.equal(imageQualityLabel(0x0063ff0f),'RAW · C-RAW');
  assert.equal(imageQualityLabel(0x00640112),'RAW + JPEG M · Normal');
  assert.equal(imageQualityLabel(0x0164ff0f),'M-RAW');
  assert.equal(imageQualityLabel(0x0083ff0f),'HEIF L · Fine');
  assert.equal(imageQualityLabel(0xffffffff),undefined);
  assert.equal(choices('imageQuality',[0x0064ff0f,0x0013ff0f],0x0064ff0f).length,2);
});
test('Image format changes use the reported descriptor, verify readback and reject unsupported writes',async()=>{
  let current=0x0013ff0f;const writes=[];
  const control=createCameraControl({ensure(){},isCapturing:()=>false,refresh:()=>({properties:{imageQuality:{writable:true,allowed:[0x0013ff0f,0x0064ff0f]}}}),get:id=>{assert.equal(id,0x100);return current;},set:(id,value)=>{writes.push([id,value]);current=value;}});
  await control.property({key:'imageQuality',value:0x0064ff0f});
  assert.deepEqual(writes,[[0x100,0x0064ff0f]]);
  await assert.rejects(control.property({key:'imageQuality',value:0x0063ff0f}),/недоступен/);
  assert.equal(writes.length,1);
});
test('Product image transparency clears only connected neutral background and preserves enclosed white detail',()=>{
  const pixels=Buffer.alloc(7*7*4,255);
  for(let y=1;y<6;y++)for(let x=1;x<6;x++){const offset=(y*7+x)*4;pixels[offset]=pixels[offset+1]=pixels[offset+2]=30;}
  pixels.set([255,255,255,255],(3*7+3)*4);
  const out=clearBackground(pixels,7,7);
  assert.equal(out[3],0);assert.equal(out[(3*7+3)*4+3],255);assert.equal(out[(1*7+1)*4+3],255);
});
