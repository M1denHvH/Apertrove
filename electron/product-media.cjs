const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const sharp=require('sharp');
const {loadProduct,safeUrl}=require('./equipment.cjs');
function clearBackground(data,width,height){
  const visited=new Uint8Array(width*height),queue=new Int32Array(width*height);let head=0,tail=0;
  const add=index=>{if(visited[index])return;visited[index]=1;const offset=index*4,r=data[offset],g=data[offset+1],b=data[offset+2];if(Math.min(r,g,b)<219||Math.max(r,g,b)-Math.min(r,g,b)>28)return;queue[tail++]=index;};
  for(let x=0;x<width;x++){add(x);add((height-1)*width+x);}for(let y=0;y<height;y++){add(y*width);add(y*width+width-1);}
  while(head<tail){const index=queue[head++],x=index%width,y=Math.floor(index/width),offset=index*4,light=Math.min(data[offset],data[offset+1],data[offset+2]);data[offset+3]=Math.min(data[offset+3],Math.round(255*(1-Math.min(1,Math.max(0,(light-219)/28)))));if(x)add(index-1);if(x+1<width)add(index+1);if(y)add(index-width);if(y+1<height)add(index+width);}
  return data;
}
const pending=new Map();
async function productMedia(kind,name,cache,fetcher=fetch){
  const id=crypto.createHash('sha256').update(`front-v1:${kind}:${name}`).digest('hex'),folder=path.join(cache,'equipment'),file=path.join(folder,`${id}.png`),meta=path.join(folder,`${id}.json`);
  try{const stored=JSON.parse(await fs.readFile(meta,'utf8'));if(Date.now()-stored.timestamp<30*86400000){await fs.access(file);return {...stored,image:file};}}catch{}
  if(pending.has(id))return pending.get(id);
  const task=(async()=>{
    const product=await loadProduct(kind,name,fetcher);let url=product.image,response;
    for(let redirects=0;redirects<4;redirects++){if(!safeUrl(url,product.source,true))throw Error('Недопустимый адрес изображения.');response=await fetcher(url,{redirect:'manual',signal:AbortSignal.timeout(12000)});if([301,302,303,307,308].includes(response.status)){url=safeUrl(response.headers.get('location'),url,true);continue;}break;}
    if(!response?.ok||!response.headers.get('content-type')?.startsWith('image/'))throw Error('Изображение недоступно.');
    const reader=response.body.getReader(),chunks=[];let length=0;
    try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>8*1024*1024)throw Error('Изображение слишком большое.');chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
    const {data,info}=await sharp(Buffer.concat(chunks),{limitInputPixels:32*1024*1024}).rotate().resize({width:1000,height:700,fit:'inside',withoutEnlargement:true}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    await fs.mkdir(folder,{recursive:true});await sharp(clearBackground(data,info.width,info.height),{raw:{width:info.width,height:info.height,channels:4}}).trim({threshold:4}).png().toFile(file);
    const stored={...product,image:undefined,timestamp:Date.now()};await fs.writeFile(meta,JSON.stringify(stored));return {...stored,image:file};
  })();pending.set(id,task);try{return await task;}finally{pending.delete(id);}
}
module.exports={productMedia,clearBackground};
