// Shared naming policy; importing session migration must not load Sharp.
function safeName(name){return String(name||'Съёмка').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'').slice(0,100)||'Съёмка';}
module.exports={safeName};
