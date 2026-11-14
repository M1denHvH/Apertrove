const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');const sharp=require('sharp');
const {readMetadata,serializable}=require('../electron/metadata.cjs');
test('Full metadata reading includes author and copyright while leaving the original unchanged',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'apertrove-meta-')),file=path.join(dir,'rights.jpg');
  try{await sharp({create:{width:160,height:120,channels:3,background:'#6f7d89'}}).withExif({IFD0:{Artist:'Apertrove QA',Copyright:'Apertrove test rights'}}).jpeg().toFile(file);const before=await fs.readFile(file),result=await readMetadata(file);assert.equal(result.file.width,160);assert.ok(JSON.stringify(result.metadata).includes('Apertrove QA'));assert.ok(JSON.stringify(result.metadata).includes('Apertrove test rights'));assert.deepEqual(await fs.readFile(file),before);}finally{await fs.unlink(file).catch(()=>{});await fs.rmdir(dir);}
});
test('Binary metadata remains exportable instead of being silently discarded',()=>{const result=serializable({data:Buffer.from([0,1,255]),large:123n,date:new Date('2026-10-25T21:00:00Z')});assert.equal(result.data.base64,'AAH/');assert.equal(result.data.bytes,3);assert.equal(result.large,'123');assert.equal(result.date,'2026-10-25T21:00:00.000Z');});
