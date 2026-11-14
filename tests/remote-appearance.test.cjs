const {test}=require('node:test'),assert=require('node:assert/strict');
const {normalize}=require('../electron/remote/appearance.js');
require('../electron/remote/lcd.js');const {layout}=globalThis.ApertroveLcd;
test('Shared appearance validates preferences and computes readable text on arbitrary accents',()=>{
  assert.deepEqual(normalize({theme:'bad',design:'bad',accentColor:'red'}),{theme:'system',resolvedTheme:'light',systemTheme:'light',design:'current',accentColor:'#7f9c69',onAccent:'#102018',performanceMode:false});
  assert.equal(normalize({accentColor:'#000000'}).onAccent,'#ffffff');assert.equal(normalize({accentColor:'#FFFFFF'}).onAccent,'#102018');assert.equal(normalize({accentColor:'#AB90CE'}).accentColor,'#ab90ce');
});
test('System appearance follows the computer-resolved theme rather than the phone preference',()=>{
  assert.equal(normalize({theme:'system'},true).resolvedTheme,'dark');assert.equal(normalize({theme:'system'},false).resolvedTheme,'light');
  assert.equal(normalize({theme:'system',resolvedTheme:'dark'},false).resolvedTheme,'dark');assert.equal(normalize({theme:'light',resolvedTheme:'dark'},true).resolvedTheme,'light');
});
test('Accent button text retains 4.5:1 contrast, including middle grey custom accents',()=>{
 const luminance=hex=>{const rgb=hex.match(/[a-f0-9]{2}/gi).map(value=>parseInt(value,16)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
 for(let channel=0;channel<256;channel++){const accentColor='#'+channel.toString(16).padStart(2,'0').repeat(3),foreground=normalize({accentColor}).onAccent,a=luminance(accentColor),b=luminance(foreground);assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,accentColor);}
});
test('Desktop and web Classic share the same seven-segment readout layout',()=>{
  assert.equal(layout('shutter','1/80').width,132);assert.equal(layout('aperture','f/2.8').width,216);assert.equal(layout('iso','Auto').width,264);assert.equal(layout('shutter','10″').items.at(-1).type,'quote');assert.equal(layout('iso','—').items.length,2);
});
