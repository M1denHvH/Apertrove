'use strict';
// Creates a private H1A-only manifest; no native module or SDK is loaded.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const base=require('../native-n1/manifest.cjs');
const {root,files,allowed,sha,validate}=require('./manifest.cjs');
try{
  const args=process.argv.slice(2);
  if(args.length!==2||args[0]!=='--base-manifest'||!path.isAbsolute(args[1])||!process.execArgv.includes('--no-addons')||process.env.NODE_OPTIONS||process.env.NODE_PATH)throw Error('USAGE: node --no-addons prepare.cjs --base-manifest <absolute reviewed N2 JSON>');
  const bytes=fs.readFileSync(args[1]),native=JSON.parse(bytes),previousRoot=path.resolve(path.dirname(args[1]),'../..');
  const equivalence=[];
  for(const file of base.files){
    const current=fs.readFileSync(path.join(root,file)),currentSha=sha(current),pinned=native.harness[file];
    if(currentSha!==pinned){const previous=fs.readFileSync(path.join(previousRoot,file));if(sha(previous)!==pinned||!Buffer.from(current.toString('utf8').replace(/\r\n/g,'\n')).equals(Buffer.from(previous.toString('utf8').replace(/\r\n/g,'\n'))))throw Error('BASE_HARNESS_CONTENT_CHANGED: '+file);}
    equivalence.push({file,previousSha256:pinned,currentSha256:currentSha,difference:currentSha===pinned?'IDENTICAL_BYTES':'CRLF_LF_ONLY'});native.harness[file]=currentSha;
  }
  const manifest={schema:1,purpose:'H1A_CAMERA_COUNT_ONLY',allowedCanonCalls:allowed,baseManifest:{path:fs.realpathSync(args[1]),sha256:sha(bytes)},baseAdmission:native,sourceEquivalence:equivalence,harness:Object.fromEntries(files.map(file=>[file,sha(fs.readFileSync(path.join(root,file)))])),abiReview:{status:'DOCUMENTED_ARCHIVAL_CORROBORATED',pointerBytes:8,uint32Bytes:4,noStructOutputs:true,evidence:[
    'Canon API Reference 13.20.11 pp39-43; lifecycle, CameraList output, ChildCount, owned list and Release sentinel',
    'https://learn.microsoft.com/en-us/cpp/build/x64-software-conventions?view=msvc-170',
    'https://learn.microsoft.com/en-us/cpp/cpp/stdcall?view=msvc-170',
    'Historical Canon-derived Windows2.11 EDSDKTypes.h blob18a7f8ec0de10bb55a533ab95bc71491b2cd15c9 in samizzo/canon-tweet; not matching official PSE headers',
    'Historical ofxEdsdk EDSDKTypes.h blobf69d1c44bc15da1688c8c02ec1f84785b4e4244a and EDSDK.h blob6a1eec37a6740c61dbd5523180e58573ce5f1afe; corroborating declarations only',
    'https://koffi.dev/output; exact scalar output and opaque pointer-to-pointer marshalling'
  ]}};
  const admission=validate(manifest);if(!admission.ready)throw Error('BASE_ADMISSION_NOT_READY: '+admission.blockers.join(','));
  const directory=path.join(root,'qa/native-hardware');fs.mkdirSync(directory,{recursive:true});const output=path.join(directory,'h1a-manifest-'+crypto.randomUUID()+'.json');fs.writeFileSync(output,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({manifest:output,sha256:sha(fs.readFileSync(output)),ready:true,nativeLoaded:false,authorization:'NOT_GRANTED'}));
}catch(error){console.error(error.message);process.exitCode=2;}
