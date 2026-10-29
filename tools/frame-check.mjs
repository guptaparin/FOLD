// Enter emulated VR, tilt the headset as the autopilot does, open chapter III mid-fold.
export default async function run({ frame }) {
  return await frame.evaluate(async () => {
    const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
    const f = window.fold, r = window.IWER_DEVICE.remote;
    document.getElementById('landing').style.display = 'none';
    f.lowfx(true);
    f.enterVR(); await sleep(1500);
    try { await r.dispatch('accept_session'); } catch (e) {}
    await sleep(4000);
    await r.dispatch('set_input_mode', { mode: 'hand' });
    await r.dispatch('set_transform', { device: 'headset', orientation: { pitch: -32, yaw: 0, roll: 0 } });
    f.start(2); await sleep(6000);
    for (let i = 0; i < 4; i++) { f.autoFold(); await sleep(5000); }
    const h = f.worldOf('handle');
    await r.dispatch('set_transform', { device: 'hand-right', position: { x: h.x + 0.01, y: h.y + 0.04, z: h.z + 0.02 } });
    f.holdAt(0.5);
    await sleep(8000);
    return JSON.stringify(f.state());
  });
}
