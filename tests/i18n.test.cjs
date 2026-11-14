const {test}=require('node:test');
const assert=require('node:assert/strict');
const i18n=require('../electron/i18n/runtime.js');
const ru=require('../electron/i18n/locales/ru-RU.json');
const en=require('../electron/i18n/locales/en-US.json');
i18n.register('ru-RU',ru);
i18n.register('en-US',en);

test('migrates existing settings to Russian and defaults a fresh profile to System',()=>{
  assert.equal(i18n.migrate(undefined,true),'ru-RU');
  assert.equal(i18n.migrate(undefined,false),'system');
  assert.equal(i18n.migrate('en-US',true),'en-US');
  assert.equal(i18n.resolve('system',['ru','en-US']),'ru-RU');
  assert.equal(i18n.resolve('system',['en-GB']),'en-US');
  assert.equal(i18n.resolve('system',['ja-JP','ru-RU']),'en-US');
  assert.equal(i18n.resolve('ru-RU',['en-US']),'ru-RU');
});
test('switches plural rules and formatting immediately without changing values',()=>{
  i18n.setLocale('ru-RU');
  assert.deepEqual([1,2,5,11,21].map(count=>i18n.t('count.photos',{count})),['1 фотография','2 фотографии','5 фотографий','11 фотографий','21 фотография']);
  assert.equal(i18n.number(0.5),'0,5');
  assert.match(i18n.date('2026-02-12T12:00:00Z',{month:'short',timeZone:'UTC'}),/фев/i);
  i18n.setLocale('en-US');
  assert.deepEqual([1,2,5].map(count=>i18n.t('count.photos',{count})),['1 photo','2 photos','5 photos']);
  assert.equal(i18n.number(0.5),'0.5');
  assert.equal(i18n.date('2026-02-12T12:00:00Z',{month:'short',timeZone:'UTC'}),'Feb');
});
test('uses the fallback dictionary and re-evaluates localized factories on change',()=>{
  const key='test.fallback';
  i18n.register('en-US',{...en,[key]:'Fallback {{name}}','test.fallback_plural.one':'{{count}} item','test.fallback_plural.other':'{{count}} items'});
  i18n.setLocale('ru-RU');
  assert.equal(i18n.t(key,{name:'Canon EOS 2000D'}),'Fallback Canon EOS 2000D');
  assert.equal(i18n.t('test.fallback_plural',{count:21}),'21 items');
  const cached=i18n.localized(()=>i18n.t('language.title'));
  assert.equal(cached(),'Язык');
  let changes=0;
  const stop=i18n.subscribe(()=>changes++);
  i18n.setLocale('en-US');
  assert.equal(cached(),'Language');
  assert.equal(changes,1);
  stop();
  i18n.register('en-US',en);
});
test('translates original starter labels without translating custom preset text',()=>{
  i18n.setLocale('en-US');
  const name=ru['legacy.main.soft_portrait'];
  assert.equal(i18n.starterPresetLabel({id:'portrait',name},'name'),'Soft portrait');
  assert.equal(i18n.starterPresetLabel({id:'portrait',name:ru['legacy.main.city_in_motion']},'name'),ru['legacy.main.city_in_motion']);
  assert.equal(i18n.starterPresetLabel({id:'custom',name},'name'),name);
  i18n.setLocale('ru-RU');
  assert.equal(i18n.starterPresetLabel({id:'portrait',name},'name'),name);
});
test('preserves Canon error codes and literal paths inside diagnostic interpolation',()=>{
  i18n.setLocale('en-US');
  assert.equal(i18n.error("Error invoking remote method 'focal:flash': Error: Подъём вспышки доступен в P, Tv, Av, M или Bulb."),'Raise the flash in P, Tv, Av, M or Bulb mode.');
  assert.equal(i18n.legacy('Спуск затвора: Камера занята. Дождитесь завершения записи или закройте EOS Utility. (0x0081).'),
    'Shutter release: The camera is busy. Wait for it to finish writing or close EOS Utility. (0x0081).');
  assert.equal(i18n.legacy('Экспорт: C:\\Фото\\Кадр.jpg'),'Exported: C:\\Фото\\Кадр.jpg');
  assert.equal(i18n.legacy('Произвольное имя объектива'),'Произвольное имя объектива');
});

