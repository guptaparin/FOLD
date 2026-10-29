export default async function run({ page, frame }) {
  const f = frame;
  await f.evaluate(() => { document.getElementById('landing').style.display = 'none'; window.fold.playFlat(); window.fold.lowfx(true); window.fold.start(1); });
  const tick = (s) => f.evaluate((x) => window.fold.tick(x), s);
  await tick(1.2);
  for (let i = 0; i < 3; i++) { await f.evaluate(() => window.fold.autoFold()); await tick(1.0); }
  await tick(12);
  return JSON.stringify({ st: await f.evaluate(() => window.fold.state()), c: await f.evaluate(() => window.fold.debugCreature()) });
}
