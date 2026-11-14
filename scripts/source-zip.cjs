// A small dependency-free ZIP writer (stored entries, UTF-8 names). Source only.
const fs=require('node:fs');
const path=require('node:path');
const {ROOT}=require('./source-files.cjs');
const {preflight}=require('./preflight.cjs');
const table=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes)crc=table[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
function zip(files){
  const local=[],central=[];let offset=0;
  for(const file of files){
    const name=Buffer.from(`Apertrove/${file}`),bytes=fs.readFileSync(path.join(ROOT,file)),crc=crc32(bytes);
    const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(33,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(bytes.length,18);header.writeUInt32LE(bytes.length,22);header.writeUInt16LE(name.length,26);
    local.push(header,name,bytes);
    const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt16LE(0x800,8);entry.writeUInt16LE(33,14);entry.writeUInt32LE(crc,16);entry.writeUInt32LE(bytes.length,20);entry.writeUInt32LE(bytes.length,24);entry.writeUInt16LE(name.length,28);entry.writeUInt32LE(offset,42);central.push(entry,name);offset+=header.length+name.length+bytes.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,directory,end]);
}
const files=preflight(),target=path.join(ROOT,'artifacts');fs.mkdirSync(target,{recursive:true});
if(process.argv.includes('--stage')){
  // Reuse a reviewed export only if every byte still matches the public sources.
  // Never remove or overwrite an existing staging tree automatically.
  const stage=path.join(target,'github-upload');
  if(fs.existsSync(stage)){
    const actual=[];
    function walk(directory=''){
      for(const item of fs.readdirSync(path.join(stage,directory),{withFileTypes:true})){
        if(directory===''&&item.name==='.git')continue;
        const relative=directory?`${directory}/${item.name}`:item.name;
        if(item.isSymbolicLink())throw Error(`Staged symlink: ${relative}`);
        if(item.isDirectory())walk(relative);else actual.push(relative);
      }
    }
    walk();
    if(JSON.stringify(actual.sort())!==JSON.stringify(files))throw Error('Staged file list differs. Review/rename artifacts/github-upload before preparing a fresh export.');
    for(const file of files)if(!fs.readFileSync(path.join(ROOT,file)).equals(fs.readFileSync(path.join(stage,file))))throw Error(`Staged source differs: ${file}. Review/rename the existing export before preparing a fresh one.`);
    console.log(`Verified reviewed export: ${files.length} files in artifacts/github-upload`);
  }else{
    for(const file of files){const dest=path.join(stage,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(ROOT,file),dest,fs.constants.COPYFILE_EXCL);}
    console.log(`Staged ${files.length} files in artifacts/github-upload`);
  }
}else{
  const file=path.join(target,'Apertrove-github-ready.zip');fs.writeFileSync(file,zip(files));console.log(`Created artifacts/${path.basename(file)} (${files.length} files)`);
}
