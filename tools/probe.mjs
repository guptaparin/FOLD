export default async function run({ page, frame }) {
  const f = frame ?? page;
  const frames = page.frames().map((x) => x.url().slice(0, 80));
  const st = await f.evaluate(() => (window.fold ? window.fold.state() : 'no-api'));
  const h = await f.evaluate(() => (window.fold ? window.fold.screenOf('handle') : null));
  return JSON.stringify({ frames, main: frame === page.mainFrame(), st, h });
}
