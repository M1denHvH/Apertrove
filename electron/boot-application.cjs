// Shared boot orchestration. Native services are supplied by main only after commit.
function createBootApplication({bootstrap,isQuitting,acceptStore,initializeServices,applyAppearance,publicState,locale}){
  const failed=kind=>({bootFailure:{kind},locale:locale()});
  return async function bootApplication(){
    if(isQuitting())return failed('CANCELLED');
    const result=await bootstrap.boot();
    if(isQuitting())return failed('CANCELLED');
    if(result.kind!=='VALID')return failed(result.kind);
    acceptStore(result.store);
    try{initializeServices();}catch{return failed('RUNTIME_FAILED');}
    if(isQuitting())return failed('CANCELLED');
    applyAppearance();
    return publicState();
  };
}
module.exports={createBootApplication};
