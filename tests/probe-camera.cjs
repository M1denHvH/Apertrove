const {fork}=require('node:child_process');
const path=require('node:path');
const child=fork(path.join(__dirname,'../electron/camera-worker.cjs'),[],{stdio:['ignore','pipe','pipe','ipc']});
const timeout=setTimeout(()=>{child.kill();process.exitCode=1;console.error('Camera probe timed out');},20000);
child.stdout.on('data',d=>process.stdout.write(d));child.stderr.on('data',d=>process.stderr.write(d));
child.on('message',m=>{
  if(m.event==='ready')child.send({id:1,method:'connect',args:{folder:path.join(__dirname,'../test-captures')}});
  if(m.id===1){console.log(JSON.stringify(m,null,2));child.send({id:2,method:'shutdown'});}
  if(m.event==='shutdown')clearTimeout(timeout);
});
child.on('exit',code=>{clearTimeout(timeout);if(code)process.exitCode=code;});
