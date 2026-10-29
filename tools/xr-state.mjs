export default async function run({ frame }) {
  return JSON.stringify(await frame.evaluate(() => ({
    st: window.fold.state(),
    h: window.fold.worldOf('handle'),
    t: window.fold.worldOf('target'),
    p: window.fold.pointers(),
  })));
}
