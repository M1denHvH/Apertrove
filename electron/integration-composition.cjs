// Main-only, one-shot composition. No environment/renderer/LAN selector exists.
// Packaged applications can never install or consume integration ports.
const {app}=require('electron');
const fs=require('node:fs'),path=require('node:path');
let pending=null,consumed=false;
const inside=(root,file)=>{const relative=path.relative(root,file);return relative===''||!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep);};
function install(ports){
  if(app.isPackaged||consumed||pending)throw Error('Integration composition is unavailable.');
  if(!ports||typeof ports!=='object'||Object.keys(ports).some(key=>!['fixtureRoot','dataFolder','camera','flash','onWorker','onReady','requestTimeoutMs'].includes(key)))throw Error('Unknown integration configuration.');
  const base=path.resolve(__dirname,'../qa/integration-candidate/fixtures'),root=fs.realpathSync(ports.fixtureRoot);
  if(!inside(base,root)||root===base||path.resolve(ports.fixtureRoot)!==root)throw Error('Confined integration fixture required.');
  for(let p=root;;p=path.dirname(p)){if(fs.lstatSync(p).isSymbolicLink())throw Error('Fixture aliases are not admitted.');if(p===path.parse(p).root)break;}
  if(!inside(root,fs.realpathSync(ports.dataFolder))||path.resolve(ports.camera?.entrypoint||'')!==path.resolve(__dirname,'../tests/ic01/fake-camera.cjs'))throw Error('Exact fake provider and profile required.');
  if(!ports.flash||['createFlashBridge','withFlashConnection','flashAvailability'].some(key=>typeof ports.flash[key]!=='function')||['onWorker','onReady','requestTimeoutMs'].some(key=>typeof ports[key]!=='function')||['argsFor','envFor'].some(key=>typeof ports.camera[key]!=='function'))throw Error('Explicit integration ports required.');
  pending=Object.freeze({...ports,camera:Object.freeze(ports.camera),flash:Object.freeze(ports.flash)});
}
function consume(){if(consumed)throw Error('Application composition already consumed.');consumed=true;if(pending&&app.isPackaged)throw Error('Packaged integration mode is forbidden.');const ports=pending;pending=null;return ports;}
module.exports={install,consume};
