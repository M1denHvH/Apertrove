const CAMERA_SOURCE='https://www.canon-europe.com/cameras/eos-2000d/specifications/';
const SIGMA_SOURCE='https://www.sigma-global.com/en/lenses/c013_17_70_28_4/';
const normalize=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const OFFICIAL_HOSTS=new Set(['www.canon-europe.com','www.sigma-global.com']);
const IMAGE_HOSTS=new Set([...OFFICIAL_HOSTS,'cdn.media.amplience.net','cdn.sigma-global.com','global.canon']);
function safeUrl(value,base,image=false){if(typeof value!=='string'||!value.trim())return null;try{const url=new URL(value,base);return url.protocol==='https:'&&(image?IMAGE_HOSTS:OFFICIAL_HOSTS).has(url.hostname)?url.href:null;}catch{return null;}}
function identify(kind,name){
  const key=normalize(name);
  if(kind==='camera'){
    const aliases=['canoneos2000d','canoneosrebelt7','canoneoskissx90','eos2000d','eosrebelt7','eoskissx90'];
    if(aliases.includes(key))return {manufacturer:'Canon',source:CAMERA_SOURCE,known:true,facts:[['Матрица','22.3 × 14.9 мм CMOS'],['Разрешение','24.1 Мп'],['Байонет','Canon EF / EF-S'],['Размеры','129 × 101.3 × 77.6 мм'],['Аккумулятор','LP-E10']]};
    const model=String(name||'').replace(/^Canon\s*/i,'').trim();
    const slug=model.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    return {manufacturer:'Canon',source:/^eos-[a-z0-9-]+$/.test(slug)?`https://www.canon-europe.com/cameras/${slug}/specifications/`:null,known:false,facts:[]};
  }
  if(/1770mmf284dcmacrooshsm.*contemporary013/.test(key))return {manufacturer:'Sigma',source:SIGMA_SOURCE,known:true,facts:[['Фокусное расстояние','17–70 мм'],['Светосила','f/2.8–4'],['Формат','APS-C · DC'],['Оптическая схема','16 элементов / 14 групп'],['Мин. дистанция','22 см'],['Фильтр','72 мм'],['Лепестки диафрагмы','7']]};
  const lens=String(name||'').replace(/^Canon\s*/i,'').trim();
  if(/^(EF-S|RF-S|EF|RF|TS-E|MP-E)\s*\d/i.test(lens)){
    const slug=lens.replace(/^(EF-S|RF-S|EF|RF|TS-E|MP-E)\s*(?=\d)/i,'$1-').replace(/f\s*\//i,'f-').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    return {manufacturer:'Canon',source:`https://www.canon-europe.com/lenses/${slug}-lens/`,known:false,facts:[]};
  }
  return {manufacturer:/sigma/i.test(name)?'Sigma':/tamron/i.test(name)?'Tamron':'Не определён SDK',source:null,known:false,facts:[]};
}
function equipmentCards(camera,store){
  const hardware=camera.equipment||{},model=camera.model||'',lens=hardware.lensName||'';
  const counts=store.equipmentStats||{};
  const photos=store.photos||[];
  return {
    camera:{kind:'camera',name:model,connected:!!camera.connected,...identify('camera',model),facts:[['Модель · SDK',model||'—'],['Прошивка · SDK',hardware.firmware||'Не предоставлена'],['Режим · SDK',camera.mode||'—'],...identify('camera',model).facts],stats:[['Снято в Apertrove',String(counts[`camera:${model}`]||0)],['Кадров в библиотеке',String(photos.filter(p=>normalize(p.equipment?.camera||p.metadata?.Model)===normalize(model)&&model).length)],['Заряд · SDK',camera.battery<=100&&camera.battery!==null?`${camera.battery}%`:'—'],['Доступно кадров · SDK',hardware.availableShots??'—']],note:'Счётчик ведётся с версии 0.5 и учитывает съёмку в приложении. Общий пробег затвора EDSDK не предоставляет.'},
    lens:{kind:'lens',name:lens,connected:!!camera.connected&&!!lens,...identify('lens',lens),facts:[['Модель · SDK',lens||'Не передана камерой'],['Состояние · SDK',hardware.lensAttached?'Объектив установлен':'Не предоставлено'],['Фокусное · SDK',hardware.focalLength?`${hardware.focalLength} мм`:'Не предоставлено'],...identify('lens',lens).facts],stats:[['Снято в Apertrove',String(counts[`lens:${lens}`]||0)],['Кадров в библиотеке',String(photos.filter(p=>normalize(p.equipment?.lens||p.metadata?.LensModel)===normalize(lens)&&lens).length)]],note:'Возможности фокусировки зависят от камеры, объектива и положения AF/MF на объективе.'}
  };
}
function plain(value){return String(value||'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<[^>]+>/g,' ').replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>{const code=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return code>0&&code<=0x10ffff?String.fromCodePoint(code):'';}).replace(/&(?:amp|quot|apos|lt|gt|nbsp);/g,entity=>({'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>','&nbsp;':' '})[entity]).replace(/\s+/g,' ').trim();}
function attr(tag,key){return plain(tag.match(new RegExp(`(?:^|\\s)${key}\\s*=\\s*["']([^"']*)["']`,'i'))?.[1]||'');}
function parseProduct(html,source,kind,name){
  const title=plain(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'');
  const expected=normalize(name).replace(/^canon/,'');
  // Reject redirects to generic catalogues and error pages; never label an unrelated photo as this device.
  if(!identify(kind,name).known&&!normalize(title).includes(expected))throw Error('На сайте производителя не найдена точная карточка этой модели. Данные SDK остаются доступны.');
  const images=[...html.matchAll(/<img\b[^>]*>/gi)].map(match=>match[0]);
  let image=null;
  if(source.includes('sigma-global.com'))image=images.map(tag=>attr(tag,'src')).find(url=>/product_img\d+/i.test(url));
  else {
    const parts=new URL(source).pathname.split('/').filter(Boolean);const token=kind==='camera'?normalize(parts.at(-1)==='specifications'?parts.at(-2):parts.at(-1)):expected;
    const candidates=images.filter(tag=>normalize(tag).includes(token)&&!/cashback|lifestyle|banner|logo/i.test(tag));
    const selected=candidates.find(tag=>/prod-spec-hero|product-hero|placeholder--one-by-one/i.test(tag))||candidates[0];
    if(selected)image=attr(selected,'data-src')||attr(selected,'src');
  }
  if(kind==='camera'){
    if(['canoneos2000d','eos2000d','canoneosrebelt7','eosrebelt7','canoneoskissx90','eoskissx90'].includes(normalize(name)))image='https://cdn.media.amplience.net/i/canon/eos-2000d-bk-ef-s18-55-iii-bk-frt_square_8359a828267541b39cc45a3a8694abda?w=1000&fmt=png';
    else {
      const front=images.map(tag=>attr(tag,'data-src')||attr(tag,'src')).find(url=>/[-_](?:front|frt)(?:[-_.?]|$)/i.test(url)&&normalize(url).includes(expected)&&!/rear|back|top|side|lifestyle/i.test(url));
      image=front||null;
    }
  }
  image=safeUrl(image,source,true);if(!image)throw Error('Фотография этой модели на странице производителя не найдена.');
  const rows=[];
  for(const match of html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)){
    const block=match[1];let label,value;
    if(source.includes('canon-europe.com')){label=plain(block.match(/class=["'][^"']*product-specification-detail__list-key[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]);value=plain(block.match(/class=["'][^"']*product-specification-detail__list-value\s[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]);}
    else {const pair=[...block.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)];if(pair.length>=2){label=plain(pair[0][1]);value=plain(pair[1][1]);}}
    if(label&&value&&!rows.some(row=>row[0]===label)&&value.length<220)rows.push([label,value]);
  }
  const wanted=kind==='camera'?['Type','Effective Pixels','Lens Mount','AF System / Points','ISO Sensitivity','Dimensions (WxHxD)','Batteries']:['Sensor Format','Lens Construction','Minimum Focusing Distance','Filter Size','Number of Diaphragm Blades'];
  const labels={'Type':'Матрица','Effective Pixels':'Разрешение','Lens Mount':'Байонет','AF System / Points':'Система AF','ISO Sensitivity':'ISO','Dimensions (WxHxD)':'Размеры','Batteries':'Аккумулятор','Sensor Format':'Формат','Lens Construction':'Оптическая схема','Minimum Focusing Distance':'Мин. дистанция','Filter Size':'Фильтр','Number of Diaphragm Blades':'Диафрагма'};
  const facts=rows.filter(([label])=>wanted.includes(label)).slice(0,7).map(([label,value])=>[labels[label],value]);
  return {image,source,title,facts,loadedAt:new Date().toISOString()};
}
async function loadProduct(kind,name,fetcher=fetch,preferredSource){
  if(!['camera','lens'].includes(kind)||!name)throw Error('Сначала подключите камеру с объективом.');
  const source=preferredSource||identify(kind,name).source;if(!source)throw Error('Для этой модели ещё нет проверенного адреса производителя. Основные сведения доступны через SDK.');
  let url=source;
  for(let redirect=0;redirect<4;redirect++){
    if(!safeUrl(url,source))throw Error('Разрешены только официальные страницы производителя.');
    const response=await fetcher(url,{redirect:'manual',signal:AbortSignal.timeout(10000)});
    if([301,302,303,307,308].includes(response.status)){url=safeUrl(response.headers.get('location'),url);if(!url)throw Error('Производитель перенаправил запрос на неподдерживаемый адрес.');continue;}
    if(!response.ok)throw Error(`Страница производителя недоступна (${response.status}).`);
    const reader=response.body.getReader(),chunks=[];let size=0;
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024)throw Error('Страница производителя слишком большая.');chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
    try{return parseProduct(Buffer.concat(chunks).toString('utf8'),url,kind,name);}catch(error){if(kind==='camera'&&url.includes('/specifications/'))return loadProduct(kind,name,fetcher,url.replace('/specifications/','/'));throw error;}
  }
  throw Error('Слишком много перенаправлений производителя.');
}
module.exports={identify,equipmentCards,loadProduct,parseProduct,safeUrl};
