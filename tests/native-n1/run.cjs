'use strict';
// Parent stays addon-free; only a separately authorized dedicated child is native.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {root,sha,validate}=require('./manifest.cjs');
async function main(){
  const args=process.argv.slice(2),mode=args.shift();
  if(!['--dry-run','--execute'].includes(mode)||args.shift()!=='--manifest')throw Error('USAGE: run.cjs --dry-run|--execute --manifest <absolute JSON> [--authorize-native-n2 --camera-disconnected]');
  const file=args.shift(),execute=mode==='--execute';
  if(args.join(' ')!==(execute?'--authorize-native-n2 --camera-disconnected':''))throw Error('EXPLICIT_N2_AUTHORIZATION_REQUIRED');
  if(!path.isAbsolute(file||'')||fs.statSync(file).size>256*1024)throw Error('INVALID_MANIFEST_PATH');
  if(!process.execArgv.includes('--no-addons')||process.execArgv.some(a=>!['--no-addons','--max-old-space-size=192'].includes(a)))throw Error('ADDON_FREE_PARENT_REQUIRED');
  const bytes=fs.readFileSync(file),manifest=JSON.parse(bytes),admission=validate(manifest,{execute});
  const summary={mode:execute?'N2_NATIVE':'N1_DRY_RUN',manifestSha256:sha(bytes),runtimeSha256:admission.dll.sha256,ready:admission.ready,blockers:admission.blockers,nativeLoaded:false,expectedBoundary:'one Node x64 child, one init, terminate only after init=0; 15s external watchdog; no retries, enumeration or camera operations'};
  if(!execute){console.log(JSON.stringify(summary,null,2));return;}
  const output=path.join(root,'qa','native-n1','n2-runs',crypto.randomUUID());fs.mkdirSync(output,{recursive:true});
  for(const name of ['temp','profile'])fs.mkdirSync(path.join(output,name));
  const nonce=crypto.randomBytes(24).toString('hex');
  const system=process.env.SystemRoot;if(!system||!path.isAbsolute(system))throw Error('SYSTEM_ROOT_REQUIRED');
  const env={SystemRoot:system,WINDIR:system,PATH:path.join(system,'System32'),TEMP:path.join(output,'temp'),TMP:path.join(output,'temp'),APPDATA:path.join(output,'profile'),LOCALAPPDATA:path.join(output,'profile'),NODE_OPTIONS:'',NODE_PATH:'',APERTROVE_N2_NONCE:nonce};
  // This import/spawn is unreachable in dry-run or with failed vendor admission.
  const {spawn}=require('node:child_process');
  const child=spawn(process.execPath,['--max-old-space-size=128',path.join(__dirname,'worker.cjs'),'--native-worker',nonce],{cwd:output,env,windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});
  summary.pid=child.pid;summary.nativeResult='UNKNOWN';let timedOut=false,count=0,stderrBytes=0;
  const result=await new Promise(resolve=>{
    let finished=false;
    const finish=value=>{if(finished)return;finished=true;clearTimeout(watchdog);clearTimeout(exitBound);resolve(value);};
    const watchdog=setTimeout(()=>{timedOut=true;summary.killRequested=child.kill();},15000);
    const exitBound=setTimeout(()=>{timedOut=true;child.kill();if(child.connected)child.disconnect();child.stderr.destroy();child.unref();finish({code:null,signal:null,processEnded:false});},17000);
    child.on('message',message=>{if(++count>12){child.kill();return;}if(message?.type==='ready'&&message.nonce===nonce)child.send({nonce,manifest,manifestSha256:sha(bytes)});else if(message?.type==='result'&&message.nonce===nonce)summary.receipt=message.receipt;});
    child.stderr.on('data',chunk=>{stderrBytes+=chunk.length;if(stderrBytes>8192)child.kill();});
    child.on('error',error=>{summary.spawnError=error.code;});
    child.on('close',(code,signal)=>finish({code,signal,processEnded:true}));
  });
  Object.assign(summary,{...result,timedOut,stderrBytes,nativeLoaded:summary.receipt?.nativeLoaded??'UNKNOWN'});
  const r=summary.receipt;
  if(!timedOut&&result.code===0&&r?.initialize===0&&r?.terminate===0&&r?.unloaded===true&&r?.comBalanced===true)summary.nativeResult='SOURCE_ZERO_CYCLE';
  summary.limitations='Process exit is observed; independent OS handle/DLL-loader tracing and vendor-internal cleanup are not proven.';
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({...summary,output},null,2));if(summary.nativeResult!=='SOURCE_ZERO_CYCLE')process.exitCode=1;
}
main().catch(error=>{console.error(error.message);process.exitCode=2;});
