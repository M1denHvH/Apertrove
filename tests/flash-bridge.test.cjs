const {test}=require('node:test'),assert=require('node:assert/strict');
const {createFlashBridge,withFlashConnection,flashAvailability}=require('../electron/flash-bridge.cjs');
test('unqualified flash popup never probes Windows, sends PTP or reports mechanical success',async()=>{
 let nativeCalls=0;const bridge=createFlashBridge(()=>nativeCalls++);
 for(const result of [await bridge.probe('Canon EOS 2000D'),await bridge.cached('Canon EOS 2000D'),flashAvailability({connected:true,mode:'M'})]){
  assert.equal(result.available,false);assert.equal(result.canAttempt,false);assert.equal(result.accepted,false);assert.equal(result.raised,null);assert.equal(result.reason,'FLASH_POPUP_PROTOCOL_UNQUALIFIED');
 }
 await assert.rejects(bridge.popup('Canon EOS 2000D'),error=>error.code==='FLASH_POPUP_PROTOCOL_UNQUALIFIED');
 await assert.rejects(withFlashConnection({disconnect:()=>nativeCalls++,popup:()=>nativeCalls++,reconnect:()=>nativeCalls++},true),error=>error.code==='FLASH_POPUP_PROTOCOL_UNQUALIFIED');
 assert.equal(nativeCalls,0);
});
test('unknown/disconnected and all camera modes retain truthful unsupported status',()=>{
 for(const camera of [{connected:false},{connected:true,mode:'M'},{connected:true,mode:'Auto'},{connected:true,model:'unknown'}]){
  assert.equal(flashAvailability(camera,{available:true}).canAttempt,false);
 }
});
