'use strict';
// Reuses N2's read-only byte/PE admission, not its executable lifecycle entrypoint.
const fs=require('node:fs'),path=require('node:path');
const base=require('../native-n1/manifest.cjs');
const root=path.resolve(__dirname,'../..');
const files=['tests/native-hardware/manifest.cjs','tests/native-hardware/prepare.cjs','tests/native-hardware/run.cjs','tests/native-hardware/worker.cjs','tests/native-hardware/h1a-lifecycle.cjs'];
const allowed=['EdsInitializeSDK','EdsGetCameraList','EdsGetChildCount','EdsRelease','EdsTerminateSDK'];
function validate(manifest,{execute=false}={}){
  if(manifest?.schema!==1||manifest.purpose!=='H1A_CAMERA_COUNT_ONLY'||JSON.stringify(manifest.allowedCanonCalls)!==JSON.stringify(allowed))throw Error('H1A_MANIFEST_SCOPE_DENIED');
  if(manifest.abiReview?.status!=='DOCUMENTED_ARCHIVAL_CORROBORATED'||manifest.abiReview.pointerBytes!==8||manifest.abiReview.uint32Bytes!==4||manifest.abiReview.noStructOutputs!==true)throw Error('H1A_ABI_REVIEW_REQUIRED');
  for(const name of files)if(manifest.harness?.[name]!==base.sha(fs.readFileSync(path.join(root,name))))throw Error('H1A_HARNESS_IDENTITY_MISMATCH: '+name);
  const admission=base.validate(manifest.baseAdmission,{execute});
  for(const name of allowed)if(!admission.dll.exports.includes(name))throw Error('H1A_REQUIRED_EXPORT_MISSING: '+name);
  return {...admission,runtimeObservations:{dynamicDependencies:'NOT_RUN',initializationEffects:'NOT_RUN',cameraEnumeration:'NOT_RUN'}};
}
module.exports={root,files,allowed,sha:base.sha,validate};
