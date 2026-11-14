const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const sharp=require('sharp');
const L=require('../electron/library.cjs');
test('Unicode file imports produce previews, histogram and an unchanged original',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'focal-test-'));
  try{
    const file=path.join(dir,'Свет и тень.jpg'),cache=path.join(dir,'cache');
    await sharp({create:{width:640,height:400,channels:3,background:{r:120,g:160,b:90}}}).jpeg().toFile(file);
    const before=await fs.readFile(file),photo=await L.buildPhoto(file,cache);
    assert.equal(photo.previewError,null);assert.equal(photo.metadata.width,640);assert.equal(photo.histogram.length,64);
    assert.ok((await fs.stat(photo.thumbPath)).size>0);
    const out=path.join(dir,'Экспорт.jpg');await L.renderEdited(photo,out,{exposure:1,contrast:10,saturation:-10,warmth:20,rotation:90});
    const meta=await sharp(out).metadata();assert.equal(meta.width,400);assert.equal(meta.height,640);
    assert.deepEqual(await fs.readFile(file),before);assert.notDeepEqual(await fs.readFile(out),before);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('unique filenames preserve existing files and JSON writes remain valid',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'focal-test-'));
  try{
    await fs.writeFile(path.join(dir,'IMG_0001.CR2'),'original');
    assert.equal(path.basename(await L.uniquePath(dir,'IMG_0001.CR2')),'IMG_0001_1.CR2');
    await L.atomicJSON(path.join(dir,'settings.json'),{name:'Тест'});
    await L.atomicJSON(path.join(dir,'settings.json'),{name:'Готово'});
    assert.equal((await L.loadJSON(path.join(dir,'settings.json'),{})).name,'Готово');
    assert.equal(await fs.readFile(path.join(dir,'IMG_0001.CR2'),'utf8'),'original');
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('unsupported RAW preview reports a useful failure without losing its file',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'focal-test-'));
  try{const file=path.join(dir,'test.CR2');await fs.writeFile(file,'not a raw');const p=await L.buildPhoto(file,path.join(dir,'cache'));assert.ok(p.previewError);assert.equal(p.previewPath,null);assert.equal(await fs.readFile(file,'utf8'),'not a raw');}finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('EXIF orientation is applied before an additional user rotation',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'focal-test-'));
  try{const file=path.join(dir,'portrait.jpg'),out=path.join(dir,'rotated.jpg');await sharp({create:{width:640,height:400,channels:3,background:'#8b9a77'}}).withMetadata({orientation:6}).jpeg().toFile(file);await L.renderEdited({path:file},out,{rotation:0});let meta=await sharp(out).metadata();assert.equal(meta.width,400);assert.equal(meta.height,640);await L.renderEdited({path:file},out,{rotation:90});meta=await sharp(out).metadata();assert.equal(meta.width,640);assert.equal(meta.height,400);}finally{await fs.rm(dir,{recursive:true,force:true});}
});
