// Repeats discrete lens steps without a command backlog. A stop cancels the
// next step and joins the one already in flight, including session restoration.
function createFocusHold({prepare,step,restore,onState=()=>{},interval=300,setTimer=setTimeout,clearTimer=clearTimeout}){
  let owner=null,last={status:'idle',inputId:null};
  const publish=value=>{last={...last,...value};onState({...last});return {...last};};
  async function start(args={}){
    if(owner)throw Object.assign(Error('Дождитесь завершения текущей команды камеры.'),{code:'OPERATION_BUSY'});
    if(!['near','far'].includes(args.direction)||![1,2,3].includes(args.step)||typeof args.inputId!=='string'||!args.inputId||args.inputId.length>96)throw Error('Некорректная команда удержания фокуса.');
    let ready,failed;const acknowledged=new Promise((resolve,reject)=>{ready=resolve;failed=reject;});
    const current={...args,cancelled:false,wake:null};owner=current;publish({status:'starting',direction:args.direction,step:args.step,inputId:args.inputId,error:undefined});
    current.task=(async()=>{
      let prepared=false;
      try{
        prepared=true;await prepare(args);
        // A release during asynchronous preparation must not move the lens.
        if(!current.cancelled){await step(args);publish({status:'holding'});}
        ready({...last});
        while(!current.cancelled){
          await new Promise(resolve=>{const timer=setTimer(resolve,interval);current.wake=()=>{clearTimer(timer);resolve();};});current.wake=null;
          if(current.cancelled)break;await step(args);
        }
      }catch(error){publish({status:'error',error:error.message});failed(error);}
      finally{
        try{if(prepared)await restore();}catch(error){publish({status:'error',error:error.message});failed(error);}
        if(owner===current)owner=null;
        if(last.status!=='error')publish({status:'idle',inputId:null});
      }
      return {...last};
    })();
    return acknowledged;
  }
  async function stop({inputId}={}){
    const current=owner;if(!current||inputId&&current.inputId!==inputId)return {...last};
    current.cancelled=true;publish({status:'stopping'});current.wake?.();return current.task;
  }
  return {start,stop,isBusy:()=>!!owner,snapshot:()=>({...last})};
}
module.exports={createFocusHold};
