// In emulated VR with hands: make one fold, then run the right index tip along the crease.
export default async function run({ frame }) {
  return await frame.evaluate(async () => {
    const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
    const until = async (c, t = 60000) => { const t0 = performance.now(); while (performance.now() - t0 < t) { if (c()) return true; await sleep(150); } return false; };
    const f = window.fold, r = window.IWER_DEVICE.remote, log = [];
    document.getElementById('landing').style.display = 'none';
    f.lowfx(true);
    f.enterVR(); await sleep(1500);
    try { await r.dispatch('accept_session'); } catch (e) {}
    await until(() => f.pointers()[0].kind !== 'none' || f.state().state === 'menu', 20000);
    await r.dispatch('set_input_mode', { mode: 'hand' });
    await until(() => f.pointers()[1].kind === 'hand', 30000);
    f.start(1);
    await until(() => f.state().state === 'fold');
    f.autoFold();
    await until(() => f.state().step === 1, 30000);
    const line = f.sharpLine();
    log.push('after fold: ' + JSON.stringify(f.state()) + ' line=' + JSON.stringify(line));
    if (!line) return log.join('\n');
    // Offset between hand transform and index tip.
    const hp = (await r.dispatch('get_transform', { device: 'hand-right' })).position;
    const tip = f.pointers()[1].tip;
    const off = [tip[0] - hp.x, tip[1] - hp.y, tip[2] - hp.z];
    const at = (k) => ({ x: line.a[0] + (line.b[0] - line.a[0]) * k - off[0], y: line.a[1] + (line.b[1] - line.a[1]) * k - off[1] + 0.004, z: line.a[2] + (line.b[2] - line.a[2]) * k - off[2] });
    await r.dispatch('animate_to', { device: 'hand-right', position: at(0), duration: 0.3 });
    for (let i = 1; i <= 10; i++) {
      await r.dispatch('animate_to', { device: 'hand-right', position: at(i / 10), duration: 0.15 });
      log.push(`k=${i / 10} sharp=${f.state().sharp}`);
    }
    return log.join('\n');
  });
}
