// Plays a chapter end to end with real mouse drags along the fold path.
// Game logic is advanced with fold.tick() so it runs fast under a software GPU.
//   CHAPTER=0 SHOT_DIR=/abs/dir SHOTS=1 npx @iwsdk/cli browser run tools/play-chapter.mjs
export default async function run({ page, frame }) {
  const f = frame ?? page;
  const chapter = Number(process.env.CHAPTER ?? 0);
  const dir = process.env.SHOT_DIR;
  const shots = process.env.SHOTS === '1';
  let ox = 0;
  let oy = 0;
  if (frame && frame !== page.mainFrame()) {
    const box = await (await frame.frameElement()).boundingBox();
    ox = box?.x ?? 0;
    oy = box?.y ?? 0;
  }
  if (process.env.SMALL === '1') await page.setViewportSize({ width: 800, height: 500 });
  const tick = (s) => f.evaluate((x) => window.fold.tick(x), s);
  const shot = async (name) => {
    if (!dir) return;
    await f.evaluate(() => window.fold.render());
    await page.screenshot({ path: `${dir}/${name}.png` });
  };
  const log = [];
  await f.evaluate(() => {
    const el = document.getElementById('landing');
    if (el) el.style.display = 'none';
    window.fold.playFlat();
    window.fold.lowfx(true);
    window.fold.freeze();
  });
  await f.evaluate((c) => window.fold.start(c), chapter);
  await tick(1.2);
  if (shots && process.env.ALL === '1') await shot(`c${chapter}-0-start`);
  for (let guard = 0; guard < 20; guard++) {
    const st = await f.evaluate(() => window.fold.state());
    if (st.state !== 'fold') break;
    await tick(0.1);
    const h = await f.evaluate(() => window.fold.screenOf('handle'));
    const t = await f.evaluate(() => window.fold.screenOf('target'));
    if (!h || !t) break;
    await page.mouse.move(h.x + ox, h.y + oy);
    await tick(0.05);
    await page.mouse.down();
    await tick(0.05);
    const steps = 16;
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const x = h.x + (t.x - h.x) * k;
      const y = h.y + (t.y - h.y) * k - Math.sin(k * Math.PI) * 70;
      await page.mouse.move(x + ox, y + oy);
      await tick(0.04);
      if (shots && process.env.ALL === '1' && i === 8) await shot(`c${chapter}-${st.step + 1}-mid`);
    }
    const mid = await f.evaluate(() => window.fold.state());
    await page.mouse.up();
    await tick(0.8);
    const after = await f.evaluate(() => window.fold.state());
    log.push(
      `step ${st.step}: theta at end of drag ${mid.theta.toFixed(2)} -> ${after.state}:${after.step}`,
    );
    if (after.step === st.step && after.state === 'fold') {
      log.push('  drag did not commit; autoFold');
      await f.evaluate(() => window.fold.autoFold());
      await tick(0.8);
    }
  }
  // Life + act.
  await tick(1.0);
  if (shots) await shot(`c${chapter}-life`);
  await tick(2.4);
  
  await tick(4);
  if (shots) await shot(`c${chapter}-act-mid`);
  await tick(6);
  const end = await f.evaluate(() => window.fold.state());
  log.push(`end: ${JSON.stringify(end)}`);
  if (shots) await shot(`c${chapter}-done`);
  return log.join('\n');
}
