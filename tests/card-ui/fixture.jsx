// Actual production component with a synthetic IPC port. No camera worker exists.
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import CameraCard from '../../src/CameraCard';
import {setLocale,useLocale} from '../../src/i18n';
import '../../src/style.css';
import '../../src/theme.css';
import '../../src/polish.css';
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/600.css';
function Fixture(){
  useLocale();const [camera,setCamera]=useState({connected:true,working:true,model:'Demo camera',cameraId:'synthetic',connectedAt:1}),[mounted,setMounted]=useState(true),[notices,setNotices]=useState([]);
  window.__cardFixture={camera:setCamera,mount:setMounted,locale:locale=>{setLocale(locale);document.documentElement.lang=locale;},theme:theme=>document.documentElement.dataset.theme=theme};
  return <div style={{padding:'30px',maxWidth:1250,margin:'0 auto'}}><h1 style={{fontSize:24,marginBottom:24}}>Library</h1>{mounted&&<CameraCard camera={camera} api={window.cardFixtureAPI} onNotice={message=>setNotices(old=>[...old,message])}/>}<div aria-label="Transient notices">{notices.map((message,index)=><span key={index}>{message}</span>)}</div></div>;
}
setLocale('en-US');createRoot(document.getElementById('root')).render(<Fixture/>);
