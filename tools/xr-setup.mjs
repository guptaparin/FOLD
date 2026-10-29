export default async function run({ frame }) {
  await frame.evaluate(() => {
    document.getElementById('landing').style.display = 'none';
    window.fold.playFlat();
    window.fold.lowfx(true);
    window.fold.start(Number(2));
  });
  return 'ok';
}
