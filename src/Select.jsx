import React,{Children,useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Check,ChevronDown} from 'lucide-react';
import EosIcon from './EosIcon';

function optionList(children,parentDisabled=false){
  return Children.toArray(children).flatMap(child=>{
    if(!React.isValidElement(child))return [];
    if(child.type===React.Fragment||child.type==='optgroup')return optionList(child.props.children,parentDisabled||child.props.disabled);
    if(child.type!=='option')return [];
    return [{...child.props,disabled:parentDisabled||child.props.disabled,value:String(child.props.value??child.props.children)}];
  });
}
export default function Select({value,onChange,children,disabled=false,className='',renderValue,iconKind,...props}){
  const id=useId(),button=useRef(null),list=useRef(null),[open,setOpen]=useState(false),[active,setActive]=useState(0),[position,setPosition]=useState({});
  const options=optionList(children);
  const selected=options.findIndex(option=>option.value===String(value));
  const label=options[selected]?.children||'—';
  const close=()=>{setOpen(false);button.current?.focus({preventScroll:true});};
  const choose=index=>{const option=options[index];if(!option||option.disabled)return;onChange?.({target:{value:option.value}});close();};
  const show=()=>{if(disabled)return;setActive(Math.max(0,selected));setOpen(true);};
  useLayoutEffect(()=>{if(!open)return;const place=()=>{const r=button.current.getBoundingClientRect(),height=Math.min(300,options.length*39+12),below=innerHeight-r.bottom-12,above=r.top-12,up=below<height&&above>below,maxHeight=Math.max(100,Math.min(300,up?above:below)),width=Math.min(Math.max(r.width,210),innerWidth-24);setPosition({position:'fixed',left:Math.max(12,Math.min(r.left,innerWidth-width-12)),width,maxHeight,...(up?{bottom:innerHeight-r.top+6}:{top:r.bottom+6})});};place();window.addEventListener('resize',place);window.addEventListener('scroll',place,true);return()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};},[open,options.length]);
  useEffect(()=>{if(!open)return;list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({block:'nearest'});},[open,active]);
  useEffect(()=>{if(!open)return;const outside=event=>{if(!button.current?.contains(event.target)&&!list.current?.contains(event.target))setOpen(false);};document.addEventListener('pointerdown',outside,true);return()=>document.removeEventListener('pointerdown',outside,true);},[open]);
  useEffect(()=>{if(disabled)setOpen(false);},[disabled]);
  const keyDown=event=>{
    if(event.key==='Escape'&&!open)return;
    if(['ArrowDown','ArrowUp','Home','End','Enter',' ','Escape'].includes(event.key)){event.preventDefault();event.stopPropagation();}
    if(event.key==='Escape'){setOpen(false);return;}
    if(event.key==='Tab'){setOpen(false);return;}
    if(event.key==='Enter'||event.key===' '){if(open)choose(active);else show();return;}
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){if(!open){show();return;}const direction=event.key==='ArrowUp'?-1:1;let index=event.key==='Home'?0:event.key==='End'?options.length-1:(active+direction+options.length)%options.length;for(let i=0;i<options.length&&options[index]?.disabled;i++)index=(index+direction+options.length)%options.length;setActive(index);return;}
    if(event.key.length===1&&!event.ctrlKey&&!event.metaKey){event.stopPropagation();if(!open)show();const index=options.findIndex((option,index)=>index>active&&String(option.children).toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase()));if(index>=0)setActive(index);}
  };
  return <><button {...props} ref={button} type="button" className={`ui-select ${className}`} role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={open?id:undefined} aria-activedescendant={open?`${id}-${active}`:undefined} disabled={disabled} onClick={()=>open?setOpen(false):show()} onKeyDown={keyDown}><span className="ui-select-value" lang={options[selected]?.lang}>{renderValue?renderValue(label):label}</span><ChevronDown size={13}/></button>{open&&createPortal(<div ref={list} id={id} role="listbox" aria-label={props['aria-label']} className="ui-select-menu" style={position}>{options.map((option,index)=><div key={`${option.value}-${index}`} id={`${id}-${index}`} data-index={index} data-value={option.value} role="option" aria-selected={index===selected} aria-disabled={!!option.disabled} className={`${index===active?'highlighted ':''}${index===selected?'selected':''}`} onPointerMove={()=>setActive(index)} onPointerDown={event=>{event.preventDefault();choose(index);}}><span lang={option.lang}>{iconKind&&<EosIcon kind={iconKind} value={Number(option.value)} size={18}/>} {option.children}</span>{index===selected&&<Check size={14}/>}</div>)}</div>,document.body)}</>;
}
