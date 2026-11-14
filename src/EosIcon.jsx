import React from 'react';
// Original vector drawings using familiar photographic control symbols.
export default function EosIcon({kind,value,size=19,...props}){
  let icon;
  if(kind==='driveMode')icon=[16,17,7].includes(value)?<><circle cx="12" cy="13" r="8"/><path d="M9 2h6M12 7v6l4 2M18 5l2-2"/>{value===7&&<path d="M2 7V4h4"/>}</>:[1,4,5].includes(value)?<><path d="M2 9V4h14M5 12V7h14"/><rect x="8" y="10" width="14" height="10" rx="1"/></>:<rect x="4" y="6" width="16" height="13" rx="1"/>;
  else if(kind==='whiteBalance')icon=value===2?<path d="M6 18a4 4 0 1 1 .8-7.9A6 6 0 0 1 18 9a4.5 4.5 0 1 1 .5 9Z"/>:value===5?<path d="m13 2-8 12h6l-1 8 9-13h-6Z"/>:value===4?<><rect x="2" y="9" width="20" height="6" rx="1"/><path d="M5 5v2m7-2v2m7-2v2M5 17v2m7-2v2m7-2v2"/></>:value===3?<><path d="M8 17h8M9 21h6M8 14a6 6 0 1 1 8 0v3H8Z"/><path d="m10 10 2 3 2-3"/></>:value===1?<><circle cx="12" cy="12" r="4"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/></>:<><path d="m2 18 4-12 4 12M3 14h6M12 6l2 12 3-8 3 8 2-12"/></>;
  else if(kind==='afMode'||kind==='liveAfMode')icon=<><path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"/><circle cx="12" cy="12" r="4"/></>;
  else if(kind==='imageQuality')icon=<><path d="M5 2h10l4 4v16H5Z"/><path d="M14 2v5h5M8 12h8m-8 4h8"/></>;
  else if(kind==='aperture')icon=<><circle cx="12" cy="12" r="10"/><path d="m6 4 9 1 5 8-5 7-9-1-4-8ZM9 8h7l3 6-4 6M9 8l-4 7m4-7 3-6"/></>;
  else if(kind==='shutter')icon=<><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 3"/></>;
  else if(kind==='compensation')icon=<><rect x="3" y="3" width="18" height="18" rx="1"/><path d="m4 20 16-16M6 8h6M9 5v6m4 5h6"/></>;
  else icon=<><path d="M3 8h5l2-3h6l2 3h3v12H3Z"/><circle cx="12" cy="14" r="4"/></>;
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{icon}</svg>;
}
