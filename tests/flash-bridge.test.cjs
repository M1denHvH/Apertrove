const {test}=require('node:test'),assert=require('node:assert/strict');
const {createFlashBridge,withFlashConnection,flashAvailability}=require('../electron/flash-bridge.cjs');
test('Flash bridge probes advertised support once and passes model as a separate hidden-process argument',async()=>{
 const calls=[],bridge=createFlashBridge((program,args,options,callback)=>{calls.push({program,args,options});callback(null,JSON.stringify({available:true,accepted:!args.includes('-Probe')}),'');});
 assert.equal((await bridge.probe('Canon EOS 2000D')).available,true);await bridge.probe('Canon EOS 2000D');assert.equal(calls.length,1);assert.equal((await bridge.popup('Canon EOS 2000D')).accepted,true);assert.equal(calls[1].options.windowsHide,true);assert.equal(calls[1].options.timeout,12000);assert.ok(!calls[1].args.includes('-Probe'));assert.equal(calls[1].args.at(-1),'Canon EOS 2000D');
});
test('Flash bridge reports driver errors and never turns a failed popup into success',async()=>{
 const bridge=createFlashBridge((_program,_args,_options,callback)=>callback(Error('driver busy'),'','PTP response 0x2019'));
 assert.equal((await bridge.probe('Canon EOS 2000D')).available,false);await assert.rejects(bridge.popup('Canon EOS 2000D'),/0x2019/);await assert.rejects(bridge.popup(''),/подключите/);
});
test('The Windows flash handoff restores SDK connection and Live View on both success and driver failure',async()=>{
 for(const fail of [false,true]){const calls=[],io={disconnect:async()=>calls.push('disconnect'),popup:async()=>{calls.push('popup');if(fail)throw Error('busy');return {accepted:true};},reconnect:async()=>calls.push('connect'),restoreLive:async()=>calls.push('live')};if(fail)await assert.rejects(withFlashConnection(io,true),/busy/);else assert.equal((await withFlashConnection(io,true)).accepted,true);assert.deepEqual(calls,['disconnect','popup','connect','live']);}
});
test('A temporary unsupported/busy probe is not cached and reconnect can refresh a successful probe',async()=>{
 let count=0;const bridge=createFlashBridge((_program,_args,_options,callback)=>callback(null,JSON.stringify({available:++count>1}),''));
 assert.equal((await bridge.probe('Canon EOS 2000D')).available,false);assert.equal((await bridge.cached('Canon EOS 2000D')).canAttempt,true);
 assert.equal((await bridge.probe('Canon EOS 2000D')).available,true);assert.equal(count,2);await bridge.probe('Canon EOS 2000D');assert.equal(count,2);await bridge.probe('Canon EOS 2000D',{force:true});assert.equal(count,3);
});
test('Creative modes remain actionable after a failed probe; Basic Zone restrictions update with the dial',()=>{
 for(const mode of ['M','P','Av','Tv','Bulb']){assert.equal(flashAvailability({connected:true,mode},{available:false}).canAttempt,true);assert.equal(flashAvailability({connected:true,mode},{available:true}).available,true);}
 for(const mode of ['Auto','9','15','19'])assert.equal(flashAvailability({connected:true,mode},{available:true}).canAttempt,false);
 assert.equal(flashAvailability({connected:false,mode:'M'},{available:true}).canAttempt,false);
});
