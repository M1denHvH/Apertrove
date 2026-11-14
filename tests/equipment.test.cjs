const {test}=require('node:test');const assert=require('node:assert/strict');
const {identify,parseProduct,safeUrl,equipmentCards}=require('../electron/equipment.cjs');
test('SDK model cards cover unknown devices honestly and identify the connected third-party lens',()=>{
  const sigma=identify('lens','17-70mm F2.8-4 DC MACRO OS HSM | Contemporary 013');assert.equal(sigma.manufacturer,'Sigma');assert.ok(sigma.source.includes('sigma-global.com'));
  const unknown=equipmentCards({model:'Canon EOS Future',equipment:{lensName:'Unknown optics'}},{photos:[]});assert.deepEqual(unknown.lens.facts.filter(([name])=>name==='Фильтр'),[]);assert.equal(unknown.lens.source,null);
});
test('Official product parsing accepts matching product media and rejects unrelated models/unsafe URLs',()=>{
  const source='https://www.canon-europe.com/cameras/eos-r6-mark-ii/specifications/';
  const html='<title>Canon EOS R6 Mark II Specifications</title><img data-src="https://cdn.media.amplience.net/i/canon/eos-r6-mark-ii-front" class="prod-spec-hero"><li><div class="product-specification-detail__list-key">Effective Pixels</div><div class="product-specification-detail__list-value canon">24 megapixels</div></li>';
  const result=parseProduct(html,source,'camera','Canon EOS R6 Mark II');assert.equal(result.facts[0][0],'Разрешение');assert.ok(result.image.startsWith('https://'));
  assert.throws(()=>parseProduct(html,source,'camera','Canon EOS R5'));
  assert.equal(safeUrl('http://localhost/private',source,true),null);assert.equal(safeUrl('javascript:alert(1)',source,true),null);assert.equal(safeUrl(null,source,true),null);
  assert.throws(()=>parseProduct(html.replace('mark-ii-front','mark-ii-left-side'),source,'camera','Canon EOS R6 Mark II'),/Фотография/);
});
