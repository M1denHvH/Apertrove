const {validateLibrary,preparationCopy}=require('./library-schema.cjs');

function selectDataFolder({legacy,current,probe}){
  try{probe(legacy);return legacy;}
  catch(error){return error?.code==='ENOENT'?current:legacy;}
}
function createLibraryBootstrap({readText,writeStore,createFresh,prepare}){
  for(const fn of [readText,writeStore,createFresh,prepare])if(typeof fn!=='function')throw TypeError('Bootstrap requires explicit adapters.');
  let state={phase:'idle'},pending=null,committed=null,disposed=false;
  const failure=(kind,error)=>({kind,...(typeof error?.code==='string'&&/^[A-Z0-9_]+$/.test(error.code)?{code:error.code}:{})});
  async function attempt(){
    let input,established=true;
    try{
      const source=await readText();
      if(typeof source!=='string')return failure('UNREADABLE');
      try{input=JSON.parse(source);}catch{return failure('CORRUPT');}
    }catch(error){
      if(error?.code==='LIBRARY_RECOVERY_REQUIRED')return failure('RECOVERY_REQUIRED',error);
      if(error?.code!=='ENOENT')return failure('UNREADABLE',error);
      established=false;
      try{input=createFresh();}catch(error){return failure('MIGRATION_FAILED',error);}
    }
    if(disposed)return failure('CANCELLED');
    const valid=validateLibrary(input);
    if(valid.kind!=='VALID')return valid;
    let candidate;
    try{
      candidate=preparationCopy(input);
      candidate=await prepare(candidate,{established,version:valid.version});
      if(disposed)return failure('CANCELLED');
      if(validateLibrary(candidate).kind!=='VALID'||candidate.version!==2)return failure('MIGRATION_FAILED');
    }catch(error){return failure('MIGRATION_FAILED',error);}
    if(disposed)return failure('CANCELLED');
    try{await writeStore(candidate);}catch(error){return failure('PERSIST_FAILED',error);}
    if(disposed)return failure('CANCELLED');
    committed=candidate;
    return {kind:'VALID',store:committed,established};
  }
  function boot(){
    if(disposed)return Promise.resolve(failure('CANCELLED'));
    if(committed)return Promise.resolve({kind:'VALID',store:committed});
    if(pending)return pending;
    state={phase:'loading'};
    pending=attempt().catch(error=>failure('UNREADABLE',error)).then(result=>{
      state=result.kind==='VALID'?{phase:'ready'}:{phase:'failed',error:result};
      return result;
    }).finally(()=>{pending=null;});
    return pending;
  }
  return {boot,isReady:()=>committed!==null,getState:()=>({...state}),dispose:()=>{disposed=true;}};
}
module.exports={createLibraryBootstrap,selectDataFolder};
