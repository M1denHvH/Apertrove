'use strict';
// Read-only admission. This module never imports Koffi or loads a DLL.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..');
const files=['tests/native-n1/manifest.cjs','tests/native-n1/prepare.cjs','tests/native-n1/run.cjs','tests/native-n1/worker.cjs'];
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function requireValue(ok,code){if(!ok)throw Error(code);}
function ordinary(file){
  requireValue(typeof file==='string'&&path.isAbsolute(file),'ABSOLUTE_PATH_REQUIRED');
  const real=fs.realpathSync(file),stat=fs.statSync(real);
  requireValue(stat.isFile()&&stat.size>0&&stat.size<=128*1024*1024,'INVALID_FILE');
  return real;
}
function inspect(file){
  const real=ordinary(file),b=fs.readFileSync(real);
  requireValue(b.length>=64&&b.toString('ascii',0,2)==='MZ','INVALID_PE');
  const pe=b.readUInt32LE(60);requireValue(pe+24<=b.length&&b.readUInt32LE(pe)===0x4550,'INVALID_PE');
  const sections=b.readUInt16LE(pe+6),optional=b.readUInt16LE(pe+20),opt=pe+24;
  requireValue(b.readUInt16LE(pe+4)===0x8664&&b.readUInt16LE(opt)===0x20b,'X64_PE_REQUIRED');
  requireValue(sections>0&&sections<=96&&opt+optional+sections*40<=b.length,'INVALID_PE_SECTIONS');
  function rva(value){
    for(let i=0;i<sections;i++){const p=opt+optional+i*40,size=b.readUInt32LE(p+16),va=b.readUInt32LE(p+12),raw=b.readUInt32LE(p+20);if(value>=va&&value<va+size){const offset=raw+value-va;requireValue(offset<b.length,'INVALID_PE_RVA');return offset;}}
    throw Error('UNMAPPED_PE_RVA');
  }
  function string(offset){const end=b.indexOf(0,offset);requireValue(end>=offset&&end-offset<=512,'INVALID_PE_STRING');return b.toString('ascii',offset,end);}
  const exportRva=b.readUInt32LE(opt+112),exports=[];
  if(exportRva){const p=rva(exportRva);requireValue(p+40<=b.length,'INVALID_PE_EXPORTS');const count=b.readUInt32LE(p+24),names=rva(b.readUInt32LE(p+32));requireValue(count<=20000&&names+count*4<=b.length,'INVALID_PE_EXPORTS');for(let i=0;i<count;i++)exports.push(string(rva(b.readUInt32LE(names+i*4))));}
  return {path:real,sha256:sha(b),bytes:b.length,machine:'x64',exports};
}
function validate(manifest,{execute=false}={}){
  requireValue(process.platform==='win32'&&process.arch==='x64','WINDOWS_X64_REQUIRED');
  requireValue(!process.env.NODE_OPTIONS&&!process.env.NODE_PATH,'PRELOAD_ENV_DENIED');
  requireValue(manifest?.schema===1&&manifest.purpose==='N2_INIT_TERMINATE_ONLY','MANIFEST_SCHEMA_DENIED');
  requireValue(manifest.node?.path===process.execPath&&manifest.node.sha256===sha(fs.readFileSync(process.execPath)),'NODE_IDENTITY_MISMATCH');
  for(const name of files)requireValue(manifest.harness?.[name]===sha(fs.readFileSync(path.join(root,name))),'HARNESS_IDENTITY_MISMATCH');
  const dll=inspect(manifest.runtime?.path);requireValue(dll.sha256===manifest.runtime.sha256,'RUNTIME_HASH_MISMATCH');
  for(const name of ['EdsInitializeSDK','EdsTerminateSDK'])requireValue(dll.exports.includes(name),'MISSING_LIFECYCLE_EXPORT');
  const addon=inspect(manifest.koffi?.path);requireValue(addon.sha256===manifest.koffi.sha256&&manifest.koffi.version==='2.16.3'&&path.basename(addon.path)==='koffi.node','KOFFI_IDENTITY_MISMATCH');
  const directory=fs.realpathSync(path.dirname(dll.path));
  requireValue(Array.isArray(manifest.dependencies)&&manifest.dependencies.length>0&&manifest.dependencies.length<=128,'DEPENDENCY_MANIFEST_REQUIRED');
  const seen=new Set();
  for(const item of manifest.dependencies){const entry=inspect(item.path);requireValue(path.dirname(entry.path).toLowerCase()===directory.toLowerCase()&&entry.sha256===item.sha256&&!seen.has(entry.path.toLowerCase()),'DEPENDENCY_IDENTITY_MISMATCH');seen.add(entry.path.toLowerCase());}
  const actual=fs.readdirSync(directory).filter(name=>/\.dll$/i.test(name)).map(name=>fs.realpathSync(path.join(directory,name)).toLowerCase());
  requireValue(actual.length===seen.size&&actual.every(name=>seen.has(name))&&seen.has(dll.path.toLowerCase()),'DLL_DIRECTORY_CHANGED');
  requireValue(manifest.reference?.path&&manifest.reference.sha256===sha(fs.readFileSync(ordinary(manifest.reference.path))),'REFERENCE_REQUIRED');
  const blockers=[];
  if(!['CONFIRMED_MATCH','VERIFIED_LIFECYCLE_SUBSET'].includes(manifest.vendorReview?.status))blockers.push('MATCHING_VENDOR_LIFECYCLE_REVIEW_REQUIRED');
  if(manifest.vendorReview?.initSuccessRequiresTerminate!==true||manifest.vendorReview?.initFailureMustNotTerminate!==true||!manifest.vendorReview?.evidence)blockers.push('LIFECYCLE_ORDER_REVIEW_REQUIRED');
  if(manifest.dependencyReview?.status!=='REVIEWED'||!manifest.dependencyReview?.evidence)blockers.push('DEPENDENCY_CLOSURE_REVIEW_REQUIRED');
  if(manifest.koffi.reviewed!==true)blockers.push('NATIVE_ADDON_REVIEW_REQUIRED');
  if(manifest.safetyReview?.initializationEffectsReviewed!==true||!manifest.safetyReview?.evidence)blockers.push('INITIALIZATION_EFFECTS_REVIEW_REQUIRED');
  if(execute)requireValue(!blockers.length,'N2_NOT_QUALIFIED: '+blockers.join(', '));
  return {dll,addon,directory,blockers,ready:blockers.length===0};
}
module.exports={root,files,sha,inspect,validate};
