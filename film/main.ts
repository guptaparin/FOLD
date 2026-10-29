/**
 * FOLD — film director.
 *
 * Renders the 32 s film frame by frame from docs/timing.json, using the game's
 * own fold engine, paper, dioramas and world. `window.film.frame(n)` draws
 * frame n; frames must be requested in order (seeking backwards re-simulates
 * from frame 0, so every frame is a pure function of its number).
 */
import '@fontsource-variable/fraunces';
import '@fontsource-variable/fraunces/wght-italic.css';
import '@fontsource-variable/inter';
import {
  AdditiveBlending,
  BackSide,
  Color,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  CylinderGeometry,
  DirectionalLight,
  Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  Quaternion,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from '@iwsdk/core';
import { Diorama } from '../src/game/dioramas.js';
import { Environment, LAYOUT } from '../src/game/env.js';
import { PreparedStep, Sheet } from '../src/game/fold/engine.js';
import { apply } from '../src/game/fold/math.js';
import { OrigamiModel } from '../src/game/fold/models.js';
import { CHAPTERS, Chapter } from '../src/game/levels.js';
import { Opener } from '../src/game/life.js';
import { FoldGuides, LAYER, PAPER_HALF, PaperView } from '../src/game/paper-view.js';
import { craftPaper, glowTexture, paperBack, paperFront } from '../src/game/textures.js';
import { Hand } from './hand.js';

// ---------------------------------------------------------------------------
// Timing

interface FoldT { model: string; step: number; pinch: number; pullStart: number; snap: number; hand: boolean; kind: string }
interface Timing {
  fps: number; totalFrames: number; beatFrames: number;
  folds: FoldT[];
  morphs: { from: string; to: string; unfold: [number, number]; flip: [number, number] }[];
  life: { model: string; open: [number, number]; glide?: [number, number]; land?: number }[];
  type: { text: string; in: number; out: number; where: string }[];
  acts: Record<string, { start: number; speed: number; offset: number; hopT?: number; dur?: number }>;
  progress: [number, number][];
  release: number;
  wipe: [number, number];
}

const T: Timing = await fetch('./timing.json').then((r) => r.json());
const FPS = T.fps;
const DT = 1 / FPS;

// ---------------------------------------------------------------------------
// Easing

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const inOut = (x: number) => { const t = clamp01(x); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const outCubic = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
const outBack = (x: number, s = 1.6) => { const t = clamp01(x) - 1; return 1 + t * t * ((s + 1) * t + s); };
const range = (n: number, a: number, b: number) => (n - a) / (b - a);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

// ---------------------------------------------------------------------------
// Renderer, world

// Render-quality knobs (URL): ?scale=0.75&aa=0 . The canvas is shown at 1920×1080.
const QS = new URLSearchParams(location.search);
const RS = Number(QS.get('scale') ?? '1');
const W = 1920;
const H = 1080;
const renderer = new WebGLRenderer({ antialias: QS.get('aa') !== '0', preserveDrawingBuffer: true });
renderer.setPixelRatio(RS);
renderer.setSize(W, H);
renderer.outputColorSpace = SRGBColorSpace;
renderer.shadowMap.enabled = QS.get('shadow') !== '0';
renderer.shadowMap.type = PCFSoftShadowMap;
document.getElementById('stage')!.appendChild(renderer.domElement);

const scene = new Scene();
const camera = new PerspectiveCamera(40, W / H, 0.005, 200);
scene.add(camera);

// Image-based light that matches the game's IBL gradient.
{
  const gs = new Scene();
  const mat = new ShaderMaterial({
    side: BackSide,
    uniforms: { sky: { value: new Color(0.32, 0.36, 0.55) }, eq: { value: new Color(0.42, 0.33, 0.38) }, gr: { value: new Color(0.18, 0.14, 0.13) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 sky; uniform vec3 eq; uniform vec3 gr; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(eq, sky, smoothstep(0.0, 0.6, h)) : mix(eq, gr, smoothstep(0.0, -0.4, h)); gl_FragColor = vec4(c, 1.0); }',
  });
  gs.add(new Mesh(new SphereGeometry(10, 32, 16), mat));
  const pm = new PMREMGenerator(renderer);
  scene.environment = pm.fromScene(gs, 0.04).texture;
  (scene as unknown as { environmentIntensity: number }).environmentIntensity = 0.55;
}

const env = new Environment(scene);
// Lake lanterns read at film scale (the instance transform is reused per lantern).
(env as unknown as { tmp: Object3D }).tmp.scale.setScalar(2.4);
if (QS.get('smap')) env.moonLight.shadow.mapSize.set(Number(QS.get('smap')), Number(QS.get('smap')));
const EYE = new Vector3(0, 1.2, 0);
env.recenter(EYE, 0);
const station = env.station;
{
  // A warm key from the desk lantern's side: paper should feel lamp-lit.
  const key = new DirectionalLight(0xffc488, 1.25);
  key.position.set(-0.9, 0.7, 0.35);
  key.target.position.set(0, -0.45, -0.5);
  station.add(key, key.target);
  const fill = new DirectionalLight(0xffe7c8, 0.35);
  fill.position.set(0.6, 0.4, 0.8);
  fill.target.position.set(0, -0.45, -0.5);
  station.add(fill, fill.target);
  env.moonLight.intensity = 0.95;
}
const board = env.board;
const stageAnchor = env.stageAnchor;

/** Station-local point to world. */
const sw = (x: number, y: number, z: number, out = new Vector3()) => out.set(x, y, z).add(EYE);

// ---------------------------------------------------------------------------
// Paper sequences: random access to "model folded to step k at angle theta".

interface Snap { sheet: Sheet; prep: PreparedStep }
interface Seq { ch: Chapter; model: OrigamiModel; view: PaperView; pivot: Group; snaps: Snap[]; final: Sheet; guides: FoldGuides }

function makeSeq(idx: number, flipFaces = false): Seq {
  const ch = CHAPTERS[idx];
  const model = ch.model;
  const s = new Sheet(model.turn);
  const snaps: Snap[] = [];
  model.steps.forEach((st, k) => {
    const prep = s.prepare(st, k);
    snaps.push({ sheet: s.clone(), prep });
    s.commit(prep);
  });
  const front = paperFront(ch.paper, 1);
  const back = paperBack(2);
  const up = flipFaces ? !model.colorUp : model.colorUp;
  const view = up ? new PaperView(front, back) : new PaperView(back, front);
  const pivot = new Group();
  pivot.add(view.root);
  board.add(pivot);
  pivot.visible = false;
  const guides = new FoldGuides();
  guides.root.scale.setScalar(PAPER_HALF);
  pivot.add(guides.root);
  return { ch, model, view, pivot, snaps, final: s, guides };
}

// The hook sheet starts patterned side up: frame one must be the beautiful side.
const seqs: Record<string, Seq> = { tent: makeSeq(0, true), fox: makeSeq(2), swan: makeSeq(5) };

function poseSeq(q: Seq, k: number, theta: number): void {
  if (k >= q.snaps.length) {
    q.view.sync(q.final);
    q.view.pose(null, 0);
    return;
  }
  const sn = q.snaps[k];
  q.view.sync(sn.sheet);
  q.view.pose(sn.prep, theta);
}

/** Fold state of a model at frame n from its fold list. */
function foldState(model: string, n: number): { k: number; theta: number; fold: FoldT | null; u: number } {
  const fl = T.folds.filter((f) => f.model === model);
  for (let i = 0; i < fl.length; i++) {
    const f = fl[i];
    if (n < f.pullStart) return { k: i, theta: 0, fold: f, u: 0 };
    if (n < f.snap) {
      const u = range(n, f.pullStart, f.snap);
      const target = seqs[model].snaps[i].prep.target;
      return { k: i, theta: target * inOut(u), fold: f, u };
    }
  }
  return { k: fl.length, theta: 0, fold: null, u: 1 };
}

// ---------------------------------------------------------------------------
// Life: a finished model lifts, relaxes open and stands (or swims).

function openedClone(q: Seq, u: number): Sheet {
  const c = q.final.clone();
  new Opener(c, q.model).update(u);
  return c;
}

interface Stand { q: Quaternion; scale: number; pivot: Vector3 }
function standFor(q: Seq, stage: Diorama, scale: number): Stand {
  const quat = stage.standQuaternion(new Quaternion());
  const m = new Matrix4().compose(new Vector3(), quat, new Vector3(scale, scale, scale));
  const mn = new Vector3();
  const mx = new Vector3();
  q.view.sync(openedClone(q, 1));
  q.view.pose(null, 0);
  q.view.bounds(m, mn, mx);
  return { q: quat, scale, pivot: new Vector3(-(mn.x + mx.x) / 2, -mn.y, -(mn.z + mx.z) / 2) };
}

/** A creature rig: outer group placed in some parent, inner group orients the paper. */
class Creature {
  readonly outer = new Group();
  readonly inner = new Group();
  constructor(readonly q: Seq) {
    this.outer.add(this.inner);
  }
  attach(): void {
    this.q.view.root.removeFromParent();
    this.inner.add(this.q.view.root);
  }
  detach(): void {
    this.q.view.root.removeFromParent();
    this.q.pivot.add(this.q.view.root);
    this.outer.removeFromParent();
  }
}

// ---------------------------------------------------------------------------
// Dioramas

const stages: Record<string, Diorama> = {
  shelter: CHAPTERS[0].stage(),
  fox: CHAPTERS[2].stage(),
  canyon: CHAPTERS[4].stage(),
  lake: CHAPTERS[5].stage(),
};
for (const s of Object.values(stages)) {
  s.reset();
  s.root.visible = false;
  stageAnchor.add(s.root);
}
function showStage(id: string | null): void {
  for (const [k, s] of Object.entries(stages)) s.root.visible = k === id;
}

// Fox and plane creatures for their own diorama shots (separate paper views).
function finishedView(idx: number): { q: Seq; creature: Creature } {
  const q = makeSeq(idx);
  const c = new Creature(q);
  c.attach();
  q.view.sync(openedClone(q, 1));
  q.view.pose(null, 0);
  return { q, creature: c };
}
const foxActor = finishedView(2);
const planeActor = finishedView(4);
function mountActor(a: { q: Seq; creature: Creature }, stage: Diorama): void {
  const st = standFor(a.q, stage, stage.creatureScale);
  a.q.view.sync(openedClone(a.q, 1));
  a.q.view.pose(null, 0);
  a.creature.inner.quaternion.copy(st.q);
  a.creature.inner.scale.setScalar(st.scale);
  a.creature.inner.position.copy(st.pivot);
  stage.root.add(a.creature.outer);
}
mountActor(foxActor, stages.fox);
mountActor(planeActor, stages.canyon);

// Keepsakes: all six models on wooden plinths along the desk.
const shelf = new Group();
station.add(shelf);
shelf.visible = false;
const plinthMat = new MeshStandardMaterial({ color: 0x3a2618, roughness: 0.55 });
const keepsakes: Group[] = [];
CHAPTERS.forEach((ch, i) => {
  const q = makeSeq(i);
  q.pivot.removeFromParent();
  const st = standFor(q, ch.stage(), 0.5);
  q.view.sync(openedClone(q, 1));
  q.view.pose(null, 0);
  const holder = new Group();
  const plinth = new Mesh(new CylinderGeometry(0.042, 0.045, 0.01, 32), plinthMat);
  plinth.position.y = 0.005;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  holder.add(plinth);
  const o = new Group();
  o.quaternion.copy(st.q);
  o.scale.setScalar(st.scale);
  o.position.copy(st.pivot).add(new Vector3(0, 0.01, 0));
  o.add(q.view.root);
  holder.add(o);
  holder.position.set(-0.33 + i * 0.13, LAYOUT.deskY, -0.52 - Math.abs(i - 2.5) * 0.025);
  holder.rotation.y = 0.35 - i * 0.12;
  shelf.add(holder);
  keepsakes.push(holder);
});

// ---------------------------------------------------------------------------
// Sparks along a crease (deterministic).

const glow = glowTexture();
interface Spark { s: Sprite; v: Vector3; born: number; life: number }
const sparks: Spark[] = [];
for (let i = 0; i < 90; i++) {
  const s = new Sprite(new SpriteMaterial({ map: glow, color: 0xffe0a6, transparent: true, depthWrite: false, blending: AdditiveBlending, opacity: 0 }));
  s.visible = false;
  station.add(s);
  sparks.push({ s, v: new Vector3(), born: -999, life: 0 });
}
let sparkCursor = 0;
function burst(a: Vector3, b: Vector3, count: number, n: number, color = 0xffe0a6): void {
  for (let i = 0; i < count; i++) {
    const sp = sparks[sparkCursor++ % sparks.length];
    const t = Math.random();
    sp.s.position.lerpVectors(a, b, t);
    sp.v.set((Math.random() - 0.5) * 0.05, 0.03 + Math.random() * 0.07, (Math.random() - 0.5) * 0.05);
    sp.born = n;
    sp.life = 18 + Math.random() * 16;
    (sp.s.material as SpriteMaterial).color.setHex(color);
  }
}
function updateSparks(n: number): void {
  for (const sp of sparks) {
    const age = n - sp.born;
    if (age < 0 || age > sp.life) {
      sp.s.visible = false;
      continue;
    }
    sp.s.visible = true;
    const k = age / sp.life;
    sp.s.position.addScaledVector(sp.v, DT);
    sp.v.y -= 0.04 * DT;
    sp.v.multiplyScalar(0.97);
    (sp.s.material as SpriteMaterial).opacity = Math.sin(Math.PI * Math.min(1, k * 1.4)) * (1 - k);
    sp.s.scale.setScalar(0.004 + (1 - k) * 0.007);
  }
}

/** Crease endpoints in station space for a prepared step. */
function creaseStation(q: Seq, prep: PreparedStep): [Vector3, Vector3] {
  const out: Vector3[] = [];
  for (const g of prep.guide) {
    const v = new Vector3(g[0], g[1], 0.02).multiplyScalar(PAPER_HALF);
    q.pivot.updateWorldMatrix(true, false);
    q.pivot.localToWorld(v);
    station.worldToLocal(v);
    out.push(v);
  }
  return [out[0], out[1]];
}

// ---------------------------------------------------------------------------
// Hand

const hand = new Hand();
hand.root.scale.setScalar(0.88);
station.add(hand.root);
const handTmp = new Vector3();
/** Pinch point of the current handle in station space. */
function handlePointStation(q: Seq, prep: PreparedStep, theta: number, sheet: Sheet, lift = 0): Vector3 {
  const top = (sheet.stackAt([prep.handle[0], prep.handle[1]]) + 1) * LAYER + 0.012;
  const v = q.guides.handlePoint(prep, theta, top, new Vector3());
  v.multiplyScalar(PAPER_HALF);
  q.pivot.updateWorldMatrix(true, false);
  q.pivot.localToWorld(v);
  station.worldToLocal(v);
  v.y += lift;
  return v;
}

function placeHand(p: Vector3, pinch: number, n: number, yaw = 0): void {
  hand.root.position.copy(p);
  // Fingers reach forward and down onto the mat, wrist toward the viewer.
  hand.root.rotation.set(-0.62 + Math.sin(n * 0.05) * 0.02, -0.55 + yaw, 0.1);
  hand.pose(pinch);
}

// ---------------------------------------------------------------------------
// Camera rig (station space), with motion that never fully stops.

function setCam(pos: Vector3, look: Vector3, fov: number, n: number, drift = 1): void {
  const d = drift * 0.0025;
  const p = pos.clone().add(new Vector3(Math.sin(n * 0.031) * d, Math.sin(n * 0.023 + 1) * d * 0.6, 0));
  camera.position.copy(p).add(EYE);
  camera.lookAt(look.clone().add(EYE));
  if (camera.fov !== fov) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
}
const V = (x: number, y: number, z: number) => new Vector3(x, y, z);
const lerpV = (a: Vector3, b: Vector3, t: number) => a.clone().lerp(b, t);

// Board geometry: centre and surface normal in station space.
const BOARD_C = LAYOUT.boardPos.clone();
const BN = V(0, Math.sin(-LAYOUT.boardTilt), Math.cos(-LAYOUT.boardTilt)).normalize();
const overhead = (dist: number, ox = 0, oy = 0) => BOARD_C.clone().addScaledVector(BN, dist).add(V(ox, oy, 0));

// ---------------------------------------------------------------------------
// Type overlay

const typesEl = document.getElementById('types')!;
const typeEls = T.type.map((t) => {
  const el = document.createElement('div');
  el.className = 'type';
  const words = t.text.split(' ');
  el.innerHTML = `<span class="plate">${words.map((w) => `<span class="w" style="display:inline-block">${w}</span>`).join(' ')}</span>`;
  const size = t.where.startsWith('sky') ? 66 : 72;
  el.style.fontSize = `${size}px`;
  el.style.top = { sky: '12%', sky2: '21%', crease: '64%' }[t.where as string] ?? '72%';
  if (t.text.endsWith('hands.')) el.style.fontStyle = 'italic';
  typesEl.appendChild(el);
  return { el, t, words: [...el.querySelectorAll<HTMLSpanElement>('.w')] };
});

function updateType(n: number): void {
  for (const { el, t, words } of typeEls) {
    if (n < t.in - 1 || n > t.out + 1) {
      el.style.opacity = '0';
      continue;
    }
    const enter = range(n, t.in, t.in + 14);
    const exit = range(n, t.out - 8, t.out);
    el.style.opacity = String(clamp01(enter * 3) * (1 - smooth(exit)));
    el.style.filter = exit > 0 ? `blur(${smooth(exit) * 8}px)` : 'none';
    el.style.transform = `translateY(${(1 - outCubic(enter)) * 26 - smooth(exit) * 18}px)`;
    // Words unmask one after another, like a crease running across.
    words.forEach((w, i) => {
      const k = outCubic(range(n, t.in + i * 3, t.in + i * 3 + 9));
      w.style.clipPath = `inset(-20% ${100 - k * 100}% -30% 0)`;
      w.style.transform = `translateY(${(1 - k) * 12}px)`;
    });
  }
}

// ---------------------------------------------------------------------------
// End card

const endEl = document.getElementById('end')!;
const flashEl = document.getElementById('flash')!;
{
  const bg = craftPaper('#f4ead6', 31, 1024);
  const img = (bg.image as HTMLCanvasElement).toDataURL('image/jpeg', 0.92);
  (endEl.querySelector('.bg') as HTMLElement).style.backgroundImage = `url(${img})`;
  // The fox mark, drawn by the fold engine itself.
  const ch = CHAPTERS[2];
  const s = new Sheet(ch.model.turn);
  ch.model.steps.forEach((st, k) => s.commit(s.prepare(st, k)));
  const [mn, mx] = s.bounds();
  const k = 88 / Math.max(mx[0] - mn[0], mx[1] - mn[1]);
  const cx = (mn[0] + mx[0]) / 2;
  const cy = (mn[1] + mx[1]) / 2;
  const polys = [...s.facets]
    .sort((a, b) => a.order - b.order)
    .map((f) => {
      const pts = f.poly.map((p) => apply(f.m, [p[0], p[1], 0])).map((q) => `${(50 + (q[0] - cx) * k).toFixed(2)},${(50 - (q[1] - cy) * k).toFixed(2)}`).join(' ');
      const col = (f.m[10] > 0) === ch.model.colorUp ? ch.paper.base : '#f3ead8';
      return `<polygon points="${pts}" fill="${col}" stroke="rgba(40,25,15,.35)" stroke-width="0.5" stroke-linejoin="round"/>`;
    })
    .join('');
  endEl.querySelector('.mark')!.innerHTML = polys;
  // Optional official Meta logo: drop it at film/public/meta-logo.svg.
  const logo = document.getElementById('meta-logo') as HTMLImageElement;
  const ok = await fetch('./meta-logo.svg', { method: 'HEAD' }).then((r) => r.ok && (r.headers.get('content-type') ?? '').includes('svg')).catch(() => false);
  if (ok) {
    logo.src = './meta-logo.svg';
    logo.style.display = 'block';
  }
}
const endParts = ['.mark', '.word', '.tag', '.made', '.url'].map((s) => endEl.querySelector(s) as HTMLElement);

function updateEnd(n: number): void {
  const [w0, w1] = T.wipe;
  // Lantern light fills the frame, then opens onto the card.
  const f = n < w0 ? 0 : n < 880 ? smooth(range(n, w0, 880)) : 1 - smooth(range(n, 880, w1));
  flashEl.style.opacity = String(f);
  const vis = n >= 878;
  endEl.style.opacity = vis ? String(smooth(range(n, 878, 890))) : '0';
  if (!vis) return;
  const e = n - 880;
  endParts.forEach((el, i) => {
    const k = range(e, 2 + i * 5, 18 + i * 5);
    el.style.opacity = String(clamp01(k * 2));
    if (i === 0) {
      // The mark unfolds from a flat crease, overshooting a touch.
      el.style.transform = `perspective(900px) rotateX(${(1 - outBack(k, 1.3)) * 88}deg) scale(${0.9 + 0.1 * outCubic(k)})`;
    } else {
      el.style.transform = `translateY(${(1 - outCubic(k)) * 22}px)`;
      el.style.clipPath = `inset(-10% ${(1 - outCubic(k)) * 100}% -20% 0)`;
    }
  });
  // A slow light sweep keeps the hold alive.
  const sw2 = endEl.querySelector('.sweep') as HTMLElement;
  const x = -40 + (e / 80) * 180;
  sw2.style.background = `linear-gradient(105deg, rgba(255,255,255,0) ${x - 18}%, rgba(255,246,226,0.55) ${x}%, rgba(255,255,255,0) ${x + 18}%)`;
}

// ---------------------------------------------------------------------------
// Scene logic

const tentStage = stages.shelter;
let progressNow = 0;
let released = false;
const swanCreature = new Creature(seqs.swan);
const tentCreature = new Creature(seqs.tent);
let swanFrom: { pos: Vector3; quat: Quaternion } | null = null;
let swanTo: { pos: Vector3; quat: Quaternion; st: Stand } | null = null;
let tentStand: Stand | null = null;
let lastSnapSeen = -1;
const glowLevel: Record<string, number> = { tent: 0, fox: 0, swan: 0 };

function showOnly(model: string | null): void {
  for (const [k, q] of Object.entries(seqs)) {
    q.pivot.visible = k === model;
    q.guides.setVisible(false);
  }
}

function setFlip(q: Seq, phi: number, isNew: boolean, spin: number): void {
  // Turn the sheet over about the board's X axis, lifting it off the mat.
  q.pivot.position.set(0, 0, Math.sin(Math.min(Math.PI, Math.max(0, phi))) * 0.07);
  q.pivot.rotation.set(isNew ? phi - Math.PI : phi, 0, spin);
}

function boardPoseInStation(): { pos: Vector3; quat: Quaternion } {
  board.updateWorldMatrix(true, false);
  station.updateWorldMatrix(true, false);
  const m = new Matrix4().copy(station.matrixWorld).invert().multiply(board.matrixWorld);
  const pos = new Vector3();
  const quat = new Quaternion();
  m.decompose(pos, quat, new Vector3());
  return { pos, quat };
}

function snapFX(model: string, n: number): void {
  const fl = T.folds.filter((f) => f.model === model);
  fl.forEach((f, i) => {
    if (f.snap === n && lastSnapSeen !== n) {
      const q = seqs[model];
      const [a, b] = creaseStation(q, q.snaps[i].prep);
      if (f.kind !== 'flip') burst(a, b, model === 'tent' ? 26 : 14, n);
      glowLevel[model] = model === 'tent' ? 0.7 : 0.45;
      lastSnapSeen = n;
    }
  });
}

function decayGlow(): void {
  for (const k of Object.keys(glowLevel)) {
    glowLevel[k] = Math.max(0, glowLevel[k] - DT * 1.6);
    seqs[k].view.setGlow(glowLevel[k]);
  }
}

/** Advance simulation state to frame n (no rendering). Must be called in order. */
function step(n: number): void {
  const time = n / FPS;
  // Lake lanterns light up chapter by chapter.
  for (const [f, p] of T.progress) if (n >= f) progressNow = p;
  env.setProgress(progressNow);
  if (n >= T.release && !released) {
    released = true;
    env.celebrate(-1);
    for (const l of (env as unknown as { lanternData: { vy: number }[] }).lanternData) l.vy *= 7;
  }
  env.update(time, DT);
  for (const s of Object.values(stages)) if (s.root.visible) s.update(time, DT);
  updateSparks(n);
  decayGlow();

  shelf.visible = n >= 716 && n < 800;
  // Clear the desk for the keepsakes and the wide release shot.
  board.parent!.visible = n < 716;
  stageAnchor.visible = n < 716;
  hand.setOpacity(0);

  // ----- hook + reveal: the tent sheet -----------------------------------
  if (n < 240) {
    showStage('shelter');
    const tent = seqs.tent;
    if (n < 150) {
      showOnly('tent');
      setFlip(tent, 0, false, 0);
      const fs = foldState('tent', n);
      poseSeq(tent, fs.k, fs.theta);
      const prep = tent.snaps[0].prep;
      if (fs.k < 1) {
        tent.guides.show(tent.snaps[0].sheet, prep);
        tent.guides.grabbed = n >= 40;
        tent.guides.update(tent.snaps[0].sheet, fs.theta, time);
        tent.guides.setVisible(n < 118);
      }
      snapFX('tent', n);
      // Hand: rests by the far edge, pinches on beat 2, carries the flap over.
      const f = T.folds[0];
      const sheet = tent.snaps[0].sheet;
      let p: Vector3;
      let pinch = 0;
      if (n < f.pinch) {
        const k = smooth(range(n, 0, f.pinch));
        p = handlePointStation(tent, prep, 0, sheet, 0.03 * (1 - k) + 0.004);
        p.z += 0.012 * (1 - k);
        pinch = 0.15 * k;
      } else if (n < f.snap + 4) {
        p = handlePointStation(tent, prep, fs.k >= 1 ? prep.target : fs.theta, sheet, 0.002);
        pinch = smooth(range(n, f.pinch - 2, f.pinch + 4));
      } else {
        const k = smooth(range(n, f.snap + 4, f.snap + 28));
        p = handlePointStation(tent, prep, prep.target, sheet, 0.002 + k * 0.12);
        p.x += k * 0.12;
        p.z += k * 0.12;
        pinch = 1 - k;
      }
      placeHand(p, pinch, n);
      hand.setOpacity(n < f.snap + 4 ? 1 : 1 - smooth(range(n, f.snap + 16, f.snap + 30)));
    } else {
      // Life: the folded tent lifts and stands on the mat, then settles back.
      showOnly(null);
      tent.pivot.visible = true;
      const L = T.life[0];
      if (!tentStand) tentStand = standFor(tent, tentStage, 0.62);
      const up = smooth(range(n, L.open[0], L.open[0] + 24));
      const down = smooth(range(n, 198, 212));
      const u = up * (1 - down);
      if (n < 212) {
        if (!tentCreature.outer.parent) {
          station.add(tentCreature.outer);
          tentCreature.attach();
        }
        tent.view.sync(openedClone(tent, u));
        tent.view.pose(null, 0);
        const from = boardPoseInStation();
        const toPos = BOARD_C.clone().add(V(0, 0.012, 0.01));
        tentCreature.outer.position.lerpVectors(from.pos, toPos, u);
        tentCreature.outer.position.y += Math.sin(u * Math.PI) * 0.05;
        tentCreature.outer.quaternion.slerpQuaternions(from.quat, new Quaternion(), u);
        tentCreature.inner.quaternion.slerpQuaternions(new Quaternion(), tentStand.q, u);
        tentCreature.inner.position.lerpVectors(V(0, 0, 0), tentStand.pivot, u);
        tentCreature.inner.scale.setScalar(mix(1, tentStand.scale, u));
        // Breathing while it stands.
        tentCreature.outer.rotation.y += Math.sin(time * 2.2) * 0.04 * u;
        if (n === L.open[0]) {
          const c = BOARD_C.clone();
          burst(c.clone().add(V(-0.06, 0.02, 0)), c.clone().add(V(0.06, 0.02, 0)), 18, n, 0xfff1c8);
        }
      } else {
        if (tentCreature.outer.parent) tentCreature.detach();
        // Morph: unfold flat, then turn over into the fox's sheet.
        const M = T.morphs[0];
        const ku = range(n, M.unfold[0], M.unfold[1]);
        const fox = seqs.fox;
        const kf = range(n, M.flip[0], M.flip[1]);
        const phi = Math.PI * inOut(kf);
        const spin = (Math.PI / 4) * inOut(kf);
        if (phi <= Math.PI / 2) {
          showOnly('tent');
          poseSeq(tent, 0, tent.snaps[0].prep.target * (1 - inOut(ku)));
          setFlip(tent, phi, false, spin);
        } else {
          showOnly('fox');
          poseSeq(fox, 0, 0);
          setFlip(fox, phi, true, spin - Math.PI / 4);
        }
      }
    }
  }
  // ----- fox montage -------------------------------------------------------
  else if (n < 400) {
    showStage('shelter');
    const fox = seqs.fox;
    const M = T.morphs[1];
    if (n < M.unfold[0]) {
      showOnly('fox');
      setFlip(fox, 0, false, 0);
      const fs = foldState('fox', n);
      const L = T.life[1];
      if (n >= L.open[0]) {
        // The fox pops its ears.
        const u = Math.sin(Math.PI * clamp01(range(n, L.open[0], L.open[1] + 2)));
        fox.view.sync(openedClone(fox, 0.25 + 0.75 * u));
        fox.view.pose(null, 0);
        if (n === L.open[0]) {
          const c = BOARD_C.clone();
          burst(c.clone().add(V(-0.04, 0.03, 0)), c.clone().add(V(0.04, 0.03, 0)), 14, n, 0xfff1c8);
        }
      } else {
        poseSeq(fox, fs.k, fs.theta);
      }
      snapFX('fox', n);
      // The hand works fold to fold, on the beat.
      const fl = T.folds.filter((f) => f.model === 'fox');
      let p: Vector3 | null = null;
      let pinch = 0;
      for (let i = 0; i < fl.length; i++) {
        const f = fl[i];
        const prev = i > 0 ? fl[i - 1] : null;
        const start = prev ? prev.snap : 230;
        if (n >= start && n < f.snap + (i === fl.length - 1 ? 14 : 0)) {
          const sn = fox.snaps[i];
          if (n < f.pinch) {
            // Travel from the last crease to this handle along an arc.
            const k = inOut(range(n, start, f.pinch));
            const a = prev ? handlePointStation(fox, fox.snaps[i - 1].prep, fox.snaps[i - 1].prep.target, fox.snaps[i - 1].sheet, 0.002) : BOARD_C.clone().add(V(0.12, 0.1, 0.1));
            const b = handlePointStation(fox, sn.prep, 0, sn.sheet, 0.002);
            p = a.lerp(b, k);
            p.y += Math.sin(k * Math.PI) * 0.03;
            pinch = 1 - Math.sin(k * Math.PI) * 0.9;
          } else if (n < f.snap) {
            p = handlePointStation(fox, sn.prep, fs.k === i ? fs.theta : sn.prep.target, sn.sheet, 0.002);
            pinch = 1;
          } else {
            const k = smooth(range(n, f.snap, f.snap + 14));
            p = handlePointStation(fox, sn.prep, sn.prep.target, sn.sheet, 0.002 + k * 0.1);
            p.x += k * 0.1;
            p.z += k * 0.1;
            pinch = 1 - k;
          }
          break;
        }
      }
      if (p) {
        placeHand(p, pinch, n, 0.15);
        hand.setOpacity(n > 368 ? 1 - smooth(range(n, 368, 374)) : smooth(range(n, 230, 238)));
      }
    } else {
      // Unfold the fox flat, then turn over into the swan's sheet.
      const ku = range(n, M.unfold[0], M.unfold[1]);
      const kf = range(n, M.flip[0], M.flip[1]);
      const phi = Math.PI * inOut(kf);
      const spin = (Math.PI / 4) * inOut(kf);
      const nSteps = fox.snaps.length;
      if (phi <= Math.PI / 2) {
        showOnly('fox');
        // Run the folds backwards, fast.
        const x = (1 - inOut(ku)) * nSteps;
        const k = Math.min(nSteps - 1, Math.floor(x));
        const frac = x - k;
        poseSeq(fox, k, fox.snaps[k].prep.target * frac);
        setFlip(fox, phi, false, 0);
        fox.pivot.rotation.z = spin * 0;
      } else {
        showOnly('swan');
        poseSeq(seqs.swan, 0, 0);
        setFlip(seqs.swan, phi, true, 0);
      }
    }
  }
  // ----- swan flurry -------------------------------------------------------
  else if (n < 480) {
    showStage('lake');
    showOnly('swan');
    const swan = seqs.swan;
    setFlip(swan, 0, false, 0);
    const fs = foldState('swan', n);
    poseSeq(swan, fs.k, fs.theta);
    snapFX('swan', n);
  }
  // ----- the swan comes alive and glides into the lake --------------------
  else if (n < 560) {
    showStage('lake');
    const swan = seqs.swan;
    const lake = stages.lake;
    const L = T.life[2];
    showOnly(null);
    swan.pivot.visible = true;
    if (!swanCreature.outer.parent) {
      lake.root.updateWorldMatrix(true, true);
      board.updateWorldMatrix(true, false);
      const m = new Matrix4().copy(lake.root.matrixWorld).invert().multiply(board.matrixWorld);
      const pos = new Vector3();
      const quat = new Quaternion();
      m.decompose(pos, quat, new Vector3());
      swanFrom = { pos, quat };
      const st = standFor(swan, lake, lake.creatureScale);
      swanTo = { pos: lake.landing.clone(), quat: new Quaternion(), st };
      lake.root.add(swanCreature.outer);
      swanCreature.attach();
    }
    const u = smooth(range(n, L.open[0], L.open[1]));
    swan.view.sync(openedClone(swan, u));
    swan.view.pose(null, 0);
    const g = inOut(range(n, L.glide![0], L.glide![1]));
    const st = swanTo!.st;
    const c = swanCreature;
    c.outer.position.lerpVectors(swanFrom!.pos, swanTo!.pos, g);
    c.outer.position.y += Math.sin(g * Math.PI) * 0.06 + smooth(range(n, 480, 500)) * 0.02 * (1 - g);
    c.outer.quaternion.slerpQuaternions(swanFrom!.quat, swanTo!.quat, g);
    c.inner.quaternion.slerpQuaternions(new Quaternion(), st.q, g);
    c.inner.scale.setScalar(mix(1, st.scale, g));
    c.inner.position.lerpVectors(V(0, 0, 0), st.pivot, g);
    if (n >= L.land!) {
      const t = (n - L.land!) / FPS;
      c.outer.position.x = swanTo!.pos.x + t * 0.02;
      c.outer.position.y = swanTo!.pos.y + Math.sin(t * 2) * 0.0015;
      c.outer.rotation.y = Math.sin(t * 0.8) * 0.12;
    }
    if (n === 480) burst(BOARD_C.clone().add(V(-0.05, 0.03, 0)), BOARD_C.clone().add(V(0.05, 0.03, 0)), 20, n, 0xfff1c8);
    if (n >= 540) {
      lake.solved = true;
      lake.update(time, DT * 4); // let the moon climb within the shot
    }
  }
  // ----- fox path -----------------------------------------------------------
  else if (n < 640) {
    showStage('fox');
    showOnly(null);
    if (swanCreature.outer.parent) swanCreature.detach();
    const a = T.acts.foxpath;
    if (n === a.start) stages.fox.reset();
    stages.fox.act(foxActor.creature.outer, ((n - a.start) / FPS) * a.speed + a.offset, DT * a.speed);
  }
  // ----- canyon --------------------------------------------------------------
  else if (n < 720) {
    showStage('canyon');
    showOnly(null);
    const a = T.acts.canyon;
    if (n === a.start) stages.canyon.reset();
    stages.canyon.act(planeActor.creature.outer, ((n - a.start) / FPS) * a.speed + a.offset, DT * a.speed);
  }
  // ----- shelf, release, end --------------------------------------------------
  else {
    showStage('lake');
    showOnly(null);
    stages.lake.solved = true;
    if (n < 800) {
      keepsakes.forEach((k, i) => {
        const pop = outBack(range(n, 722 + i * 11, 734 + i * 11), 2);
        k.scale.setScalar(Math.max(0.001, pop));
        k.children[1].rotation.y = Math.sin(time * 1.5 + i) * 0.08;
      });
    }
  }
}

/** Camera for frame n. */
function shoot(n: number): void {
  if (n < 160) {
    // Three-quarter macro of the whole sheet; the flap comes toward camera.
    const k = smooth(range(n, 0, 160));
    // Once the flap lands, follow the folded half and ease back a little.
    const c = inOut(range(n, 84, 150));
    const pos = lerpV(V(0.17, -0.235, -0.15), V(0.13, -0.22, -0.16), k).add(V(0, 0.012, 0.045).multiplyScalar(c));
    const look = lerpV(V(-0.005, -0.425, -0.39), V(0.0, -0.43, -0.385), k).add(V(0, 0, 0.045).multiplyScalar(c));
    setCam(pos, look, mix(27, 29, k), n);
  } else if (n < 240) {
    const k = inOut(range(n, 160, 236));
    const pos = lerpV(V(0.13, -0.208, -0.115), overhead(0.42, 0, 0), k);
    const look = lerpV(V(0.0, -0.43, -0.34), BOARD_C, k);
    setCam(pos, look, mix(29, 38, k), n);
  } else if (n < 400) {
    const k = range(n, 240, 400);
    setCam(overhead(0.42 - k * 0.03, Math.sin(k * 3) * 0.004), BOARD_C, 38, n, 0.5);
  } else if (n < 480) {
    // The swan base is long: widen while it is folded, then settle in to
    // exactly where the lake shot picks up.
    const up = inOut(range(n, 400, 418));
    const dn = inOut(range(n, 448, 480));
    setCam(overhead(mix(mix(0.39, 0.47, up), 0.36, dn), 0, 0), BOARD_C, mix(38, 36, dn), n, 0.5);
  } else if (n < 560) {
    // Rise and turn to watch the swan glide into the lake diorama.
    const k = inOut(range(n, 482, 552));
    const pos = lerpV(overhead(0.36), V(0.09, -0.27, -0.36), k);
    const look = lerpV(BOARD_C, V(-0.03, -0.445, -0.84), k);
    setCam(pos, look, mix(36, 42, k), n);
  } else if (n < 640) {
    const k = range(n, 560, 640);
    setCam(V(-0.2 + k * 0.05, -0.335, -0.52), V(0.03 + k * 0.02, -0.465, -0.83), 40, n);
  } else if (n < 720) {
    const k = range(n, 640, 720);
    setCam(V(0.02 - k * 0.02, -0.3, -0.45 - k * 0.02), V(0.02, -0.36, -0.84), 44, n);
  } else if (n < 800) {
    const k = inOut(range(n, 716, 800));
    setCam(V(-0.12 + k * 0.22, -0.4, -0.02), V(-0.06 + k * 0.12, -0.47, -0.53), 42, n);
  } else {
    // Wide over the lake; tilt up with the lanterns.
    const k = inOut(range(n, 800, 880));
    setCam(V(0.0, -0.18 + k * 0.05, 0.12), V(0.0, -0.7 + k * 1.6, -5), mix(50, 54, k), n);
  }
}

// Miniature focus: soft blur bands at the top and bottom of close shots.
const tiltTop = document.getElementById('tiltTop')!;
const tiltBot = document.getElementById('tiltBot')!;
function updateFocus(n: number): void {
  let b = 0;
  if (n < 240) b = 7 - 4 * smooth(range(n, 170, 236));
  else if (n < 480) b = 2.5;
  else if (n < 720) b = 6;
  else if (n < 800) b = 7;
  else b = 3;
  for (const el of [tiltTop, tiltBot]) el.style.setProperty('--b', `${b.toFixed(2)}px`);
}

// ---------------------------------------------------------------------------

let last = -1;
function reset(): void {
  location.reload();
}

async function frame(n: number): Promise<void> {
  if (n !== last + 1) {
    if (n <= last) {
      reset();
      return;
    }
    for (let f = last + 1; f < n; f++) {
      step(f);
    }
  }
  step(n);
  shoot(n);
  updateType(n);
  updateEnd(n);
  updateFocus(n);
  renderer.render(scene, camera);
  last = n;
}

await document.fonts.ready;
await Promise.all([
  document.fonts.load('600 60px "Fraunces Variable"'),
  document.fonts.load('italic 400 40px "Fraunces Variable"'),
  document.fonts.load('600 30px "Inter Variable"'),
]).catch(() => undefined);
/** Advance the simulation through frame n without drawing (for skipping ahead). */
function sim(n: number): void {
  if (n !== last + 1) return;
  step(n);
  last = n;
}
(window as unknown as { film: unknown }).film = { frame, sim, total: T.totalFrames, ready: true };
