async function choose(locator,value){
  await locator.click();
  const page=locator.page();
  await page.getByRole('listbox').locator(`[role="option"][data-value=${JSON.stringify(String(value))}]`).click();
}
module.exports={choose};
