// Shared filesystem adapter. Keep image codecs and native camera modules out of boot.
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {decodeLibraryBytes}=require('./library-text.cjs');

async function readLibraryText(filename){
  return decodeLibraryBytes(await fs.readFile(filename));
}

async function atomicJSON(filename,value){
  await fs.mkdir(path.dirname(filename),{recursive:true});
  const tmp=`${filename}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp,JSON.stringify(value,null,2));
  await fs.rename(tmp,filename);
}

async function writeLibraryStore(filename,candidate){
  if(candidate.settings.captureFolder)await fs.mkdir(candidate.settings.captureFolder,{recursive:true});
  await atomicJSON(filename,candidate);
}

module.exports={readLibraryText,atomicJSON,writeLibraryStore};
