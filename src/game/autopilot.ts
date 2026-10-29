/**
 * Trailer autopilot (dev server only).
 *
 * Drives the Immersive Web Emulator's hands in real time: reach for the fold
 * handle, pinch, pull the flap around its crease and let go, step after step.
 * Record the browser window while it runs to capture genuine emulator footage
 * of the hand interactions for the submission video.
 *
 *   In the browser console (npm run dev):  fold.autopilot([0, 2, 4])
 */

type Vec = { x: number; y: number; z: number };

interface Remote {
  dispatch(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

interface FoldApi {
  state(): { state: string; step: number; chapter: number };
  start(i: number): void;
  worldOf(which: 'handle' | 'target'): Vec | null;
  pointers(): { id: string; kind: string; pinching: boolean; pinch: number[] }[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll until `cond` holds (or time runs out). Robust to slow frame rates. */
async function until(cond: () => boolean, timeoutMs = 60000): Promise<boolean> {
  const t0 = performance.now();
  while (performance.now() - t0 < timeoutMs) {
    if (cond()) return true;
    await sleep(120);
  }
  return false;
}

function remote(): Remote | null {
  const dev = (window as unknown as { IWER_DEVICE?: { remote?: Remote } }).IWER_DEVICE;
  return dev?.remote ?? null;
}

export async function autopilot(api: FoldApi, chapters: number[], launch: () => void): Promise<string> {
  const r = remote();
  if (!r) return 'Autopilot needs the emulator: run `npm run dev` and use the dev URL.';

  // Clear the landing page so it doesn't cover the recording.
  const landing = document.getElementById('landing');
  if (landing) landing.style.display = 'none';
  const pill = document.getElementById('vr-pill');
  if (pill) pill.style.display = 'none';
  launch();
  await sleep(1500);
  try {
    await r.dispatch('accept_session');
  } catch {
    // Already in a session.
  }
  await sleep(800);
  await r.dispatch('set_input_mode', { mode: 'hand' });
  await sleep(600);
  // Rest the left hand out of shot; the right hand does the folding.
  await r.dispatch('set_transform', { device: 'hand-left', position: { x: -0.32, y: 1.18, z: -0.22 } });

  // Measure where the pinch point sits relative to the hand while pinched.
  const rest = { x: 0.3, y: 1.3, z: -0.25 };
  await r.dispatch('set_transform', { device: 'hand-right', position: rest });
  await r.dispatch('set_select_value', { device: 'hand-right', value: 1 });
  await sleep(500);
  const p = api.pointers().find((x) => x.id === 'right');
  const off = p && p.kind === 'hand' ? { x: p.pinch[0] - rest.x, y: p.pinch[1] - rest.y, z: p.pinch[2] - rest.z } : { x: 0, y: -0.025, z: -0.012 };
  await r.dispatch('set_select_value', { device: 'hand-right', value: 0 });

  const handAt = (v: Vec): Vec => ({ x: v.x - off.x, y: v.y - off.y, z: v.z - off.z });
  const move = (v: Vec, duration: number) =>
    r.dispatch('animate_to', { device: 'hand-right', position: handAt(v), duration });

  for (const ch of chapters) {
    api.start(ch);
    await until(() => api.state().state === 'fold');
    for (let guard = 0; guard < 12 && api.state().state === 'fold'; guard++) {
      const step = api.state().step;
      await sleep(350);
      const h = api.worldOf('handle');
      const t = api.worldOf('target');
      if (!h || !t) break;
      // Reach in above the handle, settle onto it, pinch.
      await move({ x: h.x, y: h.y + 0.06, z: h.z + 0.03 }, 0.55);
      await move(h, 0.3);
      await r.dispatch('set_select_value', { device: 'hand-right', value: 1 });
      await sleep(220);
      // Pull along an arc over the crease to the target.
      const n = 9;
      for (let i = 1; i <= n; i++) {
        const k = i / n;
        const e = k * k * (3 - 2 * k);
        await move(
          {
            x: h.x + (t.x - h.x) * e,
            y: h.y + (t.y - h.y) * e + Math.sin(e * Math.PI) * 0.09,
            z: h.z + (t.z - h.z) * e,
          },
          0.12,
        );
      }
      await sleep(150);
      await r.dispatch('set_select_value', { device: 'hand-right', value: 0 });
      await move({ x: t.x + 0.04, y: t.y + 0.08, z: t.z + 0.05 }, 0.35);
      // Wait for the crease to press (or the model to start its life).
      await until(() => api.state().step !== step || api.state().state !== 'fold', 20000);
      await sleep(300);
    }
    // Let the model come to life and perform.
    await r.dispatch('animate_to', { device: 'hand-right', position: rest, duration: 0.6 });
    await until(() => api.state().state === 'done', 120000);
    await sleep(2500);
  }
  return 'Autopilot finished.';
}
