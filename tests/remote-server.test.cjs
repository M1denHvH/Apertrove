const {test}=require('node:test');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const {WebSocket}=require('ws');
const {createRemoteServer,localInterfaces}=require('../electron/remote-server.cjs');
function client(url,origin){return new WebSocket(url,{origin});}
test('Remote API requires its key, validates origins and exposes only camera commands',async()=>{
 const calls=[],server=createRemoteServer({getState:()=>({camera:{model:'Test'}}),command:async(name,args)=>{calls.push([name,args]);return {ok:true};}});
 try{const info=await server.start({host:'127.0.0.1',port:0}),base=`http://${info.host}:${info.port}`,key=new URLSearchParams(new URL(info.url).hash.slice(1)).get('key');
  assert.equal((await fetch(base+'/')).status,200);assert.equal((await fetch(base+'/api/state')).status,401);
  const headers={Authorization:'Bearer '+key};assert.equal((await fetch(base+'/api/state',{headers})).status,200);
  assert.equal((await fetch(base+'/api/state',{headers:{...headers,Origin:'http://unrelated.example'}})).status,403);
  let r=await fetch(base+'/api/command',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({name:'property',args:{key:'iso',value:72}})});assert.equal(r.status,200);assert.deepEqual(calls,[['property',{key:'iso',value:72}]]);
  r=await fetch(base+'/api/command',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({name:'chooseFolder',args:{path:'C:\\'}})});assert.equal(r.status,400);assert.equal(calls.length,1);
  assert.equal((await fetch(base+'/api/command',{method:'POST',headers,body:'x'})).status,415);
 }finally{await server.stop();}
});
test('WebSocket authenticates before state/frames, sends original binary JPEG, and rotates keys on restart',async()=>{
 const server=createRemoteServer({getState:()=>({camera:{connected:true}}),command:async()=>true});let ws,bad;
 try{let info=await server.start({host:'127.0.0.1',port:0});const key=new URLSearchParams(new URL(info.url).hash.slice(1)).get('key'),url=`ws://127.0.0.1:${info.port}/ws`,origin=`http://127.0.0.1:${info.port}`;
  bad=client(url,origin);await once(bad,'open');bad.send(JSON.stringify({type:'auth',key:'invalid'}));const [code]=await once(bad,'close');assert.equal(code,1008);
  ws=client(url,origin);await once(ws,'open');const state=once(ws,'message');ws.send(JSON.stringify({type:'auth',key}));assert.equal(JSON.parse((await state)[0]).type,'state');
  const bytes=Buffer.from([0xff,0xd8,12,34,56,0xff,0xd9]),frame=once(ws,'message');server.publishFrame(bytes);const [received,binary]=await frame;assert.equal(binary,true);assert.deepEqual(received,bytes);
  const result=once(ws,'message');ws.send(JSON.stringify({type:'command',id:7,name:'capture'}));assert.deepEqual(JSON.parse((await result)[0]),{type:'result',id:7,result:true});
  await server.stop();info=await server.start({host:'127.0.0.1',port:0});const newKey=new URLSearchParams(new URL(info.url).hash.slice(1)).get('key');assert.notEqual(key,newKey);
 }finally{ws?.terminate();bad?.terminate();await server.stop();}
});
test('Remote server binds only private local interfaces and validates port numbers',async()=>{
 const server=createRemoteServer({getState:()=>({}),command:async()=>{}});
 await assert.rejects(server.start({host:'0.0.0.0',port:8765}),/локальной/);await assert.rejects(server.start({host:'127.0.0.1',port:80}),/Порт/);
 assert.ok(localInterfaces().some(i=>i.address==='127.0.0.1'));assert.ok(localInterfaces().every(i=>!i.address.startsWith('198.18.')));await server.stop();
});
test('Login receives only sanitized public appearance, and theme/font assets have explicit routes',async()=>{
 const server=createRemoteServer({getState:()=>({appearance:{theme:'system',resolvedTheme:'dark',design:'classic',accentColor:'#669dd8',captureFolder:'private',secret:'private'},photos:['private'],settings:{sdkDir:'private'}}),command:async()=>{}});
 try{const info=await server.start({host:'127.0.0.1',port:0}),base=`http://${info.host}:${info.port}`,response=await fetch(base+'/appearance.json'),appearance=await response.json();assert.equal(response.status,200);assert.equal(appearance.resolvedTheme,'dark');assert.equal(appearance.design,'classic');assert.equal(appearance.secret,undefined);assert.equal(appearance.captureFolder,undefined);assert.equal((await fetch(base+'/api/state')).status,401);
 for(const route of ['/appearance.js','/appearance.css','/lcd.js','/fonts/manrope-cyrillic-400.woff2','/fonts/manrope-latin-700.woff2']){const asset=await fetch(base+route);assert.equal(asset.status,200,route);assert.ok((await asset.arrayBuffer()).byteLength>100);}
 assert.equal((await fetch(base+'/fonts/unknown.woff2')).status,401);
 }finally{await server.stop();}
});
