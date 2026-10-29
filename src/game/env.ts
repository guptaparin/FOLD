/**
 * The world around the desk: a dusk sky with stars and a paper moon, layered
 * cut-paper mountains, a lake of floating lanterns, the writing desk, the
 * folding stand and the warm desk lantern.
 *
 * The world quietly reflects progress: each finished chapter lights more
 * lanterns on the lake and raises the moon a little higher.
 */
import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  FogExp2,
  Group,
  HemisphereLight,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  Points,
  Scene,
  ShaderMaterial,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
} from '@iwsdk/core';
import { craftPaper, glowTexture, matTexture, rng, woodTexture } from './textures.js';

/** Station layout, metres, relative to the player's eyes at recentre. */
export const LAYOUT = {
  deskY: -0.5,
  deskZ: -0.58,
  boardPos: new Vector3(0, -0.5 + 0.06, -0.37),
  boardTilt: (-62 * Math.PI) / 180, // tilt from vertical: mat leans back toward the player
  stagePos: new Vector3(0, -0.5, -0.82),
};

const skyVert = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * p;
  }
`;
const skyFrag = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uMid;
  uniform vec3 uHorizon;
  uniform vec3 uBottom;
  uniform float uWarm;
  varying vec3 vDir;
  void main() {
    float h = vDir.y;
    vec3 c = mix(uHorizon, uMid, smoothstep(0.0, 0.22, h));
    c = mix(c, uTop, smoothstep(0.18, 0.8, h));
    c = mix(c, uBottom, smoothstep(0.0, -0.25, h));
    // Warm glow low on the horizon, strongest toward the moon (−Z).
    float toward = max(0.0, -vDir.z);
    c += vec3(0.32, 0.14, 0.06) * uWarm * toward * exp(-abs(h) * 9.0);
    gl_FragColor = vec4(c, 1.0);
  }
`;

const starVert = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  uniform float uTime;
  varying float vA;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vA = 0.55 + 0.45 * sin(uTime * (0.6 + aPhase) + aPhase * 30.0);
    gl_PointSize = aSize;
    gl_Position = projectionMatrix * mv;
  }
`;
const starFrag = /* glsl */ `
  varying float vA;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float a = smoothstep(0.5, 0.0, length(d));
    gl_FragColor = vec4(1.0, 0.95, 0.85, a * vA);
  }
`;

export class Environment {
  readonly root = new Group();
  /** Moves with recentre: desk, stand, lantern. */
  readonly station = new Group();
  /** Folding board: fold-space +Z is its surface normal. */
  readonly board = new Group();
  readonly stageAnchor = new Group();
  readonly moonLight: DirectionalLight;
  private stars: Points;
  private starMat: ShaderMaterial;
  private moon = new Group();
  private lanterns: InstancedMesh;
  private lanternData: { p: Vector3; phase: number; lit: number; target: number; rise: number; vy: number }[] = [];
  /** Things that only belong to the virtual world (hidden in mixed reality). */
  private worldOnly: Object3D[] = [];
  private fog: FogExp2;
  mixedReality = false;
  private lanternMat: MeshStandardMaterial;
  private deskLight: PointLight;
  private deskFlame: Mesh;
  private tmp = new Object3D();
  private c = new Color();
  private progress = 0;
  private moonY = 0;

  constructor(private scene: Scene) {
    this.root.name = 'Environment';
    this.fog = new FogExp2(0x1c2440, 0.018);
    scene.fog = this.fog;

    // Sky dome.
    const sky = new Mesh(
      new SphereGeometry(70, 48, 24),
      new ShaderMaterial({
        vertexShader: skyVert,
        fragmentShader: skyFrag,
        side: BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uTop: { value: new Color(0x070b1d) },
          uMid: { value: new Color(0x1d2550) },
          uHorizon: { value: new Color(0x7d4d6b) },
          uBottom: { value: new Color(0x0a0d18) },
          uWarm: { value: 1 },
        },
      }),
    );
    sky.renderOrder = -10;
    this.root.add(sky);
    this.worldOnly.push(sky);

    // Stars.
    const r = rng(42);
    const n = 1400;
    const pos = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const phase = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = r();
      const v = 0.08 + r() * 0.92;
      const th = u * Math.PI * 2;
      const y = v;
      const rr = Math.sqrt(1 - y * y);
      pos.set([Math.cos(th) * rr * 62, y * 62, Math.sin(th) * rr * 62], i * 3);
      size[i] = 1 + Math.pow(r(), 6) * 3.5;
      phase[i] = r();
    }
    const sg = new BufferGeometry();
    sg.setAttribute('position', new BufferAttribute(pos, 3));
    sg.setAttribute('aSize', new BufferAttribute(size, 1));
    sg.setAttribute('aPhase', new BufferAttribute(phase, 1));
    this.starMat = new ShaderMaterial({
      vertexShader: starVert,
      fragmentShader: starFrag,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: false,
      uniforms: { uTime: { value: 0 } },
    });
    this.stars = new Points(sg, this.starMat);
    this.root.add(this.stars);
    this.worldOnly.push(this.stars);

    // Paper moon.
    const moonDisc = new Mesh(
      new CircleGeometry(3.6, 64),
      new MeshBasicMaterial({ map: craftPaper('#f3e6c4', 77, 512), fog: false }),
    );
    const moonGlow = new Sprite(
      new SpriteMaterial({ map: glowTexture(), color: 0xffe2b0, transparent: true, opacity: 0.55, depthWrite: false, blending: AdditiveBlending, fog: false }),
    );
    moonGlow.scale.setScalar(22);
    moonGlow.position.z = -0.1;
    this.moon.add(moonGlow, moonDisc);
    // Moon craters as darker paper circles.
    const craterMat = new MeshBasicMaterial({ color: 0xd8c59c, fog: false });
    for (const [x, y, s] of [
      [-0.7, 0.6, 0.45],
      [0.8, -0.4, 0.6],
      [0.1, -1.1, 0.3],
      [0.5, 0.9, 0.22],
    ]) {
      const cm = new Mesh(new CircleGeometry(s, 32), craterMat);
      cm.position.set(x, y, 0.01);
      this.moon.add(cm);
    }
    this.moon.position.set(6, 4, -55);
    this.moon.lookAt(0, 0, 0);
    this.root.add(this.moon);
    this.worldOnly.push(this.moon);

    // Cut-paper mountain ridges, three layers.
    const ridgeColors = ['#3b3e66', '#2b2d50', '#1d1f3a'];
    ridgeColors.forEach((col, layer) => {
      const radius = 52 - layer * 9;
      const mat = new MeshStandardMaterial({
        map: craftPaper(col, 10 + layer, 256),
        roughness: 1,
        side: DoubleSide,
      });
      const segs = 9;
      for (let s = 0; s < segs; s++) {
        const shape = new Shape();
        const width = 26;
        const pr = rng(100 + layer * 17 + s);
        shape.moveTo(-width / 2, -4);
        const peaks = 7;
        for (let k = 0; k <= peaks; k++) {
          const x = -width / 2 + (width * k) / peaks;
          const y = 0.5 + pr() * (5 - layer * 0.8) + (k % 2) * 2;
          shape.lineTo(x, y);
        }
        shape.lineTo(width / 2, -4);
        const m = new Mesh(new ShapeGeometry(shape), mat);
        const a = ((s - (segs - 1) / 2) / segs) * Math.PI * 1.25 + Math.PI;
        m.position.set(Math.sin(a) * radius, -2.6, Math.cos(a) * radius);
        m.lookAt(0, -2.6, 0);
        this.root.add(m);
        this.worldOnly.push(m);
      }
    });

    // Dark lake.
    const lake = new Mesh(
      new CircleGeometry(70, 64),
      new MeshStandardMaterial({ color: 0x10172c, roughness: 0.25, metalness: 0.4 }),
    );
    lake.rotation.x = -Math.PI / 2;
    lake.position.y = -1.4;
    this.root.add(lake);
    this.worldOnly.push(lake);

    // Floating lanterns on the lake; more light up as chapters are finished.
    const lanternGeo = new LatheGeometry(
      [
        new Vector2(0.0, -0.16),
        new Vector2(0.09, -0.15),
        new Vector2(0.14, -0.06),
        new Vector2(0.15, 0.04),
        new Vector2(0.12, 0.13),
        new Vector2(0.06, 0.17),
        new Vector2(0.0, 0.17),
      ],
      10,
    );
    this.lanternMat = new MeshStandardMaterial({
      color: 0xf4e3c3,
      emissive: 0xff9a4a,
      emissiveIntensity: 1,
      roughness: 0.9,
      flatShading: true,
    });
    const count = 48;
    this.lanterns = new InstancedMesh(lanternGeo, this.lanternMat, count);
    const lr = rng(7);
    for (let i = 0; i < count; i++) {
      const a = Math.PI + (lr() - 0.5) * Math.PI * 1.4;
      const d = 4 + lr() * 18;
      this.lanternData.push({
        p: new Vector3(Math.sin(a) * d, -1.25 + lr() * 0.15, Math.cos(a) * d),
        phase: lr() * 10,
        lit: 0,
        target: 0,
        rise: 0,
        vy: 0,
      });
      this.lanterns.setColorAt(i, this.c.set(0x2a2a35));
    }
    this.root.add(this.lanterns);
    this.worldOnly.push(this.lanterns);

    // Lights.
    const hemi = new HemisphereLight(0x8ea0d8, 0x3a2a24, 0.55);
    this.root.add(hemi);
    this.moonLight = new DirectionalLight(0xc9d6ff, 1.35);
    this.moonLight.castShadow = true;
    this.moonLight.shadow.mapSize.set(1536, 1536);
    const sc = this.moonLight.shadow.camera;
    sc.left = -0.75;
    sc.right = 0.75;
    sc.top = 0.75;
    sc.bottom = -0.75;
    sc.near = 0.1;
    sc.far = 6;
    this.moonLight.shadow.bias = -0.0004;
    this.moonLight.shadow.normalBias = 0.002;

    // Desk, stand, lantern — all on the station so recentre moves them together.
    this.station.name = 'Station';
    this.buildDesk();
    this.station.add(this.moonLight, this.moonLight.target);
    this.moonLight.position.set(1.2, 2.2, 0.6);
    this.moonLight.target.position.set(0, LAYOUT.deskY, -0.6);

    // Desk lantern (warm key light).
    const lantern = new Group();
    const shade = new Mesh(
      lanternGeo,
      new MeshStandardMaterial({ color: 0xf6e7cc, emissive: 0xffa457, emissiveIntensity: 1.3, roughness: 0.9, flatShading: true }),
    );
    shade.scale.setScalar(0.42);
    const capMat = new MeshStandardMaterial({ color: 0x2a1c14, roughness: 0.6 });
    const cap = new Mesh(new CylinderGeometry(0.02, 0.026, 0.012, 16), capMat);
    cap.position.y = 0.075;
    const base = new Mesh(new CylinderGeometry(0.03, 0.034, 0.01, 16), capMat);
    base.position.y = -0.07;
    this.deskFlame = new Mesh(
      new SphereGeometry(0.012, 12, 8),
      new MeshBasicMaterial({ color: 0xffe0a0 }),
    );
    const halo = new Sprite(
      new SpriteMaterial({ map: glowTexture(), color: 0xffa860, transparent: true, opacity: 0.45, depthWrite: false, blending: AdditiveBlending }),
    );
    halo.scale.setScalar(0.35);
    lantern.add(shade, cap, base, this.deskFlame, halo);
    lantern.position.set(-0.42, LAYOUT.deskY + 0.075, -0.62);
    this.deskLight = new PointLight(0xffae66, 1.6, 2.2, 1.6);
    this.deskLight.position.set(-0.42, LAYOUT.deskY + 0.1, -0.62);
    this.station.add(lantern, this.deskLight);

    this.root.add(this.station);
    scene.add(this.root);
  }

  private buildDesk(): void {
    const wood = woodTexture();
    const deskMat = new MeshStandardMaterial({ map: wood, roughness: 0.62, metalness: 0.02 });
    const top = new Mesh(new BoxGeometry(1.4, 0.04, 0.82), deskMat);
    top.position.set(0, LAYOUT.deskY - 0.02, LAYOUT.deskZ);
    top.receiveShadow = true;
    this.station.add(top);
    this.worldOnly.push(top);
    // A front lip, slightly rounded by a cylinder.
    const lip = new Mesh(new CylinderGeometry(0.02, 0.02, 1.4, 16), deskMat);
    lip.rotation.z = Math.PI / 2;
    lip.position.set(0, LAYOUT.deskY - 0.02, LAYOUT.deskZ + 0.41);
    this.station.add(lip);
    this.worldOnly.push(lip);
    // Legs fading into the dark.
    const legMat = new MeshStandardMaterial({ color: 0x3a2617, roughness: 0.8 });
    for (const [x, z] of [
      [-0.64, -0.24],
      [0.64, -0.24],
      [-0.64, -0.92],
      [0.64, -0.92],
    ]) {
      const leg = new Mesh(new BoxGeometry(0.05, 0.7, 0.05), legMat);
      leg.position.set(x, LAYOUT.deskY - 0.39, z);
      this.station.add(leg);
      this.worldOnly.push(leg);
    }

    // Folding stand: a slanted board with a felt mat.
    const stand = new Group();
    stand.position.copy(LAYOUT.boardPos);
    stand.rotation.x = LAYOUT.boardTilt;
    const plank = new Mesh(new BoxGeometry(0.3, 0.3, 0.012), deskMat);
    plank.position.z = -0.008;
    plank.receiveShadow = true;
    const mat = new Mesh(
      new PlaneGeometry(0.28, 0.28),
      new MeshStandardMaterial({ map: matTexture(), roughness: 0.95 }),
    );
    mat.position.z = -0.0015;
    mat.receiveShadow = true;
    stand.add(plank, mat);
    // Little wedge feet holding it up.
    const footMat = new MeshStandardMaterial({ color: 0x4a2e1b, roughness: 0.7 });
    for (const x of [-0.12, 0.12]) {
      const foot = new Mesh(new BoxGeometry(0.02, 0.016, 0.1), footMat);
      foot.position.set(x, 0.11, -0.05);
      foot.rotation.x = -LAYOUT.boardTilt - Math.PI / 2;
      stand.add(foot);
    }
    this.board.name = 'Board';
    this.board.position.z = 0.0005;
    stand.add(this.board);
    this.station.add(stand);

    this.stageAnchor.position.copy(LAYOUT.stagePos);
    this.station.add(this.stageAnchor);
  }

  /** 0..1 chapter progress drives lanterns and moon height. */
  setProgress(p: number): void {
    this.progress = p;
    const n = this.lanternData.length;
    const lit = Math.round(4 + p * (n - 4));
    this.lanternData.forEach((l, i) => (l.target = i < lit ? 1 : 0));
  }

  /**
   * Mixed reality: hide the sky, lake, mountains and virtual desk so the paper,
   * the stand and the diorama sit in the player's real room.
   */
  setMixedReality(on: boolean): void {
    this.mixedReality = on;
    for (const o of this.worldOnly) o.visible = !on;
    this.scene.fog = on ? null : this.fog;
  }

  /** Release lit lanterns into the sky. `count` < 0 releases every lit one. */
  celebrate(count: number): void {
    let n = 0;
    for (const l of this.lanternData) {
      if (l.target < 1 || l.vy > 0) continue;
      l.vy = 0.12 + Math.random() * 0.12;
      if (count >= 0 && ++n >= count) break;
    }
  }

  /** Place the station at the player's head (seated or standing). */
  recenter(head: Vector3, yaw: number): void {
    this.station.position.copy(head);
    this.station.rotation.set(0, yaw, 0);
  }

  update(time: number, dt: number): void {
    this.starMat.uniforms.uTime.value = time;
    // Moon rises with progress.
    const targetY = 3 + this.progress * 14;
    this.moonY += (targetY - this.moonY) * Math.min(1, dt * 0.6);
    this.moon.position.set(6, this.moonY, -55);
    this.moon.lookAt(0, 0, 0);
    // Lanterns bob and light up.
    for (let i = 0; i < this.lanternData.length; i++) {
      const l = this.lanternData[i];
      l.lit += (l.target - l.lit) * Math.min(1, dt * 0.8);
      if (l.vy > 0) {
        // A sky lantern: drift up and away, then return to the lake lit.
        l.rise += l.vy * dt;
        if (l.rise > 16) {
          l.rise = 0;
          l.vy = 0;
        }
      }
      this.tmp.position.set(
        l.p.x + Math.sin(l.rise * 0.4 + l.phase) * l.rise * 0.08,
        l.p.y + l.rise + Math.sin(time * 0.6 + l.phase) * 0.04,
        l.p.z,
      );
      this.tmp.rotation.set(Math.sin(time * 0.4 + l.phase) * 0.06, l.phase, 0);
      this.tmp.updateMatrix();
      this.lanterns.setMatrixAt(i, this.tmp.matrix);
      const flick = 0.85 + Math.sin(time * 7 + l.phase * 3) * 0.08;
      this.c.setRGB(0.16 + 0.84 * l.lit * flick, 0.16 + 0.5 * l.lit * flick, 0.2 + 0.1 * l.lit);
      this.lanterns.setColorAt(i, this.c);
    }
    this.lanterns.instanceMatrix.needsUpdate = true;
    if (this.lanterns.instanceColor) this.lanterns.instanceColor.needsUpdate = true;
    // Candle flicker.
    const f = 1 + Math.sin(time * 11) * 0.05 + Math.sin(time * 17.3) * 0.04;
    this.deskLight.intensity = 1.6 * f;
    this.deskFlame.scale.setScalar(f);
  }
}

// Silence unused-import lint for helpers kept for scenery building.
void Float32BufferAttribute;
void Matrix4;
