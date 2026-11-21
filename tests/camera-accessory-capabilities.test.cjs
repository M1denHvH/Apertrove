const {test}=require('node:test'),assert=require('node:assert/strict');
const {capabilityReport}=require('../electron/camera-capabilities.cjs');
function report(patch={},restricted=false){
  const state={connected:true,working:true,eventsRegistered:true,properties:{},capabilities:{bulb:true,flashPopup:true},bulb:{available:true,status:'idle',confirmation:'command-accepted'},flash:{available:true,status:'ready',accepted:false,raised:null,confirmation:'unconfirmed'},...patch};
  const calls=[];const rows=capabilityReport({state,read:id=>{calls.push(id);return {code:0x50};},storage:{volumes:[]},exports:{},restricted});
  return {bulb:rows.find(row=>row.id==='bulb'),flash:rows.find(row=>row.id==='flashPopup'),calls};
}
test('qualified working BULB and flash are available without claiming physical validation',()=>{
  const {bulb,flash,calls}=report();assert.equal(bulb.status,'ready');assert.equal(flash.status,'ready');assert.match(bulb.detail,/не проверялся/);assert.match(flash.detail,/не проверялось/);
  assert.equal(calls.includes(0x106),true,'ordinary white-balance property read remains separate from flash command');assert.equal(calls.includes(0x310),false);
});
test('an accepted flash command never certifies mechanical popup or upgrades unavailable capability',()=>{
  const accepted={available:true,status:'ready',accepted:true,raised:null,confirmation:'command-accepted'};
  const yes=report({flash:accepted});assert.equal(yes.flash.status,'ready');assert.match(yes.flash.detail,/Физическое положение вспышки не подтверждено/);
  const no=report({flash:accepted,capabilities:{bulb:false,flashPopup:false}});assert.equal(no.flash.status,'unsupported');assert.equal(no.bulb.status,'unsupported');
});
test('read-only, disconnected and missing registration keep accessories unknown without testing commands',()=>{
  for(const patch of [{working:false},{connected:false},{eventsRegistered:false},{capabilities:undefined,bulb:undefined,flash:undefined}]){
    const result=report(patch);assert.equal(result.bulb.status,'unknown');assert.equal(result.flash.status,'unknown');
    if(patch.capabilities!==undefined)assert.match(result.bulb.detail,/Команды не отправлялись/);
  }
});
test('restricted and controls-only connections cannot inherit a cached qualified accessory result',()=>{
  for(const [patch,restricted]of [[{},true],[{controlsOnly:true},false]]){const r=report(patch,restricted);assert.equal(r.bulb.status,'unsupported');assert.equal(r.flash.status,'unsupported');assert.match(r.flash.detail,/режиме подключения/);}
});
test('unknown completion and rejected commands remain visible even when a capability is qualified',()=>{
  const uncertain=report({bulb:{available:true,status:'error',confirmation:'unknown'},flash:{available:true,status:'error',confirmation:'unknown'}});assert.equal(uncertain.bulb.status,'temporary');assert.equal(uncertain.flash.status,'temporary');assert.match(uncertain.bulb.detail,/не подтверждено/);assert.match(uncertain.flash.detail,/неизвестен/);
  const failed=report({bulb:{available:true,status:'error',confirmation:'command-accepted',error:'Synthetic start failure'},flash:{available:true,status:'error',confirmation:'command-rejected',error:'Synthetic busy'}});assert.equal(failed.bulb.status,'error');assert.equal(failed.bulb.detail,'Synthetic start failure');assert.equal(failed.flash.status,'temporary');assert.equal(failed.flash.detail,'Synthetic busy');
});
