const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const exifr = require('exifr');
const {safeName}=require('./photo-name.cjs');
const EXTENSIONS = new Set(['.jpg','.jpeg','.png','.webp','.tif','.tiff','.cr2','.cr3']);
const DEFAULT_EDITS = { exposure: 0, contrast: 0, saturation: 0, warmth: 0, monochrome: false, rotation: 0 };
async function uniquePath(dir, filename) {
  const ext = path.extname(filename), stem = path.basename(filename,ext);
  for (let i=0;i<10000;i++) { const target=path.join(dir, `${stem}${i ? `_${i}` : ''}${ext}`); try { await fs.access(target); } catch { return target; } }
  throw Error('Не удалось подобрать свободное имя файла.');
}
async function atomicJSON(filename, value) {
  await fs.mkdir(path.dirname(filename), {recursive:true});
  const tmp = `${filename}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp,JSON.stringify(value,null,2));
  await fs.rename(tmp,filename);
}
async function loadJSON(filename, fallback) { try { return JSON.parse(await fs.readFile(filename,'utf8')); } catch(error) { if(error.code==='ENOENT')return fallback;throw error; } }
async function previewSource(file) {
  if (/\.cr[23]$/i.test(file)) {
    const preview = await exifr.thumbnail(file).catch(()=>null);
    if (!preview) throw Error('RAW сохранён. В нём нет доступного JPEG-превью.');
    return Buffer.from(preview);
  }
  return file;
}
function editPipeline(pipeline, input = {}) {
  const e = {...DEFAULT_EDITS,...input};
  pipeline = pipeline.autoOrient().rotate(Number(e.rotation)||0);
  if (e.monochrome) pipeline = pipeline.grayscale();
  pipeline = pipeline.modulate({brightness: 2 ** Math.max(-3, Math.min(3,Number(e.exposure)||0)), saturation: Math.max(0,1+(Number(e.saturation)||0)/100)});
  const c = Math.max(0.25, 1+(Number(e.contrast)||0)/100);
  pipeline = pipeline.linear(c,128*(1-c));
  const w = Math.max(-100, Math.min(100,Number(e.warmth)||0))/500;
  if (w) pipeline = pipeline.recomb([[1+w,0,0],[0,1,0],[0,0,1-w]]);
  return pipeline;
}
async function buildPhoto(file, cacheDir) {
  const stat = await fs.stat(file), id = crypto.createHash('sha256').update(file + stat.size + stat.mtimeMs).digest('hex').slice(0,24);
  await fs.mkdir(cacheDir,{recursive:true});
  const thumbPath=path.join(cacheDir,`${id}-thumb.jpg`), previewPath=path.join(cacheDir,`${id}-preview.jpg`);
  let metadata={}, error=null,histogram=null;
  try {
    const source = await previewSource(file);
    const info = await sharp(source).metadata();
    await sharp(source).rotate().resize(360,260,{fit:'inside',withoutEnlargement:true}).jpeg({quality:80}).toFile(thumbPath);
    await sharp(source).rotate().resize(2400,1800,{fit:'inside',withoutEnlargement:true}).jpeg({quality:90}).toFile(previewPath);
    metadata={width:info.width,height:info.height};
    const raw=await sharp(source).rotate().resize(180,120,{fit:'inside'}).removeAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject:true});
    const bins=new Array(64).fill(0);
    for(let i=0;i<raw.data.length;i+=raw.info.channels){const y=.2126*raw.data[i]+.7152*raw.data[i+1]+.0722*raw.data[i+2];bins[Math.min(63,Math.floor(y/4))]++;}
    const max=Math.max(...bins,1);histogram=bins.map(v=>Math.sqrt(v/max));
  } catch(e) { error=e.message; }
  try {
    const exif=await exifr.parse(file,{pick:['ISO','FNumber','ExposureTime','LensModel','Model','DateTimeOriginal','FocalLength']});
    if(exif) metadata={...metadata,...exif};
  } catch {}
  return {id,path:file,name:path.basename(file),size:stat.size,date:stat.mtime.toISOString(),metadata,histogram,thumbPath:error?null:thumbPath,previewPath:error?null:previewPath,previewError:error,rating:0,edits:{...DEFAULT_EDITS}};
}
async function renderEdited(photo, output, edits) {
  const source=await previewSource(photo.path);
  await editPipeline(sharp(source),edits).jpeg({quality:95,mozjpeg:true}).toFile(output);
  return output;
}
module.exports={EXTENSIONS,DEFAULT_EDITS,safeName,uniquePath,atomicJSON,loadJSON,previewSource,editPipeline,buildPhoto,renderEdited};
