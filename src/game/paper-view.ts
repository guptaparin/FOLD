/**
 * Three.js view of a fold Sheet, plus the fold guides (handle, ghost, crease
 * line, path dots). Everything here lives in "fold space": the PaperView root
 * is scaled so one fold unit = half the paper's width.
 */
import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  FrontSide,
  Group,
  LineBasicMaterial,
  LineLoop,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RingGeometry,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  Texture,
  Vector3,
} from '@iwsdk/core';
import type { Facet, PreparedStep, Sheet } from './fold/engine.js';
import { glowTexture } from './textures.js';

/** Paper half-width in metres: a 20 cm kami sheet, true to life. */
export const PAPER_HALF = 0.1;
/** Visual thickness per stacked layer, in fold units (0.4 mm). */
export const LAYER = 0.004;

interface FacetObj {
  facet: Facet;
  group: Group;
  front: Mesh;
  back: Mesh;
  edge: LineLoop;
  base: Matrix4;
  /** Optional extra transform applied after the base (life animation). */
  extra: Matrix4 | null;
}

function facetGeometry(f: Facet): BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const nrm: number[] = [];
  const p0 = f.poly[0];
  for (let i = 1; i < f.poly.length - 1; i++) {
    for (const p of [p0, f.poly[i], f.poly[i + 1]]) {
      pos.push(p[0], p[1], 0);
      uv.push((p[0] + 1) / 2, (p[1] + 1) / 2);
      nrm.push(0, 0, 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
  g.computeBoundingSphere();
  return g;
}

function edgeGeometry(f: Facet): BufferGeometry {
  const pos: number[] = [];
  for (const p of f.poly) pos.push(p[0], p[1], 0);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  return g;
}

export class PaperView {
  readonly root = new Group();
  private objs = new Map<number, FacetObj>();
  frontMat: MeshStandardMaterial;
  backMat: MeshStandardMaterial;
  private edgeMat = new LineBasicMaterial({
    color: 0x3b2a1d,
    transparent: true,
    opacity: 0.28,
  });
  /** Facets currently animating with the active step. */
  private moving = new Set<number>();
  private glowColor = new Color(0x000000);

  private R = new Matrix4();
  private T = new Matrix4();
  private tmp = new Matrix4();
  private axisV = new Vector3();
  private originV = new Vector3();

  constructor(front: Texture, back: Texture) {
    this.root.name = 'Paper';
    this.root.scale.setScalar(PAPER_HALF);
    const common = {
      roughness: 0.86,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    };
    this.frontMat = new MeshStandardMaterial({ ...common, map: front, side: FrontSide });
    this.backMat = new MeshStandardMaterial({ ...common, map: back, side: BackSide });
  }

  setTextures(front: Texture, back: Texture): void {
    this.frontMat.map = front;
    this.backMat.map = back;
    this.frontMat.needsUpdate = true;
    this.backMat.needsUpdate = true;
  }

  /** Brief warm emissive pulse (crease made, model alive...). */
  setGlow(amount: number, color = 0xffc77a): void {
    this.glowColor.setHex(color).multiplyScalar(amount);
    this.frontMat.emissive.copy(this.glowColor);
    this.backMat.emissive.copy(this.glowColor);
  }

  /** Create/destroy facet objects so they mirror the sheet. */
  sync(sheet: Sheet): void {
    const alive = new Set<number>();
    for (const f of sheet.facets) {
      alive.add(f.id);
      let o = this.objs.get(f.id);
      if (!o) {
        const geo = facetGeometry(f);
        const group = new Group();
        group.matrixAutoUpdate = false;
        const front = new Mesh(geo, this.frontMat);
        const back = new Mesh(geo, this.backMat);
        front.castShadow = back.castShadow = true;
        front.receiveShadow = back.receiveShadow = true;
        const edge = new LineLoop(edgeGeometry(f), this.edgeMat);
        group.add(front, back, edge);
        this.root.add(group);
        o = { facet: f, group, front, back, edge, base: new Matrix4(), extra: null };
        this.objs.set(f.id, o);
      }
      o.facet = f;
      o.base.fromArray(f.m);
      if (f.flat) {
        this.T.makeTranslation(0, 0, f.stack * LAYER);
        o.base.premultiply(this.T);
      }
    }
    for (const [id, o] of this.objs) {
      if (alive.has(id)) continue;
      o.front.geometry.dispose();
      o.edge.geometry.dispose();
      this.root.remove(o.group);
      this.objs.delete(id);
    }
    this.pose(null, 0);
  }

  /** Pose the sheet, animating the prepared step at angle `theta`. */
  pose(p: PreparedStep | null, theta: number): void {
    this.moving = p ? p.movingIds : new Set();
    let maxMv = 0;
    if (p) {
      this.originV.set(p.origin[0], p.origin[1], p.origin[2]);
      this.axisV.set(p.axis[0], p.axis[1], p.axis[2]);
      this.R.makeTranslation(-this.originV.x, -this.originV.y, -this.originV.z);
      this.tmp.makeRotationAxis(this.axisV, theta);
      this.R.premultiply(this.tmp);
      this.tmp.makeTranslation(this.originV.x, this.originV.y, this.originV.z);
      this.R.premultiply(this.tmp);
      for (const id of p.movingIds) {
        const o = this.objs.get(id);
        if (o && o.facet.flat) maxMv = Math.max(maxMv, o.facet.stack);
      }
    }
    const target = p ? p.target : Math.PI;
    const sgn = target >= 0 ? 1 : -1;
    const denom = 1 - Math.cos(target) || 1;
    const prog = (1 - Math.cos(theta)) / denom;
    const flip = p?.step.kind === 'flip';

    for (const o of this.objs.values()) {
      const g = o.group;
      if (p && this.moving.has(o.facet.id)) {
        const st = o.facet.flat ? o.facet.stack : 0;
        const zFinal = (p.lift + (maxMv - st)) * LAYER;
        let z = prog * (sgn * zFinal + st * LAYER);
        if (flip) z += Math.sin(Math.abs(theta)) * p.radius * 0.55;
        this.T.makeTranslation(0, 0, z);
        g.matrix.multiplyMatrices(this.T, this.R).multiply(o.base);
      } else {
        g.matrix.copy(o.base);
      }
      if (o.extra) g.matrix.premultiply(o.extra);
      g.matrixWorldNeedsUpdate = true;
    }
  }

  /** Extra transform for one facet (used by the "comes to life" opening). */
  setExtra(id: number, m: Matrix4 | null): void {
    const o = this.objs.get(id);
    if (o) o.extra = m;
  }

  /**
   * Bounds of the paper in the space given by `parent` (a matrix mapping
   * this root's parent space into the target space). Uses current poses.
   */
  bounds(parent: Matrix4, outMin: Vector3, outMax: Vector3): void {
    outMin.set(Infinity, Infinity, Infinity);
    outMax.set(-Infinity, -Infinity, -Infinity);
    this.root.updateMatrix();
    const v = new Vector3();
    const m = new Matrix4();
    for (const o of this.objs.values()) {
      m.multiplyMatrices(parent, this.root.matrix).multiply(o.group.matrix);
      for (const p of o.facet.poly) {
        v.set(p[0], p[1], 0).applyMatrix4(m);
        outMin.min(v);
        outMax.max(v);
      }
    }
  }

  facetIds(): number[] {
    return [...this.objs.keys()];
  }

  dispose(): void {
    for (const o of this.objs.values()) {
      o.front.geometry.dispose();
      o.edge.geometry.dispose();
    }
    this.objs.clear();
    this.root.clear();
  }
}

// ---------------------------------------------------------------------------

const creaseVert = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const creaseFrag = /* glsl */ `
  uniform float uTime;
  uniform float uLen;
  uniform vec3 uColor;
  uniform float uAlpha;
  varying vec2 vUv;
  void main() {
    float along = vUv.x * uLen;
    float dash = step(0.5, fract(along * 6.0 - uTime * 1.4));
    float edge = 1.0 - abs(vUv.y - 0.5) * 2.0;
    float a = (0.35 + 0.65 * dash) * smoothstep(0.0, 0.5, edge) * uAlpha;
    float fade = smoothstep(0.0, 0.06, vUv.x) * smoothstep(1.0, 0.94, vUv.x);
    gl_FragColor = vec4(uColor, a * fade);
  }
`;

/**
 * The visual language of a fold: a breathing handle where you pinch, a
 * marching crease line, a ghost of where the flap will land and a trail of
 * dots between the two.
 */
export class FoldGuides {
  readonly root = new Group();
  private handle = new Group();
  private ring: Mesh;
  private core: Mesh;
  private halo: Sprite;
  private target: Sprite;
  private dots: Sprite[] = [];
  private crease: Mesh;
  private creaseMat: ShaderMaterial;
  private ghost = new Group();
  private ghostMat = new MeshBasicMaterial({
    color: 0xfff2d6,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    side: DoubleSide,
  });
  private ghostEdge = new LineBasicMaterial({ color: 0xffe2a8, transparent: true, opacity: 0.6 });
  private prepared: PreparedStep | null = null;
  private tmpM = new Matrix4();
  private tmpT = new Matrix4();
  private v = new Vector3();
  private o = new Vector3();
  private a = new Vector3();
  /** World-space handle position, refreshed every frame. */
  readonly handleWorld = new Vector3();
  hovered = false;
  grabbed = false;
  visible = false;
  /** Accessibility: brighter, thicker guides. */
  highContrast = false;

  constructor() {
    this.root.name = 'FoldGuides';
    const glow = glowTexture();
    this.ring = new Mesh(
      new RingGeometry(0.1, 0.13, 40),
      new MeshBasicMaterial({ color: 0xffd38a, transparent: true, opacity: 0.95, depthWrite: false, side: DoubleSide }),
    );
    this.core = new Mesh(
      new CircleGeometry(0.045, 24),
      new MeshBasicMaterial({ color: 0xfff6e0, transparent: true, opacity: 0.95, depthWrite: false, side: DoubleSide }),
    );
    this.halo = new Sprite(
      new SpriteMaterial({ map: glow, color: 0xffb860, transparent: true, opacity: 0.8, depthWrite: false, blending: AdditiveBlending }),
    );
    this.halo.scale.setScalar(0.55);
    this.handle.add(this.ring, this.core, this.halo);
    this.handle.renderOrder = 10;
    this.target = new Sprite(
      new SpriteMaterial({ map: glow, color: 0x9fe8ff, transparent: true, opacity: 0.85, depthWrite: false, blending: AdditiveBlending }),
    );
    this.target.scale.setScalar(0.32);
    for (let i = 0; i < 14; i++) {
      const s = new Sprite(
        new SpriteMaterial({ map: glow, color: 0xfff0c8, transparent: true, opacity: 0.5, depthWrite: false, blending: AdditiveBlending }),
      );
      s.scale.setScalar(0.07);
      this.dots.push(s);
      this.root.add(s);
    }
    this.creaseMat = new ShaderMaterial({
      vertexShader: creaseVert,
      fragmentShader: creaseFrag,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uLen: { value: 1 },
        uColor: { value: new Color(0xffe6b0) },
        uAlpha: { value: 1 },
      },
    });
    this.crease = new Mesh(new PlaneGeometry(1, 1), this.creaseMat);
    this.crease.matrixAutoUpdate = false;
    this.root.add(this.handle, this.target, this.crease, this.ghost);
    this.setVisible(false);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.root.visible = v;
  }

  /** Build guides for a freshly prepared step. */
  show(sheet: Sheet, p: PreparedStep): void {
    this.prepared = p;
    // Ghost of the flap at its destination.
    for (const c of [...this.ghost.children]) {
      const m = c as Mesh;
      m.geometry.dispose();
      this.ghost.remove(c);
    }
    const R = new Matrix4().fromArray(rotationAboutFlat(p, p.target));
    for (const f of sheet.facets) {
      if (!p.movingIds.has(f.id)) continue;
      const geo = facetGeometry(f);
      const mesh = new Mesh(geo, this.ghostMat);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.fromArray(f.m);
      const lift = new Matrix4().makeTranslation(0, 0, (p.lift + 2) * LAYER + 0.01);
      mesh.matrix.premultiply(R).premultiply(lift);
      if (p.step.kind === 'flip') mesh.visible = false;
      const edge = new LineLoop(edgeGeometry(f), this.ghostEdge);
      mesh.add(edge);
      this.ghost.add(mesh);
    }
    // Crease strip.
    const [a, b] = p.guide;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 0.001;
    const z = (sheet.maxStack() + 2) * LAYER + 0.006;
    const w = this.highContrast ? 0.05 : 0.03;
    this.crease.matrix
      .makeRotationZ(Math.atan2(dy, dx))
      .premultiply(this.tmpT.makeTranslation((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z));
    this.crease.matrix.multiply(this.tmpM.makeScale(len, w, 1));
    this.crease.matrixWorldNeedsUpdate = true;
    this.creaseMat.uniforms.uLen.value = len;
    this.ring.scale.setScalar(this.highContrast ? 1.35 : 1);
    this.setVisible(true);
  }

  hide(): void {
    this.prepared = null;
    this.setVisible(false);
  }

  /**
   * Per-frame: place handle at its current animated position, pulse, and run
   * the trail of dots from handle to target.
   */
  update(sheet: Sheet, theta: number, time: number): void {
    const p = this.prepared;
    if (!p || !this.visible) return;
    const top = (sheet.stackAt([p.handle[0], p.handle[1]]) + 1) * LAYER + 0.012;
    // Rotate the handle point by theta about the hinge.
    this.handlePoint(p, theta, top, this.v);
    this.handle.position.copy(this.v);
    const k = this.grabbed ? 1.25 : this.hovered ? 1.15 : 1 + Math.sin(time * 4) * 0.08;
    this.handle.scale.setScalar(k);
    (this.halo.material as SpriteMaterial).opacity = this.grabbed ? 1 : this.hovered ? 0.95 : 0.55 + Math.sin(time * 4) * 0.2;
    // Orient handle disc to the moving flap.
    this.handle.quaternion.setFromAxisAngle(this.a.set(p.axis[0], p.axis[1], p.axis[2]), theta);

    this.handlePoint(p, p.target, top + (p.lift + 2) * LAYER, this.o);
    this.target.position.copy(this.o);
    this.target.visible = p.step.kind !== 'flip';
    (this.target.material as SpriteMaterial).opacity = 0.55 + Math.sin(time * 3) * 0.25;

    const n = this.dots.length;
    const span = p.target - theta;
    for (let i = 0; i < n; i++) {
      const t = (i + 1) / (n + 1);
      this.handlePoint(p, theta + span * t, top, this.v);
      const d = this.dots[i];
      d.position.copy(this.v);
      const wave = Math.max(0, Math.sin((t - time * 0.7) * Math.PI * 2));
      (d.material as SpriteMaterial).opacity = (this.grabbed ? 0.15 : 0.25) + wave * 0.55;
      d.visible = Math.abs(span) > 0.05;
    }
    this.creaseMat.uniforms.uTime.value = time;
    this.creaseMat.uniforms.uAlpha.value = this.grabbed ? 1 : 0.75;
    this.ghost.visible = !this.grabbed || theta < p.target * 0.9;
    this.ghostMat.opacity = this.highContrast ? 0.3 : 0.16;
    // World handle position for input hit-testing.
    this.handle.getWorldPosition(this.handleWorld);
  }

  /** Handle position (fold space) at fold angle `ang`, raised by `z`. */
  handlePoint(p: PreparedStep, ang: number, z: number, out: Vector3): Vector3 {
    const r = p.radius;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    // In-plane radial, rotated up toward +Z around the axis.
    const ox = p.handle[0] - p.radial[0] * r;
    const oy = p.handle[1] - p.radial[1] * r;
    out.set(ox + p.radial[0] * r * c, oy + p.radial[1] * r * c, r * s + z);
    if (p.step.kind === 'flip') out.z += Math.sin(Math.abs(ang)) * r * 0.55;
    return out;
  }
}

function rotationAboutFlat(p: PreparedStep, theta: number): number[] {
  const m = new Matrix4();
  const t1 = new Matrix4().makeTranslation(-p.origin[0], -p.origin[1], -p.origin[2]);
  const r = new Matrix4().makeRotationAxis(new Vector3(p.axis[0], p.axis[1], p.axis[2]), theta);
  const t2 = new Matrix4().makeTranslation(p.origin[0], p.origin[1], p.origin[2]);
  m.multiplyMatrices(t2, r).multiply(t1);
  return m.toArray();
}
