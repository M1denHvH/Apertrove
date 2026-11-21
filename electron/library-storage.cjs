// Shared filesystem adapter. Keep image codecs and native camera modules out of boot.
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {readPrimaryLibraryText,writeLibraryGeneration}=require('./library-recovery.cjs');
const {validateLibrary}=require('./library-schema.cjs');

async function readLibraryText(filename){
  return readPrimaryLibraryText(filename);
}

async function atomicJSON(filename,value){
  await fs.mkdir(path.dirname(filename),{recursive:true});
  const tmp=`${filename}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp,JSON.stringify(value,null,2));
  await fs.rename(tmp,filename);
}

async function writeLibraryStore(filename,candidate,options){
  if(validateLibrary(candidate).kind!=='VALID'||candidate.version!==2){const error=Error('Invalid prepared library candidate.');error.code='LIBRARY_CANDIDATE_INVALID';throw error;}
  if(candidate.settings.captureFolder)await fs.mkdir(candidate.settings.captureFolder,{recursive:true});
  return writeLibraryGeneration(filename,candidate,options);
}

module.exports={readLibraryText,atomicJSON,writeLibraryStore};
