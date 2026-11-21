// Input ownership is synchronous and independent of React render/IPC completion.
// Repeated release notifications consume the same intent exactly once.
function createShutterInput({start,stop,newId=()=>globalThis.crypto.randomUUID(),onChange=()=>{}}){
  let held=null,disposed=false;
  const snapshot=()=>held?{...held}:null;
  function release(reason='release',identity){
    if(!held||identity!==undefined&&held.identity!==identity)return false;
    const input=held;held=null;onChange(false);
    stop({...input,phase:'release',reason});return true;
  }
  function press(source,identity){
    if(disposed||held)return false;
    held={inputId:newId(),source,identity};const input=held;onChange(true);
    try{const result=start({...input,phase:'press'});Promise.resolve(result).catch(()=>{if(held===input)release('start-error');});}
    catch(error){release('start-error');throw error;}
    return true;
  }
  return {press,release,snapshot,dispose(){if(disposed)return;release('unmount');disposed=true;}};
}
module.exports={createShutterInput};
