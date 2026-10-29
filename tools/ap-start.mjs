export default async function run({ frame }) {
  await frame.evaluate(() => {
    document.getElementById('landing').style.display = 'none';
    window.fold.playFlat();
    window.fold.lowfx(true);
    window.__ap = 'running';
    window.fold.autopilot([0]).then((m) => (window.__ap = m)).catch((e) => (window.__ap = 'error: ' + e));
  });
  return 'started';
}
