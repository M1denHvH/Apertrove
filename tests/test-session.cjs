async function capturePage(page){
  await page.waitForSelector('.app-shell');
  await page.evaluate(async()=>{const state=await window.focal.boot();if(!state.sessionId)await window.focal.session({name:'Проверка интерфейса'});});
  await page.locator('.nav-item').filter({hasText:'Съёмка'}).click();
}
module.exports={capturePage};
