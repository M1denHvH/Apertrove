const {syntheticPath}=require('./policy.cjs');
const {createHash}=require('node:crypto');
const {migrateSessions}=require('../../electron/sessions.cjs');
const file='/synthetic/s1/library.json';
const hash=text=>createHash('sha256').update(String(text)).digest('hex');
const valid=()=>({version:2,photos:[],sessions:[],presets:[],sessionId:null,settings:{}});
const legacy=()=>({version:1,sessionId:'active',settings:{captureFolder:'/synthetic/s1/capture',autofocus:false,grid:true},sessions:[{id:'active',name:'A'},{id:'old',name:'B'}],photos:[{id:'photo',path:'/synthetic/s1/old/shot.jpg',sessionId:'old',rating:5}],extra:{sentinel:'keep'}});
function memoryStore(source){
  const files=new Map([['/synthetic/s1/original.jpg','synthetic original bytes']]);if(source!==undefined)files.set(file,source);
  const io={files,writes:[],reads:0,readError:null,writeError:null,
    readText:async(target=file)=>{syntheticPath(target);io.reads++;if(io.readError)throw io.readError;if(!files.has(target))throw Object.assign(Error('missing fixture'),{code:'ENOENT'});return files.get(target);},
    writeStore:async(value,target=file)=>{syntheticPath(target);io.writes.push({target,value:JSON.parse(JSON.stringify(value))});if(io.writeError)throw io.writeError;files.set(target,JSON.stringify(value));},
    before:()=>hash(files.get(file)),original:()=>hash(files.get('/synthetic/s1/original.jpg'))};
  return io;
}
function prepared(store){return migrateSessions(store,'/synthetic/s1/sessions');}
module.exports={file,hash,valid,legacy,memoryStore,prepared};
