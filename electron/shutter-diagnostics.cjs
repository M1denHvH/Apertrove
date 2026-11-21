const SOURCES=new Set(['pointer','keyboard','keyboard-body','ipc','remote','unknown']);
const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9_.:-]{1,160}$/.test(value);
function shutterInput(value){return {inputId:validId(value?.inputId)?value.inputId:null,source:SOURCES.has(value?.source)?value.source:'unknown'};}
function createShutterDiagnostics({enabled=false,write=()=>{},now=Date.now,max=400}={}){
  let emitted=0;
  return (phase,data={})=>{
    if(!enabled||emitted>=max||typeof phase!=='string'||!/^[a-z-]{1,40}$/.test(phase))return;
    const row={at:now(),phase,...shutterInput(data),operationId:validId(data.operationId)?data.operationId:null};
    for(const key of ['command','parameter','code','driveMode','watchdogMs'])if(Number.isFinite(data[key]))row[key]=data[key];
    for(const key of ['servo','worker','reason'])if(typeof data[key]==='string'&&/^[a-zA-Z0-9_-]{1,48}$/.test(data[key]))row[key]=data[key];
    emitted++;write(row);
  };
}
module.exports={shutterInput,createShutterDiagnostics};
