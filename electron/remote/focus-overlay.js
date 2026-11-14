(function(root){
  function drawFocus(ctx,width,height,info,now=Date.now()){
    if(!info||now-info.at>2500)return;
    const locked=info.lastFocused&&now-info.lastFocused.at<1500?info.lastFocused.boxes:[];
    const focusIds=new Set(locked.map(point=>point.id));
    const focusing=info.autofocus?.status==='focusing',failed=info.autofocus?.status==='failed'&&now-info.autofocus.at<1500;
    ctx.save();ctx.lineWidth=Math.max(1.5,width/700);
    for(const point of info.boxes||[]){
      const x=point.x*width,y=point.y*height,w=point.width*width,h=point.height*height;
      const focused=point.status==='focused'||focusIds.has(point.id);
      ctx.strokeStyle=focused?'#6ef18a':failed&&point.selected?'#f08076':focusing&&point.selected?'#efce77':'#d5e0e8';
      ctx.globalAlpha=focused||focusing||failed?1:point.selected?.65:.3;
      ctx.shadowColor='#000';ctx.shadowBlur=2;
      if(focused){ctx.strokeRect(x,y,w,h);continue;}
      const corner=Math.min(w,h)*.32;ctx.beginPath();
      ctx.moveTo(x,y+corner);ctx.lineTo(x,y);ctx.lineTo(x+corner,y);
      ctx.moveTo(x+w-corner,y);ctx.lineTo(x+w,y);ctx.lineTo(x+w,y+corner);
      ctx.moveTo(x+w,y+h-corner);ctx.lineTo(x+w,y+h);ctx.lineTo(x+w-corner,y+h);
      ctx.moveTo(x+corner,y+h);ctx.lineTo(x,y+h);ctx.lineTo(x,y+h-corner);ctx.stroke();
    }
    ctx.restore();
  }
  root.ApertroveFocus={drawFocus};
  if(typeof module!=='undefined')module.exports={drawFocus};
})(globalThis);
