'use strict';
// Copies only the pinned stock Electron runtime already installed by npm ci.
// Never downloads Canon files, opens the SDK, or replaces prior admission data.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),version='45.3.2',expected='7ae7a76540172dba12a731974dac752be374ca1c35b3d0833ce7db60a07c8a3d';
if(process.platform!=='win32'||process.arch!=='x64')throw Error('Windows x64 is required.');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const runtimeRoot=path.join(root,'qa/integration-candidate/runtime'),record=path.join(runtimeRoot,'admission.json');
if(fs.existsSync(record)){
 const existing=JSON.parse(fs.readFileSync(record,'utf8').replace(/^\uFEFF/,''));
 const relative=path.relative(runtimeRoot,existing.binary.path);
 if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||existing.version!==version||existing.architecture!=='x64'||existing.binary.sha256!==expected||hash(existing.binary.path)!==expected)throw Error('Existing admission differs. Preserve it and review manually.');
 console.log('Verified existing pinned UI runtime; no files replaced.');
}else{
 const pkg=JSON.parse(fs.readFileSync(path.join(root,'node_modules/electron/package.json'),'utf8'));
 if(pkg.version!==version)throw Error('Installed Electron version differs from the reviewed runtime.');
 const source=path.join(root,'node_modules/electron/dist'),binary=path.join(source,'electron.exe');
 if(hash(binary)!==expected)throw Error('Installed Electron bytes differ from the reviewed runtime.');
 const destination=path.join(runtimeRoot,'electron-v'+version+'-win32-x64');
 if(fs.existsSync(destination))throw Error('A runtime directory already exists. Preserve and review it before preparing admission.');
 fs.mkdirSync(runtimeRoot,{recursive:true});fs.cpSync(source,destination,{recursive:true,errorOnExist:true,force:false});
 const output=path.join(destination,'electron.exe');if(hash(output)!==expected)throw Error('Copied runtime hash differs.');
 fs.writeFileSync(record,JSON.stringify({version,architecture:'x64',binary:{path:output,sha256:expected},authenticode:{status:'NotSigned'},provenance:'Pinned stock Electron installed by npm ci, hash verified; no Canon code loaded'},null,2)+'\n',{flag:'wx'});
 console.log('Prepared pinned UI runtime. Run npm run test:ui:controls after npm run build.');
}
