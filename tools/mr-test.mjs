// Starts a mixed-reality session in the emulator and reports what the game sees.
export default async function run({ frame }) {
  return await frame.evaluate(async () => {
    document.getElementById('landing').style.display = 'none';
    window.fold.lowfx(true);
    window.fold.enterMR();
    const r = window.IWER_DEVICE?.remote;
    await new Promise((ok) => setTimeout(ok, 1500));
    try { await r.dispatch('accept_session'); } catch (e) { /* may already be accepted */ }
    await new Promise((ok) => setTimeout(ok, 15000));
    const s = (window).fold;
    return JSON.stringify({ st: s.state(), status: await r.dispatch('get_session_status') });
  });
}
