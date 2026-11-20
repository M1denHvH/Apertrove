'use strict';
// Classify sampled evidence. Absence in a sample is never proof of no activity.
const fs=require('node:fs'),path=require('node:path');
const comparable=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
function readFrames(file){
  const bytes=fs.readFileSync(file);if(bytes.length>9*1024*1024)throw Error('OBSERVATION_SIZE_LIMIT');
  return bytes.toString('utf8').split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
}
function review({beforeFile,duringFile,afterFile,manifest,rootPid,systemRoot}){
  const before=readFrames(beforeFile).at(-1),frames=readFrames(duringFile),after=readFrames(afterFile).at(-1);
  const normalized=file=>path.resolve(file).toLowerCase();
  const allowedFiles=new Set([manifest.node.path,manifest.koffi.path,...manifest.dependencies.map(item=>item.path)].map(normalized));
  const systemDirectory=normalized(path.join(systemRoot,'System32'));
  function permittedModule(file){
    if(typeof file!=='string'||!path.isAbsolute(file))return false;
    const resolved=normalized(file);
    return allowedFiles.has(resolved)||path.dirname(resolved)===systemDirectory;
  }
  const moduleMap=new Map(),incomplete=[],network=[];
  let rootReadable=false;
  for(const frame of frames){
    if(frame.framesTruncated||frame.limitReached)incomplete.push('MONITOR_LIMIT_REACHED');
    for(const error of frame.sectionErrors||[])incomplete.push(error);
    for(const proc of frame.targetProcesses||[]){
      if(proc.status!=='VISIBLE')continue;
      if(proc.pid===rootPid&&proc.moduleStatus==='READ'&&!proc.modulesTruncated&&proc.modules?.length)rootReadable=true;
      if(proc.moduleStatus!=='READ'||proc.modulesTruncated)incomplete.push('MODULE_SAMPLE_INCOMPLETE:'+proc.pid);
      for(const mod of proc.modules||[]){
        const key=String(mod.path||mod.name).toLowerCase();
        if(!moduleMap.has(key))moduleMap.set(key,{name:mod.name,path:mod.path,firstSeenUtc:frame.atUtc,allowedReviewedLocation:permittedModule(mod.path),observedPids:[]});
        const entry=moduleMap.get(key);if(!entry.observedPids.includes(proc.pid))entry.observedPids.push(proc.pid);
      }
    }
  }
  if(!rootReadable)incomplete.push('NO_READABLE_ROOT_MODULE_SAMPLE');
  const canonBefore=new Set((before.canonProcesses?.items||[]).map(item=>String(item.pid)+':'+item.creationUtc));
  const newlyPresentCanon=(after.canonProcesses?.items||[]).filter(item=>!canonBefore.has(String(item.pid)+':'+item.creationUtc));
  const oldServices=new Map((before.services?.items||[]).map(item=>[item.name,item]));
  const newServices=new Map((after.services?.items||[]).map(item=>[item.name,item]));
  const serviceChanges=[...new Set([...oldServices.keys(),...newServices.keys()])].flatMap(name=>{
    const old=oldServices.get(name),item=newServices.get(name);
    return comparable(old)===comparable(item)?[]:[{name,before:old??null,after:item??null}];
  });
  const oldDevices=new Map((before.cameraDevices?.items||[]).map(item=>[item.instanceIdSha256,item]));
  const newDevices=new Map((after.cameraDevices?.items||[]).map(item=>[item.instanceIdSha256,item]));
  const cameraDeviceChanges=[...new Set([...oldDevices.keys(),...newDevices.keys()])].flatMap(id=>{
    const old=oldDevices.get(id),item=newDevices.get(id);
    return comparable(old)===comparable(item)?[]:[{instanceIdSha256:id,before:old??null,after:item??null}];
  });
  for(const snapshot of [before,after]){
    incomplete.push(...snapshot.sectionErrors||[]);
    for(const kind of ['canonProcesses','services','cameraDevices']){
      const section=snapshot[kind];
      const accepted=kind==='cameraDevices'?'PASSIVE_PNP_SNAPSHOT':'SNAPSHOT';
      if(section?.truncated||section?.status!==accepted)incomplete.push('SNAPSHOT_SECTION_INCOMPLETE:'+snapshot.phase+':'+kind);
    }
    for(const kind of ['tcp','udp']){
      const section=snapshot.network?.[kind];
      if(section?.truncated)incomplete.push('NETWORK_SAMPLE_TRUNCATED:'+kind);
      for(const item of section?.items||[])network.push({phase:snapshot.phase,kind,...item});
    }
  }
  const unexpectedModules=[...moduleMap.values()].filter(item=>!item.allowedReviewedLocation);
  const findings=[];
  if(unexpectedModules.length)findings.push('UNEXPECTED_MODULE_LOCATION');
  if(newlyPresentCanon.length)findings.push('PERSISTENT_NEW_CANON_PROCESS');
  if(serviceChanges.length)findings.push('CANON_SERVICE_STATE_CHANGED');
  if(cameraDeviceChanges.length)findings.push('CAMERA_DEVICE_STATE_CHANGED');
  if(network.length)findings.push('TARGET_NETWORK_ENDPOINT_OBSERVED');
  if(before.runtime?.sha256!==after.runtime?.sha256)findings.push('RUNTIME_CHANGED');
  const acl=value=>(value?.paths||[]).map(item=>({path:item.path?.toLowerCase(),aclSha256:item.aclSha256})).sort((a,b)=>String(a.path).localeCompare(String(b.path)));
  if(after.runtimeTrust?.status!=='REVIEWED_PROTECTED'||after.runtimeTrust.signature?.status!=='Valid'||before.runtimeTrust?.signature?.thumbprint!==after.runtimeTrust?.signature?.thumbprint||JSON.stringify(acl(before.runtimeTrust))!==JSON.stringify(acl(after.runtimeTrust)))findings.push('RUNTIME_TRUST_CHANGED_OR_UNAVAILABLE');
  return {
    scope:'Sampled user-mode evidence only. Module location does not certify module code; short-lived module, network and device effects may be missed. No kernel tracing.',
    rootPid,findings,incomplete:[...new Set(incomplete)],
    modules:[...moduleMap.values()],unexpectedModules,newlyPresentCanonProcesses:newlyPresentCanon,serviceChanges,cameraDeviceChanges,networkEndpoints:network,
    disposition:findings.length||incomplete.length?'REVIEW_REQUIRED':'NO_UNEXPECTED_EFFECT_IN_AVAILABLE_SAMPLES',
    nativeCleanup:'NOT_ESTABLISHED_BY_SNAPSHOTS'
  };
}
module.exports={review,readFrames};
