const path=require('node:path');
const DEV_ORIGIN='http://127.0.0.1:5173';
function frontendTarget({isPackaged,devURL,entry,distDir}){
  if(!['index.html','shot-inspector.html'].includes(entry))throw Error('Unknown frontend entry.');
  if(!isPackaged&&devURL){
    let url;
    try{url=new URL(devURL);}catch{throw Error('Invalid development frontend URL.');}
    if(url.origin!==DEV_ORIGIN||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Untrusted development frontend URL.');
    return {url:new URL(entry,url).href};
  }
  return {file:path.join(distDir,entry)};
}
function denyPermissions(session){
  session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  session.setPermissionCheckHandler(()=>false);
}
async function copyHexColor(text,writeText){
  if(typeof text!=='string'||text.length!==7||!/^#[0-9a-f]{6}$/i.test(text))throw Error('Invalid HEX color.');
  await writeText(text);return true;
}
module.exports={frontendTarget,denyPermissions,copyHexColor,DEV_ORIGIN};
