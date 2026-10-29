export default async function run({ page, frame }) {
  const f = frame ?? page;
  const a = await f.evaluate(() => window.fold.state());
  await page.waitForTimeout(1500);
  const b = await f.evaluate(() => window.fold.state());
  const vis = await f.evaluate(() => document.visibilityState);
  const raf = await f.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const tick = () => { n++; if (performance.now() - t0 > 500) res(n); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); }));
  return JSON.stringify({ a, b, vis, raf });
}
