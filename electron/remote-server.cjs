const http=require('node:http');
const {createRemoteHolds}=require('./remote-holds.cjs');
const os=require('node:os');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {WebSocketServer,WebSocket}=require('ws');
const {supportedLocales}=require('./i18n/runtime.js');
const {normalize:normalizeAppearance}=require('./remote/appearance.js');
const COMMANDS=new Set(['flashSupport','flashPopup','connect','disconnect','listCameras','live','property','focus','focusStart','focusStop','bulbStart','bulbStop','autofocus','capture','applyPreset','intervalStart','intervalStop','seriesStart','seriesStop','burstStart','burstStop']);
function localInterfaces(){
  const result=[];
  for(const [name,list] of Object.entries(os.networkInterfaces()))for(const a of list||[]){if(a.family!=='IPv4'||a.internal)continue;const [x,y]=a.address.split('.').map(Number);if(x===10||(x===172&&y>=16&&y<=31)||(x===192&&y===168))result.push({name,address:a.address});}
  return [...result,{name:'Только этот компьютер',address:'127.0.0.1'}];
}
function sameSecret(actual,expected){if(typeof actual!=='string')return false;const a=Buffer.from(actual),b=Buffer.from(expected);return a.length===b.length&&crypto.timingSafeEqual(a,b);}
function createRemoteServer({getState,command,getPhoto=()=>null,log=()=>{},onClients=()=>{}}){
  let server,wss,host,port,secret,lastFrame=null,running=false;
  const peers=new Set(),sockets=new Set();
  const holds=createRemoteHolds({command,onError:error=>log('error',error.message),canRecover:()=>getState().camera?.bulb?.status==='error'&&getState().camera?.bulb?.confirmation==='unknown'});
  let heartbeat;
  const assets=new Map([['/',['hud.html','text/html; charset=utf-8']],['/hud.css',['hud.css','text/css; charset=utf-8']],['/hud.js',['hud.js','text/javascript; charset=utf-8']],['/focus-overlay.js',['focus-overlay.js','text/javascript; charset=utf-8']],['/composition-overlay.js',['composition-overlay.js','text/javascript; charset=utf-8']]]);
  assets.set('/i18n.js',['../i18n/runtime.js','text/javascript; charset=utf-8']);
  for(const locale of supportedLocales)assets.set('/locales/'+locale+'.json',['../i18n/locales/'+locale+'.json','application/json; charset=utf-8']);
  for(const file of ['appearance.js','appearance.css','lcd.js'])assets.set('/'+file,[file,file.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8']);
  for(const subset of ['latin','cyrillic'])for(const weight of [400,500,600,700])assets.set(`/fonts/manrope-${subset}-${weight}.woff2`,[path.join('..','..','node_modules','@fontsource','manrope','files',`manrope-${subset}-${weight}-normal.woff2`),'font/woff2']);
  function info(){return {running,host:running?host:null,port:running?port:null,clients:[...peers].filter(p=>p.authorized).length,url:running?`http://${host}:${port}/#key=${secret}`:null};}
  function notify(){onClients(info());}
  function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
  function checkOrigin(req){
    try{const requestHost=new URL(`http://${req.headers.host}`).hostname;if(requestHost!==host)return false;
      if(req.headers.origin){const origin=new URL(req.headers.origin);if(origin.protocol!=='http:'||origin.host!==req.headers.host)return false;}return true;
    }catch{return false;}
  }
  function authorized(req){return sameSecret(String(req.headers.authorization||'').replace(/^Bearer /,''),secret);}
  async function execute(name,args,peer){if(!COMMANDS.has(name))throw Error('Команда недоступна в веб-пульте.');return holds.execute(peer,name,args||{});}
  async function readBody(req){let size=0,parts=[];for await(const part of req){size+=part.length;if(size>16384)throw Error('Слишком большой запрос.');parts.push(part);}return JSON.parse(Buffer.concat(parts).toString('utf8'));}
  async function handle(req,res){
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self' ws:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if(!checkOrigin(req))return json(res,403,{error:'Источник запроса не разрешён.'});
    const url=new URL(req.url,`http://${host}:${port}`),route=url.pathname;
    if(req.method==='GET'&&route==='/locale.json')return json(res,200,{locale:getState().locale||'ru-RU'});
    if(req.method==='GET'&&route==='/appearance.json')return json(res,200,normalizeAppearance(getState().appearance));
    if(req.method==='GET'&&assets.has(route)){const [file,type]=assets.get(route);res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});return res.end(fs.readFileSync(path.join(__dirname,'remote',file)));}
    if(!authorized(req))return json(res,401,{error:'Нужен ключ доступа из приложения.'});
    if(req.method==='GET'&&route==='/api/state')return json(res,200,getState());
    if(req.method==='GET'&&route==='/api/frame'){if(!lastFrame){res.writeHead(204);return res.end();}res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'no-store'});return res.end(lastFrame);}
    if(req.method==='GET'&&route.startsWith('/api/photo/')){const photo=await getPhoto(route.slice('/api/photo/'.length));if(!photo)return json(res,404,{error:'Превью недоступно.'});res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'no-store'});return res.end(photo);}
    if(req.method==='POST'&&route==='/api/command'){
      if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return json(res,415,{error:'Требуется JSON.'});
      try{const {name,args}=await readBody(req);return json(res,200,{result:await execute(name,args)});}catch(e){return json(res,400,{error:e.message});}
    }
    return json(res,404,{error:'Не найдено.'});
  }
  async function start(options={}){
    if(running)return info();
    host=options.host||localInterfaces()[0].address;const addresses=localInterfaces().map(i=>i.address);
    if(!addresses.includes(host))throw Error('Выберите адрес интерфейса локальной сети.');
    const requested=options.port===undefined?8765:Number(options.port);
    if(!Number.isInteger(requested)||(requested!==0&&(requested<1024||requested>65535)))throw Error('Порт должен быть от 1024 до 65535.');
    secret=crypto.randomBytes(24).toString('base64url');lastFrame=null;
    server=http.createServer((req,res)=>handle(req,res).catch(e=>{log('error',e.message);if(!res.headersSent)json(res,500,{error:'Ошибка локального сервера.'});else res.destroy();}));
    server.headersTimeout=5000;server.requestTimeout=10000;server.maxConnections=32;
    server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
    wss=new WebSocketServer({noServer:true,maxPayload:16384,perMessageDeflate:false});
    server.on('upgrade',(req,socket,head)=>{if(req.url!=='/ws'||!checkOrigin(req)||peers.size>=12){socket.destroy();return;}wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws));});
    wss.on('connection',ws=>{
      const peer={ws,authorized:false,busy:false,count:0,window:Date.now(),alive:true};peers.add(peer);
      const authTimeout=setTimeout(()=>{if(!peer.authorized)ws.close(1008,'Authentication required');},5000);
      ws.on('message',async(data,binary)=>{
        try{
          if(binary)throw Error('Ожидается JSON.');const msg=JSON.parse(data.toString());
          if(!peer.authorized){if(msg.type!=='auth'||!sameSecret(msg.key,secret)){ws.close(1008,'Invalid key');return;}clearTimeout(authTimeout);peer.authorized=true;ws.send(JSON.stringify({type:'state',data:getState()}));if(lastFrame)ws.send(lastFrame,{binary:true});notify();return;}
          if(msg.type==='ping'){ws.send(JSON.stringify({type:'pong',at:msg.at}));return;}
          if(msg.type!=='command')throw Error('Неизвестный тип сообщения.');
          if(Date.now()-peer.window>1000){peer.window=Date.now();peer.count=0;}if(++peer.count>25&&!holds.isStop(msg.name))throw Error('Слишком много команд.');
          if(peer.busy&&!holds.isStop(msg.name)){ws.send(JSON.stringify({type:'result',id:msg.id,error:'Дождитесь предыдущей команды.'}));return;}
          const ownsBusy=!holds.isStop(msg.name);if(ownsBusy)peer.busy=true;
          try{const result=await execute(msg.name,msg.args,peer);if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'result',id:msg.id,result}));}
          catch(e){if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'result',id:msg.id,error:e.message}));}
          finally{if(ownsBusy)peer.busy=false;}
        }catch(e){if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'error',error:e.message}));}
      });
      ws.on('pong',()=>{peer.alive=true;});
      ws.on('close',()=>{clearTimeout(authTimeout);void holds.disconnected(peer);peers.delete(peer);notify();});ws.on('error',()=>{});
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(requested,host,()=>{server.removeListener('error',reject);resolve();});});
    heartbeat=setInterval(()=>{for(const peer of peers){if(!peer.alive){peer.ws.terminate();continue;}peer.alive=false;peer.ws.ping();}},5000);heartbeat.unref();
    port=server.address().port;running=true;notify();log('info',`Веб-пульт: http://${host}:${port}`);return info();
  }
  function publishFrame(bytes){
    if(!running)return;lastFrame=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);
    for(const p of peers)if(p.authorized&&p.ws.readyState===WebSocket.OPEN&&p.ws.bufferedAmount<768*1024)p.ws.send(lastFrame,{binary:true});
  }
  function publishFocus(info){if(!running)return;const text=JSON.stringify({type:'focus',data:info});for(const p of peers)if(p.authorized&&p.ws.readyState===WebSocket.OPEN&&p.ws.bufferedAmount<128*1024)p.ws.send(text);}
  function publishState(){if(!running)return;const state=getState();if(state.camera?.live===false)lastFrame=null;const text=JSON.stringify({type:'state',data:state});for(const p of peers)if(p.authorized&&p.ws.readyState===WebSocket.OPEN&&p.ws.bufferedAmount<1024*1024)p.ws.send(text);}
  async function stop(){running=false;lastFrame=null;clearInterval(heartbeat);await Promise.all([...peers].map(p=>holds.disconnected(p)));for(const p of peers)p.ws.terminate();peers.clear();if(wss){wss.close();wss=null;}if(server){const old=server;server=null;for(const s of sockets)s.destroy();sockets.clear();await new Promise(r=>old.close(r));}notify();return info();}
  return {start,stop,info,publishFrame,publishState,publishFocus};
}
module.exports={createRemoteServer,localInterfaces,sameSecret};
