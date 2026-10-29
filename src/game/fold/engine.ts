/**
 * FOLD paper engine.
 *
 * The sheet is a set of convex facets. Each facet keeps its polygon in the
 * original paper coordinates (unit square, -1..1) and a rigid transform that
 * places it in "fold space": the plane of the folding board, with +Z pointing
 * up off the board. Folding a step:
 *
 *   1. resolve the fold line in fold space from named paper points
 *      (so instructions read like real origami: "bring this corner to that one");
 *   2. split every selected facet the line crosses;
 *   3. rotate the facets on the moving side about the line by the fold angle;
 *   4. re-stack layers so the flap that moved lands on top (valley) or below
 *      (mountain), then compute compact per-facet stack heights.
 *
 * Because every point is addressed in paper coordinates, the same model
 * definition works no matter how the sheet has been flipped or turned before.
 */

import {
  apply,
  convexOverlap,
  cross2,
  dot2,
  EPS,
  identity,
  lerp2,
  M4,
  mul,
  norm2,
  normalZ,
  pointInConvex,
  polygonArea,
  rotationAbout,
  sub2,
  V2,
  V3,
} from './math.js';

export interface Facet {
  id: number;
  /** Polygon in paper coordinates (-1..1), counter-clockwise. */
  poly: V2[];
  /** Paper space -> fold space (before stack offset). */
  m: M4;
  /** Global layer ordering key; larger draws on top. */
  order: number;
  /** Compact stack height used for the visual z offset. */
  stack: number;
  /** Bitmask of fold steps that moved this facet. */
  hist: number;
  /** False once a partial (non-180 degree) fold left it standing up. */
  flat: boolean;
}

/**
 * A point on the sheet: either paper coordinates (-1..1), or `{ at: [x, y] }`
 * for an exact fold-space location at the moment the step starts.
 */
export type PaperPt = V2 | { at: V2 };

const isAt = (p: PaperPt): p is { at: V2 } => !Array.isArray(p);

export interface Selection {
  /** Facet must have been moved by every listed step. */
  movedIn?: number[];
  /** Facet must not have been moved by any listed step. */
  notMovedIn?: number[];
}

export type FoldLine =
  | { bisect: [PaperPt, PaperPt] }
  | { through: [PaperPt, PaperPt] };

export interface FoldStep {
  kind: 'fold';
  /** Player-facing instruction. */
  say: string;
  line: FoldLine;
  /** A paper point on the side that moves. */
  move: PaperPt;
  /** Where the player pinches (paper point). Defaults to `move`. */
  handle?: PaperPt;
  /** Which facets take part. Default: every flat facet. */
  sel?: Selection;
  /** Final fold angle in radians, default PI (flat). */
  angle?: number;
  /** 1 = valley (flap comes up and over, the default), -1 = mountain. */
  dir?: 1 | -1;
}

export interface FlipStep {
  kind: 'flip';
  say: string;
  /** Flip about the fold-space X axis (top edge comes toward you) or Y axis. */
  axis: 'x' | 'y';
}

export type Step = FoldStep | FlipStep;

/** Everything the view and the input layer need to animate one step. */
export interface PreparedStep {
  step: Step;
  index: number;
  /** Point on the hinge, fold space. */
  origin: V3;
  /** Unit hinge axis, oriented so positive angles lift the moving side. */
  axis: V3;
  /** Target angle (signed). */
  target: number;
  /** Handle position at angle 0, fold space. */
  handle: V3;
  /** Unit vector in the board plane from the hinge toward the handle. */
  radial: V3;
  /** Distance from hinge to handle. */
  radius: number;
  movingIds: Set<number>;
  /** Extra lift so a moving flap never sinks into the stack it crosses. */
  lift: number;
  /** Fold line clipped to the moving+static selection footprint, for the guide. */
  guide: [V3, V3];
}

const STACK_STEP = 1;

/** A committed crease, remembered so the finished model can relax open. */
export interface Crease {
  /** Two points on the hinge, in paper coordinates of the static side. */
  a: V2;
  b: V2;
}

export class Sheet {
  facets: Facet[] = [];
  /** Hinge of each committed fold step, by step index. */
  creases: (Crease | undefined)[] = [];
  private nextId = 1;

  /** Initial in-plane rotation of the sheet, degrees (e.g. 45 = diamond). */
  turn = 0;

  constructor(turn = 0) {
    this.turn = turn;
    this.reset();
  }

  reset(): void {
    this.nextId = 1;
    this.creases = [];
    const a = (this.turn * Math.PI) / 180;
    const m0 = identity();
    m0[0] = Math.cos(a);
    m0[1] = Math.sin(a);
    m0[4] = -Math.sin(a);
    m0[5] = Math.cos(a);
    this.facets = [
      {
        id: this.nextId++,
        poly: [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ],
        m: m0,
        order: 0,
        stack: 0,
        hist: 0,
        flat: true,
      },
    ];
  }

  clone(): Sheet {
    const s = new Sheet(this.turn);
    s.nextId = this.nextId;
    s.creases = this.creases.map((c) => (c ? { a: [...c.a] as V2, b: [...c.b] as V2 } : undefined));
    s.facets = this.facets.map((f) => ({
      ...f,
      poly: f.poly.map((p) => [p[0], p[1]] as V2),
      m: f.m.slice(),
    }));
    return s;
  }

  /** Fold-space XY polygon of a facet (ignores stack offset). */
  footprint(f: Facet): V2[] {
    return f.poly.map((p) => {
      const q = apply(f.m, [p[0], p[1], 0]);
      return [q[0], q[1]] as V2;
    });
  }

  /** Locate a paper point and return its fold-space position (with stack). */
  locate(pt: PaperPt, stackHeight = 0): V3 | null {
    if (isAt(pt)) {
      const xy = pt.at;
      return [xy[0], xy[1], this.stackAt(xy) * stackHeight];
    }
    const p = pt;
    let best: Facet | null = null;
    for (const f of this.facets) {
      if (pointInConvex(f.poly, p, 1e-4)) {
        if (!best || f.stack > best.stack) best = f;
      }
    }
    if (!best) return null;
    const q = apply(best.m, [p[0], p[1], 0]);
    if (best.flat) q[2] += best.stack * stackHeight;
    return q;
  }

  /** Top stack height over a fold-space XY point (for placing handles). */
  stackAt(xy: V2): number {
    let top = 0;
    for (const f of this.facets) {
      if (!f.flat) continue;
      if (pointInConvex(this.footprint(f), xy, 1e-4)) top = Math.max(top, f.stack);
    }
    return top;
  }

  private selected(f: Facet, sel?: Selection): boolean {
    if (!f.flat) return false;
    if (!sel) return true;
    if (sel.movedIn) for (const s of sel.movedIn) if (!(f.hist & (1 << s))) return false;
    if (sel.notMovedIn) for (const s of sel.notMovedIn) if (f.hist & (1 << s)) return false;
    return true;
  }

  /**
   * Resolve a step against the current sheet. Splits facets along the fold
   * line (a permanent, harmless change: split facets render identically) and
   * returns the animation frame of reference.
   */
  prepare(step: Step, index: number): PreparedStep {
    if (step.kind === 'flip') return this.prepareFlip(step, index);

    const sel = step.sel;
    const posOf = (p: PaperPt): V3 => {
      const q = this.locate(p);
      if (!q) throw new Error(`Step ${index}: point ${JSON.stringify(p)} is not on the sheet`);
      return q;
    };

    let o2: V2;
    let d2: V2;
    if ('bisect' in step.line) {
      const a = posOf(step.line.bisect[0]);
      const b = posOf(step.line.bisect[1]);
      o2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      d2 = norm2([-(b[1] - a[1]), b[0] - a[0]]);
    } else {
      const a = posOf(step.line.through[0]);
      const b = posOf(step.line.through[1]);
      o2 = [a[0], a[1]];
      d2 = norm2([b[0] - a[0], b[1] - a[1]]);
    }

    const mv = posOf(step.move);
    const side = Math.sign(cross2(d2, sub2([mv[0], mv[1]], o2)));
    if (side === 0) throw new Error(`Step ${index}: move point lies on the fold line`);
    const sideOf = (v: V2): number => cross2(d2, sub2(v, o2)) * side;

    // Split selected facets crossed by the line.
    const next: Facet[] = [];
    const moving = new Set<number>();
    for (const f of this.facets) {
      if (!this.selected(f, sel)) {
        next.push(f);
        continue;
      }
      const fp = this.footprint(f);
      const ds = fp.map(sideOf);
      const hasPos = ds.some((d) => d > 1e-7);
      const hasNeg = ds.some((d) => d < -1e-7);
      if (hasPos && !hasNeg) {
        next.push(f);
        moving.add(f.id);
        continue;
      }
      if (!hasPos) {
        next.push(f);
        continue;
      }
      const pos: V2[] = [];
      const neg: V2[] = [];
      const n = f.poly.length;
      for (let i = 0; i < n; i++) {
        const a = f.poly[i];
        const b = f.poly[(i + 1) % n];
        const da = ds[i];
        const db = ds[(i + 1) % n];
        if (da >= -1e-9) pos.push(a);
        if (da <= 1e-9) neg.push(a);
        if ((da > 1e-9 && db < -1e-9) || (da < -1e-9 && db > 1e-9)) {
          const t = da / (da - db);
          const x = lerp2(a, b, t);
          pos.push(x);
          neg.push(x);
        }
      }
      const clean = (poly: V2[]): V2[] => {
        const out: V2[] = [];
        for (const p of poly) {
          const last = out[out.length - 1];
          if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) > 1e-7) out.push(p);
        }
        if (out.length > 1) {
          const a = out[0];
          const b = out[out.length - 1];
          if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-7) out.pop();
        }
        return out;
      };
      const P = clean(pos);
      const N = clean(neg);
      if (P.length >= 3 && Math.abs(polygonArea(P)) > 1e-7) {
        const fa: Facet = { ...f, id: this.nextId++, poly: P, m: f.m.slice() };
        next.push(fa);
        moving.add(fa.id);
      }
      if (N.length >= 3 && Math.abs(polygonArea(N)) > 1e-7) {
        next.push({ ...f, id: this.nextId++, poly: N, m: f.m.slice() });
      }
    }
    this.facets = next;

    // Axis oriented so a positive rotation lifts the moving side (+Z).
    const axis: V3 = side > 0 ? [d2[0], d2[1], 0] : [-d2[0], -d2[1], 0];
    const origin: V3 = [o2[0], o2[1], 0];
    const dir = step.dir ?? 1;
    const target = (step.angle ?? Math.PI) * dir;

    const hp = posOf(step.handle ?? step.move);
    const hv: V2 = sub2([hp[0], hp[1]], o2);
    const along = dot2(hv, d2);
    const radialV: V2 = [hv[0] - d2[0] * along, hv[1] - d2[1] * along];
    const radius = Math.hypot(radialV[0], radialV[1]);
    const radial: V3 = [radialV[0] / (radius || 1), radialV[1] / (radius || 1), 0];

    let maxStack = 0;
    for (const f of this.facets) if (f.flat) maxStack = Math.max(maxStack, f.stack);

    return {
      step,
      index,
      origin,
      axis,
      target,
      handle: [hp[0], hp[1], 0],
      radial,
      radius,
      movingIds: moving,
      lift: maxStack + 1,
      guide: this.clipGuide(o2, d2, sel),
    };
  }

  private prepareFlip(step: FlipStep, index: number): PreparedStep {
    const [min, max] = this.bounds();
    const cx = (min[0] + max[0]) / 2;
    const cy = (min[1] + max[1]) / 2;
    // Flipping about X: the top edge (+Y) comes toward the player and over.
    // Handle sits on the far edge so the gesture is "lift the far edge, flip it".
    const axis: V3 = step.axis === 'x' ? [-1, 0, 0] : [0, 1, 0];
    const handle: V3 = step.axis === 'x' ? [cx, max[1], 0] : [min[0], cy, 0];
    const radial: V3 = step.axis === 'x' ? [0, 1, 0] : [-1, 0, 0];
    const radius = step.axis === 'x' ? max[1] - cy : cx - min[0];
    // Make sure the rotation lifts the handle: cross(axis, radial) must be +Z.
    const cz = axis[0] * radial[1] - axis[1] * radial[0];
    if (cz < 0) {
      axis[0] = -axis[0];
      axis[1] = -axis[1];
    }
    const ids = new Set(this.facets.filter((f) => f.flat).map((f) => f.id));
    const guide: [V3, V3] =
      step.axis === 'x'
        ? [
            [min[0], cy, 0],
            [max[0], cy, 0],
          ]
        : [
            [cx, min[1], 0],
            [cx, max[1], 0],
          ];
    return {
      step,
      index,
      origin: [cx, cy, 0],
      axis,
      target: Math.PI,
      handle,
      radial,
      radius,
      movingIds: ids,
      lift: 0,
      guide,
    };
  }

  /** Fold-space bounds of the flat sheet. */
  bounds(): [V2, V2] {
    const min: V2 = [Infinity, Infinity];
    const max: V2 = [-Infinity, -Infinity];
    for (const f of this.facets) {
      for (const p of this.footprint(f)) {
        min[0] = Math.min(min[0], p[0]);
        min[1] = Math.min(min[1], p[1]);
        max[0] = Math.max(max[0], p[0]);
        max[1] = Math.max(max[1], p[1]);
      }
    }
    return [min, max];
  }

  private clipGuide(o: V2, d: V2, sel?: Selection): [V3, V3] {
    let tMin = Infinity;
    let tMax = -Infinity;
    for (const f of this.facets) {
      if (!this.selected(f, sel)) continue;
      for (const p of this.footprint(f)) {
        const t = dot2(sub2(p, o), d);
        // Only extend along the line where the footprint actually reaches it.
        const off = Math.abs(cross2(d, sub2(p, o)));
        if (off < 0.6) {
          tMin = Math.min(tMin, t);
          tMax = Math.max(tMax, t);
        }
      }
    }
    if (!isFinite(tMin)) {
      tMin = -1;
      tMax = 1;
    }
    // Shrink to the actual crossing by sampling the union of facets.
    const samples = 64;
    let a = tMax;
    let b = tMin;
    for (let i = 0; i <= samples; i++) {
      const t = tMin + ((tMax - tMin) * i) / samples;
      const p: V2 = [o[0] + d[0] * t, o[1] + d[1] * t];
      for (const f of this.facets) {
        if (!this.selected(f, sel)) continue;
        if (pointInConvex(this.footprint(f), p, 1e-4)) {
          a = Math.min(a, t);
          b = Math.max(b, t);
          break;
        }
      }
    }
    if (a > b) {
      a = tMin;
      b = tMax;
    }
    return [
      [o[0] + d[0] * a, o[1] + d[1] * a, 0],
      [o[0] + d[0] * b, o[1] + d[1] * b, 0],
    ];
  }

  /** Rotation matrix for a prepared step at angle `theta` (radians). */
  static rotation(p: PreparedStep, theta: number): M4 {
    return rotationAbout(p.origin, p.axis, theta);
  }

  /** Apply the finished step permanently. */
  commit(p: PreparedStep): void {
    const R = Sheet.rotation(p, p.target);
    const flatResult = Math.abs(Math.abs(p.target) - Math.PI) < 1e-3;
    const moving = this.facets.filter((f) => p.movingIds.has(f.id));
    if (moving.length === 0) return;

    if (p.step.kind === 'flip') {
      for (const f of this.facets) {
        if (!p.movingIds.has(f.id)) continue;
        f.m = mul(R, f.m);
        f.order = -f.order;
      }
    } else {
      this.creases[p.index] = this.creaseOf(p);
      const bit = 1 << p.index;
      let maxAll = -Infinity;
      let minAll = Infinity;
      for (const f of this.facets) {
        maxAll = Math.max(maxAll, f.order);
        minAll = Math.min(minAll, f.order);
      }
      let maxMv = -Infinity;
      let minMv = Infinity;
      for (const f of moving) {
        maxMv = Math.max(maxMv, f.order);
        minMv = Math.min(minMv, f.order);
      }
      const valley = p.target > 0;
      for (const f of moving) {
        f.m = mul(R, f.m);
        f.hist |= bit;
        if (!flatResult) {
          f.flat = false;
          continue;
        }
        // A folded flap lands upside down on the other side: its layer order reverses.
        f.order = valley ? maxAll + 1 + (maxMv - f.order) : minAll - 1 - (f.order - minMv);
      }
    }
    this.snapFlat();
    this.restack();
  }

  /** Remove numeric drift so flat facets stay exactly in the board plane. */
  private snapFlat(): void {
    for (const f of this.facets) {
      if (!f.flat) continue;
      const nz = normalZ(f.m) > 0 ? 1 : -1;
      // Clean the rotation part to an exact in-plane rotation / reflection.
      const a = Math.atan2(f.m[1], f.m[0]);
      const c = Math.cos(a);
      const s = Math.sin(a);
      f.m[0] = c;
      f.m[1] = s;
      f.m[2] = 0;
      f.m[4] = -s * nz;
      f.m[5] = c * nz;
      f.m[6] = 0;
      f.m[8] = 0;
      f.m[9] = 0;
      f.m[10] = nz;
      f.m[14] = 0;
      f.m[3] = f.m[7] = f.m[11] = 0;
      f.m[15] = 1;
    }
  }

  /** Paper coordinates of a fold-space XY point on a given facet. */
  static toPaper(f: Facet, xy: V2): V2 {
    // Flat facets: inverse of an in-plane rigid transform (rotation or reflection).
    const m = f.m;
    const x = xy[0] - m[12];
    const y = xy[1] - m[13];
    // Columns 0 and 1 are orthonormal: project onto them.
    return [x * m[0] + y * m[1], x * m[4] + y * m[5]];
  }

  private creaseOf(p: PreparedStep): Crease | undefined {
    const pick = (pt: V3): V2 | null => {
      const xy: V2 = [pt[0], pt[1]];
      let best: Facet | null = null;
      for (const f of this.facets) {
        if (!f.flat || p.movingIds.has(f.id)) continue;
        if (pointInConvex(this.footprint(f), xy, 1e-3)) {
          if (!best || f.stack > best.stack) best = f;
        }
      }
      return best ? Sheet.toPaper(best, xy) : null;
    };
    // Sample two points well inside the hinge segment.
    const [g0, g1] = p.guide;
    const at = (t: number): V3 => [g0[0] + (g1[0] - g0[0]) * t, g0[1] + (g1[1] - g0[1]) * t, 0];
    const a = pick(at(0.2)) ?? pick(at(0.05));
    const b = pick(at(0.8)) ?? pick(at(0.95));
    return a && b ? { a, b } : undefined;
  }

  /** Locate a paper point using only facets that pass `filter`. */
  locateWithin(p: V2, filter: (f: Facet) => boolean): { pos: V3; facet: Facet } | null {
    let best: Facet | null = null;
    for (const f of this.facets) {
      if (!filter(f)) continue;
      if (pointInConvex(f.poly, p, 1e-4)) {
        if (!best || f.stack > best.stack) best = f;
      }
    }
    if (!best) return null;
    return { pos: apply(best.m, [p[0], p[1], 0]), facet: best };
  }

  /** Recompute compact stack heights from the global layer order. */
  restack(): void {
    const flat = this.facets.filter((f) => f.flat).sort((a, b) => a.order - b.order);
    const prints = new Map<number, V2[]>();
    for (const f of flat) prints.set(f.id, this.footprint(f));
    for (let i = 0; i < flat.length; i++) {
      const f = flat[i];
      let h = 0;
      const pf = prints.get(f.id)!;
      for (let j = 0; j < i; j++) {
        const g = flat[j];
        if (g.order >= f.order) continue;
        if (g.stack + STACK_STEP <= h) continue;
        if (convexOverlap(pf, prints.get(g.id)!)) h = Math.max(h, g.stack + STACK_STEP);
      }
      f.stack = h;
    }
  }

  /** Total paper area visible from above vs. original, a cheap sanity metric. */
  footprintArea(): number {
    let a = 0;
    for (const f of this.facets) a += Math.abs(polygonArea(f.poly));
    return a;
  }

  maxStack(): number {
    let m = 0;
    for (const f of this.facets) if (f.flat) m = Math.max(m, f.stack);
    return m;
  }

  /** Paper corners/points helper: fold-space position, or throw. */
  at(p: PaperPt): V3 {
    const q = this.locate(p);
    if (!q) throw new Error(`point ${JSON.stringify(p)} not found`);
    return q;
  }
}

/** Run a list of steps to completion; used by tools, tests and previews. */
export function foldAll(steps: Step[], upTo = steps.length, turn = 0): Sheet {
  const s = new Sheet(turn);
  for (let i = 0; i < upTo; i++) s.commit(s.prepare(steps[i], i));
  return s;
}

export { EPS };
