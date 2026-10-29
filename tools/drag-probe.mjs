export default async function run({ page, frame }) {
  const f = frame;
  const box = await (await frame.frameElement()).boundingBox();
  const ox = box.x, oy = box.y;
  const tick = (s) => f.evaluate((x) => window.fold.tick(x), s);
  await f.evaluate(() => { document.getElementById('landing').style.display = 'none'; window.fold.playFlat(); window.fold.lowfx(true); window.fold.start(Number(1)); });
  await tick(1.3);
  const h = await f.evaluate(() => window.fold.screenOf('handle'));
  const t = await f.evaluate(() => window.fold.screenOf('target'));
  const out = [`h=${h.x|0},${h.y|0} t=${t.x|0},${t.y|0}`];
  await page.mouse.move(h.x + ox, h.y + oy); await tick(0.05);
  await page.mouse.down(); await tick(0.05);
  for (let i = 1; i <= 10; i++) {
    const k = i / 10;
    await page.mouse.move(h.x + (t.x - h.x) * k + ox, h.y + (t.y - h.y) * k - Math.sin(k * Math.PI) * 70 + oy);
    await tick(0.05);
    const st = await f.evaluate(() => window.fold.state());
    out.push(`k=${k.toFixed(1)} theta=${st.theta.toFixed(2)} ${st.state}:${st.step}`);
  }
  await page.mouse.up(); await tick(1);
  return out.join('\n');
}
