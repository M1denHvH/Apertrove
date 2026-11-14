const fs=require('node:fs/promises');const path=require('node:path');const exifr=require('exifr');const sharp=require('sharp');
function serializable(value,seen=new WeakSet(),includeBinary=true){
  if(value===undefined)return null;if(value===null||typeof value==='string'||typeof value==='boolean')return value;
  if(typeof value==='number')return Number.isFinite(value)?value:String(value);if(typeof value==='bigint')return value.toString();
  if(value instanceof Date)return Number.isNaN(value.getTime())?String(value):value.toISOString();
  if(Buffer.isBuffer(value)||ArrayBuffer.isView(value)){const bytes=Buffer.from(value.buffer,value.byteOffset,value.byteLength);return {type:'binary',bytes:bytes.length,...(includeBinary?{base64:bytes.toString('base64')}:{})};}
  if(typeof value==='object'){if(seen.has(value))return '[circular]';seen.add(value);const result=Array.isArray(value)?value.map(v=>serializable(v,seen,includeBinary)):Object.fromEntries(Object.entries(value).map(([key,v])=>[key,serializable(v,seen,includeBinary)]));seen.delete(value);return result;}
  return String(value);
}
async function readMetadata(file,{includeBinary=true}={}){
  const stat=await fs.stat(file),result={file:{name:path.basename(file),bytes:stat.size,modified:stat.mtime.toISOString()},metadata:{},errors:[]};
  try{result.metadata=serializable(await exifr.parse(file,{tiff:true,exif:true,gps:true,interop:true,ifd1:true,xmp:true,iptc:true,icc:true,jfif:true,ihdr:true,makerNote:true,userComment:true,mergeOutput:false,translateKeys:true,translateValues:true,reviveValues:true})||{},new WeakSet(),includeBinary);}catch(error){result.errors.push(`EXIF/IPTC/XMP: ${error.message}`);}
  try{const info=await sharp(file,{failOn:'none'}).metadata();for(const key of ['format','width','height','space','channels','depth','density','chromaSubsampling','isProgressive','isPalette','bitsPerSample','pages','pageHeight','loop','delay','hasProfile','hasAlpha','orientation'])if(info[key]!==undefined)result.file[key]=serializable(info[key]);}catch(error){result.errors.push(`Декодер изображения: ${error.message}`);}
  return result;
}
module.exports={readMetadata,serializable};
