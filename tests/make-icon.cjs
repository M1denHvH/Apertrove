const sharp=require('sharp');
const fs=require('node:fs/promises');
const path=require('node:path');
(async()=>{
  const dir=path.join(__dirname,'../assets');await fs.mkdir(dir,{recursive:true});
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#273447"/><stop offset="1" stop-color="#111a2b"/></linearGradient><linearGradient id="iris" x2="1" y2="1"><stop stop-color="#f2d5a7"/><stop offset="1" stop-color="#b99bcd"/></linearGradient></defs><rect width="256" height="256" rx="58" fill="url(#bg)"/><path d="M58 188L109 71Q128 35 147 71L198 188" fill="none" stroke="url(#iris)" stroke-width="17" stroke-linecap="round" stroke-linejoin="round"/><circle cx="128" cy="136" r="37" fill="#182335" stroke="url(#iris)" stroke-width="9"/><path d="M128 99L147 126L165 136M165 136L137 139L110 168M110 168L117 140L109 104" fill="none" stroke="url(#iris)" stroke-width="5" stroke-linejoin="round"/><path d="M155 160L188 194" stroke="#dbc5be" stroke-width="7" stroke-linecap="round"/><circle cx="193" cy="198" r="6" fill="#dbc5be"/></svg>`;
  await fs.writeFile(path.join(dir,'icon.svg'),svg);await fs.mkdir(path.join(__dirname,'../public'),{recursive:true});await fs.writeFile(path.join(__dirname,'../public/icon.svg'),svg);const png=await sharp(Buffer.from(svg)).resize(256).png().toBuffer();await fs.writeFile(path.join(dir,'icon.png'),png);
  const header=Buffer.alloc(22);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header[6]=0;header[7]=0;header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(png.length,14);header.writeUInt32LE(22,18);await fs.writeFile(path.join(dir,'icon.ico'),Buffer.concat([header,png]));
})();
