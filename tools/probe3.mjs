export default async function run({ page, frame }) {
  const f = frame ?? page;
  const r = await f.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const tick = () => { n++; if (performance.now() - t0 > 6000) res({n, ms: performance.now()-t0}); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); }));
  const gl = await f.evaluate(() => { const c = document.createElement('canvas'); const g = c.getContext('webgl2'); const d = g.getExtension('WEBGL_debug_renderer_info'); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'n/a'; });
  return JSON.stringify({ r, gl });
}
