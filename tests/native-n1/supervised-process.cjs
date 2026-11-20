'use strict';
const {classifyOutcome}=require('./job-control.cjs');
const {performance}=require('node:perf_hooks');

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function waitForClose(child,ms){
  if(child.exitCode!==null||child.signalCode!==null)return Promise.resolve({code:child.exitCode,signal:child.signalCode});
  return new Promise(resolve=>{
    let timer;
    const finish=value=>{clearTimeout(timer);child.removeListener('close',onClose);resolve(value);};
    const onClose=(code,signal)=>finish({code,signal});
    child.once('close',onClose);
    timer=setTimeout(()=>finish(null),ms);
  });
}
async function query(supervisor){
  try{
    const reply=await supervisor.request('status',{},1500);
    return reply?.ok?reply.state:null;
  }catch{return null;}
}
async function waitForEmptyTree(supervisor,ms){
  const deadline=performance.now()+ms;
  let state=null;
  do{
    state=await query(supervisor);
    if(state?.querySucceeded&&state.activeProcesses===0)return state;
    if(performance.now()>=deadline)break;
    await delay(100);
  }while(performance.now()<deadline);
  return state;
}
async function requestTreeTermination(supervisor){
  try{
    const reply=await supervisor.request('terminateTree',{},1500);
    return {accepted:reply?.requestAccepted===true,errorCode:reply?.errorCode??null,state:reply?.state??null};
  }catch(error){return {accepted:false,error:String(error.message),state:null};}
}
async function superviseChild({child,supervisor,timeoutMs=15000,rootGraceMs=1000,treeGraceMs=2500,handoffMs=25000}={}){
  if(!child||!Number.isInteger(child.pid)||child.pid<=0||!supervisor)throw Error('N2_SUPERVISION_INPUT_INVALID');
  let terminationRequested=false,rootRequest=null,treeRequest=null,timedOut=false;
  let closed=await waitForClose(child,timeoutMs);
  let state=await query(supervisor);
  if(closed&&state?.querySucceeded&&state.activeProcesses===0&&state.rootSignaled===true){
    return {processClosed:true,...closed,timedOut:false,terminationRequested:false,rootRequest:null,treeRequest:null,jobStatus:state,disposition:classifyOutcome({processClosed:true,exitCode:closed.code,signal:closed.signal,jobStatus:state})};
  }

  if(!closed){
    timedOut=true;
    try{
      rootRequest=await supervisor.request('terminateProcess',{pid:child.pid},1500);
      terminationRequested=rootRequest?.requestAccepted===true;
    }catch(error){rootRequest={ok:false,error:String(error.message)};}
    closed=await waitForClose(child,rootGraceMs);
  }

  state=await query(supervisor);
  if(!state?.querySucceeded||state.activeProcesses>0){
    treeRequest=await requestTreeTermination(supervisor);
    if(treeRequest.accepted)terminationRequested=true;
    if(!closed)closed=await waitForClose(child,treeGraceMs);
    state=await waitForEmptyTree(supervisor,treeGraceMs);
  }

  const confirmed=!!closed&&state?.querySucceeded===true&&state.activeProcesses===0&&state.rootSignaled===true;
  const disposition=confirmed
    ? (timedOut?'TIMED_OUT_EXIT_CONFIRMED':terminationRequested?'FORCED_TERMINATION_CONFIRMED':classifyOutcome({processClosed:true,exitCode:closed.code,signal:closed.signal,terminationRequested,jobStatus:state}))
    : 'UNKNOWN';
  let handoff=null;
  if(!confirmed){
    try{handoff=await supervisor.handoff(handoffMs);}catch(error){handoff={ok:false,error:String(error.message)};}
  }
  return {processClosed:!!closed,...(closed||{code:null,signal:null}),timedOut,terminationRequested,rootRequest,treeRequest,jobStatus:state,disposition,supervisorHandoff:handoff?.ok===true?handoff:null};
}
module.exports={superviseChild,waitForEmptyTree};
