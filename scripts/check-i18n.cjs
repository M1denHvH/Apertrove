const fs=require('node:fs'),path=require('node:path'),babel=require('@babel/parser'),walk=require('@babel/traverse').default;
const base=path.join(__dirname,'..');
const load=locale=>JSON.parse(fs.readFileSync(path.join(base,'electron/i18n/locales',locale+'.json'),'utf8'));
const ru=load('ru-RU'),en=load('en-US');
const legacyValues=new Set(Object.entries(ru).filter(([k])=>k.startsWith('legacy.')).map(([,value])=>value));
const names=[...new Set([...Object.keys(ru),...Object.keys(en)])];
const seen=new Set(Object.keys(en).filter(key=>key.startsWith('language.name.'))), dynamic=new Set(['legacy']);
const errors=[];
const placeholderNames=value=>[...new Set(Array.from(value.matchAll(/\{\{(\w+)\}\}/g),match=>match[1]))].sort().join(',');
const pluralKey=/^(.+)\.(zero|one|two|few|many|other)$/;
const dictionaries={'ru-RU':ru,'en-US':en};
const pluralForms=Object.fromEntries(Object.keys(dictionaries).map(locale=>[locale,new Intl.PluralRules(locale).resolvedOptions().pluralCategories]));
function lookup(dict,key,locale){
  const plural=key.match(pluralKey);
  if(plural&&!pluralForms[locale].includes(plural[2]))return dict[key]??dict[plural[1]+'.other'];
  return dict[key];
}
for(const key of names){
 if(!/^[a-z][\w]*(?:\.[a-z0-9_][\w]*)+$/.test(key)) errors.push('Invalid key: '+key);
 const a=lookup(ru,key,'ru-RU'),b=lookup(en,key,'en-US');
 if(typeof a!=='string'||!a.trim()||typeof b!=='string'||!b.trim())errors.push('Missing or empty: '+key);
 else if([a,b].some(value=>/\{\{|\}\}/.test(value.replace(/\{\{\w+\}\}/g,''))))errors.push('Malformed placeholder: '+key);
 else if(placeholderNames(a)!==placeholderNames(b))errors.push('Different placeholders: '+key);
 else if(key.startsWith('count.')&&placeholderNames(a)!=='count') errors.push('Missing plural count: '+key);
}
const pluralGroups=new Set(names.map(key=>key.match(pluralKey)?.[1]).filter(Boolean));
for(const group of pluralGroups){
 for(const [locale,dictionary] of Object.entries(dictionaries)) for(const form of pluralForms[locale]){
  if(!dictionary[group+'.'+form])errors.push('Missing plural form '+locale+': '+group+'.'+form);
 }
}
function list(folder){return fs.readdirSync(path.join(base,folder),{recursive:true}).filter(f=>/\.(?:[cm]?js|jsx)$/.test(f)).map(f=>path.join(folder,f));}
for(const name of [...list('src'),'electron/remote/hud.js','electron/main.cjs']){
 const data=fs.readFileSync(path.join(base,name),'utf8');
 const parsed=babel.parse(data,{sourceType:'unambiguous',plugins:['jsx']});
 function verifyLiteral(value,p){
   if(/[А-Яа-яЁё]/.test(value)&&name.startsWith('src')&&!(name.endsWith('Equipment.jsx') && ['Модель'].includes(value)))errors.push('Unlocalized text '+name+':'+p.node.loc.start.line+' '+value);
 }
 walk(parsed,{
  CallExpression(p){
    const [first]=p.node.arguments;
    if(p.node.callee.type!=='Identifier'||p.node.callee.name!=='t'||first?.type!=='StringLiteral')return;
    const key=first.value;
    seen.add(key);
    if(!en[key]&&!en[key+'.other'])errors.push('Unknown key '+key+' in '+name+':'+p.node.loc.start.line);
  },
  StringLiteral(p){verifyLiteral(p.node.value,p);if(en[p.node.value]&&(name.includes('lighting-colors')||name.includes('Onboarding')))seen.add(p.node.value);},
  JSXText(p){verifyLiteral(p.node.value,p);},
  TemplateElement(p){verifyLiteral(p.node.value.cooked||'',p);}
 });
}
for (const name of list('electron').filter(name => name.endsWith('.cjs'))) {
 const document=babel.parse(fs.readFileSync(path.join(base,name),'utf8'),{sourceType:'unambiguous'});
 function verify(value, node) {
   if (/[А-Яа-яЁё]/.test(value)&&!legacyValues.has(value))errors.push('Uncatalogued native text '+name+':'+node.loc.start.line+' '+value);
 }
 walk(document,{
   StringLiteral(p){verify(p.node.value,p.node);},
   TemplateLiteral(p){
    const node=p.node;
    verify(node.quasis.map((q,i)=>(q.value.cooked||'')+(i<node.expressions.length?'{{v'+i+'}}':'')).join(''),node);
   }
 });
}
for(const m of fs.readFileSync(path.join(base,'electron/remote/hud.html'),'utf8').matchAll(/\bdata-i18n(?:-aria-label|-placeholder)?="([^"]+)"/g)){
 seen.add(m[1]);if(!en[m[1]])errors.push('Unknown Web Remote key '+m[1]);
}
const unused=names.filter(key=>!dynamic.has(key.split('.')[0])&&!seen.has(key.match(pluralKey)?.[1]??key));
if(process.argv.includes('--unused'))console.log('Possibly unused:',unused.join(', '));
console.log(names.length+' keys checked. '+errors.length+' errors. '+unused.length+' potentially unused keys.');
if(errors.length){console.error([...new Set(errors)].join('\n'));process.exitCode=1;}

