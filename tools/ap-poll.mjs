export default async function run({ frame }) {
  return JSON.stringify(await frame.evaluate(() => ({ ap: window.__ap, st: window.fold.state(), p: window.fold.pointers()[1] })));
}
