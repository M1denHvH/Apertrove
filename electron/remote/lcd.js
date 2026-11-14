(function(root){
  'use strict';
  const segments={a:'12,3 48,3 55,10 48,17 12,17 5,10',b:'49,18 56,11 59,18 59,45 52,52 45,45',c:'52,53 59,60 59,87 56,94 49,87 45,60',d:'12,87 48,87 55,94 48,101 12,101 5,94',e:'4,53 11,60 11,87 4,94 1,87 1,60',f:'4,11 11,18 11,45 4,52 1,45 1,18',g:'12,45 48,45 55,52 48,59 12,59 5,52'};
  const glyphs={'0':'abcdef','1':'bc','2':'abdeg','3':'abcdg','4':'bcfg','5':'acdfg','6':'acdefg','7':'abc','8':'abcdefg','9':'abcdfg','A':'abcefg','U':'bcdef','t':'defg','o':'cdeg','F':'aefg','b':'cdefg','u':'cde','L':'def','-':'g'};
  function layout(kind,value){
    let text=value||'--';if(text==='—')text='--';if(text==='Auto')text='AUto';if(kind==='shutter')text=text.replace(/^1\//,'').replace(/[″”]/g,'"');if(kind==='aperture')text=text.replace(/^f\//i,'F');
    let cursor=0;const items=[...text].map(letter=>{const x=cursor,type=letter==='.'?'dot':letter==='"'?'quote':'segments';cursor+=type==='dot'?18:type==='quote'?28:66;return {x,type,segments:glyphs[letter]||'g'};});
    return {width:Math.max(66,cursor),items};
  }
  function draw(svg,kind,value){
    if(svg.dataset.value===value)return;svg.dataset.value=value;
    const {width,items}=layout(kind,value);svg.setAttribute('viewBox',`0 0 ${width} 106`);svg.replaceChildren();
    const node=(tag,attributes)=>{const element=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value] of Object.entries(attributes))element.setAttribute(key,value);return element;};
    for(const item of items){
      if(item.type==='dot')svg.append(node('circle',{cx:item.x+5,cy:94,r:6}));
      else{const group=node('g',{transform:`translate(${item.x},0)`});if(item.type==='quote')group.append(node('path',{d:'M3 3H11V24H3ZM18 3H26V24H18Z'}));else for(const segment of item.segments)group.append(node('polygon',{points:segments[segment]}));svg.append(group);}
    }
  }
  root.ApertroveLcd={segments,layout,draw};
})(globalThis);
