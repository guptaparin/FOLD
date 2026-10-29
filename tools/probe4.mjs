export default async function run({ page, frame }) {
  const f = frame ?? page;
  await f.evaluate(() => { document.getElementById('landing').style.display='none'; window.fold.playFlat(); });
  await page.waitForTimeout(6000);
  return JSON.stringify(await f.evaluate(() => window.fold.stats()));
}
