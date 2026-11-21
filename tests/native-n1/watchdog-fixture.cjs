'use strict';
// Harmless synthetic child used only by the standalone watchdog tests.
// It cannot import project code, Canon EDSDK, Koffi or any native addon.
const {spawn}=require('node:child_process');
const mode=process.argv[2];
if(!process.send||!['hold','exception','grandchild','grandchild-exit-on-stop','grandchild-loop'].includes(mode))process.exit(80);
if(!process.execArgv.includes('--no-addons')||!process.env.N2_TEST_RUN_ID)process.exit(81);
let descendant=null;
function send(value){try{process.send({run:process.env.N2_TEST_RUN_ID,...value});}catch{}}
process.on('disconnect',()=>{
  // A generated descendant must stay alive long enough to test Job Object cleanup.
  // It never escapes the job and has no native Canon/Koffi path.
});
if(mode==='exception'){
  send({event:'ready'});
  process.on('message',message=>{if(message?.run===process.env.N2_TEST_RUN_ID&&message.action==='crash')setImmediate(()=>{throw Error('synthetic immediate child exception');});});
}else if(mode==='grandchild-loop'){
  send({event:'ready'});
  setInterval(()=>{},1000);
}else{
  send({event:'ready'});
  process.on('message',message=>{
    if(message?.run!==process.env.N2_TEST_RUN_ID)return;
    if(message.action==='spawn-descendant'&&['grandchild','grandchild-exit-on-stop'].includes(mode)&&!descendant){
      descendant=spawn(process.execPath,['--no-addons',__filename,'grandchild-loop'],{windowsHide:true,stdio:['ignore','ignore','ignore','ipc'],env:{SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,PATH:process.env.PATH,NODE_OPTIONS:'',NODE_PATH:'',N2_TEST_RUN_ID:process.env.N2_TEST_RUN_ID}});
      descendant.on('message',payload=>{if(payload?.event==='ready')send({event:'descendant-ready',pid:descendant.pid});});
    }else if(message.action==='exit')process.exit(Number.isInteger(message.code)?message.code:0);
    else if(message.action==='graceful-stop'&&mode==='grandchild-exit-on-stop')process.exit(0);
    // Deliberately ignore graceful requests in the hang cases.
  });
}
