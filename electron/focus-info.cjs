// EdsFocusInfo: EdsRect (16), pointNumber (4), 128 EdsFocusPoint (32), executeMode (4).
// Both legacy boolean and extended EVF focus flags occur in Canon SDK versions.
function parseFocusInfo(buffer){
  if(!Buffer.isBuffer(buffer)||buffer.length<24)return {status:'unknown',points:[],boxes:[]};
  const count=buffer.readUInt32LE(16);if(count>4096||20+count*32+4>buffer.length)return {status:'unknown',points:[],boxes:[]};
  const image={x:buffer.readInt32LE(0),y:buffer.readInt32LE(4),width:buffer.readInt32LE(8),height:buffer.readInt32LE(12)};
  const points=[],boxes=[];
  for(let i=0;i<count;i++){
    const offset=20+i*32;
    const valid=!!buffer.readUInt32LE(offset),selected=!!buffer.readUInt32LE(offset+4),result=buffer.readUInt32LE(offset+8);
    if(valid&&selected)points.push(result);
    if(valid&&image.width>0&&image.height>0){
      const x=(buffer.readInt32LE(offset+12)-image.x)/image.width,y=(buffer.readInt32LE(offset+16)-image.y)/image.height;
      const width=buffer.readInt32LE(offset+20)/image.width,height=buffer.readInt32LE(offset+24)/image.height;
      if(width>0&&height>0&&x>=0&&y>=0&&x+width<=1.01&&y+height<=1.01)boxes.push({id:i,x,y,width,height,selected,status:[1,17,20].includes(result)?'focused':[2,18].includes(result)?'failed':'idle'});
    }
  }
  const focused=points.some(value=>[1,17,20].includes(value));
  const failed=points.length>0&&points.every(value=>[2,18].includes(value));
  return {status:focused?'focused':failed?'failed':'unknown',points,boxes,image};
}
module.exports={parseFocusInfo};
