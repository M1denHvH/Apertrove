'use strict';
// Trusted launcher-only descriptor. Production main never discovers this module.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'../..');
const COMMANDS=new Set(['configure','emit','release','crash','malformed','snapshot']);
const inside=(base,file)=>{const value=path.relative(base,file);return value===''||!path.isAbsolute(value)&&value!=='..'&&!value.startsWith('..'+path.sep);};
const same=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
function reject(message){const error=Error('IC01_PROVIDER_ADMISSION: '+message);error.code='IC01_PROVIDER_ADMISSION';throw error;}
function checkedExisting(file,base,{directory=false}={}){
  if(typeof file!=='string'||!path.isAbsolute(file)||!inside(base,path.resolve(file)))reject('Explicit contained absolute path required.');
  const resolved=path.resolve(file),relative=path.relative(base,resolved);
  for(const part of [base,...relative.split(path.sep).filter(Boolean).map((_part,index,parts)=>path.join(base,...parts.slice(0,index+1)))]){
    const stat=fs.lstatSync(part);if(stat.isSymbolicLink()||!same(fs.realpathSync(part),part))reject('Aliases are not admitted.');
  }
  const stat=fs.statSync(resolved);if(directory?!stat.isDirectory():!stat.isFile())reject('Unexpected fixture path type.');
  return resolved;
}
function generation(value){if(typeof value!=='string'||!/^[A-Za-z0-9._:-]{1,96}$/.test(value))reject('Explicit worker generation required.');return value;}
function createFakeCamera(options={}){
  if(Object.keys(options).some(key=>!['app','fixtureRoot','seedFile'].includes(key)))reject('Unknown configuration.');
  const {app}=options;if(!app||app.isPackaged!==false||typeof app.getPath!=='function')reject('Only a trusted unpackaged launcher may compose the fake provider.');
  const base=path.join(ROOT,'qa','integration-candidate','fixtures');
  const fixtureRoot=checkedExisting(options.fixtureRoot,base,{directory:true});
  if(!inside(fixtureRoot,path.resolve(app.getPath('userData'))))reject('userData must be inside the admitted fixture.');
  const seedFile=checkedExisting(options.seedFile||path.join(fixtureRoot,'seed.jpg'),fixtureRoot);
  const bytes=fs.readFileSync(seedFile);
  if(bytes.length<4||bytes.length>262144||bytes.readUInt16BE(0)!==0xffd8||bytes.readUInt16BE(bytes.length-2)!==0xffd9)reject('A bounded generated JPEG seed is required.');
  const entrypoint=checkedExisting(path.join(__dirname,'fake-camera.cjs'),ROOT);
  const token=crypto.randomBytes(32).toString('hex'),scope=crypto.randomUUID();let sequence=0;
  const seedSha256=crypto.createHash('sha256').update(bytes).digest('hex');
  const sourceFiles=['tests/ic01/admission.cjs','tests/ic01/fake-camera.cjs','electron/operation-lifecycle.cjs','electron/transfer-context.cjs','electron/transfer-producer.cjs'];
  const sourceHashes=Object.fromEntries(sourceFiles.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(checkedExisting(path.join(ROOT,file),ROOT))).digest('hex')]));
  return Object.freeze({
    entrypoint,
    argsFor(value){return ['--apertrove-generation='+generation(value),'--ic01-fake-provider'];},
    envFor(value){return {NODE_OPTIONS:'',NODE_PATH:'',APERTROVE_IC01_GENERATION:generation(value),APERTROVE_IC01_FIXTURE:fixtureRoot,APERTROVE_IC01_SEED_FILE:seedFile,APERTROVE_IC01_CONTROL_TOKEN:token,APERTROVE_RECOVERY_DESTINATION:path.join(fixtureRoot,'unattributed-transfers')};},
    sendControl(worker,command,args={}){
      if(!worker||['postMessage','on','removeListener'].some(key=>typeof worker[key]!=='function'))return Promise.reject(Error('IC01_EXPLICIT_UTILITY_PROCESS_REQUIRED'));
      if(!COMMANDS.has(command)||!args||typeof args!=='object'||Array.isArray(args)||Buffer.byteLength(JSON.stringify(args))>16384||++sequence>256)return Promise.reject(Error('IC01_CONTROL_REFUSED'));
      const controlId=scope+':control:'+sequence;
      return new Promise((resolve,rejectControl)=>{
        const finish=(error,result)=>{clearTimeout(timer);worker.removeListener('message',listener);error?rejectControl(error):resolve(result);};
        const listener=message=>{if(message?.type!=='ic01-control-result'||message.controlId!==controlId)return;if(message.ok!==true)return finish(Object.assign(Error('IC01_CONTROL_FAILED'),{code:message.code||'IC01_CONTROL_FAILED'}));finish(null,message.result);};
        const timer=setTimeout(()=>finish(Error('IC01_CONTROL_DEADLINE')),2500);
        worker.on('message',listener);
        try{worker.postMessage({type:'ic01-control',controlId,token,command,args});}catch(error){finish(error);}
      });
    },
    evidence(){return {provider:'IC01_SYNTHETIC_JS_ONLY',entrypoint:'tests/ic01/fake-camera.cjs',seedSha256,seedBytes:bytes.length,sourceHashes,controlsSent:sequence,packagedMode:false,limits:{maxFiles:32,maxFileBytes:262144,maxAggregateBytes:8388608,maxControlMessages:256,hardLifetimeMs:90000},limitations:['Trusted code-level composition and sentinels, not an OS filesystem/network sandbox','No native SDK, real capture timing or RAW codec certification']};}
  });
}
module.exports={createFakeCamera};
