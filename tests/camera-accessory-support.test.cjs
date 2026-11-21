const {test}=require('node:test'),assert=require('node:assert/strict');
const {decodeCanonModelId,cameraAccessorySupport}=require('../electron/camera-accessory-support.cjs');
const {describeCamera}=require('../electron/camera-discovery.cjs');
test('camera capability identity uses the verified DeviceInfo uint32 field and excludes invalid data',()=>{
  const id=0x80000432,reserved=(id^0x31247e3b)>>>0;assert.equal(decodeCanonModelId(reserved),id);
  for(const value of [null,undefined,-1,0x100000000,1.5,'0x80000432'])assert.equal(decodeCanonModelId(value),null);
  const described=describeCamera({port:'synthetic-usb',description:'Demo',reserved},0);assert.equal(described.modelId,id);assert.equal(described.id.length,20);
});
test('only known camera identities expose the verified per-model accessory route',()=>{
  assert.deepEqual(cameraAccessorySupport(0x80000432),{known:true,flashPopup:true,bulbRoute:'press-shutter'});
  assert.deepEqual(cameraAccessorySupport(0x80000437),{known:true,flashPopup:false,bulbRoute:'press-shutter'});
  for(const id of [undefined,null,-1,0,0xdeadbeef,'0x80000432'])assert.deepEqual(cameraAccessorySupport(id),{known:false,flashPopup:false,bulbRoute:null});
});
