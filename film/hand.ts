/**
 * A soft porcelain right hand for the film, built from capsules so it reads as
 * hand tracking without imitating any platform's own hand art.
 *
 * Local frame: the pinch point is the origin, fingers point along -Z, +Y is up,
 * +X is the hand's right. `pinch` 0 = open, 1 = thumb and index touching.
 */
import {
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';

type P = [number, number, number];

const lerp3 = (a: P, b: P, t: number): Vector3 =>
  new Vector3(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);

// Joint chains (metres), pinched pose and open pose.
const CHAINS: { r: number; closed: P[]; open: P[] }[] = [
  // Thumb: CMC, MCP, IP, tip
  {
    r: 0.0088,
    closed: [[0.046, 0.016, 0.088], [0.032, 0.006, 0.057], [0.016, 0.0, 0.028], [0.004, -0.001, 0.008]],
    open: [[0.046, 0.016, 0.088], [0.036, 0.004, 0.06], [0.026, -0.004, 0.036], [0.018, -0.008, 0.02]],
  },
  // Index: MCP, PIP, DIP, tip
  {
    r: 0.0078,
    closed: [[0.012, 0.034, 0.05], [0.0, 0.03, 0.024], [-0.006, 0.016, 0.006], [-0.003, 0.004, -0.002]],
    open: [[0.012, 0.034, 0.05], [0.002, 0.036, 0.024], [-0.006, 0.03, 0.004], [-0.01, 0.022, -0.012]],
  },
  // Middle (curled under)
  {
    r: 0.0076,
    closed: [[0.024, 0.036, 0.052], [0.016, 0.026, 0.028], [0.018, 0.008, 0.026], [0.022, -0.002, 0.04]],
    open: [[0.024, 0.036, 0.052], [0.018, 0.03, 0.026], [0.018, 0.014, 0.018], [0.02, 0.002, 0.026]],
  },
  // Ring
  {
    r: 0.0072,
    closed: [[0.035, 0.032, 0.058], [0.03, 0.022, 0.036], [0.032, 0.006, 0.036], [0.035, -0.002, 0.048]],
    open: [[0.035, 0.032, 0.058], [0.032, 0.026, 0.034], [0.032, 0.012, 0.028], [0.034, 0.002, 0.036]],
  },
  // Little
  {
    r: 0.0064,
    closed: [[0.045, 0.026, 0.066], [0.043, 0.016, 0.048], [0.045, 0.004, 0.048], [0.047, -0.002, 0.058]],
    open: [[0.045, 0.026, 0.066], [0.044, 0.02, 0.046], [0.045, 0.01, 0.04], [0.046, 0.002, 0.046]],
  },
];

const WRIST: P = [0.036, 0.03, 0.12];
const PALM: P = [0.03, 0.03, 0.078];

export class Hand {
  readonly root = new Group();
  private bones: Mesh[] = [];
  private joints: Mesh[] = [];
  private palm: Mesh;
  private wrist: Mesh;
  private wristCap: Mesh;
  private mat: MeshStandardMaterial;
  private up = new Vector3(0, 1, 0);
  private q = new Quaternion();

  constructor() {
    this.root.name = 'Hand';
    this.mat = new MeshStandardMaterial({
      color: new Color('#efe7dc'),
      roughness: 0.48,
      metalness: 0,
      emissive: new Color('#3a2a1e'),
      emissiveIntensity: 0.12,
    });
    // Soft rim light so the hand reads against dark paper.
    this.mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float rim = 1.0 - max(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0)), 0.0);
        totalEmissiveRadiance += vec3(1.0, 0.86, 0.66) * pow(rim, 2.4) * 0.4;`,
      );
    };
    const cyl = new CylinderGeometry(1, 1, 1, 14, 1, true);
    const sph = new SphereGeometry(1, 16, 12);
    for (const c of CHAINS) {
      for (let i = 0; i < c.closed.length; i++) {
        const j = new Mesh(sph, this.mat);
        j.scale.setScalar(c.r * (i === c.closed.length - 1 ? 0.92 : 1));
        j.castShadow = true;
        this.joints.push(j);
        this.root.add(j);
        if (i > 0) {
          const b = new Mesh(cyl, this.mat);
          b.castShadow = true;
          this.bones.push(b);
          this.root.add(b);
        }
      }
    }
    this.palm = new Mesh(sph, this.mat);
    this.palm.scale.set(0.03, 0.013, 0.036);
    this.palm.position.set(...PALM);
    this.palm.rotation.set(0.15, -0.35, 0.12);
    this.palm.castShadow = true;
    // Wrist: a short closed stub with rounded ends, like tracked hands that
    // stop at the wrist, so no camera angle sees into an open tube.
    this.wrist = new Mesh(new CylinderGeometry(1, 1, 1, 20, 1, false), this.mat);
    this.wrist.castShadow = true;
    this.wristCap = new Mesh(sph, this.mat);
    this.wristCap.scale.setScalar(0.02);
    this.wristCap.castShadow = true;
    const wristBase = new Mesh(sph, this.mat);
    wristBase.scale.set(0.022, 0.019, 0.022);
    wristBase.position.set(...WRIST);
    wristBase.castShadow = true;
    this.root.add(this.palm, this.wrist, this.wristCap, wristBase);
    // Palm links to each finger base.
    for (let i = 0; i < CHAINS.length; i++) {
      const b = new Mesh(cyl, this.mat);
      b.castShadow = true;
      this.bones.push(b);
      this.root.add(b);
    }
    this.pose(0);
  }

  private bone(m: Mesh, a: Vector3, b: Vector3, r: number): void {
    const d = new Vector3().subVectors(b, a);
    const len = d.length();
    m.position.copy(a).addScaledVector(d, 0.5);
    m.scale.set(r, len, r);
    this.q.setFromUnitVectors(this.up, d.normalize());
    m.quaternion.copy(this.q);
  }

  /** 0 = open hand, 1 = pinched. */
  pose(pinch: number): void {
    const t = Math.max(0, Math.min(1, pinch));
    let bi = 0;
    let ji = 0;
    const palm = new Vector3(...PALM);
    const bases: Vector3[] = [];
    for (const c of CHAINS) {
      const pts = c.closed.map((p, i) => lerp3(c.open[i], p, t));
      bases.push(pts[0]);
      for (let i = 0; i < pts.length; i++) {
        this.joints[ji++].position.copy(pts[i]);
        if (i > 0) this.bone(this.bones[bi++], pts[i - 1], pts[i], c.r);
      }
    }
    for (const b of bases) this.bone(this.bones[bi++], palm, b, 0.009);
    const w = new Vector3(...WRIST);
    const end = w.clone().add(new Vector3(0.012, 0.03, 0.1).multiplyScalar(0.6));
    this.bone(this.wrist, w, end, 0.02);
    this.wristCap.position.copy(end);
  }

  setOpacity(o: number): void {
    this.mat.transparent = o < 0.999;
    this.mat.opacity = o;
    this.root.visible = o > 0.01;
  }
}
