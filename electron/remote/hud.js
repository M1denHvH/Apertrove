(async function startRemote() {
'use strict';
const { t, legacy, setLocale, getLocale, number, register, systemLocale, supportedLocales } = globalThis.ApertroveI18n;
async function read(url) {
  const response = await fetch(url,{cache:'no-store'});
  if (!response.ok) throw new Error(response.statusText);
  return response.json();
}
const resources=await Promise.allSettled(supportedLocales.map(id=>read('/locales/'+id+'.json').then(dictionary=>register(id,dictionary))));
const dictionariesReady=resources.every(result=>result.status==='fulfilled');
if(dictionariesReady){
  const initial=await read('/locale.json').catch(()=>({locale:systemLocale(navigator.languages)}));
  setLocale(initial.locale);
}
function localizeDocument(){
  for(const node of document.querySelectorAll('[data-i18n]'))node.textContent=t(node.dataset.i18n);
  for(const node of document.querySelectorAll('[data-i18n-aria-label]'))node.setAttribute('aria-label',t(node.dataset.i18nAriaLabel));
  for(const node of document.querySelectorAll('[data-i18n-placeholder]'))node.placeholder=t(node.dataset.i18nPlaceholder);
  document.documentElement.lang=getLocale();
}
if(dictionariesReady)localizeDocument();
const $=id=>document.getElementById(id),canvas=$('preview'),ctx=canvas.getContext('2d',{alpha:false});
let nativeHolding=false,focusInfo=null,socket,state=null,sequence=0,pending=new Map(),busy=false,latest=null,decoding=false,shown=0,totalFrames=0,fpsAt=performance.now(),reconnectTimer,messageTimer;
let previewAt=0,flashProbeModel=null,flashAvailable=false;
let authenticated=false,appearanceRevision=0,appearanceSignature='';
function appearance(input){const value=globalThis.ApertroveAppearance.normalize(input),signature=JSON.stringify(value);if(signature===appearanceSignature)return;appearanceSignature=signature;globalThis.ApertroveAppearance.apply(value);try{localStorage.setItem('apertrove-remote-appearance',JSON.stringify(value));}catch{}document.querySelector('meta[name="theme-color"]').content=getComputedStyle(document.documentElement).getPropertyValue('--background').trim();}
try{appearance(JSON.parse(localStorage.getItem('apertrove-remote-appearance')||'{}'));}catch{appearance({});}
let loginRejected=false,refreshInProgress=false;
function applyLocale(next){
  if(!dictionariesReady||!supportedLocales.includes(next)||next===getLocale())return;
  setLocale(next);localizeDocument();
  $('more').querySelector('span').textContent=$('details').hidden?t('remote.all_settings'):t('remote.hide_settings');
  if(currentMessage)$('message-text').textContent=legacy(currentMessage);
  if(loginRejected)$('login-error').textContent=t("remote.that_key_isn_t_valid_open_a_fresh");
  $('connection-text').textContent=t(authenticated?'remote.connected':'remote.offline');
}
async function refreshAppearance(){
  if(refreshInProgress)return;
  refreshInProgress=true;
  const revision=appearanceRevision;
  try {
    const [theme,language]=await Promise.allSettled([read('/appearance.json'),read('/locale.json')]);
    if(revision!==appearanceRevision)return;
    if(theme.status==='fulfilled')appearance(theme.value);
    if(!authenticated&&language.status==='fulfilled'){applyLocale(language.value.locale);render();}
  } finally {refreshInProgress=false;}
}
refreshAppearance();setInterval(()=>{if(!document.hidden&&(!authenticated||socket?.readyState!==1))refreshAppearance();},3000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!authenticated)refreshAppearance();});
let key=new URLSearchParams(location.hash.slice(1)).get('key')||sessionStorage.getItem('focal-key');
if(key){sessionStorage.setItem('focal-key',key);history.replaceState(null,'',location.pathname);}
let currentMessage;
function message(text,error=false){currentMessage=text;$('message-text').textContent=legacy(text);$('message').classList.toggle('error',error);$('message').hidden=false;clearTimeout(messageTimer);messageTimer=setTimeout(()=>$('message').hidden=true,6000);}
function command(name,args={}){if(!socket||socket.readyState!==1)return Promise.reject(Error(t("remote.no_connection_to_the_computer")));const id=++sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error(t("remote.the_command_didn_t_finish_check_apertrove_on")));},name==='capture'?(state?.camera.properties?.driveMode?.value===7?925000:85000):['autofocus','focus','flashPopup'].includes(name)?35000:20000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({type:'command',id,name,args}));});}
async function action(name,args){const stopping=['seriesStop','intervalStop','burstStop'].includes(name);if((busy||state?.busy)&&!stopping){if(state?.busy)message(t('operation.busy'),true);return;}busy=true;render();try{const result=await command(name,args);if(name==='capture'&&result?.confirmation==='UNVERIFIED')message(t('operation.capture_unverified'));return result;}catch(e){message(e.message,true);}finally{busy=false;render();}}
function option(select,list,value,localize=false){const signature=JSON.stringify([getLocale(),list]);if(select.dataset.options!==signature){select.replaceChildren(...list.map(item=>new Option(localize?legacy(item.label):item.label,item.value)));select.dataset.options=signature;}if(value!==undefined&&value!==null)select.value=String(value);}
function render(){if(!state)return;const cam=state.camera||{},connected=cam.connected&&authenticated&&socket?.readyState===1,seriesActive=state.series&&['running','stopping','restoring'].includes(state.series.status),burstActive=state.burst&&['holding','transferring'].includes(state.burst.status),locked=busy||!!state.busy||seriesActive||burstActive;
 if(!cam.live&&state.focusPreview&&state.focusPreview.at!==previewAt){const snapshot=state.focusPreview;previewAt=snapshot.at;const image=new Image();image.onload=()=>{if(state?.camera.live||state?.focusPreview?.at!==snapshot.at)return;canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;ctx.drawImage(image,0,0);globalThis.ApertroveComposition.drawComposition(ctx,canvas.width,canvas.height,state.composition);globalThis.ApertroveFocus.drawFocus(ctx,canvas.width,canvas.height,snapshot.focusInfo,snapshot.at);canvas.dataset.frames='1';$('view-empty').hidden=true;};image.src=snapshot.image;}
 const flashKey=JSON.stringify([cam.cameraId,cam.model,cam.mode,cam.connectedAt]);if(connected&&flashProbeModel!==flashKey){flashProbeModel=flashKey;flashAvailable=false;command('flashSupport').then(info=>{if(flashProbeModel===flashKey){flashAvailable=info.available||info.canAttempt;render();}}).catch(()=>{if(flashProbeModel===flashKey)flashAvailable=false;});}if(!connected){flashProbeModel=null;flashAvailable=false;}$('flash-popup').disabled=!connected||!flashAvailable||locked||!!state.interval;
$('model').textContent=cam.model||t("remote.no_camera_connected");$('model').title=cam.model||'';$('mode').textContent=!cam.live&&state.focusPreview?t("remote.af_preview"):cam.mode||'—';$('battery').textContent=connected&&cam.battery<=100?t("remote.bat", { v0: cam.battery }):'';
 $('session').textContent=state.session?.name||t("remote.none_selected");$('session').title=state.session?.name||'';$('count').textContent=number(state.session?.count||0);
 $('count-label').textContent=t('remote.session_photo_label',{count:state.session?.count||0});
 $('live').textContent=cam.live?t("remote.stop_live_view"):t("remote.start_live_view");$('live').disabled=!connected||locked||cam.capabilities?.liveView===false;
 $('view-empty').hidden=!!(cam.live||state.focusPreview)&&canvas.dataset.frames>0;if(!cam.live&&!state.focusPreview){ctx.clearRect(0,0,canvas.width,canvas.height);$('view-empty').hidden=false;$('view-empty').querySelector('p').textContent=connected?t("remote.preview_is_off"):t("remote.connect_a_camera");$('fps').textContent='0';}
 $('shutter').disabled=!state.session?.name||!connected||!!state.busy&&!(burstActive&&nativeHolding)||seriesActive||!!state.interval||busy&&!nativeHolding||state.burst?.status==='transferring'||cam.capabilities?.capture===false;const continuous=[1,4,5].includes(cam.properties?.driveMode?.value);$('shutter').setAttribute('aria-label',continuous?t("remote.hold_for_burst"):t("remote.take_photo"));$('shutter').title=continuous?t("remote.hold_for_burst_stops_after_5_seconds"):t("remote.take_photo");$('shutter').classList.toggle('holding',nativeHolding);
 $('af').textContent=cam.autofocus?.status==='focusing'?'AF…':'AF';
 const requests=job=>t('operation.requests_progress',{requested:number(job.requested??job.done??0),total:number(job.count||0),confirmed:number(job.done||0)});
 const unconfirmed=state.series?.status==='unconfirmed'||state.burst?.status==='unconfirmed';
 $('status').textContent=burstActive?(state.burst.status==='holding'?t("remote.continuous_shooting_release_to_stop"):t("remote.transferring_burst")):seriesActive?requests(state.series):state.interval?requests(state.interval):unconfirmed?t('operation.capture_unverified'):cam.autofocus?.status==='focusing'?t("remote.focusing"):busy||state.busy?t('operation.busy'):connected?(legacy(cam.error)||t("remote.ready_to_shoot")):t("remote.disconnected");
 document.querySelectorAll('[data-property]').forEach(el=>{const p=cam.properties?.[el.dataset.property];option(el,p?.choices?.length?p.choices:[{value:'',label:'—'}],p?.value,true);el.disabled=!connected||!p?.writable||locked||!!state.interval;if(el.nextElementSibling?.classList.contains('lcd-readout'))globalThis.ApertroveLcd.draw(el.nextElementSibling,el.dataset.property,el.selectedOptions[0]?.textContent||'—');});
 const ev=cam.properties?.compensation,evChoices=[...(ev?.choices||[])].sort((a,b)=>(a.value>127?a.value-256:a.value)-(b.value>127?b.value-256:b.value)),evSlider=$('ev-slider');evSlider.dataset.choices=JSON.stringify(evChoices);evSlider.max=Math.max(1,evChoices.length-1);evSlider.disabled=!connected||!ev?.writable||locked||!!state.interval;if(document.activeElement!==evSlider){evSlider.value=Math.max(0,evChoices.findIndex(choice=>choice.value===ev?.value));$('ev-value').textContent=(evChoices[evSlider.value]?.label||'—')+' EV';}
 for(const id of ['near','far','af'])$(id).disabled=!connected||cam.properties?.afMode?.value===3||locked||!!state.interval||cam.capabilities?.focus===false;
 option($('presets'),[{value:'',label:t("remote.none_selected_2")},...(state.presets||[]).map(p=>({value:p.id,label:p.name}))]);$('presets').disabled=!connected||locked;
 option($('cameras'),(state.cameras||[]).map(c=>({value:c.id,label:c.model})),cam.cameraId);$('connect-camera').disabled=!authenticated||locked||!$('cameras').value;$('refresh-cameras').disabled=!authenticated||locked;
 $('interval').textContent=state.interval?t("remote.stop_series"):t("remote.start_series");$('interval').disabled=!connected||!state.interval&&(!state.session?.name||locked||cam.capabilities?.capture===false);const seriesButton=$('preset-series');seriesButton.textContent=seriesActive?t("remote.stop_queue"):t('remote.shoot_queue',{photos:t('count.photos',{count:state.session?.queueLength||0})});seriesButton.disabled=!connected||(seriesActive?state.series.cancelled:busy||!!state.busy||!!state.interval||burstActive||!state.session?.queueLength);
}
async function draw(){if(decoding||!latest)return;decoding=true;const bytes=latest;latest=null;
 try{const image=await createImageBitmap(new Blob([bytes],{type:'image/jpeg'}));if(canvas.width!==image.width||canvas.height!==image.height){canvas.width=image.width;canvas.height=image.height;}if(state?.camera.live){ctx.drawImage(image,0,0);globalThis.ApertroveComposition.drawComposition(ctx,canvas.width,canvas.height,state?.composition);globalThis.ApertroveFocus.drawFocus(ctx,canvas.width,canvas.height,focusInfo||state?.camera.focusInfo);canvas.dataset.frames=String(++totalFrames);$('view-empty').hidden=true;shown++;}image.close();const now=performance.now();if(now-fpsAt>1000){$('fps').textContent=(shown*1000/(now-fpsAt)).toFixed(1);fpsAt=now;shown=0;}}
 catch(e){console.warn('JPEG decode failed');}finally{decoding=false;if(latest)draw();}}
function connect(){clearTimeout(reconnectTimer);authenticated=false;if(!key){$('login').hidden=false;$('hud').hidden=true;return;}$('login').hidden=true;$('hud').hidden=false;if(!state)state={camera:{connected:false}};render();
 socket=new WebSocket(`ws://${location.host}/ws`);socket.binaryType='arraybuffer';
 socket.onopen=()=>{socket.send(JSON.stringify({type:'auth',key}));};
 socket.onmessage=event=>{if(event.data instanceof ArrayBuffer){latest=event.data;if(!decoding)draw();return;}const msg=JSON.parse(event.data);
  if(msg.type==='state'){state=msg.data;authenticated=true;loginRejected=false;if(state.appearance){appearanceRevision++;appearance(state.appearance);}$('online').classList.add('on');$('connection-text').textContent=t("remote.connected");applyLocale(state.locale);render();}
  else if(msg.type==='focus'){focusInfo=msg.data;}
  else if(msg.type==='result'){const p=pending.get(msg.id);if(p){clearTimeout(p.timer);pending.delete(msg.id);msg.error?p.reject(Error(msg.error)):p.resolve(msg.result);}}
  else if(msg.type==='error')message(msg.error,true);
 };
 socket.onclose=event=>{authenticated=false;nativeHolding=false;flashProbeModel=null;flashAvailable=false;$('online').classList.remove('on');$('connection-text').textContent=t("remote.offline");for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error(t("remote.connection_to_the_computer_lost")));}pending.clear();render();if(event.code===1008){sessionStorage.removeItem('focal-key');key=null;loginRejected=true;$('login-error').textContent=t("remote.that_key_isn_t_valid_open_a_fresh");connect();}else reconnectTimer=setTimeout(connect,2000);};socket.onerror=()=>{};
}
$('login-form').onsubmit=e=>{e.preventDefault();let value=$('key').value.trim();try{if(value.startsWith('http'))value=new URLSearchParams(new URL(value).hash.slice(1)).get('key');}catch{}if(value){key=value;sessionStorage.setItem('focal-key',key);connect();}};
$('live').onclick=()=>action('live',{enabled:!state?.camera.live});$('shutter').onclick=()=>{if(![1,4,5].includes(state?.camera.properties?.driveMode?.value))action('capture');};
$('shutter').onpointerdown=async event=>{if(![1,4,5].includes(state?.camera.properties?.driveMode?.value))return;event.preventDefault();nativeHolding=true;event.currentTarget.setPointerCapture(event.pointerId);render();try{await command('burstStart',{seconds:5});}catch(e){nativeHolding=false;message(e.message,true);render();}};
const releaseBurst=()=>{if(!nativeHolding)return;nativeHolding=false;command('burstStop').catch(e=>message(e.message,true));render();};$('shutter').onpointerup=releaseBurst;$('shutter').onpointercancel=releaseBurst;$('shutter').onlostpointercapture=releaseBurst;window.addEventListener('blur',releaseBurst);
$('preset-series').onclick=()=>action(state?.series&&['running','stopping','restoring'].includes(state.series.status)?'seriesStop':'seriesStart');
document.querySelectorAll('[data-property]').forEach(el=>el.onchange=()=>action('property',{key:el.dataset.property,value:Number(el.value)}));
$('near').onclick=()=>action('focus',{direction:'near',step:Number($('focus-step').value)});$('far').onclick=()=>action('focus',{direction:'far',step:Number($('focus-step').value)});$('af').onclick=()=>action('autofocus');
$('more').onclick=()=>{$('details').hidden=!$('details').hidden;$('more').setAttribute('aria-expanded',String(!$('details').hidden));$('more').querySelector('span').textContent=$('details').hidden?t("remote.all_settings"):t("remote.hide_settings");};
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if($('viewfinder').requestFullscreen)await $('viewfinder').requestFullscreen();else $('viewfinder').classList.toggle('expanded');}catch{$('viewfinder').classList.toggle('expanded');}};
$('presets').onchange=()=>{if($('presets').value)action('applyPreset',{id:$('presets').value});};
$('refresh-cameras').onclick=async()=>{try{await command('listCameras');}catch(e){message(e.message,true);}};
$('connect-camera').onclick=()=>action('connect',{cameraId:$('cameras').value});
$('interval').onclick=()=>state?.interval?action('intervalStop'):action('intervalStart',{count:Number($('interval-count').value),seconds:Number($('interval-seconds').value)});
connect();

$('ev-slider').oninput=()=>{$('ev-value').textContent=(JSON.parse($('ev-slider').dataset.choices||'[]')[$('ev-slider').value]?.label||'—')+' EV';};
$('ev-slider').onchange=()=>{const choice=JSON.parse($('ev-slider').dataset.choices||'[]')[$('ev-slider').value];if(choice)action('property',{key:'compensation',value:choice.value});};

$('flash-popup').onclick=()=>action('flashPopup');
$('message-close').onclick=()=>{clearTimeout(messageTimer);$('message').hidden=true;};

})();
