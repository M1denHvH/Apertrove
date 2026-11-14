// EDSDK ImageQuality packs primary/secondary image size, type and compression.
const sizes={0:'L',1:'M',2:'S',5:'M1',6:'M2',14:'S1',15:'S2',16:'S3'};
function component(code){
  if(code===0xff0f||code===0xffff)return null;
  const size=code>>>8,type=(code>>>4)&15,quality=code&15;
  if(type===6)return `${({0:'RAW',1:'M-RAW',2:'S-RAW'})[size]||'RAW'}${quality===3?' · C-RAW':''}`;
  const format=type===1?'JPEG':type===8?'HEIF':null;
  if(!format)return null;
  return `${format} ${sizes[size]||size}${quality===3?' · Fine':quality===2?' · Normal':''}`;
}
function imageQualityLabel(value){
  if(!Number.isInteger(value)||value===0xffffffff)return undefined;
  const primary=component(value>>>16),secondary=component(value&0xffff);
  return primary?[primary,secondary].filter(Boolean).join(' + '):undefined;
}
const IMAGE_QUALITIES=[];
for(const [size,label] of Object.entries(sizes))for(const quality of [3,2])IMAGE_QUALITIES.push({value:((Number(size)<<24)|((0x10|quality)<<16)|0xff0f)>>>0,label:`JPEG ${label} · ${quality===3?'Fine':'Normal'}`});
for(const raw of [0x0064,0x0164,0x0264,0x0063]){
  const name=component(raw);IMAGE_QUALITIES.push({value:((raw<<16)|0xff0f)>>>0,label:name});
  for(const size of [0,1,2,14])for(const quality of [3,2]){const value=((raw<<16)|(size<<8)|0x10|quality)>>>0;IMAGE_QUALITIES.push({value,label:imageQualityLabel(value)});}
}
module.exports={imageQualityLabel,IMAGE_QUALITIES};
