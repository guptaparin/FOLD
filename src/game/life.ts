/**
 * "Comes to life": relax chosen creases of a finished model so the flat fold
 * gains volume (wings spread, a neck lifts, a tent opens). Each open is
 * resolved against the sheet as it stands when that open begins, so opens can
 * be chained.
 */
import type { Facet, Sheet } from './fold/engine.js';
import { apply, M4, mul, rotationAbout, translation, V3 } from './fold/math.js';
import type { OrigamiModel } from './fold/models.js';
import { LAYER } from './paper-view.js';

interface ActiveOpen {
  ids: Facet[];
  start: M4[];
  origin: V3;
  axis: V3;
  angle: number;
}

export class Opener {
  private active: (ActiveOpen | null)[] = [];
  private started: boolean[] = [];
  private finished: boolean[] = [];
  private baked = false;

  constructor(
    private sheet: Sheet,
    private model: OrigamiModel,
  ) {}

  /** Freeze stack offsets into matrices so facets can leave the plane. */
  private bake(): void {
    if (this.baked) return;
    this.baked = true;
    for (const f of this.sheet.facets) {
      if (!f.flat) continue;
      f.m = mul(translation(0, 0, f.stack * LAYER), f.m);
      f.flat = false;
      f.stack = 0;
    }
  }

  private begin(i: number): ActiveOpen | null {
    const o = this.model.opens[i];
    const crease = this.sheet.creases[o.step];
    if (!crease) return null;
    const bit = 1 << o.step;
    const isStatic = (f: Facet) => !(f.hist & bit);
    const A = this.sheet.locateWithin(crease.a, isStatic);
    const B = this.sheet.locateWithin(crease.b, isStatic);
    if (!A || !B) return null;
    const ax: V3 = [B.pos[0] - A.pos[0], B.pos[1] - A.pos[1], B.pos[2] - A.pos[2]];
    const len = Math.hypot(ax[0], ax[1], ax[2]) || 1;
    const axis: V3 = [ax[0] / len, ax[1] / len, ax[2] / len];
    const moving = this.sheet.facets.filter((f) => f.hist & bit);
    if (!moving.length) return null;
    // Which side of the body does the flap physically lie on? Compare the
    // stacked heights of the flap and the body it was folded against. (A
    // turn-over step can put a flap underneath, so paper normals can't tell.)
    const zOf = (f: Facet): number => {
      let z = 0;
      for (const p of f.poly) z += apply(f.m, [p[0], p[1], 0])[2];
      return z / f.poly.length;
    };
    const planar = (f: Facet): boolean => Math.abs(f.m[10]) > 0.999;
    const mv = moving.filter(planar);
    const st = this.sheet.facets.filter((f) => !(f.hist & bit) && planar(f));
    let ns: V3 = [A.facet.m[8], A.facet.m[9], A.facet.m[10]];
    if (mv.length && st.length) {
      const mz = mv.reduce((a, f) => a + zOf(f), 0) / mv.length;
      const sz = st.reduce((a, f) => a + zOf(f), 0) / st.length;
      if (Math.abs(mz - sz) > 1e-6) ns = [0, 0, mz > sz ? 1 : -1];
    }
    // Centroid of the moving flap.
    let cx = 0;
    let cy = 0;
    let cz = 0;
    let n = 0;
    for (const f of moving) {
      for (const p of f.poly) {
        const q = apply(f.m, [p[0], p[1], 0]);
        cx += q[0];
        cy += q[1];
        cz += q[2];
        n++;
      }
    }
    const c: V3 = [cx / n, cy / n, cz / n];
    const test = apply(rotationAbout(A.pos, axis, 0.15), c);
    const disp = (test[0] - c[0]) * ns[0] + (test[1] - c[1]) * ns[1] + (test[2] - c[2]) * ns[2];
    const sign = disp > 0 ? 1 : -1;
    return {
      ids: moving,
      start: moving.map((f) => f.m.slice()),
      origin: A.pos,
      axis,
      angle: o.angle * sign,
    };
  }

  /**
   * u in 0..1 across all opens. Opens run one after another, because a later
   * open may carry facets an earlier one already moved.
   */
  update(u: number): void {
    this.bake();
    const n = this.model.opens.length;
    for (let i = 0; i < n; i++) {
      const a = i / n;
      const b = (i + 1) / n;
      const k = Math.min(1, Math.max(0, (u - a) / (b - a)));
      if (k <= 0 || this.finished[i]) continue;
      if (!this.started[i]) {
        this.started[i] = true;
        this.active[i] = this.begin(i);
      }
      const op = this.active[i];
      if (!op) continue;
      const e = k * k * (3 - 2 * k);
      const R = rotationAbout(op.origin, op.axis, op.angle * e);
      op.ids.forEach((f, j) => (f.m = mul(R, op.start[j])));
      if (k >= 1) this.finished[i] = true;
    }
  }
}
