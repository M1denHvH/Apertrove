const {TextDecoder}=require('node:util');
// Reject damaged UTF-8 instead of silently persisting replacement characters.
function decodeLibraryBytes(bytes){return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
module.exports={decodeLibraryBytes};
