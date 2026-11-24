'use strict';
const {app,BrowserWindow,ipcMain,session}=require('electron'),path=require('node:path');
if(app.isPackaged)throw Error('Unpackaged synthetic component fixture only.');
const folder=process.argv.find(value=>value.startsWith('--fixture='))?.slice(10);if(!folder||!path.isAbsolute(folder))throw Error('Explicit isolated fixture required.');
app.setPath('userData',path.join(folder,'profile'));
let win,scenario={},calls=[],activeReads=0,maxReads=0,exportJob=null,nextOperation=0,revision=1;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const file=(index,extension='JPG')=>({id:'file-'+index,parentId:'folder',name:(index===6?'A-very-long-but-realistic-camera-file-name-to-check-truncation':'IMG_'+String(index).padStart(4,'0'))+'.'+extension,kind:'file',size:6200000,extension,date:'2026-11-21T12:00:00.000Z',thumbnailAvailable:!['MOV','BIN'].includes(extension)});
function listing({parentId=null,offset=0,limit=80}){
  const common={status:'ready',epoch:1,revision,parentId,breadcrumbs:parentId?[{id:'volume',name:'SD card'},...(parentId==='folder'?[{id:'folder',name:'100CANON'}]:[])]:[],offset};
  if(scenario.unsupported)return {...common,status:'unsupported',items:[],total:0,nextOffset:null};
  if(scenario.noStorage)return {...common,status:'no-storage',items:[],total:0,nextOffset:null};
  let items=parentId===null?[{id:'volume',name:'SD card',kind:'volume',volume:{capacity:32000000000,free:18000000000}}]:parentId==='volume'?[{id:'folder',name:'100CANON',kind:'folder'}]:scenario.empty?[]:Array.from({length:scenario.large?182:6},(_,index)=>file(index+1,['JPG','CR2','MOV','BIN','JPG','CR3'][index%6]));
  if(scenario.itemError&&parentId==='folder')items.push({id:null,kind:'unavailable',name:'Unavailable item',error:'Synthetic item metadata error',index:6},{id:null,kind:'unavailable',name:'Unavailable item',error:'Synthetic second item error',index:7});
  const total=items.length;items=items.slice(offset,offset+limit);return {...common,items,total,nextOffset:offset+items.length<total?offset+items.length:null};
}
ipcMain.handle('card-ui',async(_event,method,args={})=>{
  calls.push({method,args});
  if(method==='cardList'||method==='cardThumbnail'){
    activeReads++;maxReads=Math.max(maxReads,activeReads);
    try{await wait(scenario.slowRead?120:8);if(method==='cardList'){if(scenario.readError)throw Error('Synthetic card read error');return listing(args);}
      return args.id==='file-1'?{id:args.id,image:'data:image/jpeg;base64,'+require('../ic01/fixture-image.cjs').jpegBase64,unavailable:false}:{id:args.id,image:null,unavailable:true};
    }finally{activeReads--;}
  }
  if(method==='cardExportCancel'){if(exportJob)exportJob.cancelled=true;return {cancelled:true};}
  if(method==='cardExport'){
    if(activeReads)throw Error('Concurrent card read during export');
    if(scenario.chooserCancelled)return {status:'cancelled',files:[],failures:[],cancelled:true,remainingIds:args.ids};
    const job={operationId:'export-'+(++nextOperation),cancelled:false};exportJob=job;const files=[],failures=[];
    for(const id of args.ids){
      if(job.cancelled)break;
      win.webContents.send('card-ui-event',{type:'cardExportProgress',data:{operationId:job.operationId,total:args.ids.length,done:files.length,currentId:id,currentName:file(Number(id.split('-')[1])).name,status:'transferring'}});
      await wait(scenario.slowExport?160:15);
      if(job.cancelled)break;
      if(scenario.writeError){failures.push({id,error:'Synthetic disk write error'});break;}
      files.push({id,name:id+'.JPG',path:path.join(folder,'export',id+'.JPG'),size:6200000});
    }
    const remainingIds=args.ids.filter(id=>!files.some(file=>file.id===id));exportJob=null;
    return {operationId:job.operationId,status:job.cancelled?'cancelled':failures.length?'partial':'completed',files,failures,cancelled:job.cancelled,remainingIds};
  }
  throw Error('Unexpected synthetic operation.');
});
globalThis.__cardUi={configure:patch=>{scenario={...patch};return true;},snapshot:()=>({calls:[...calls],maxReads,activeReads,nativeCalls:0,exporting:!!exportJob}),reset:()=>{calls=[];maxReads=0;revision++;}};
app.whenReady().then(()=>{
  session.defaultSession.webRequest.onBeforeRequest({urls:['<all_urls>']},(details,callback)=>callback({cancel:/^https?:/.test(details.url)}));
  win=new BrowserWindow({width:1320,height:900,show:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.loadFile(path.join(folder,'build/tests/card-ui/index.html'));
});
app.on('window-all-closed',()=>app.quit());
