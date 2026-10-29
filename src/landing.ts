/**
 * The 2D landing page shown in any browser before entering VR: what FOLD is,
 * an "Enter VR" button for Quest / Meta VR Glasses, and a "Play in browser"
 * fallback (mouse folding) for everyone else.
 */
import { Sheet } from './game/fold/engine.js';
import { apply } from './game/fold/math.js';
import { CHAPTER_DATA as CHAPTERS } from './game/chapter-data.js';

function silhouette(i: number, size: number): string {
  const ch = CHAPTERS[i];
  const s = new Sheet(ch.model.turn);
  ch.model.steps.forEach((st, k) => s.commit(s.prepare(st, k)));
  const [mn, mx] = s.bounds();
  const span = Math.max(mx[0] - mn[0], mx[1] - mn[1]);
  const k = (size * 0.86) / span;
  const cx = (mn[0] + mx[0]) / 2;
  const cy = (mn[1] + mx[1]) / 2;
  const polys = [...s.facets]
    .sort((a, b) => a.order - b.order)
    .map((f) => {
      const pts = f.poly
        .map((p) => apply(f.m, [p[0], p[1], 0]))
        .map((q) => `${(size / 2 + (q[0] - cx) * k).toFixed(1)},${(size / 2 - (q[1] - cy) * k).toFixed(1)}`)
        .join(' ');
      const up = f.m[10] > 0;
      const col = up === ch.model.colorUp ? ch.paper.base : '#f3ead8';
      return `<polygon points="${pts}" fill="${col}" stroke="rgba(40,25,15,.35)" stroke-width="1" stroke-linejoin="round"/>`;
    })
    .join('');
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">${polys}</svg>`;
}

const CSS = `
#landing{position:fixed;inset:0;z-index:10;display:flex;align-items:flex-start;justify-content:center;
  background:radial-gradient(120% 90% at 50% 110%,#7d4d6b 0%,#2a2650 38%,#0b1024 78%);color:#f6ecd8;
  font-family:"Inter Variable",system-ui,sans-serif;overflow:auto;transition:opacity .6s ease}
#landing.hide{opacity:0;pointer-events:none}
#landing::before{content:"";position:absolute;inset:0;pointer-events:none;opacity:.12;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence baseFrequency='.9' numOctaves='2'/></filter><rect width='160' height='160' filter='url(%23n)' opacity='.6'/></svg>")}
.l-wrap{position:relative;margin:auto;max-width:880px;width:100%;padding:48px 24px 40px;box-sizing:border-box;text-align:center}
.l-kicker{letter-spacing:.32em;text-transform:uppercase;font-size:12px;color:#ffc56b;font-weight:600}
.l-title{font-family:"Fraunces Variable",Georgia,serif;font-weight:650;font-size:clamp(64px,13vw,128px);letter-spacing:.12em;line-height:1;margin:14px 0 6px}
.l-tag{font-family:"Fraunces Variable",Georgia,serif;font-style:italic;font-size:clamp(18px,3vw,24px);color:#ffd89a;margin:0 0 28px}
.l-row{display:flex;gap:14px;justify-content:center;flex-wrap:wrap;margin:6px 0 30px}
.l-row figure{margin:0;padding:12px 10px 8px;background:#f7efdf;border-radius:4px;box-shadow:0 10px 30px rgba(0,0,0,.35);
  transform:rotate(var(--r));transition:transform .3s ease;color:#2c2118;width:92px}
.l-row figure:hover{transform:rotate(0) translateY(-4px)}
.l-row figcaption{font-family:"Fraunces Variable",Georgia,serif;font-size:13px;font-weight:600;margin-top:4px}
.l-row small{display:block;font-size:10px;color:#c4553a;letter-spacing:.1em}
.l-btns{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.l-btn{font:600 16px "Inter Variable",system-ui,sans-serif;border:0;border-radius:999px;padding:15px 30px;cursor:pointer;transition:transform .15s ease,box-shadow .15s ease}
.l-btn:hover{transform:translateY(-2px)}
.l-btn:focus-visible{outline:3px solid #ffc56b;outline-offset:3px}
.l-primary{background:#e2704f;color:#fff6ea;box-shadow:0 8px 24px rgba(226,112,79,.45)}
.l-ghost{background:rgba(255,255,255,.08);color:#f6ecd8;border:1px solid rgba(255,255,255,.25)}
.l-btn[disabled]{opacity:.45;cursor:not-allowed;transform:none}
.l-note{font-size:13px;color:rgba(246,236,216,.7);margin-top:14px;min-height:1em}
.l-feats{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-top:34px;text-align:left}
.l-feats div{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:12px 14px;font-size:13px;line-height:1.45;color:rgba(246,236,216,.85)}
.l-feats b{display:block;color:#ffd89a;font-weight:600;margin-bottom:2px}
.l-foot{margin-top:26px;font-size:12px;color:rgba(246,236,216,.5)}
#vr-pill{position:fixed;right:16px;bottom:16px;z-index:9;display:none}
@media (prefers-reduced-motion:reduce){.l-row figure{transition:none}}
`;

/** Mount immediately; call the returned `ready` once the 3D world exists. */
export function mountLanding(): { ready: (xrEnabled: boolean) => void; dismiss: () => void } {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  document.title = 'FOLD — a little paper world, folded by hand';

  const el = document.createElement('div');
  el.id = 'landing';
  const rot = [-4, 3, -2, 4, -3, 2];
  el.innerHTML = `
    <div class="l-wrap">
      <div class="l-kicker">A hands-first origami game</div>
      <h1 class="l-title">FOLD</h1>
      <p class="l-tag">a little paper world, folded by hand</p>
      <div class="l-row">${CHAPTERS.map(
        (c, i) =>
          `<figure style="--r:${rot[i]}deg">${silhouette(i, 80)}<figcaption><small>${c.numeral}</small>${c.model.name}</figcaption></figure>`,
      ).join('')}</div>
      <div class="l-btns">
        <button class="l-btn l-primary" id="l-vr">Enter VR</button>
        <button class="l-btn l-ghost" id="l-mr" hidden>Fold on your real desk (MR)</button>
        <button class="l-btn l-ghost" id="l-flat">Play in browser</button>
      </div>
      <div class="l-note" id="l-note"></div>
      <div class="l-feats">
        <div><b>Real paper, real folds</b>Pinch a corner and pull it across. The flap follows your fingers around the crease.</div>
        <div><b>Made for sitting down</b>Everything is within arm's reach on a little desk. Each chapter takes about five minutes.</div>
        <div><b>Bring it to life</b>Every model you fold steps into a paper diorama and fixes something in the world.</div>
        <div><b>A new paper every day</b>The Daily Fold gives everyone the same sheet. Keep a streak and fill your shelf.</div>
      </div>
      <div class="l-foot">Hands, controllers, gaze + pinch, or a mouse · Meta Quest &amp; Meta VR Glasses · Built with Immersive Web SDK</div>
    </div>`;
  document.body.appendChild(el);

  const pill = document.createElement('button');
  pill.id = 'vr-pill';
  pill.className = 'l-btn l-primary';
  pill.textContent = 'Enter VR';
  document.body.appendChild(pill);

  const api = () => (window as unknown as { fold: { enterVR(): void; enterMR(): void; playFlat(): void } }).fold;
  const vrBtn = el.querySelector<HTMLButtonElement>('#l-vr')!;
  const mrBtn = el.querySelector<HTMLButtonElement>('#l-mr')!;
  const flatBtn = el.querySelector<HTMLButtonElement>('#l-flat')!;
  const note = el.querySelector<HTMLDivElement>('#l-note')!;

  vrBtn.disabled = true;
  flatBtn.disabled = true;
  note.textContent = 'Folding the paper…';
  let xrEnabled = false;
  let vrSupported = true;

  const hide = () => {
    el.classList.add('hide');
    setTimeout(() => (el.style.display = 'none'), 650);
  };
  vrBtn.addEventListener('click', () => {
    api().enterVR();
    hide();
  });
  pill.addEventListener('click', () => api().enterVR());
  mrBtn.addEventListener('click', () => {
    api().enterMR();
    hide();
  });
  flatBtn.addEventListener('click', () => {
    api().playFlat();
    hide();
    if (xrEnabled && vrSupported) pill.style.display = 'block';
  });

  const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
  const support: Promise<boolean> = xr
    ? xr.isSessionSupported('immersive-vr').catch(() => false)
    : Promise.resolve(false);
  const arSupport: Promise<boolean> = xr
    ? xr.isSessionSupported('immersive-ar').catch(() => false)
    : Promise.resolve(false);

  return {
    dismiss: hide,
    ready: (enabled: boolean) => {
      xrEnabled = enabled;
      flatBtn.disabled = false;
      void arSupport.then((ok) => (mrBtn.hidden = !ok));
      void support.then((ok) => {
        vrSupported = ok;
        vrBtn.disabled = !ok;
        note.textContent = ok
          ? ''
          : xr
            ? 'No VR headset found. Open this page in Meta Quest Browser, or fold with a mouse right here.'
            : 'Open this page in Meta Quest Browser to play in VR. You can fold with a mouse right here.';
      });
    },
  };
}
