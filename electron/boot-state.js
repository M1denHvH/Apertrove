// Shared with the renderer; executable in isolation without React or Electron.
(function(root){
  function createBootController({load,onState,locale='en-US'}){
    let state={phase:'loading',locale:['ru-RU','en-US'].includes(locale)?locale:'en-US'},pending=null,disposed=false,attempts=0;
    const publish=next=>{state=next;if(!disposed)onState(next);};
    function request(){
      if(disposed)return Promise.resolve();
      if(pending)return pending;
      if(state.phase==='ready')return Promise.resolve(state.data);
      publish({phase:attempts++?'retrying':'loading',locale:state.locale});
      pending=Promise.resolve().then(()=>load()).then(data=>{
        if(disposed)return;
        const nextLocale=['ru-RU','en-US'].includes(data?.locale)?data.locale:state.locale;
        if(data?.bootFailure){publish({phase:'failed',locale:nextLocale,error:data.bootFailure});return;}
        if(!data||data.bootFailure!==null||!data.settings||typeof data.settings!=='object'||Array.isArray(data.settings)||!Array.isArray(data.photos)||!Array.isArray(data.sessions)||!Array.isArray(data.presets)){
          publish({phase:'failed',locale:nextLocale,error:{kind:'UNREADABLE'}});return;
        }
        publish({phase:'ready',locale:nextLocale,data});return data;
      },()=>{if(!disposed)publish({phase:'failed',locale:state.locale,error:{kind:'UNREADABLE'}});})
        .finally(()=>{pending=null;});
      return pending;
    }
    return {request,dispose:()=>{disposed=true;},snapshot:()=>state};
  }
  const api={createBootController};
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.ApertroveBoot=api;
})(globalThis);
