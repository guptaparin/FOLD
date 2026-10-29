export default async function run({ frame }) {
  return await frame.evaluate(async () => {
    const r = window.IWER_DEVICE.remote;
    const out = [];
    const methods = r.listMethods().map((m) => m.method + (m.immediate ? '(i)' : '') + (m.requiresSession ? '(s)' : ''));
    out.push(methods.join(','));
    try { out.push('get: ' + JSON.stringify(await r.dispatch('get_transform', { device: 'hand-right' }))); } catch (e) { out.push('get err ' + e); }
    const p = r.dispatch('animate_to', { device: 'hand-right', position: { x: 0.1, y: 1.2, z: -0.4 }, duration: 0.2 });
    const res = await Promise.race([p.then((x) => 'resolved ' + JSON.stringify(x)).catch((e) => 'rejected ' + e), new Promise((ok) => setTimeout(() => ok('pending after 20s'), 20000))]);
    out.push('animate: ' + res);
    try { out.push('get2: ' + JSON.stringify(await r.dispatch('get_transform', { device: 'hand-right' }))); } catch (e) { out.push('get2 err ' + e); }
    return out.join('\n');
  });
}
