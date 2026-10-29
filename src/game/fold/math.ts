/**
 * Tiny, allocation-aware math for the fold engine.
 *
 * The engine deliberately has no Three.js dependency so it can run in Node for
 * model design tools and tests. Matrices are column-major number[16], the same
 * layout as THREE.Matrix4.elements, so the view layer can copy them directly.
 */

export type V2 = [number, number];
export type V3 = [number, number, number];
export type M4 = number[];

export const EPS = 1e-6;

export function identity(): M4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** out = a * b (column-major). */
export function mul(a: M4, b: M4, out: M4 = new Array(16)): M4 {
  const r = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let rI = 0; rI < 4; rI++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + rI] * b[c * 4 + k];
      r[c * 4 + rI] = s;
    }
  }
  for (let i = 0; i < 16; i++) out[i] = r[i];
  return out;
}

export function translation(x: number, y: number, z: number): M4 {
  const m = identity();
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
}

/** Rotation by `angle` around unit axis `k` passing through point `o`. */
export function rotationAbout(o: V3, k: V3, angle: number): M4 {
  const [x, y, z] = k;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  const r: M4 = [
    t * x * x + c,
    t * x * y + s * z,
    t * x * z - s * y,
    0,
    t * x * y - s * z,
    t * y * y + c,
    t * y * z + s * x,
    0,
    t * x * z + s * y,
    t * y * z - s * x,
    t * z * z + c,
    0,
    0,
    0,
    0,
    1,
  ];
  return mul(translation(o[0], o[1], o[2]), mul(r, translation(-o[0], -o[1], -o[2])));
}

export function apply(m: M4, p: V3): V3 {
  const [x, y, z] = p;
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

/** z component of the transformed +Z normal: +1 face up, -1 face down. */
export function normalZ(m: M4): number {
  return m[10];
}

export const sub2 = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
export const add2 = (a: V2, b: V2): V2 => [a[0] + b[0], a[1] + b[1]];
export const scale2 = (a: V2, s: number): V2 => [a[0] * s, a[1] * s];
export const dot2 = (a: V2, b: V2): number => a[0] * b[0] + a[1] * b[1];
export const cross2 = (a: V2, b: V2): number => a[0] * b[1] - a[1] * b[0];
export const len2 = (a: V2): number => Math.hypot(a[0], a[1]);
export const norm2 = (a: V2): V2 => {
  const l = len2(a) || 1;
  return [a[0] / l, a[1] / l];
};
export const lerp2 = (a: V2, b: V2, t: number): V2 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];

export function polygonArea(poly: V2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function pointInConvex(poly: V2[], p: V2, eps = 1e-5): boolean {
  // Works for either winding.
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const c = cross2(sub2(b, a), sub2(p, a));
    if (Math.abs(c) <= eps) continue;
    const s = c > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/**
 * Separating-axis overlap test for convex polygons with a shrink tolerance so
 * that facets merely sharing an edge or a vertex do not count as stacked.
 */
export function convexOverlap(a: V2[], b: V2[], tol = 1e-4): boolean {
  const test = (poly: V2[]): boolean => {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const axis: V2 = [-(q[1] - p[1]), q[0] - p[0]];
      const l = len2(axis);
      if (l < EPS) continue;
      axis[0] /= l;
      axis[1] /= l;
      let minA = Infinity;
      let maxA = -Infinity;
      let minB = Infinity;
      let maxB = -Infinity;
      for (const v of a) {
        const d = dot2(v, axis);
        minA = Math.min(minA, d);
        maxA = Math.max(maxA, d);
      }
      for (const v of b) {
        const d = dot2(v, axis);
        minB = Math.min(minB, d);
        maxB = Math.max(maxB, d);
      }
      if (maxA - tol <= minB || maxB - tol <= minA) return false;
    }
    return true;
  };
  return test(a) && test(b);
}
