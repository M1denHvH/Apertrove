(function(root){
  function frameRect(width,height,ratio){
    const ratios={'1:1':1,'4:5':4/5,'9:16':9/16};const target=ratios[ratio];if(!target)return {x:0,y:0,width,height};
    const w=Math.min(width,height*target),h=w/target;return {x:(width-w)/2,y:(height-h)/2,width:w,height:h};
  }
  function guideLines(rect,grid){
    const {x,y,width:w,height:h}=rect;
    if(grid==='diagonals')return [[x,y,x+w,y+h],[x+w,y,x,y+h]];
    const values=grid==='thirds'?[1/3,2/3]:grid==='golden'?[(3-Math.sqrt(5))/2,(Math.sqrt(5)-1)/2]:[];
    return values.flatMap(f=>[[x+w*f,y,x+w*f,y+h],[x,y+h*f,x+w,y+h*f]]);
  }
  function safeRect(frame,margins){const {x,y,width:w,height:h}=frame;return {x:x+w*(margins.left||0)/100,y:y+h*(margins.top||0)/100,width:w*(1-((margins.left||0)+(margins.right||0))/100),height:h*(1-((margins.top||0)+(margins.bottom||0))/100)};}
  function drawComposition(ctx,width,height,settings={}){
    const {grid='off',ratio='none',safe='off',margins={},opacity=.75,color='#ffffff',labels=true}=settings;
    if(grid==='off'&&ratio==='none'&&safe==='off')return;
    const frame=frameRect(width,height,ratio),line=Math.max(1.2,width/850);
    ctx.save();ctx.lineWidth=line;ctx.strokeStyle=color;ctx.globalAlpha=opacity;ctx.shadowColor='#0009';ctx.shadowBlur=line;
    if(ratio!=='none'){
      ctx.fillStyle='#000';ctx.globalAlpha=.45;ctx.fillRect(0,0,width,frame.y);ctx.fillRect(0,frame.y,frame.x,frame.height);ctx.fillRect(frame.x+frame.width,frame.y,width-frame.x-frame.width,frame.height);ctx.fillRect(0,frame.y+frame.height,width,height-frame.y-frame.height);
      ctx.globalAlpha=opacity;ctx.strokeRect(frame.x,frame.y,frame.width,frame.height);
    }
    ctx.beginPath();for(const [x1,y1,x2,y2] of guideLines(frame,grid)){ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);}ctx.stroke();
    if(safe!=='off'){
      const area=safeRect(frame,margins);ctx.setLineDash([line*5,line*4]);ctx.strokeStyle='#f3cf7a';ctx.strokeRect(area.x,area.y,area.width,area.height);ctx.setLineDash([]);
    }
    if(labels&&(ratio!=='none'||safe!=='off')){ctx.shadowBlur=line*2;ctx.fillStyle='#fff';ctx.font=`${Math.max(12,width/75)}px sans-serif`;ctx.fillText([ratio==='none'?'':ratio,safe==='off'?'':root.ApertroveI18n?.t('composition.safe_area')||'Safe area'].filter(Boolean).join(' · '),frame.x+line*7,frame.y+line*15);}
    ctx.restore();
  }
  root.ApertroveComposition={drawComposition,frameRect,guideLines,safeRect};if(typeof module!=='undefined')module.exports=root.ApertroveComposition;
})(globalThis);
