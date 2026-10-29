/**
 * Paper-theatre dioramas. Each chapter is a little cut-paper stage on the
 * desk with a problem (rain, a dark river, a wilted flower...). The model the
 * player folds is carried onto the stage and performs a short act that solves
 * it. Everything is built from flat paper cut-outs, matching the folded models.
 */
import {
  AdditiveBlending,
  Box3,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  Quaternion,
  Shape,
  ShapeGeometry,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
} from '@iwsdk/core';
import { sound } from './audio.js';
import { craftPaper, glowTexture, rng } from './textures.js';

// ---------------------------------------------------------------------------
// Helpers

const matCache = new Map<string, MeshStandardMaterial>();
export function paperMat(color: string, emissive = 0x000000): MeshStandardMaterial {
  const key = `${color}:${emissive}`;
  let m = matCache.get(key);
  if (!m) {
    m = new MeshStandardMaterial({
      map: craftPaper(color, color.length * 13 + 5, 256),
      roughness: 0.95,
      side: DoubleSide,
      emissive,
    });
    matCache.set(key, m);
  }
  return m;
}

function shapeFrom(pts: [number, number][]): Shape {
  const s = new Shape();
  pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  return s;
}

/** Flat cut-out in the XY plane. */
export function cut(pts: [number, number][], color: string, shadow = true): Mesh {
  const m = new Mesh(new ShapeGeometry(shapeFrom(pts)), paperMat(color));
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

/** Rounded blob cut-out (hills, clouds, bushes). */
export function blob(cx: number, cy: number, rx: number, ry: number, color: string, bumps = 0, seed = 1): Mesh {
  const pts: [number, number][] = [];
  const r = rng(seed);
  const n = 36;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + (bumps ? Math.sin(a * bumps) * 0.08 + (r() - 0.5) * 0.04 : 0);
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return cut(pts, color);
}

/** A thick paper slab (stage base layers). */
function slab(w: number, d: number, h: number, color: string, round = 0.03): Mesh {
  const s = new Shape();
  const x = -w / 2;
  const y = -d / 2;
  s.moveTo(x + round, y);
  s.lineTo(x + w - round, y);
  s.quadraticCurveTo(x + w, y, x + w, y + round);
  s.lineTo(x + w, y + d - round);
  s.quadraticCurveTo(x + w, y + d, x + w - round, y + d);
  s.lineTo(x + round, y + d);
  s.quadraticCurveTo(x, y + d, x, y + d - round);
  s.lineTo(x, y + round);
  s.quadraticCurveTo(x, y, x + round, y);
  const g = new ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 6 });
  const m = new Mesh(g, paperMat(color));
  m.rotation.x = -Math.PI / 2;
  m.receiveShadow = true;
  m.castShadow = true;
  return m;
}

function glow(color: number, size: number, opacity = 0.8): Sprite {
  const s = new Sprite(
    new SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity, depthWrite: false, blending: AdditiveBlending }),
  );
  s.scale.setScalar(size);
  return s;
}

/** Small paper lantern prop with controllable light. */
export class LanternProp {
  readonly root = new Group();
  private shade: Mesh;
  private halo: Sprite;
  private mat: MeshStandardMaterial;
  lit = 0;
  target = 0;
  constructor(scale = 1, color = '#f4e1bd') {
    this.mat = new MeshStandardMaterial({
      map: craftPaper(color, 31, 128),
      emissive: new Color(0xff9a4a),
      emissiveIntensity: 0,
      roughness: 0.9,
      flatShading: true,
    });
    this.shade = new Mesh(
      new LatheGeometry(
        [
          new Vector2(0, -0.016),
          new Vector2(0.01, -0.015),
          new Vector2(0.015, -0.006),
          new Vector2(0.016, 0.004),
          new Vector2(0.012, 0.013),
          new Vector2(0.006, 0.017),
          new Vector2(0, 0.017),
        ],
        8,
      ),
      this.mat,
    );
    this.shade.castShadow = true;
    this.halo = glow(0xffa860, 0.09, 0);
    this.root.add(this.shade, this.halo);
    this.root.scale.setScalar(scale);
  }
  update(dt: number): void {
    this.lit += (this.target - this.lit) * Math.min(1, dt * 3);
    this.mat.emissiveIntensity = this.lit * 1.6;
    (this.halo.material as SpriteMaterial).opacity = this.lit * 0.75;
  }
}

/** Base for every stage. */
export abstract class Diorama {
  readonly root = new Group();
  /** Where the creature should end its act, stage-local. */
  abstract readonly chapter: string;
  abstract readonly story: string;
  abstract readonly solvedLine: string;
  solved = false;
  protected t = 0;

  constructor() {
    this.root.name = 'Diorama';
    // Shared theatre base: layered paper slabs and a curved night backdrop.
    const base1 = slab(0.6, 0.36, 0.012, '#4a3a2c', 0.04);
    const base2 = slab(0.56, 0.32, 0.01, '#5c4632', 0.035);
    base2.position.y = 0.012;
    this.root.add(base1, base2);
  }

  /** Curved backdrop panel in a given colour. */
  protected backdrop(color: string, stars = true): Group {
    const g = new Group();
    const panel = new Mesh(
      new CylinderGeometry(0.34, 0.34, 0.26, 32, 1, true, Math.PI * 0.62, Math.PI * 0.76),
      paperMat(color),
    );
    panel.position.set(0, 0.15, 0.17);
    panel.receiveShadow = true;
    g.add(panel);
    if (stars) {
      const r = rng(color.length * 7);
      for (let i = 0; i < 18; i++) {
        const a = Math.PI * 0.68 + r() * Math.PI * 0.64;
        const s = glow(0xfff1c8, 0.012 + r() * 0.012, 0.9);
        s.position.set(Math.sin(a) * 0.33, 0.16 + r() * 0.1, 0.17 + Math.cos(a) * 0.33);
        g.add(s);
      }
    }
    this.root.add(g);
    return g;
  }

  /** Stage-space orientation for the creature (fold space -> stage space). */
  abstract standQuaternion(out: Quaternion): Quaternion;
  /** Where the creature lands before its act. */
  abstract readonly landing: Vector3;
  /** Scale of the creature on stage (paper is 20 cm; stages are small). */
  readonly creatureScale: number = 0.75;

  /** Reset to the unsolved state. */
  reset(): void {
    this.solved = false;
    this.t = 0;
  }

  /** Idle animation every frame. */
  abstract update(time: number, dt: number): void;

  /**
   * Drive the creature through its act. `t` counts seconds since landing.
   * Returns true once the act is finished.
   */
  abstract act(creature: Object3D, t: number, dt: number): boolean;
}

/** Build an orthonormal fold->stage rotation from two mapped directions. */
export function basisQuat(
  foldA: Vector3,
  stageA: Vector3,
  foldB: Vector3,
  stageB: Vector3,
  out: Quaternion,
): Quaternion {
  const fa = foldA.clone().normalize();
  const fb = foldB.clone().sub(fa.clone().multiplyScalar(foldB.dot(fa))).normalize();
  const fc = new Vector3().crossVectors(fa, fb);
  const sa = stageA.clone().normalize();
  const sb = stageB.clone().sub(sa.clone().multiplyScalar(stageB.dot(sa))).normalize();
  const sc = new Vector3().crossVectors(sa, sb);
  const F = new Matrix4().makeBasis(fa, fb, fc);
  const S = new Matrix4().makeBasis(sa, sb, sc);
  return out.setFromRotationMatrix(S.multiply(F.transpose()));
}

const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);

const ease = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x * x * (3 - 2 * x));

// ---------------------------------------------------------------------------
// Chapter 1 — Shelter

export class ShelterStage extends Diorama {
  readonly chapter = 'Shelter';
  readonly story = 'A firefly is caught in the rain. Fold it a shelter.';
  readonly solvedLine = 'Warm and dry. The firefly glows again.';
  readonly landing = new Vector3(0.02, 0.022, -0.02);
  override readonly creatureScale = 0.68;
  private rain: InstancedMesh;
  private drops: { x: number; y: number; z: number; v: number }[] = [];
  private rainLevel = 1;
  private firefly: Sprite;
  private fireflyCore: Mesh;
  private ffLight: PointLight;
  private clouds = new Group();
  private tmp = new Object3D();
  private ffPos = new Vector3(0.02, 0.03, -0.02);

  constructor() {
    super();
    this.backdrop('#24305a');
    const hill = blob(0, 0.0, 0.26, 0.06, '#4f7a4e', 6, 3);
    hill.position.set(0, 0.022, 0.1);
    const hill2 = blob(0.12, 0.0, 0.16, 0.05, '#3f6643', 5, 4);
    hill2.position.set(0, 0.022, 0.12);
    this.root.add(hill, hill2);
    // Grass ground.
    const ground = slab(0.5, 0.26, 0.006, '#5d8a55', 0.04);
    ground.position.y = 0.022;
    this.root.add(ground);
    // Grass tufts.
    const r = rng(9);
    for (let i = 0; i < 22; i++) {
      const tuft = cut(
        [
          [-0.006, 0],
          [-0.002, 0.016 + r() * 0.01],
          [0, 0.004],
          [0.003, 0.02 + r() * 0.01],
          [0.006, 0],
        ],
        r() > 0.5 ? '#79a866' : '#6a9a5c',
      );
      tuft.position.set((r() - 0.5) * 0.46, 0.028, (r() - 0.5) * 0.2);
      tuft.rotation.y = (r() - 0.5) * 0.8;
      this.root.add(tuft);
    }
    // Rain clouds hanging on threads.
    for (const [x, y, s] of [
      [-0.1, 0.24, 1],
      [0.08, 0.26, 1.2],
      [0.0, 0.22, 0.8],
    ]) {
      const c = new Group();
      const body = blob(0, 0, 0.06 * s, 0.025 * s, '#8a93a8', 7, x * 100 + 7);
      const puff = blob(0.02 * s, 0.014 * s, 0.035 * s, 0.022 * s, '#9aa3b8', 5, x * 50 + 3);
      puff.position.z = 0.001;
      const thread = new Mesh(new CylinderGeometry(0.0004, 0.0004, 0.1, 4), new MeshBasicMaterial({ color: 0xd8d0c0 }));
      thread.position.y = 0.06;
      c.add(body, puff, thread);
      c.position.set(x, y, -0.03);
      this.clouds.add(c);
    }
    this.root.add(this.clouds);
    // Rain: thin paper strips.
    const n = 70;
    this.rain = new InstancedMesh(
      new PlaneGeometry(0.0012, 0.012),
      new MeshBasicMaterial({ color: 0xbfd7ff, transparent: true, opacity: 0.75, side: DoubleSide }),
      n,
    );
    const rr = rng(4);
    for (let i = 0; i < n; i++) {
      this.drops.push({ x: (rr() - 0.5) * 0.3, y: 0.03 + rr() * 0.2, z: -0.06 + rr() * 0.1, v: 0.18 + rr() * 0.08 });
    }
    this.root.add(this.rain);
    // Firefly.
    this.firefly = glow(0xd9ff7a, 0.05, 0.35);
    this.fireflyCore = new Mesh(new CircleGeometry(0.003, 12), new MeshBasicMaterial({ color: 0xeaffb0 }));
    this.ffLight = new PointLight(0xc8ff70, 0.0, 0.25, 2);
    this.root.add(this.firefly, this.fireflyCore, this.ffLight);
  }

  standQuaternion(out: Quaternion): Quaternion {
    // Tent: hinge (fold +X) runs left-right; bisector of the two open halves
    // points down. The halves open by PI*0.42 from the folded state.
    const half = (Math.PI * 0.42) / 2;
    const bis = new Vector3(0, -Math.cos(half), Math.sin(half));
    // Hinge runs front-to-back so the player sees the tent's triangular gable.
    return basisQuat(X, Z, bis, Y.clone().negate(), out);
  }

  override reset(): void {
    super.reset();
    this.rainLevel = 1;
    this.clouds.position.set(0, 0, 0);
  }

  update(time: number, dt: number): void {
    this.t += dt;
    if (this.solved && this.rainLevel > 0) {
      // Once sheltered, the rain eases off and the clouds drift away.
      this.rainLevel = Math.max(0, this.rainLevel - dt * 0.5);
      this.clouds.position.y = Math.min(0.06, this.clouds.position.y + dt * 0.03);
      this.clouds.position.x = Math.min(0.1, this.clouds.position.x + dt * 0.05);
    }
    sound.setRain(this.rainLevel);
    // Rain.
    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i];
      d.y -= d.v * dt;
      if (d.y < 0.03) d.y = 0.22;
      this.tmp.position.set(d.x, d.y, d.z);
      const vis = i / this.drops.length < this.rainLevel ? 1 : 0;
      this.tmp.scale.setScalar(vis);
      this.tmp.updateMatrix();
      this.rain.setMatrixAt(i, this.tmp.matrix);
    }
    this.rain.instanceMatrix.needsUpdate = true;
    // Clouds sway; drift away once solved.
    this.clouds.children.forEach((c, i) => {
      c.rotation.z = Math.sin(time * 0.8 + i) * 0.05;
    });
    // Firefly: dim and shivering in rain, bright and floating when sheltered.
    const bright = this.solved ? 1 : 0.25;
    const shiver = this.solved ? 0 : Math.sin(time * 40) * 0.0012;
    const hover = this.solved ? Math.sin(time * 2) * 0.004 : 0;
    this.firefly.position.set(this.ffPos.x + shiver, this.ffPos.y + hover, this.ffPos.z);
    this.fireflyCore.position.copy(this.firefly.position);
    this.ffLight.position.copy(this.firefly.position);
    const flick = 0.75 + Math.sin(time * 5) * 0.25;
    (this.firefly.material as SpriteMaterial).opacity = (0.3 + bright * 0.6) * flick;
    this.ffLight.intensity = bright * 0.12 * flick;
  }

  act(creature: Object3D, t: number, dt: number): boolean {
    // Lower the tent gently over the firefly, then the rain clears.
    const drop = ease(t / 1.4);
    creature.position.y = this.landing.y + (1 - drop) * 0.12;
    if (t > 1.4) this.solved = true;
    void dt;
    return t > 4.2;
  }
}

// ---------------------------------------------------------------------------
// Chapter 2 — Lantern Boat

export class RiverStage extends Diorama {
  readonly chapter = 'The Dark River';
  readonly story = 'A lantern waits on the far bank. Fold a boat to carry it home.';
  readonly solvedLine = 'Across the water, the village lights up.';
  readonly landing = new Vector3(0.11, 0.035, 0.0);
  override readonly creatureScale = 0.72;
  private waves: Mesh[] = [];
  private passenger = new LanternProp(1.2);
  private houses: LanternProp[] = [];
  private windowMats: MeshStandardMaterial[] = [];

  constructor() {
    super();
    this.backdrop('#1c2a4e');
    // Banks.
    const left = slab(0.14, 0.3, 0.02, '#4e7449', 0.03);
    left.position.set(-0.21, 0.022, 0);
    const right = slab(0.14, 0.3, 0.02, '#4e7449', 0.03);
    right.position.set(0.21, 0.022, 0);
    this.root.add(left, right);
    // Water: layered wave strips.
    const waterBase = slab(0.3, 0.3, 0.004, '#22426d', 0.01);
    waterBase.position.y = 0.022;
    this.root.add(waterBase);
    for (let i = 0; i < 6; i++) {
      const pts: [number, number][] = [];
      for (let k = 0; k <= 24; k++) pts.push([-0.15 + (0.3 * k) / 24, Math.sin(k * 1.3 + i) * 0.003 + 0.008]);
      pts.push([0.15, 0], [-0.15, 0]);
      const w = cut(pts, i % 2 ? '#2f5a8c' : '#3a6aa0', false);
      w.position.set(0, 0.026, -0.12 + i * 0.045);
      this.waves.push(w);
      this.root.add(w);
    }
    // Village on the right bank: little paper houses with windows.
    for (let i = 0; i < 3; i++) {
      const h = new Group();
      const wall = cut(
        [
          [-0.02, 0],
          [0.02, 0],
          [0.02, 0.03],
          [0, 0.048],
          [-0.02, 0.03],
        ],
        ['#c98b64', '#b8775a', '#d39a6d'][i],
      );
      const winMat = new MeshStandardMaterial({ color: 0x2a2a3a, emissive: 0xffb050, emissiveIntensity: 0 });
      this.windowMats.push(winMat);
      const win = new Mesh(new PlaneGeometry(0.01, 0.01), winMat);
      win.position.set(0, 0.018, 0.0012);
      h.add(wall, win);
      h.position.set(0.19 + (i - 1) * 0.045, 0.042, -0.08 + i * 0.05);
      this.root.add(h);
    }
    // Passenger lantern waits on the left bank.
    this.passenger.root.position.set(-0.19, 0.06, 0.02);
    this.passenger.target = 0.6;
    this.root.add(this.passenger.root);
    // Reeds.
    const r = rng(12);
    for (let i = 0; i < 10; i++) {
      const reed = cut(
        [
          [-0.002, 0],
          [0, 0.03 + r() * 0.02],
          [0.002, 0],
        ],
        '#7aa06a',
      );
      reed.position.set(i < 5 ? -0.15 + r() * 0.02 : 0.15 - r() * 0.02, 0.042, -0.12 + r() * 0.24);
      this.root.add(reed);
    }
    this.houses = [];
  }

  standQuaternion(out: Quaternion): Quaternion {
    // Hull: fold +Y (deck) up, fold +Z (face) toward the player.
    return basisQuat(Y, Y, Z, Z, out);
  }

  update(time: number, dt: number): void {
    this.t += dt;
    this.waves.forEach((w, i) => (w.position.x = Math.sin(time * 0.6 + i) * 0.006));
    this.passenger.update(dt);
    this.passenger.root.position.y += Math.sin(time * 2) * 0.00005;
    for (const m of this.windowMats) {
      const target = this.solved ? 1.4 : 0;
      m.emissiveIntensity += (target - m.emissiveIntensity) * Math.min(1, dt * 1.5);
    }
  }

  act(creature: Object3D, t: number, dt: number): boolean {
    const bob = Math.sin(t * 3) * 0.003;
    creature.rotation.z = Math.sin(t * 2.2) * 0.04;
    // 0-1.5 s: settle on water (left side); 1.5-2.5 s: lantern hops aboard;
    // 2.5-6 s: sail to the right bank; then the village lights up.
    const startX = -0.1;
    const endX = 0.09;
    if (t < 1.5) {
      creature.position.set(startX, this.landing.y + (1 - ease(t / 1.5)) * 0.1 + bob, this.landing.z);
    } else {
      const k = ease((t - 2.5) / 3.5);
      creature.position.set(startX + (endX - startX) * k, this.landing.y + bob, this.landing.z);
    }
    if (t > 1.5 && t < 2.5) {
      const k = ease(t - 1.5);
      this.passenger.root.position.set(-0.19 + (0.09 * k), 0.06 + Math.sin(k * Math.PI) * 0.04, 0.02 - 0.02 * k);
      this.passenger.target = 1;
    } else if (t >= 2.5) {
      this.passenger.root.position.set(creature.position.x, creature.position.y + 0.045, creature.position.z + 0.004);
    }
    if (t > 6) this.solved = true;
    void dt;
    return t > 7.5;
  }
}

// ---------------------------------------------------------------------------
// Chapter 3 — Little Fox

export class FoxStage extends Diorama {
  readonly chapter = 'The Fox Path';
  readonly story = 'The forest path has gone dark. A little fox knows the way.';
  readonly solvedLine = 'Every lantern on the path is lit.';
  readonly landing = new Vector3(-0.17, 0.03, 0.06);
  override readonly creatureScale = 0.52;
  private lanterns: LanternProp[] = [];
  private stones: Vector3[] = [];
  private lastHop = -1;

  constructor() {
    super();
    this.backdrop('#203048');
    const ground = slab(0.52, 0.28, 0.006, '#3d5a3a', 0.04);
    ground.position.y = 0.022;
    this.root.add(ground);
    // Paper pine trees.
    const r = rng(21);
    for (let i = 0; i < 9; i++) {
      const tree = new Group();
      const h = 0.07 + r() * 0.06;
      for (let k = 0; k < 3; k++) {
        const w = 0.03 - k * 0.007;
        const tri = cut(
          [
            [-w, 0],
            [w, 0],
            [0, h * 0.5],
          ],
          ['#2f5a3c', '#3a6a45', '#2a4d35'][k],
        );
        tri.position.y = 0.01 + k * h * 0.22;
        tree.add(tri);
      }
      const trunk = cut(
        [
          [-0.003, 0],
          [0.003, 0],
          [0.003, 0.012],
          [-0.003, 0.012],
        ],
        '#5a3d2a',
      );
      tree.add(trunk);
      const back = i < 6;
      // Back row spans the stage; the front row stays left so the fox's path stays visible.
      const x = back ? -0.22 + (i / 5) * 0.44 + (r() - 0.5) * 0.03 : -0.25 + (i - 6) * 0.035;
      tree.position.set(x, 0.028, back ? -0.1 + r() * 0.04 : 0.1 + (i - 6) * 0.01);
      tree.rotation.y = (r() - 0.5) * 0.3;
      this.root.add(tree);
    }
    // Stepping-stone path and three lanterns.
    for (let i = 0; i < 6; i++) {
      const x = -0.15 + i * 0.065;
      const z = 0.05 - Math.sin(i * 0.9) * 0.05;
      const stone = new Mesh(new CylinderGeometry(0.014, 0.016, 0.004, 9), paperMat('#9a9488'));
      stone.position.set(x, 0.027, z);
      stone.receiveShadow = true;
      this.root.add(stone);
      this.stones.push(new Vector3(x, 0.03, z));
    }
    for (let i = 0; i < 3; i++) {
      const l = new LanternProp(1);
      const s = this.stones[1 + i * 2];
      const post = new Mesh(new CylinderGeometry(0.0015, 0.0015, 0.04, 5), paperMat('#4a3526'));
      post.position.set(s.x + 0.02, 0.045, s.z - 0.025);
      l.root.position.set(s.x + 0.02, 0.075, s.z - 0.025);
      this.root.add(post, l.root);
      this.lanterns.push(l);
    }
  }

  standQuaternion(out: Quaternion): Quaternion {
    return basisQuat(Y, Y, Z, Z, out);
  }

  override reset(): void {
    super.reset();
    this.lastHop = -1;
    for (const l of this.lanterns) l.target = 0;
  }

  update(_time: number, dt: number): void {
    this.t += dt;
    for (const l of this.lanterns) l.update(dt);
  }

  act(creature: Object3D, t: number, dt: number): boolean {
    // Hop from stone to stone; each lantern lights as the fox passes.
    const hopT = 0.55;
    const idx = Math.min(this.stones.length - 1, Math.floor(t / hopT));
    if (idx !== this.lastHop && t < hopT * this.stones.length) {
      this.lastHop = idx;
      sound.note(2 + idx, 0.22);
    }
    const k = Math.min(1, (t % hopT) / hopT);
    const a = this.stones[Math.max(0, idx - 1)];
    const b = this.stones[idx];
    if (t < hopT * this.stones.length) {
      creature.position.lerpVectors(a, b, ease(k));
      creature.position.y += Math.sin(k * Math.PI) * 0.03 + 0.012;
      creature.rotation.z = Math.sin(k * Math.PI) * 0.12;
    }
    for (let i = 0; i < 3; i++) if (idx >= 1 + i * 2) this.lanterns[i].target = 1;
    if (t > hopT * this.stones.length + 0.5) this.solved = true;
    void dt;
    return t > hopT * this.stones.length + 2;
  }
}

// ---------------------------------------------------------------------------
// Chapter 4 — Water Cup

export class GardenStage extends Diorama {
  readonly chapter = 'The Thirsty Flower';
  readonly story = 'The moon flower has wilted. Fold a cup and bring it water.';
  readonly solvedLine = 'The moon flower opens.';
  readonly landing = new Vector3(-0.15, 0.03, 0.03);
  override readonly creatureScale = 0.62;
  private petals: Mesh[] = [];
  private stem: Group = new Group();
  private bloom = 0;
  private drops: Sprite[] = [];
  private pond: Mesh;
  private flowerGlow: Sprite;
  private lastDrip = -1;

  constructor() {
    super();
    this.backdrop('#2a2448');
    const ground = slab(0.52, 0.28, 0.006, '#5b7a4a', 0.04);
    ground.position.y = 0.022;
    this.root.add(ground);
    // Pond on the left.
    this.pond = new Mesh(new CircleGeometry(0.07, 32), paperMat('#3a6aa0'));
    this.pond.rotation.x = -Math.PI / 2;
    this.pond.position.set(-0.15, 0.0285, 0.0);
    this.root.add(this.pond);
    for (let i = 0; i < 3; i++) {
      const ring = new Mesh(new CircleGeometry(0.012 + i * 0.006, 20), paperMat('#4f86bf'));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(-0.17 + i * 0.03, 0.029 + i * 0.0002, -0.01 + i * 0.012);
      this.root.add(ring);
    }
    // Flower on the right, starting wilted.
    const stemMesh = cut(
      [
        [-0.0015, 0],
        [0.0015, 0],
        [0.0015, 0.07],
        [-0.0015, 0.07],
      ],
      '#4f8a4a',
    );
    const leaf = cut(
      [
        [0, 0],
        [0.02, 0.008],
        [0.026, 0.016],
        [0.01, 0.012],
      ],
      '#5f9a55',
    );
    leaf.position.y = 0.025;
    this.stem.add(stemMesh, leaf);
    const head = new Group();
    head.position.y = 0.07;
    for (let i = 0; i < 7; i++) {
      const p = cut(
        [
          [0, 0],
          [0.008, 0.012],
          [0, 0.03],
          [-0.008, 0.012],
        ],
        i % 2 ? '#e8d6ff' : '#f6eaff',
      );
      p.rotation.z = (i / 7) * Math.PI * 2;
      this.petals.push(p);
      head.add(p);
    }
    const centre = new Mesh(new CircleGeometry(0.007, 16), new MeshBasicMaterial({ color: 0xffe08a }));
    centre.position.z = 0.002;
    head.add(centre);
    this.flowerGlow = glow(0xd6c2ff, 0.12, 0);
    head.add(this.flowerGlow);
    this.stem.add(head);
    this.stem.position.set(0.12, 0.028, 0.0);
    this.root.add(this.stem);
    for (let i = 0; i < 10; i++) {
      const d = glow(0x9fd4ff, 0.012, 0);
      this.drops.push(d);
      this.root.add(d);
    }
  }

  standQuaternion(out: Quaternion): Quaternion {
    return basisQuat(Y, Y, Z, Z, out);
  }

  override reset(): void {
    super.reset();
    this.bloom = 0;
    this.lastDrip = -1;
  }

  update(time: number, dt: number): void {
    this.t += dt;
    const target = this.solved ? 1 : 0;
    this.bloom += (target - this.bloom) * Math.min(1, dt * 1.2);
    // Wilt: stem bends, petals closed and grey.
    this.stem.rotation.z = (1 - this.bloom) * -0.9 + Math.sin(time * 1.2) * 0.02;
    this.petals.forEach((p, i) => {
      const open = 0.25 + this.bloom * 0.75;
      p.scale.set(open, 0.55 + this.bloom * 0.45, 1);
      p.rotation.z = (i / 7) * Math.PI * 2 * open;
    });
    (this.flowerGlow.material as SpriteMaterial).opacity = this.bloom * (0.6 + Math.sin(time * 2) * 0.15);
  }

  act(creature: Object3D, t: number, dt: number): boolean {
    // 0-1.5 dip into pond, 1.5-3.5 carry over, 3.5-5.5 pour, then bloom.
    const pondP = new Vector3(-0.15, 0.04, 0.0);
    const above = new Vector3(0.085, 0.13, 0.0);
    if (t < 1.5) {
      const k = ease(t / 1.5);
      creature.position.set(pondP.x, pondP.y + (1 - k) * 0.08 + Math.sin(k * Math.PI) * -0.012, pondP.z);
    } else if (t < 3.5) {
      const k = ease((t - 1.5) / 2);
      creature.position.lerpVectors(pondP, above, k);
      creature.position.y += Math.sin(k * Math.PI) * 0.05;
    } else if (t < 5.5) {
      creature.position.copy(above);
      creature.rotation.z = -ease((t - 3.5) / 0.6) * 1.1;
      // Droplets fall onto the flower.
      if (t > 3.8 && t < 5.3 && t - this.lastDrip > 0.22) {
        this.lastDrip = t;
        sound.drip();
      }
      this.drops.forEach((d, i) => {
        const ph = ((t - 3.6) * 1.6 + i / this.drops.length) % 1;
        d.position.set(above.x + 0.035 + Math.sin(i) * 0.004, above.y - 0.01 - ph * 0.06, 0.004);
        (d.material as SpriteMaterial).opacity = t > 3.8 && t < 5.3 ? 0.9 : 0;
      });
    } else {
      // Set the cup down beside the flower.
      const k = ease((t - 5.5) / 1.2);
      creature.rotation.z = -1.1 * (1 - k);
      creature.position.set(above.x - 0.045 * k, above.y + (this.landing.y - above.y) * k, above.z + 0.03 * k);
      this.drops.forEach((d) => ((d.material as SpriteMaterial).opacity = 0));
      this.solved = true;
    }
    return t > 7.5;
  }
}

// ---------------------------------------------------------------------------
// Chapter 5 — Paper Plane

export class CanyonStage extends Diorama {
  readonly chapter = 'The Letter';
  readonly story = 'A letter must cross the canyon to the lighthouse. Fold it wings.';
  readonly solvedLine = 'The lighthouse shines across the canyon.';
  readonly landing = new Vector3(-0.19, 0.11, 0.0);
  override readonly creatureScale = 0.58;
  private beam: Mesh;
  private lampMat: MeshStandardMaterial;
  private letter: Mesh;
  private light: PointLight;
  private whooshed = false;

  constructor() {
    super();
    this.backdrop('#2b2f5c');
    // Two cliffs with a canyon between.
    const cliffL = cut(
      [
        [-0.28, 0],
        [-0.1, 0],
        [-0.12, 0.05],
        [-0.15, 0.08],
        [-0.28, 0.09],
      ],
      '#8a5f4a',
    );
    const cliffR = cut(
      [
        [0.1, 0],
        [0.28, 0],
        [0.28, 0.07],
        [0.14, 0.065],
        [0.11, 0.035],
      ],
      '#8a5f4a',
    );
    for (const c of [cliffL, cliffR]) c.position.z = 0.02;
    const cliffL2 = cut(
      [
        [-0.28, 0],
        [-0.08, 0],
        [-0.11, 0.04],
        [-0.28, 0.07],
      ],
      '#6f4a3b',
    );
    cliffL2.position.z = -0.06;
    const cliffR2 = cut(
      [
        [0.08, 0],
        [0.28, 0],
        [0.28, 0.055],
        [0.1, 0.03],
      ],
      '#6f4a3b',
    );
    cliffR2.position.z = -0.06;
    const g = new Group();
    g.add(cliffL, cliffR, cliffL2, cliffR2);
    g.position.y = 0.022;
    this.root.add(g);
    // Lighthouse.
    const tower = new Group();
    const body = cut(
      [
        [-0.014, 0],
        [0.014, 0],
        [0.009, 0.1],
        [-0.009, 0.1],
      ],
      '#f1e8da',
    );
    for (let i = 0; i < 3; i++) {
      const band = cut(
        [
          [-0.0135 + i * 0.0016, 0.015 + i * 0.03],
          [0.0135 - i * 0.0016, 0.015 + i * 0.03],
          [0.0128 - i * 0.0016, 0.027 + i * 0.03],
          [-0.0128 + i * 0.0016, 0.027 + i * 0.03],
        ],
        '#c4553a',
      );
      band.position.z = 0.001;
      tower.add(band);
    }
    this.lampMat = new MeshStandardMaterial({ color: 0x333344, emissive: 0xffd47a, emissiveIntensity: 0 });
    const lamp = new Mesh(new CylinderGeometry(0.008, 0.008, 0.014, 10), this.lampMat);
    lamp.position.y = 0.107;
    const roof = cut(
      [
        [-0.012, 0.114],
        [0.012, 0.114],
        [0, 0.13],
      ],
      '#3b2a24',
    );
    roof.position.z = 0.001;
    tower.add(body, lamp, roof);
    this.beam = new Mesh(
      new CylinderGeometry(0.004, 0.045, 0.26, 16, 1, true),
      new MeshBasicMaterial({ color: 0xfff0b8, transparent: true, opacity: 0, depthWrite: false, side: DoubleSide, blending: AdditiveBlending }),
    );
    this.beam.rotation.z = Math.PI / 2;
    this.beam.position.set(-0.13, 0, 0);
    const beamPivot = new Group();
    beamPivot.position.y = 0.107;
    beamPivot.add(this.beam);
    tower.add(beamPivot);
    tower.position.set(0.2, 0.09, 0.0);
    this.root.add(tower);
    this.light = new PointLight(0xffd47a, 0, 0.6, 2);
    this.light.position.set(0.2, 0.21, 0.02);
    this.root.add(this.light);
    // Letter waiting on the left cliff.
    this.letter = new Mesh(new PlaneGeometry(0.03, 0.02), paperMat('#f6efe1'));
    const seal = new Mesh(new CircleGeometry(0.004, 12), new MeshBasicMaterial({ color: 0xc4553a }));
    seal.position.z = 0.001;
    this.letter.add(seal);
    this.letter.position.set(-0.2, 0.125, 0.02);
    this.root.add(this.letter);
  }

  standQuaternion(out: Quaternion): Quaternion {
    // Plane: the nose (fold +Y) points toward stage +X; the fold-plane normal
    // (which the opened wings fan out along) points up.
    return basisQuat(Y, X, Z, Y, out);
  }

  override reset(): void {
    super.reset();
    this.letter.position.set(-0.2, 0.125, 0.02);
    this.letter.rotation.set(0, 0, 0);
    this.whooshed = false;
  }

  update(time: number, dt: number): void {
    this.t += dt;
    const on = this.solved ? 1 : 0;
    this.lampMat.emissiveIntensity += (on * 2.2 - this.lampMat.emissiveIntensity) * Math.min(1, dt * 2);
    const bm = this.beam.material as MeshBasicMaterial;
    bm.opacity += (on * 0.18 - bm.opacity) * Math.min(1, dt * 2);
    (this.beam.parent as Group).rotation.y = time * 0.9;
    this.light.intensity = this.lampMat.emissiveIntensity * 0.12;
  }

  act(creature: Object3D, t: number, dt: number): boolean {
    // Swoop low over the left cliff, pick up the letter, glide to the tower.
    const dur = 4.5;
    if (!this.whooshed && t > 0.05) {
      this.whooshed = true;
      sound.whoosh();
    }
    const k = Math.min(1, t / dur);
    const x = -0.24 + 0.4 * ease(k);
    const y = 0.15 + Math.sin(k * Math.PI) * 0.06 - k * 0.02;
    const z = Math.sin(k * Math.PI * 2) * 0.03;
    creature.position.set(x, y, z);
    creature.rotation.set(Math.sin(k * Math.PI * 2) * 0.25, 0, Math.cos(k * Math.PI) * 0.12);
    if (x > -0.2 && t < dur + 1) {
      this.letter.position.set(x - 0.005, y - 0.012, z);
      this.letter.rotation.set(-Math.PI / 2, 0, 0);
    }
    if (t > dur) {
      this.letter.position.set(0.19, 0.095, 0.03);
      this.letter.rotation.set(0, 0, 0.2);
      this.solved = true;
      creature.position.y += Math.sin(t * 3) * 0.002;
    }
    void dt;
    return t > dur + 2;
  }
}

// ---------------------------------------------------------------------------
// Chapter 6 — Moon Swan

export class LakeStage extends Diorama {
  readonly chapter = 'Moonrise';
  readonly story = 'The moon will not rise until someone sings to it. Fold a swan.';
  readonly solvedLine = 'The moon rises. The paper world is whole again.';
  readonly landing = new Vector3(-0.16, 0.034, 0.03);
  override readonly creatureScale = 0.72;
  private moon = new Group();
  private moonGlow: Sprite;
  private ripples: Mesh[] = [];
  private petals: Sprite[] = [];

  constructor() {
    super();
    this.backdrop('#18213f');
    const lake = slab(0.5, 0.28, 0.006, '#22426d', 0.08);
    lake.position.y = 0.022;
    this.root.add(lake);
    for (let i = 0; i < 4; i++) {
      const r = new Mesh(new CircleGeometry(0.02 + i * 0.008, 32), paperMat('#2f5a8c'));
      r.rotation.x = -Math.PI / 2;
      r.position.set(-0.05 + i * 0.07, 0.0285 + i * 0.0001, -0.04 + (i % 2) * 0.06);
      this.ripples.push(r);
      this.root.add(r);
    }
    // Lotus pads.
    const rr = rng(33);
    for (let i = 0; i < 5; i++) {
      const pad = new Mesh(new CircleGeometry(0.014, 16, 0.3, Math.PI * 1.85), paperMat('#4f8a55'));
      pad.rotation.x = -Math.PI / 2;
      pad.position.set((rr() - 0.5) * 0.4, 0.029, (rr() - 0.5) * 0.2);
      this.root.add(pad);
    }
    // The stage moon starts below the backdrop horizon.
    const disc = new Mesh(new CircleGeometry(0.05, 48), new MeshBasicMaterial({ color: 0xf6e8c4 }));
    this.moonGlow = glow(0xffe6b0, 0.3, 0.2);
    this.moonGlow.position.z = -0.002;
    this.moon.add(this.moonGlow, disc);
    this.moon.position.set(0.06, 0.04, -0.15);
    this.root.add(this.moon);
    // A paper hill in front of the moon to hide it before it rises.
    const hill = blob(0, 0, 0.3, 0.07, '#1f2a4a', 5, 8);
    hill.position.set(0, 0.02, -0.12);
    this.root.add(hill);
    for (let i = 0; i < 16; i++) {
      const p = glow(0xfff1d0, 0.01, 0);
      this.petals.push(p);
      this.root.add(p);
    }
  }

  standQuaternion(out: Quaternion): Quaternion {
    // Swan floats flat: fold normal points up; it swims toward the player's
    // right so the raised neck is seen from the side, not edge-on.
    return basisQuat(Z, Y, Y, new Vector3(0.75, 0, 0.66), out);
  }

  override reset(): void {
    super.reset();
    this.moon.position.y = 0.04;
  }

  update(time: number, dt: number): void {
    this.t += dt;
    const target = this.solved ? 0.2 : 0.04;
    this.moon.position.y += (target - this.moon.position.y) * Math.min(1, dt * 0.5);
    (this.moonGlow.material as SpriteMaterial).opacity = 0.2 + (this.moon.position.y - 0.04) * 4;
    this.ripples.forEach((r, i) => r.scale.setScalar(1 + Math.sin(time * 0.8 + i) * 0.08));
    this.petals.forEach((p, i) => {
      const ph = (time * 0.05 + i / this.petals.length) % 1;
      p.position.set(Math.sin(i * 7.1) * 0.24, 0.25 - ph * 0.22, Math.cos(i * 3.3) * 0.12);
      (p.material as SpriteMaterial).opacity = this.solved ? Math.sin(ph * Math.PI) * 0.9 : 0;
    });
  }

  act(creature: Object3D, t: number, dt: number): boolean {
    const k = ease(t / 5);
    creature.position.set(-0.16 + 0.2 * k, this.landing.y + Math.sin(t * 2) * 0.0015, 0.03 - 0.03 * k);
    creature.rotation.y = Math.sin(t * 0.8) * 0.12;
    if (t > 4 && !this.solved) {
      this.solved = true;
      sound.moonrise();
    }
    void dt;
    return t > 8;
  }
}

/** Fit check helper used by the game when placing the creature. */
export function boundsOf(o: Object3D): Box3 {
  return new Box3().setFromObject(o);
}

export { Quaternion, Vector3 };
