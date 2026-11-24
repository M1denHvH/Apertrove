// A remote hold belongs to its authenticated transport and input identity.
// Stops wait for start settlement, but are never blocked by the peer busy flag.
const STARTS={bulbStart:'bulbStop',focusStart:'focusStop'};
function createRemoteHolds({command,onError=()=>{},canRecover=()=>false}){
  const owners=new Map();
  function identity(args){const value=args?.inputId||args?.input?.inputId;return typeof value==='string'&&value.length>0&&value.length<=96?value:null;}
  async function release(owner){
    if(owner.stopping)return owner.stopping;
    owner.stopping=(async()=>{try{await owner.start;}catch{}try{return await command(owner.stop,{inputId:owner.inputId});}finally{if(owners.get(owner.stop)===owner)owners.delete(owner.stop);}})();
    return owner.stopping;
  }
  async function execute(peer,name,args={}){
    if(STARTS[name]){
      if(!peer||peer.closed)throw Error('Remote hold requires an active connection.');
      const stop=STARTS[name],inputId=identity(args);if(!inputId)throw Error('Invalid hold identity.');
      if(owners.size)throw Error('A camera hold is already active.');
      const owner={peer,inputId,stop};owners.set(stop,owner);
      owner.start=Promise.resolve().then(()=>{if(peer.closed)throw Error('Remote connection closed before hold start.');return command(name,args);});
      try{return await owner.start;}catch(error){await release(owner).catch(onError);throw error;}
    }
    if(Object.values(STARTS).includes(name)){
      const owner=owners.get(name);if(!owner)return name==='bulbStop'&&args.recovery===true&&canRecover()?command(name,{}):{released:false};
      if(owner.peer!==peer||identity(args)!==owner.inputId)return {released:false};
      return release(owner);
    }
    return command(name,args);
  }
  async function disconnected(peer){peer.closed=true;await Promise.all([...owners.values()].filter(owner=>owner.peer===peer).map(owner=>release(owner).catch(onError)));}
  return {execute,disconnected,isStop:name=>Object.values(STARTS).includes(name),snapshot:()=>[...owners.values()].map(owner=>({inputId:owner.inputId,stop:owner.stop}))};
}
module.exports={createRemoteHolds};
