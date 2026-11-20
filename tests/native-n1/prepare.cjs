'use strict';
// Creates an UNQUALIFIED local manifest from explicitly selected files. No load.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {root,files,sha,inspect}=require('./manifest.cjs');
try{
  const args=process.argv.slice(2);
  if(args.length!==6||args[0]!=='--runtime'||args[2]!=='--koffi'||args[4]!=='--reference'||!process.execArgv.includes('--no-addons')||process.env.NODE_OPTIONS||process.env.NODE_PATH)throw Error('USAGE: node --no-addons prepare.cjs --runtime <absolute DLL> --koffi <absolute koffi.node> --reference <absolute vendor PDF>');
  const runtime=inspect(args[1]),koffi=inspect(args[3]);
  if(!path.isAbsolute(args[5]))throw Error('ABSOLUTE_REFERENCE_REQUIRED');
  const reference=fs.realpathSync(args[5]),directory=path.dirname(runtime.path);
  const manifest={schema:1,purpose:'N2_INIT_TERMINATE_ONLY',node:{path:process.execPath,sha256:sha(fs.readFileSync(process.execPath))},harness:Object.fromEntries(files.map(file=>[file,sha(fs.readFileSync(path.join(root,file)))])),runtime:{path:runtime.path,sha256:runtime.sha256},koffi:{path:koffi.path,sha256:koffi.sha256,version:'2.16.3',reviewed:false},dependencies:fs.readdirSync(directory).filter(name=>/\.dll$/i.test(name)).sort().map(name=>{const p=inspect(path.join(directory,name));return {path:p.path,sha256:p.sha256};}),reference:{path:reference,sha256:sha(fs.readFileSync(reference))},vendorReview:{status:'UNKNOWN',initSuccessRequiresTerminate:false,initFailureMustNotTerminate:false,evidence:''},dependencyReview:{status:'UNKNOWN',evidence:''},safetyReview:{initializationEffectsReviewed:false,evidence:''}};
  const output=path.join(root,'qa','native-n2-prep','n2-manifest-'+crypto.randomUUID()+'.json');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({manifest:output,status:'UNQUALIFIED',nativeLoaded:false}));
}catch(error){console.error(error.message);process.exitCode=2;}
