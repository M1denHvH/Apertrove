// Bounded native-free ports for the production camera-card traversal/export code.
const path=require('node:path');
const {createCameraCard}=require('../../electron/camera-card.cjs');
function createCardFixture({seed,checked,raw,ensure,getState,getEpoch,send,sleep}){
  let scenario='normal',delayMs=35,held=0,downloads=0,bytesWritten=0;const exported=[];
  const folder=(name,children=[])=>({name,folder:1,size:0,children});
  const makeFiles=()=>Array.from({length:95},(_,index)=>{const extension=index===1?'CR3':index===2?'MP4':index===3?'BIN':'JPG';return {name:'CARD_'+String(index+1).padStart(4,'0')+'.'+extension,folder:0,size:seed.length,format:0x3801,dateTime:0,children:[],noThumbnail:index===4};});
  const volume={name:'SD',label:'SD',type:2,access:2,capacity:32000000000,free:16000000000,children:[]},root={children:[]};
  function rebuild(){volume.children=[folder('DCIM',[folder('100CANON',makeFiles()),folder('EMPTY')])];root.children=scenario==='no-storage'?[]:[volume];if(scenario==='empty')volume.children=[];}
  rebuild();
  const control=createCameraCard({
    ensure:()=>{ensure();if(getState().controlsOnly)throw Error('File transfer is disabled.');},epoch:getEpoch,camera:()=>root,connected:()=>getState().connected,qualified:()=>scenario!=='unsupported',
    count:ref=>ref.children.length,
    child:(ref,index)=>{if(scenario==='read-error')throw Error('Synthetic card read failure');if(scenario==='item-error'&&ref.name==='100CANON'&&index===1)throw Error('Synthetic directory item failure');const child=ref.children[index];if(!child)throw Error('Synthetic missing child');held++;return child;},
    retain:ref=>{held++;return ref;},release:()=>{if(--held<0)throw Error('Synthetic card reference underflow');},
    volume:ref=>ref,info:ref=>ref,
    thumbnail:ref=>{if(ref.noThumbnail||/\.(?:CR3|MP4|BIN)$/.test(ref.name))throw Error('Synthetic thumbnail unavailable');return Buffer.from(seed);},
    download:async(ref,destination,{cancelled,progress})=>{
      const folder=checked(destination);raw.mkdirSync(folder,{recursive:true});
      for(let i=0;i<4;i++){if(cancelled())throw Object.assign(Error('Synthetic export cancelled'),{code:'OPERATION_CANCELLED'});if(delayMs)await sleep(delayMs);progress(Math.floor(ref.size*(i+1)/4));}
      if(cancelled())throw Object.assign(Error('Synthetic export cancelled'),{code:'OPERATION_CANCELLED'});
      if(scenario==='write-error')throw Error('Synthetic export folder is full');
      if(downloads>=64||bytesWritten+seed.length>8388608)throw Error('Synthetic card export budget');
      const extension=path.extname(ref.name),stem=path.basename(ref.name,extension);let file;
      for(let suffix=0;suffix<100;suffix++){file=checked(path.join(folder,stem+(suffix?'_'+suffix:'')+extension));try{raw.writeFileSync(file,seed,{flag:'wx'});break;}catch(error){if(error.code!=='EEXIST')throw error;file=null;}}
      if(!file)throw Error('Synthetic name conflicts');downloads++;bytesWritten+=seed.length;exported.push(file);return {path:file,size:seed.length};
    },yield:()=>sleep(0),progress:data=>send({event:'cardExportProgress',data})
  });
  return {list:args=>control.list(args),thumbnail:args=>control.thumbnail(args),export:(args,operation)=>control.export(args,operation),
    configure(args={}){if(args.cardScenario!==undefined){if(!['normal','no-storage','empty','unsupported','read-error','item-error','write-error'].includes(args.cardScenario))throw Error('Invalid synthetic card scenario');scenario=args.cardScenario;rebuild();control.reset();}if(args.cardDelayMs!==undefined){if(!Number.isInteger(args.cardDelayMs)||args.cardDelayMs<0||args.cardDelayMs>1000)throw Error('Invalid synthetic card delay');delayMs=args.cardDelayMs;}},
    snapshot:()=>({scenario,delayMs,referencesHeld:held,downloads,bytesWritten,exported:[...exported],...control.stats()})};
}
module.exports={createCardFixture};
