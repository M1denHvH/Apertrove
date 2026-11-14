(function(root){
  'use strict';
  function normalize(input={},systemDark=false){
    const theme=['light','dark','system'].includes(input.theme)?input.theme:'system';
    const resolvedTheme=theme==='system'?(['light','dark'].includes(input.resolvedTheme)?input.resolvedTheme:systemDark?'dark':'light'):theme;
    const accentColor=/^#[0-9a-f]{6}$/i.test(input.accentColor||'')?input.accentColor.toLowerCase():'#7f9c69';
    const channels=[1,3,5].map(i=>parseInt(accentColor.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
    const luminance=.2126*channels[0]+.7152*channels[1]+.0722*channels[2];
    const dark=[16,32,24].map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4),darkLuminance=.2126*dark[0]+.7152*dark[1]+.0722*dark[2];
    const onAccent=(luminance+.05)/(darkLuminance+.05)>=4.5?'#102018':1.05/(luminance+.05)>=4.5?'#ffffff':'#000000';
    const systemTheme=['light','dark'].includes(input.systemTheme)?input.systemTheme:systemDark?'dark':'light';
    return {theme,resolvedTheme,systemTheme,accentColor,performanceMode:input.performanceMode===true,design:['current','classic','modern'].includes(input.design)?input.design:'current',onAccent};
  }
  function apply(input={},systemDark=false){
    const appearance=normalize(input,systemDark),element=document.documentElement;
    element.dataset.design=appearance.design;element.dataset.theme=appearance.resolvedTheme;element.dataset.themeMode=appearance.theme;
    element.toggleAttribute('data-performance-mode',appearance.performanceMode);
    element.style.setProperty('--accent-color',appearance.accentColor);element.style.setProperty('--on-accent',appearance.onAccent);element.style.colorScheme=appearance.resolvedTheme;
    return appearance;
  }
  function windowOptions(appearance){
    const dark=appearance.resolvedTheme==='dark';
    const colors={current:['#f6f7f9','#121619'],classic:['#e4e6e7','#17191c'],modern:['#eff2f6','#0e131e']};
    return {backgroundColor:colors[appearance.design][Number(dark)],additionalArguments:['--apertrove-appearance='+JSON.stringify(appearance)]};
  }
  const api={normalize,apply,windowOptions};root.ApertroveAppearance=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
