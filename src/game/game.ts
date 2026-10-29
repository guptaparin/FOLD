/**
 * FOLD — the game system. One ECS system orchestrates the chapter flow:
 *
 *   menu  →  intro  →  fold (step by step)  →  life  →  act  →  done
 *
 * Folding is driven by real hand pinches (or a controller, gaze + pinch, or
 * the mouse). The paper flap follows the player's fingers around the crease
 * hinge, and releasing past the snap point presses the crease flat.
 */
import {
  AdditiveBlending,
  createSystem,
  CylinderGeometry,
  Mesh,
  MeshStandardMaterial,
  Group,
  Matrix4,
  Object3D,
  PCFSoftShadowMap,
  Quaternion,
  SessionMode,
  Sprite,
  SpriteMaterial,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { sound } from './audio.js';
import { Diorama } from './dioramas.js';
import { Facet, PreparedStep, Sheet } from './fold/engine.js';
import { Environment, LAYOUT } from './env.js';
import { InputHub, Pointer, rayPointDistance } from './input.js';
import { CHAPTERS, Chapter, dailyFor, todayKey } from './levels.js';
import { Opener } from './life.js';
import { FoldGuides, PAPER_HALF, PaperView } from './paper-view.js';
import { dayGap, load, SaveData, store } from './save.js';
import { glowTexture, paperBack, paperFront, PaperStyle } from './textures.js';
import { Button, Card, SANS, SERIF, STYLES, UIManager } from './ui.js';
import { apply } from './fold/math.js';
import { autopilot } from './autopilot.js';

type State = 'menu' | 'intro' | 'fold' | 'life' | 'act' | 'done';

interface Grab {
  pointer: Pointer;
  mode: 'near' | 'far' | 'plane';
  startPinch: Vector3;
  startHandle: Vector3;
}

const easeInOut = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

export class FoldGame extends createSystem({}) {
  private env!: Environment;
  private hub!: InputHub;
  private ui!: UIManager;
  private save!: SaveData;

  private state: State = 'menu';
  private stateT = 0;
  private chapter: Chapter = CHAPTERS[0];
  private daily = false;
  private dailyKey = '';
  private paperStyle!: PaperStyle;
  private paperSeed = 1;

  // Paper.
  private sheet!: Sheet;
  private view: PaperView | null = null;
  private guides!: FoldGuides;
  private foldSpace = new Group();
  private stepIndex = 0;
  private prepared: PreparedStep | null = null;
  private theta = 0;
  private thetaGoal = 0;
  private settling: 'none' | 'forward' | 'back' = 'none';
  private grab: Grab | null = null;
  private idleT = 0;
  private foldStart = 0;

  // Stage.
  private stageHolder = new Group();
  private stage: Diorama | null = null;
  private creature: Group | null = null;
  private orient: Group | null = null;
  private opener: Opener | null = null;
  private lifeFrom = { pos: new Vector3(), quat: new Quaternion() };
  private lifeTo = { pos: new Vector3(), quat: new Quaternion(), orientPos: new Vector3(), orientQuat: new Quaternion(), scale: 1 };
  private lifeMeasured = false;
  private actT = 0;

  // UI.
  private titleCard!: Card;
  private instrCard!: Card;
  private menuRoot = new Group();
  private foldButtons = new Group();
  private doneButtons = new Group();
  private chapterButtons: Button[] = [];
  private dailyButton!: Button;
  private settingButtons: { assist: Button; gaze: Button; sound: Button; contrast: Button; recenter: Button } | null = null;
  private undoBtn!: Button;
  private nextBtn!: Button;

  // Effects.
  private sparks: { s: Sprite; v: Vector3; life: number }[] = [];
  private trophies = new Group();
  private plinthMat = new MeshStandardMaterial({ color: 0x3a2618, roughness: 0.55 });

  // Misc.
  private recenterPending = 0.4;
  private tmpV = new Vector3();
  private tmpV2 = new Vector3();
  private tmpM = new Matrix4();
  private rayT = { t: 0 };
  private hoverHandle = false;
  private flatCamSet = false;
  private simTime = 1000;
  private simClock = 0;
  private demoHold: number | null = null;
  /** The crease just pressed, which a fingertip can run along to sharpen. */
  private sharp: { a: Vector3; b: Vector3; until: number; done: number; last: Map<string, number>; sound: number } | null = null;
  private camOverride: { pos: number[]; look: number[]; fov: number } | null = null;

  init(): void {
    this.save = load();
    sound.setMuted(this.save.settings.muted);
    const r = this.world.renderer;
    r.shadowMap.enabled = true;
    r.shadowMap.type = PCFSoftShadowMap;

    this.env = new Environment(this.world.scene);
    this.world.createTransformEntity(this.env.root);
    this.hub = new InputHub(this.world);
    this.ui = new UIManager();

    this.foldSpace.name = 'FoldSpace';
    this.env.board.add(this.foldSpace);
    this.guides = new FoldGuides();
    this.guides.root.scale.setScalar(PAPER_HALF);
    this.guides.highContrast = this.save.settings.contrast;
    this.env.board.add(this.guides.root);
    this.env.stageAnchor.add(this.stageHolder);
    this.trophies.name = 'Trophies';
    this.env.station.add(this.trophies);

    this.buildCards();
    this.buildMenu();
    this.buildFoldButtons();
    this.buildDoneButtons();
    this.buildSparks();
    this.refreshProgress();
    this.buildTrophies();

    // Fonts arrive asynchronously; redraw text once they're ready.
    void Promise.all([
      document.fonts.load(`600 40px ${SERIF}`),
      document.fonts.load(`500 40px ${SANS}`),
      document.fonts.load(`italic 400 40px ${SERIF}`),
    ])
      .catch(() => undefined)
      .then(() => this.redrawText());

    // Audio needs a user gesture. A pinch inside XR counts, so players who
    // enter through the browser's own "Enter VR" button still get sound.
    const unlockAudio = (): void => {
      sound.unlock();
      sound.startAmbience();
    };
    this.world.renderer.domElement.addEventListener('pointerdown', unlockAudio);
    this.cleanupFuncs.push(() => this.world.renderer.domElement.removeEventListener('pointerdown', unlockAudio));
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((v) => {
        if (v === VisibilityState.Visible) {
          this.recenterPending = 0.35;
          const session = this.world.renderer.xr.getSession();
          // Passthrough sessions blend with the room: hide the virtual world.
          const blend = (session as (XRSession & { environmentBlendMode?: string }) | null)?.environmentBlendMode;
          this.env.setMixedReality(!!blend && blend !== 'opaque');
          session?.addEventListener('selectstart', unlockAudio);
          session?.addEventListener('squeezestart', unlockAudio);
        }
        if (v === VisibilityState.NonImmersive) {
          this.flatCamSet = false;
          this.env.setMixedReality(false);
        }
        if (this.state === 'menu') this.drawTitleFor('menu');
      }),
      () => this.hub.dispose(),
    );

    // Expose a tiny API for the landing page and for automated demos.
    (window as unknown as { fold: unknown }).fold = {
      enterVR: () => {
        sound.unlock();
        sound.startAmbience();
        this.world.launchXR({ sessionMode: 'immersive-vr' as SessionMode });
      },
      /** Mixed reality: fold on your real desk, the paper world in your room. */
      enterMR: () => {
        sound.unlock();
        sound.startAmbience();
        this.world.launchXR({ sessionMode: 'immersive-ar' as SessionMode });
      },
      playFlat: () => {
        sound.unlock();
        sound.startAmbience();
      },
      start: (i: number) => this.startChapter(CHAPTERS[i], false),
      daily: () => this.startDaily(),
      state: () => ({ state: this.state, step: this.stepIndex, chapter: this.chapter.index, theta: this.theta, daily: this.daily, mr: this.env.mixedReality, sharp: this.sharp ? Number(this.sharp.done.toFixed(2)) : -1 }),
      /** Test hook: fold the current step programmatically. */
      autoFold: () => this.autoFold(),
      /** Diagnostics: renderer cost and canvas size. */
      stats: () => {
        const r = this.world.renderer;
        let meshes = 0;
        this.world.scene.traverse((o) => {
          if ((o as { isMesh?: boolean }).isMesh) meshes++;
        });
        return {
          calls: r.info.render.calls,
          triangles: r.info.render.triangles,
          textures: r.info.memory.textures,
          geometries: r.info.memory.geometries,
          meshes,
          pixelRatio: r.getPixelRatio(),
          size: [r.domElement.width, r.domElement.height],
        };
      },
      /** Test hook: advance game logic without waiting for frames. */
      tick: (seconds: number, step = 1 / 30) => {
        for (let t = 0; t < seconds; t += step) {
          this.simTime += step;
          this.update(step, this.simTime);
        }
      },
      /** Debug: how each facet of the creature faces the camera. */
      debugCreature: () => {
        if (!this.creature || !this.view) return null;
        const cam = new Vector3();
        this.world.camera.getWorldPosition(cam);
        const out: string[] = [];
        this.view.root.updateWorldMatrix(true, true);
        this.view.root.children.forEach((g) => {
          const n = new Vector3(0, 0, 1).transformDirection(g.matrixWorld);
          const p = new Vector3().setFromMatrixPosition(g.matrixWorld);
          const toCam = cam.clone().sub(p).normalize();
          out.push(`${n.dot(toCam) > 0 ? 'FRONT' : 'back'} n=${n.toArray().map((x) => x.toFixed(2))}`);
        });
        return out;
      },
      /** Test hook: world position of the fold handle or its destination. */
      worldOf: (which: 'handle' | 'target') => {
        const p = this.prepared;
        if (!p) return null;
        const v = new Vector3();
        if (which === 'handle') v.copy(this.guides.handleWorld);
        else {
          this.guides.handlePoint(p, p.target, (this.sheet.maxStack() + 1) * 0.004 + 0.012, v);
          v.multiplyScalar(PAPER_HALF);
          this.env.board.localToWorld(v);
        }
        return { x: v.x, y: v.y, z: v.z };
      },
      /** Test hook: screen position of a visible button by its label text. */
      buttonAt: (label: string) => {
        for (const b of this.ui.buttons) {
          if (!b.opts.label.startsWith(label)) continue;
          let o: Object3D | null = b.card.mesh;
          let vis = true;
          while (o) {
            if (!o.visible) vis = false;
            o = o.parent;
          }
          if (!vis) continue;
          const v = new Vector3();
          b.card.mesh.getWorldPosition(v);
          v.project(this.world.camera);
          const r = this.world.renderer.domElement.getBoundingClientRect();
          return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
        }
        return null;
      },
      settings: () => ({ ...this.save.settings }),
      save: () => JSON.parse(JSON.stringify(this.save)),
      /** Dev: fold chapters hands-first through the emulator, for recording. */
      autopilot: (chapters: number[] = [0, 1, 2, 3, 4, 5]) => {
        const api = (window as unknown as { fold: Parameters<typeof autopilot>[0] }).fold;
        return autopilot(api, chapters, () => {
          sound.unlock();
          sound.startAmbience();
          if (!this.hub.presenting) this.world.launchXR({ sessionMode: 'immersive-vr' as SessionMode });
        });
      },
      /** Test hook: what the hand pointers currently report. */
      pointers: () =>
        this.hub.all.map((p) => ({
          id: p.id,
          kind: p.kind,
          pinching: p.pinching,
          strength: Number(p.strength.toFixed(2)),
          pinch: p.pinchPos.toArray().map((x) => Number(x.toFixed(3))),
          tip: p.tipPos.toArray().map((x) => Number(x.toFixed(3))),
        })),
      /** Test hook: stop the render loop (logic then advances only via tick). */
      freeze: () => this.world.renderer.setAnimationLoop(null),
      /** Test hook: world-space ends of the crease that can be sharpened. */
      sharpLine: () => (this.sharp ? { a: this.sharp.a.toArray(), b: this.sharp.b.toArray() } : null),
      /** Screenshot hook: hide the UI cards for clean marketing shots. */
      cleanShot: (on: boolean) => {
        this.instrCard.mesh.visible = !on;
        this.foldButtons.visible = !on && (this.state === 'fold' || this.state === 'intro');
        this.titleCard.mesh.visible = !on;
      },
      /** Screenshot hook: hold the current fold at a fraction of its angle (null releases). */
      holdAt: (frac: number | null) => {
        this.demoHold = frac;
      },
      /** Screenshot hook: pin the desktop camera (station space), or null to release. */
      camera: (pos: number[] | null, look?: number[], fov = 50) => {
        this.camOverride = pos && look ? { pos, look, fov } : null;
      },
      /** Test hook: render a frame synchronously (for screenshots). */
      render: () => this.world.renderer.render(this.world.scene, this.world.camera),
      /** Test hook: render quality for slow software GPUs. */
      lowfx: (on: boolean) => {
        this.world.renderer.shadowMap.enabled = !on;
        this.world.renderer.setPixelRatio(on ? 0.75 : window.devicePixelRatio);
        if (!this.world.renderer.xr.isPresenting) this.world.renderer.xr.setFramebufferScaleFactor(on ? 0.15 : 1);
      },
      /** Test hook: screen position of a world point (handle or target). */
      screenOf: (which: 'handle' | 'target') => this.screenOf(which),
      reset: () => {
        localStorage.removeItem('fold.save.v1');
        location.reload();
      },
    };

    this.showMenu();
  }

  // -------------------------------------------------------------------------
  // UI construction

  private buildCards(): void {
    const st = this.env.station;
    this.titleCard = new Card(0.46, 0.12, STYLES.glass);
    this.titleCard.mesh.position.set(0, LAYOUT.deskY + 0.43, -1.0);
    this.titleCard.mesh.rotation.x = -0.12;
    st.add(this.titleCard.mesh);

    this.instrCard = new Card(0.22, 0.13, STYLES.cream);
    this.instrCard.mesh.position.set(-0.32, LAYOUT.deskY + 0.13, -0.4);
    this.instrCard.mesh.rotation.set(-0.35, 0.55, 0.0, 'YXZ');
    st.add(this.instrCard.mesh);
  }

  private buildMenu(): void {
    const st = this.env.station;
    this.menuRoot.name = 'Menu';
    // Chapter cards laid on a tilted rack where the folding mat usually is.
    const rack = new Group();
    rack.position.copy(LAYOUT.boardPos).add(new Vector3(0, 0.05, -0.02));
    rack.rotation.x = -0.75;
    CHAPTERS.forEach((ch, i) => {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const b = new Button({
        label: ch.model.name,
        w: 0.1,
        h: 0.075,
        style: STYLES.cream,
        onPress: () => this.startChapter(ch, false),
      });
      b.root.position.set(-0.165 + col * 0.11, 0.045 - row * 0.085, 0);
      rack.add(b.root);
      this.ui.add(b);
      this.chapterButtons.push(b);
    });
    this.dailyButton = new Button({
      label: 'Daily Fold',
      w: 0.1,
      h: 0.075,
      style: STYLES.ember,
      onPress: () => this.startDaily(),
    });
    this.dailyButton.root.position.set(-0.165 + 2 * 0.11, 0.045 - 0.085, 0);
    rack.add(this.dailyButton.root);
    this.ui.add(this.dailyButton);
    this.menuRoot.add(rack);

    // Settings column on the right of the desk.
    const col = new Group();
    col.position.set(0.31, LAYOUT.deskY + 0.075, -0.36);
    col.rotation.set(-0.5, -0.5, 0, 'YXZ');
    const mk = (y: number, label: string, onPress: () => void): Button => {
      const b = new Button({ label, w: 0.095, h: 0.03, style: STYLES.ink, onPress });
      b.root.position.y = y;
      col.add(b.root);
      this.ui.add(b);
      return b;
    };
    this.settingButtons = {
      assist: mk(0.08, '', () => this.toggleSetting('assist')),
      gaze: mk(0.044, '', () => this.toggleSetting('gaze')),
      contrast: mk(0.008, '', () => this.toggleSetting('contrast')),
      sound: mk(-0.028, '', () => this.toggleSetting('muted')),
      recenter: mk(-0.064, 'Recenter', () => this.recenter()),
    };
    this.menuRoot.add(col);
    st.add(this.menuRoot);
    this.drawSettings();
  }

  private buildFoldButtons(): void {
    const col = new Group();
    col.position.set(0.3, LAYOUT.deskY + 0.075, -0.36);
    col.rotation.set(-0.5, -0.5, 0, 'YXZ');
    const mk = (y: number, label: string, onPress: () => void): Button => {
      const b = new Button({ label, w: 0.09, h: 0.03, style: STYLES.ink, onPress });
      b.root.position.y = y;
      col.add(b.root);
      this.ui.add(b);
      return b;
    };
    this.undoBtn = mk(0.04, 'Undo', () => this.undo());
    mk(0.004, 'Restart', () => this.restartChapter());
    mk(-0.032, 'Shelf', () => this.showMenu());
    this.foldButtons.add(col);
    this.env.station.add(this.foldButtons);
  }

  private buildDoneButtons(): void {
    const row = new Group();
    row.position.copy(LAYOUT.boardPos).add(new Vector3(0, 0.03, 0));
    row.rotation.x = -0.75;
    this.nextBtn = new Button({ label: 'Next chapter', w: 0.13, h: 0.045, style: STYLES.ember, onPress: () => this.nextChapter() });
    this.nextBtn.root.position.set(-0.075, 0, 0);
    const shelf = new Button({ label: 'Shelf', w: 0.1, h: 0.045, style: STYLES.cream, onPress: () => this.showMenu() });
    shelf.root.position.set(0.075, 0, 0);
    row.add(this.nextBtn.root, shelf.root);
    this.ui.add(this.nextBtn);
    this.ui.add(shelf);
    this.doneButtons.add(row);
    this.env.station.add(this.doneButtons);
  }

  private buildSparks(): void {
    const tex = glowTexture();
    for (let i = 0; i < 40; i++) {
      const s = new Sprite(
        new SpriteMaterial({ map: tex, color: 0xffd99a, transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending }),
      );
      s.scale.setScalar(0.01);
      s.visible = false;
      this.env.station.add(s);
      this.sparks.push({ s, v: new Vector3(), life: 0 });
    }
  }

  private burst(fromLocal: Vector3, toLocal: Vector3, count = 18, color = 0xffd99a): void {
    // fromLocal/toLocal are in station space.
    let n = 0;
    for (const sp of this.sparks) {
      if (sp.life > 0) continue;
      const t = Math.random();
      sp.s.position.lerpVectors(fromLocal, toLocal, t);
      sp.v.set((Math.random() - 0.5) * 0.06, 0.04 + Math.random() * 0.08, (Math.random() - 0.5) * 0.06);
      sp.life = 0.7 + Math.random() * 0.5;
      sp.s.visible = true;
      (sp.s.material as SpriteMaterial).color.setHex(color);
      if (++n >= count) break;
    }
  }

  // -------------------------------------------------------------------------
  // Text drawing

  private redrawText(): void {
    this.drawChapterCards();
    this.drawSettings();
    this.titleCard.mesh.visible && this.drawTitleFor(this.state);
    if (this.state === 'fold') this.drawInstruction();
    for (const b of this.ui.buttons) if (!this.chapterButtons.includes(b) && b !== this.dailyButton) b.draw();
  }

  private drawSettings(): void {
    if (!this.settingButtons) return;
    const s = this.save.settings;
    this.settingButtons.assist.setLabel(`Easy folds: ${s.assist ? 'On' : 'Off'}`);
    this.settingButtons.gaze.setLabel(`Gaze + pinch: ${s.gaze ? 'On' : 'Off'}`);
    this.settingButtons.contrast.setLabel(`Bold guides: ${s.contrast ? 'On' : 'Off'}`);
    this.settingButtons.sound.setLabel(`Sound: ${s.muted ? 'Off' : 'On'}`);
    this.settingButtons.recenter.setLabel('Recenter');
  }

  private unlocked(i: number): boolean {
    return i === 0 || this.save.done[i - 1];
  }

  private drawChapterCards(): void {
    CHAPTERS.forEach((ch, i) => {
      const b = this.chapterButtons[i];
      const c = b.card;
      const open = this.unlocked(i);
      b.enabled = open;
      const r = c.background(11 + i);
      const g = c.g;
      // Folded silhouette of the model in its paper colour.
      const sheet = new Sheet(ch.model.turn);
      ch.model.steps.forEach((s, k) => sheet.commit(sheet.prepare(s, k)));
      const [mn, mx] = sheet.bounds();
      const size = Math.max(mx[0] - mn[0], mx[1] - mn[1]);
      const box = r.h * 0.52;
      const k = box / size;
      const cx = r.x + r.w * 0.5;
      const cy = r.y + r.h * 0.4;
      const sorted = [...sheet.facets].sort((a, b2) => a.order - b2.order);
      for (const f of sorted) {
        g.beginPath();
        f.poly.forEach((p, j) => {
          const q = apply(f.m, [p[0], p[1], 0]);
          const x = cx + (q[0] - (mn[0] + mx[0]) / 2) * k;
          const y = cy - (q[1] - (mn[1] + mx[1]) / 2) * k;
          if (j) g.lineTo(x, y);
          else g.moveTo(x, y);
        });
        g.closePath();
        const up = f.m[10] > 0;
        const colour = up === ch.model.colorUp;
        g.fillStyle = !open ? 'rgba(90,80,70,0.25)' : colour ? ch.paper.base : '#efe6d4';
        g.fill();
        g.strokeStyle = open ? 'rgba(60,40,25,0.45)' : 'rgba(60,40,25,0.15)';
        g.lineWidth = 1.5;
        g.stroke();
      }
      c.text(ch.numeral, r.x + r.w * 0.09, r.y + r.h * 0.2, {
        size: r.h * 0.13,
        font: SERIF,
        weight: 600,
        color: open ? '#c4553a' : 'rgba(80,60,50,0.4)',
      });
      if (this.save.done[i]) {
        c.text('✓', r.x + r.w * 0.91, r.y + r.h * 0.2, { size: r.h * 0.13, align: 'right', weight: 700, color: '#3f6b55' });
      }
      c.text(open ? ch.model.name : 'Locked', cx, r.y + r.h * 0.83, {
        size: r.h * 0.12,
        font: SERIF,
        weight: 600,
        align: 'center',
        color: open ? '#2c2118' : 'rgba(80,60,50,0.45)',
      });
      const best = this.save.best[i];
      c.text(best ? `best ${fmtTime(best)} · ${ch.model.steps.length} folds` : `${ch.model.steps.length} folds`, cx, r.y + r.h * 0.95, {
        size: r.h * 0.075,
        align: 'center',
        color: 'rgba(60,45,35,0.7)',
      });
      c.commit();
    });
    // Daily card.
    const d = this.dailyButton;
    const unlocked = this.save.done[0];
    d.enabled = unlocked;
    const c = d.card;
    const r = c.background(99);
    const key = todayKey();
    const did = this.save.daily.last === key;
    // A swatch of today's paper, so the card shows what you'll fold.
    const today = dailyFor(key);
    if (unlocked) {
      const g = c.g;
      const sw = r.h * 0.16;
      g.save();
      g.translate(r.x + r.w * 0.86, r.y + r.h * 0.2);
      g.rotate(Math.PI / 4);
      g.fillStyle = today.paper.base;
      g.strokeStyle = 'rgba(255,240,220,0.8)';
      g.lineWidth = 3;
      g.fillRect(-sw / 2, -sw / 2, sw, sw);
      g.strokeRect(-sw / 2, -sw / 2, sw, sw);
      g.restore();
    }
    c.text('Daily Fold', r.x + r.w / 2, r.y + r.h * 0.34, { size: r.h * 0.16, font: SERIF, weight: 600, align: 'center' });
    c.text(unlocked ? (did ? 'Folded today ✓' : 'New paper today') : 'Finish chapter I', r.x + r.w / 2, r.y + r.h * 0.56, {
      size: r.h * 0.095,
      align: 'center',
      color: '#ffe2a6',
    });
    c.text(`Streak ${this.save.daily.streak} · ${this.save.daily.shelf.length} kept`, r.x + r.w / 2, r.y + r.h * 0.8, {
      size: r.h * 0.085,
      align: 'center',
      color: 'rgba(255,246,234,0.85)',
    });
    c.commit();
  }

  private drawTitleFor(state: State): void {
    const c = this.titleCard;
    const r = c.background();
    if (state === 'menu') {
      c.text('FOLD', r.x + r.w / 2, r.y + r.h * 0.52, {
        size: r.h * 0.46,
        font: SERIF,
        weight: 650,
        align: 'center',
        spacing: r.h * 0.08,
      });
      const done = this.save.done.filter(Boolean).length;
      c.text(
        done === 0
          ? this.hub.presenting
            ? 'a little paper world · poke or pinch chapter I to begin'
            : 'a little paper world · click chapter I to begin'
          : done === 6
            ? 'the paper world is whole · thank you'
            : `${done} of 6 chapters folded · the lanterns are returning`,
        r.x + r.w / 2,
        r.y + r.h * 0.82,
        { size: r.h * 0.14, font: SERIF, italic: true, align: 'center', color: '#ffd89a' },
      );
    } else if (this.stage) {
      const label = this.daily ? `Daily Fold · ${this.dailyKey}` : `Chapter ${this.chapter.numeral}`;
      c.text(label.toUpperCase(), r.x + r.w / 2, r.y + r.h * 0.3, {
        size: r.h * 0.13,
        align: 'center',
        weight: 600,
        color: '#ffc56b',
        spacing: 3,
      });
      c.text(this.stage.chapter, r.x + r.w / 2, r.y + r.h * 0.58, {
        size: r.h * 0.26,
        font: SERIF,
        weight: 600,
        align: 'center',
      });
      const line = state === 'done' ? this.stage.solvedLine : this.stage.story;
      c.text(line, r.x + r.w / 2, r.y + r.h * 0.84, {
        size: r.h * 0.13,
        font: SERIF,
        italic: true,
        align: 'center',
        color: '#f3e3c6',
        maxW: r.w * 0.92,
      });
    }
    c.commit();
  }

  private drawInstruction(extra?: string): void {
    const c = this.instrCard;
    const r = c.background(5);
    const steps = this.chapter.model.steps;
    const i = Math.min(this.stepIndex, steps.length - 1);
    const pad = r.w * 0.08;
    // Step dots.
    const dotR = r.h * 0.025;
    const total = steps.length;
    const startX = r.x + pad;
    for (let k = 0; k < total; k++) {
      c.g.beginPath();
      c.g.arc(startX + k * dotR * 3.2, r.y + r.h * 0.15, dotR, 0, Math.PI * 2);
      c.g.fillStyle = k < this.stepIndex ? '#c4553a' : k === this.stepIndex ? '#e9a15b' : 'rgba(60,40,30,0.18)';
      c.g.fill();
    }
    c.text(`Fold ${i + 1} of ${total}`, r.x + r.w - pad, r.y + r.h * 0.18, {
      size: r.h * 0.08,
      align: 'right',
      weight: 600,
      color: 'rgba(60,40,30,0.6)',
    });
    let y = c.text(steps[i].say, startX, r.y + r.h * 0.38, {
      size: r.h * 0.12,
      font: SERIF,
      weight: 560,
      maxW: r.w - pad * 2,
      lineH: r.h * 0.15,
    });
    const flat = !this.hub.presenting;
    const hint =
      extra ??
      (this.chapter.index === 0 && !this.daily && this.stepIndex === 0
        ? flat
          ? 'Drag the glowing dot along the path. Let go to crease.'
          : 'Pinch the glowing dot and pull it along the path. Let go to crease.'
        : steps[i].kind === 'flip'
          ? flat
            ? 'Drag the glowing edge up and over.'
            : 'Pinch the glowing edge and turn the paper over.'
          : this.stepIndex === 1 && this.chapter.index === 1 && !this.daily && !flat
            ? 'Tip: run a fingertip along a new crease to sharpen it.'
            : '');
    if (hint) {
      y += r.h * 0.02;
      c.text(hint, startX, y, { size: r.h * 0.085, maxW: r.w - pad * 2, color: '#8a5a3a', italic: true, font: SERIF });
    }
    c.commit();
  }

  // -------------------------------------------------------------------------
  // Settings

  private toggleSetting(k: keyof SaveData['settings']): void {
    this.save.settings[k] = !this.save.settings[k];
    if (k === 'muted') sound.setMuted(this.save.settings.muted);
    if (k === 'contrast') this.guides.highContrast = this.save.settings.contrast;
    store(this.save);
    this.drawSettings();
  }

  private recenter(): void {
    const cam = this.world.camera;
    cam.getWorldPosition(this.tmpV);
    cam.getWorldDirection(this.tmpV2);
    const yaw = Math.atan2(-this.tmpV2.x, -this.tmpV2.z);
    this.env.recenter(this.tmpV, yaw);
  }

  // -------------------------------------------------------------------------
  // Flow

  private setState(s: State): void {
    this.state = s;
    this.stateT = 0;
    this.menuRoot.visible = s === 'menu';
    this.foldButtons.visible = s === 'fold' || s === 'intro';
    this.doneButtons.visible = s === 'done';
    this.instrCard.mesh.visible = s === 'fold' || s === 'intro';
    this.guides.setVisible(s === 'fold' && !!this.prepared);
    this.drawTitleFor(s);
  }

  private showMenu(): void {
    this.grab = null;
    this.settling = 'none';
    if (this.state === 'fold' || this.state === 'intro') {
      // Leaving mid-chapter: keep the resume point, clear the paper.
      this.clearPaper();
    }
    this.drawChapterCards();
    this.setState('menu');
    if (!this.stage) this.loadStage(CHAPTERS[this.firstUnfinished()]);
  }

  private firstUnfinished(): number {
    const i = this.save.done.findIndex((d) => !d);
    return i < 0 ? 5 : i;
  }

  private loadStage(ch: Chapter): void {
    if (this.stage) this.stageHolder.remove(this.stage.root);
    sound.setRain(0);
    this.creature = null;
    this.stage = ch.stage();
    this.stage.reset();
    if (this.save.done[ch.index] && !this.daily) {
      // A finished chapter shows its solved state.
      this.stage.solved = true;
    }
    this.stageHolder.add(this.stage.root);
    sound.root = ch.root;
  }

  private startChapter(ch: Chapter, daily: boolean, paper?: PaperStyle, seed = 1): void {
    sound.unlock();
    sound.startAmbience();
    this.daily = daily;
    this.chapter = ch;
    this.paperStyle = paper ?? ch.paper;
    this.paperSeed = seed;
    this.loadStage(ch);
    this.stage!.solved = false;
    this.stage!.reset();
    // Resume mid-chapter if we left one.
    const res = this.save.resume;
    let resumeStep = res && res.chapter === ch.index && res.daily === daily ? res.step : 0;
    // A sheet saved fully folded (app closed mid-celebration) starts fresh.
    if (resumeStep >= ch.model.steps.length) resumeStep = 0;
    this.newPaper(resumeStep);
    this.foldStart = performance.now();
    this.setState('intro');
  }

  private startDaily(): void {
    const key = todayKey();
    const d = dailyFor(key);
    this.dailyKey = key;
    this.startChapter(d.chapter, true, d.paper, d.seed);
  }

  private nextChapter(): void {
    const next = this.daily ? this.firstUnfinished() : Math.min(5, this.chapter.index + 1);
    if (!this.daily && this.chapter.index === 5) {
      this.startDaily();
      return;
    }
    this.startChapter(CHAPTERS[next], false);
  }

  private restartChapter(): void {
    this.save.resume = null;
    store(this.save);
    this.newPaper(0);
    this.foldStart = performance.now();
    this.setState('fold');
    this.drawInstruction();
  }

  private clearPaper(): void {
    if (this.view) {
      this.view.root.parent?.remove(this.view.root);
      this.view.dispose();
      this.view = null;
    }
    this.prepared = null;
    this.guides.hide();
  }

  /** Fresh sheet folded up to `upTo` steps, ready for the next one. */
  private newPaper(upTo: number): void {
    this.clearPaper();
    const model = this.chapter.model;
    this.sheet = new Sheet(model.turn);
    for (let i = 0; i < upTo; i++) this.sheet.commit(this.sheet.prepare(model.steps[i], i));
    const front = paperFront(this.paperStyle, this.paperSeed);
    const back = paperBack(this.paperSeed + 1);
    this.view = model.colorUp ? new PaperView(front, back) : new PaperView(back, front);
    this.foldSpace.add(this.view.root);
    this.view.root.scale.setScalar(PAPER_HALF);
    this.foldSpace.scale.setScalar(1);
    this.stepIndex = upTo;
    this.theta = this.thetaGoal = 0;
    this.settling = 'none';
    this.grab = null;
    this.prepareStep();
  }

  private prepareStep(): void {
    const steps = this.chapter.model.steps;
    if (this.stepIndex >= steps.length) {
      this.prepared = null;
      this.view!.sync(this.sheet);
      return;
    }
    this.prepared = this.sheet.prepare(steps[this.stepIndex], this.stepIndex);
    this.view!.sync(this.sheet);
    this.guides.show(this.sheet, this.prepared);
    this.theta = 0;
    this.idleT = 0;
    this.drawInstruction();
  }

  private undo(): void {
    if (this.stepIndex === 0 || this.grab) return;
    this.newPaper(this.stepIndex - 1);
    this.save.resume = { chapter: this.chapter.index, step: this.stepIndex, daily: this.daily };
    store(this.save);
    sound.release();
  }

  private commitStep(): void {
    const p = this.prepared!;
    this.sheet.commit(p);
    sound.crease(this.stepIndex);
    this.haptic(0.55, 45);
    // Sparkles along the crease.
    const a = this.foldToStation(p.guide[0], this.tmpV);
    const b = this.foldToStation(p.guide[1], this.tmpV2);
    this.burst(a.clone(), b.clone(), 16);
    this.glowLevel = 0.6;
    if (p.step.kind === 'fold') {
      // World-space crease, sampled for the fingertip sharpening gesture.
      const wa = this.foldToStation(p.guide[0], new Vector3());
      const wb = this.foldToStation(p.guide[1], new Vector3());
      this.env.station.localToWorld(wa);
      this.env.station.localToWorld(wb);
      this.sharp = { a: wa, b: wb, until: this.simClock + 6, done: 0, last: new Map(), sound: 0 };
    }
    this.stepIndex++;
    this.save.resume = { chapter: this.chapter.index, step: this.stepIndex, daily: this.daily };
    store(this.save);
    this.prepared = null;
    this.guides.hide();
    if (this.stepIndex >= this.chapter.model.steps.length) {
      this.view!.sync(this.sheet);
      this.beginLife();
    } else {
      this.prepareStep();
    }
  }

  /**
   * Run a fingertip along the crease you just made to sharpen it, as you would
   * press a real fold. Purely a delight: nothing waits on it.
   */
  private updateSharpen(): void {
    const sh = this.sharp;
    if (!sh || this.simClock > sh.until || this.grab) return;
    const ab = this.tmpV.copy(sh.b).sub(sh.a);
    const len = ab.length();
    if (len < 1e-4) return;
    for (const ptr of [this.hub.left, this.hub.right]) {
      if (ptr.kind !== 'hand') continue;
      const ap = this.tmpV2.copy(ptr.tipPos).sub(sh.a);
      const t = ap.dot(ab) / (len * len);
      if (t < -0.05 || t > 1.05) {
        sh.last.delete(ptr.id);
        continue;
      }
      const closest = ab.clone().multiplyScalar(Math.max(0, Math.min(1, t))).add(sh.a);
      if (closest.distanceTo(ptr.tipPos) > 0.018) {
        sh.last.delete(ptr.id);
        continue;
      }
      const prev = sh.last.get(ptr.id);
      if (prev === undefined) {
        sh.last.set(ptr.id, t);
        continue;
      }
      // Measure from the last registered point, so slow, steady strokes count.
      const moved = Math.abs(t - prev);
      if (moved < 0.04) continue;
      sh.last.set(ptr.id, t);
      sh.done += moved;
      const local = this.env.station.worldToLocal(ptr.tipPos.clone());
      this.burst(local, local, 2, 0xfff1c8);
      if (this.simClock - sh.sound > 0.08) {
        const finished = sh.done > 0.75;
        sound.sharpen(finished);
        sh.sound = this.simClock;
        if (finished) {
          this.glowLevel = 0.5;
          const a = this.env.station.worldToLocal(sh.a.clone());
          const b = this.env.station.worldToLocal(sh.b.clone());
          this.burst(a, b, 14, 0xffe6a8);
          this.sharp = null;
          return;
        }
      }
    }
  }

  /** A short tick on any controller that has a rumble motor (hands have none). */
  private haptic(intensity: number, ms: number): void {
    const session = this.world.renderer.xr.getSession();
    if (!session) return;
    for (const src of session.inputSources) {
      const act = src.gamepad?.hapticActuators?.[0] as
        | { pulse?: (v: number, d: number) => Promise<boolean> }
        | undefined;
      act?.pulse?.(intensity, ms).catch(() => undefined);
    }
  }

  private foldToStation(p: number[], out: Vector3): Vector3 {
    out.set(p[0], p[1], 0.02);
    this.foldSpace.updateWorldMatrix(true, false);
    out.multiplyScalar(PAPER_HALF);
    this.env.board.localToWorld(out);
    return this.env.station.worldToLocal(out);
  }

  // -------------------------------------------------------------------------
  // Life: the finished model lifts off, opens up and flies onto the stage.

  private beginLife(): void {
    this.setState('life');
    this.stageHolder.updateWorldMatrix(true, true);
    this.env.board.updateWorldMatrix(true, true);
    this.creature = new Group();
    this.creature.name = 'Creature';
    this.orient = new Group();
    this.creature.add(this.orient);
    // Start exactly where the paper is: board pose in stage space.
    this.tmpM.copy(this.stage!.root.matrixWorld).invert().multiply(this.env.board.matrixWorld);
    const s = new Vector3();
    this.tmpM.decompose(this.lifeFrom.pos, this.lifeFrom.quat, s);
    this.creature.position.copy(this.lifeFrom.pos);
    this.creature.quaternion.copy(this.lifeFrom.quat);
    this.stage!.root.add(this.creature);
    this.view!.root.removeFromParent();
    this.orient.add(this.view!.root);
    this.opener = new Opener(this.sheet, this.chapter.model);
    this.lifeMeasured = false;
    sound.sparkle();
    // A ring of sparks lifts off the mat with the model.
    const c = this.env.station.worldToLocal(this.env.board.getWorldPosition(new Vector3()));
    this.burst(c.clone().add(new Vector3(-0.08, 0, 0)), c.clone().add(new Vector3(0.08, 0, 0)), 22, 0xffe2a8);
  }

  private updateLife(dt: number): void {
    const t = this.stateT;
    const view = this.view!;
    const creature = this.creature!;
    const orient = this.orient!;
    // Phase 1 (0-1.3 s): glow, lift, relax the creases open.
    // Warm shimmer while it wakes up; decayGlow() fades it out afterwards.
    if (t < 1.6) this.glowLevel = 0.22 + 0.08 * Math.sin(t * 9);
    if (t < 1.3) {
      this.opener!.update(Math.min(1, t / 1.2));
      view.sync(this.sheet);
      const lift = easeInOut(t / 0.6) * 0.05;
      creature.position.copy(this.lifeFrom.pos);
      creature.position.y += lift;
      return;
    }
    if (!this.lifeMeasured) {
      this.opener!.update(1);
      view.sync(this.sheet);
      this.measureLanding();
      this.lifeMeasured = true;
      this.lifeFrom.pos.copy(creature.position);
    }
    // Phase 2 (1.3-2.9 s): arc onto the stage.
    const k = easeInOut((t - 1.3) / 1.6);
    creature.position.lerpVectors(this.lifeFrom.pos, this.lifeTo.pos, k);
    creature.position.y += Math.sin(k * Math.PI) * 0.09;
    creature.quaternion.slerpQuaternions(this.lifeFrom.quat, this.lifeTo.quat, k);
    orient.quaternion.slerpQuaternions(new Quaternion(), this.lifeTo.orientQuat, k);
    orient.scale.setScalar(1 + (this.lifeTo.scale - 1) * k);
    orient.position.lerpVectors(new Vector3(), this.lifeTo.orientPos, k);
    if (t > 2.9) {
      this.actT = 0;
      this.setState('act');
    }
    void dt;
  }

  /** Work out the creature's resting orientation, scale and pivot offset. */
  private measureLanding(): void {
    const stage = this.stage!;
    const q = stage.standQuaternion(new Quaternion());
    const sc = stage.creatureScale;
    // Bounds of the opened model with the stand orientation and scale.
    const m = new Matrix4().compose(new Vector3(), q, new Vector3(sc, sc, sc));
    const mn = new Vector3();
    const mx = new Vector3();
    this.view!.bounds(m, mn, mx);
    // Pivot: centred in x/z, resting on its lowest point.
    this.lifeTo.orientPos.set(-(mn.x + mx.x) / 2, -mn.y, -(mn.z + mx.z) / 2);
    this.lifeTo.orientQuat.copy(q);
    this.lifeTo.scale = sc;
    // Ask the act for its starting pose.
    const probe = new Object3D();
    probe.position.copy(stage.landing);
    stage.act(probe, 0, 0);
    this.lifeTo.pos.copy(probe.position);
    this.lifeTo.quat.copy(probe.quaternion);
  }

  // -------------------------------------------------------------------------
  // Completion

  private finishChapter(): void {
    const secs = (performance.now() - this.foldStart) / 1000;
    const i = this.chapter.index;
    if (this.daily) {
      const key = this.dailyKey;
      const d = this.save.daily;
      if (d.last !== key) {
        d.streak = d.last && dayGap(d.last, key) === 1 ? d.streak + 1 : 1;
        d.last = key;
        d.shelf.unshift({ date: key, chapter: i, paper: this.paperStyle, seconds: secs });
        d.shelf = d.shelf.slice(0, 30);
      }
    } else {
      this.save.done[i] = true;
      const b = this.save.best[i];
      this.save.best[i] = b === null ? secs : Math.min(b, secs);
    }
    this.save.resume = null;
    store(this.save);
    this.refreshProgress();
    this.buildTrophies();
    this.drawChapterCards();
    sound.bloom();
    // Lanterns rise from the lake; the last chapter releases every one.
    this.env.celebrate(!this.daily && i === 5 ? -1 : 4);
    this.nextBtn.setLabel(
      this.daily ? 'Back to chapters' : i === 5 ? 'Daily Fold' : 'Next chapter',
      this.daily ? `streak ${this.save.daily.streak} day${this.save.daily.streak === 1 ? '' : 's'}` : `folded in ${fmtTime(secs)}`,
    );
    this.setState('done');
  }

  private refreshProgress(): void {
    const n = this.save.done.filter(Boolean).length;
    this.env.setProgress(n / 6);
  }

  /** The paper village: every finished model stands on the desk shelf. */
  private buildTrophies(): void {
    for (const c of [...this.trophies.children]) {
      this.trophies.remove(c);
    }
    const items: { ch: Chapter; paper: PaperStyle; seed: number }[] = [];
    CHAPTERS.forEach((ch, i) => {
      if (this.save.done[i]) items.push({ ch, paper: ch.paper, seed: 1 });
    });
    for (const d of this.save.daily.shelf.slice(0, 6)) {
      items.push({ ch: CHAPTERS[d.chapter], paper: d.paper, seed: 7 });
    }
    // A low shelf along the back-left and back-right of the desk.
    items.forEach((it, idx) => {
      const sheet = new Sheet(it.ch.model.turn);
      it.ch.model.steps.forEach((s, k) => sheet.commit(sheet.prepare(s, k)));
      new Opener(sheet, it.ch.model).update(1);
      const front = paperFront(it.paper, it.seed);
      const back = paperBack(it.seed + 1);
      const v = it.ch.model.colorUp ? new PaperView(front, back) : new PaperView(back, front);
      v.sync(sheet);
      const stage = it.ch.stage();
      const q = stage.standQuaternion(new Quaternion());
      const sc = 0.32;
      const m = new Matrix4().compose(new Vector3(), q, new Vector3(sc, sc, sc));
      const mn = new Vector3();
      const mx = new Vector3();
      v.bounds(m, mn, mx);
      const holder = new Group();
      // A little wooden plinth so each keepsake reads as placed, not dropped.
      const plinth = new Mesh(new CylinderGeometry(0.032, 0.034, 0.008, 24), this.plinthMat);
      plinth.position.y = 0.004;
      plinth.receiveShadow = true;
      holder.add(plinth);
      const o = new Group();
      o.quaternion.copy(q);
      o.scale.setScalar(sc);
      o.position.set(-(mn.x + mx.x) / 2, -mn.y + 0.008, -(mn.z + mx.z) / 2);
      o.add(v.root);
      holder.add(o);
      const side = idx % 2 === 0 ? -1 : 1;
      const slot = Math.floor(idx / 2);
      holder.position.set(side * (0.42 + slot * 0.07), LAYOUT.deskY, -0.86 + slot * 0.05);
      holder.rotation.y = -side * 0.5;
      this.trophies.add(holder);
    });
  }

  // -------------------------------------------------------------------------
  // Folding interaction

  private pointerFoldPos(g: Grab, out: Vector3): boolean {
    const p = g.pointer;
    if (p.kind === 'none') return false;
    if (g.mode === 'near') {
      out.copy(p.pinchPos);
      return true;
    }
    if (g.mode === 'far') {
      out.copy(p.pinchPos).sub(g.startPinch).multiplyScalar(1.6).add(g.startHandle);
      return true;
    }
    // Mouse: intersect the ray with the plane of rotation through the handle.
    const prep = this.prepared!;
    const axisW = this.tmpV2.set(prep.axis[0], prep.axis[1], prep.axis[2]);
    this.env.board.updateWorldMatrix(true, false);
    axisW.transformDirection(this.env.board.matrixWorld);
    const denom = p.rayDir.dot(axisW);
    if (Math.abs(denom) < 0.12) {
      // Looking along the hinge: fall back to a fixed depth.
      out.copy(p.rayDir).multiplyScalar(g.startHandle.distanceTo(p.rayOrigin)).add(p.rayOrigin);
      return true;
    }
    const t = this.tmpV.copy(g.startHandle).sub(p.rayOrigin).dot(axisW) / denom;
    out.copy(p.rayDir).multiplyScalar(t).add(p.rayOrigin);
    return true;
  }

  /** Fold angle implied by a world point, using the prepared hinge. */
  private angleFor(world: Vector3): number {
    const p = this.prepared!;
    const local = this.tmpV.copy(world);
    this.foldSpace.updateWorldMatrix(true, false);
    this.env.board.worldToLocal(local).divideScalar(PAPER_HALF);
    const wx = local.x - p.origin[0];
    const wy = local.y - p.origin[1];
    const wz = local.z;
    const along = wx * p.axis[0] + wy * p.axis[1];
    const rx = wx - p.axis[0] * along;
    const ry = wy - p.axis[1] * along;
    const radial = rx * p.radial[0] + ry * p.radial[1];
    let a = Math.atan2(wz, radial);
    const target = p.target;
    if (target > 0) {
      if (a < -Math.PI / 2) a += Math.PI * 2; // past PI wraps negative
      a = Math.min(target, Math.max(0, a));
    } else {
      if (a > Math.PI / 2) a -= Math.PI * 2;
      a = Math.max(target, Math.min(0, a));
    }
    return a;
  }

  private updateFold(dt: number, time: number, consumed: Set<string>): void {
    const p = this.prepared;
    if (!p || !this.view) return;
    const gaze = this.save.settings.gaze;
    const hw = this.guides.handleWorld;

    if (!this.grab && this.settling === 'none') {
      let hover = false;
      for (const ptr of this.hub.all) {
        if (ptr.kind === 'none' || consumed.has(ptr.id)) continue;
        let near = false;
        let far = false;
        if (ptr.kind === 'hand' || ptr.kind === 'controller') {
          const d = ptr.pinchPos.distanceTo(hw);
          near = d < 0.06;
        }
        if (!near && !this.ui.busy) {
          const useGaze = gaze && ptr.kind === 'hand';
          const o = useGaze ? this.hub.gazeOrigin : ptr.rayOrigin;
          const dir = useGaze ? this.hub.gazeDir : ptr.rayDir;
          if (useGaze || ptr.rayValid) {
            const d = rayPointDistance(o, dir, hw, this.rayT);
            const tol = (ptr.kind === 'mouse' ? 0.018 : 0.025) + this.rayT.t * 0.03;
            far = d < tol;
          }
        }
        if (near || far) {
          hover = true;
          if (ptr.pinchDown) {
            this.grab = {
              pointer: ptr,
              mode: near ? 'near' : ptr.kind === 'mouse' ? 'plane' : 'far',
              startPinch: ptr.pinchPos.clone(),
              startHandle: hw.clone(),
            };
            sound.pickup();
            this.idleT = 0;
            break;
          }
        }
      }
      if (hover !== this.hoverHandle && hover) sound.hover();
      this.hoverHandle = hover;
      this.guides.hovered = hover;
    }

    if (this.grab) {
      const g = this.grab;
      const released = g.pointer.pinchUp || !g.pointer.pinching || g.pointer.kind === 'none';
      if (!released && this.pointerFoldPos(g, this.tmpV2)) {
        this.thetaGoal = this.angleFor(this.tmpV2.clone());
      }
      const target = p.target;
      if (Math.abs(this.thetaGoal) >= Math.abs(target) * 0.985) {
        // Pulled all the way: press the crease.
        this.grab = null;
        this.settling = 'forward';
      } else if (released) {
        const frac = this.thetaGoal / target;
        const snap = this.save.settings.assist ? 0.28 : 0.55;
        this.grab = null;
        this.settling = frac >= snap ? 'forward' : 'back';
        if (this.settling === 'back') sound.release();
      }
    }

    // Idle hint: a little tug shows which way the flap wants to go.
    this.idleT += dt;
    let hint = 0;
    if (!this.grab && this.settling === 'none' && this.idleT > 5) {
      const ph = (this.idleT - 5) % 3.2;
      hint = ph < 1.2 ? Math.sin((ph / 1.2) * Math.PI) * 0.22 * p.target : 0;
    }

    const prev = this.theta;
    if (this.demoHold !== null) {
      this.theta = p.target * this.demoHold;
      this.guides.grabbed = true;
      this.view.pose(p, this.theta);
      this.guides.update(this.sheet, this.theta, time);
      return;
    }
    if (this.settling === 'forward') {
      this.theta += (p.target - this.theta) * Math.min(1, dt * 12) + Math.sign(p.target) * dt * 0.8;
      if (Math.abs(this.theta) >= Math.abs(p.target) - 0.004) {
        this.theta = p.target;
        this.settling = 'none';
        this.commitStep();
        return;
      }
    } else if (this.settling === 'back') {
      this.theta += (0 - this.theta) * Math.min(1, dt * 10);
      if (Math.abs(this.theta) < 0.003) {
        this.theta = 0;
        this.settling = 'none';
      }
    } else if (this.grab) {
      this.theta += (this.thetaGoal - this.theta) * Math.min(1, dt * 22);
    } else {
      this.theta += (hint - this.theta) * Math.min(1, dt * 6);
    }
    sound.rustle((this.theta - prev) / Math.max(dt, 1e-3));
    this.guides.grabbed = !!this.grab;
    this.view.pose(p, this.theta);
    this.guides.update(this.sheet, this.theta, time);
  }

  /** Pixel position of the fold handle (or its destination) on the canvas. */
  private screenOf(which: 'handle' | 'target'): { x: number; y: number } | null {
    const p = this.prepared;
    if (!p) return null;
    const v = new Vector3();
    if (which === 'handle') v.copy(this.guides.handleWorld);
    else {
      const top = (this.sheet.maxStack() + 1) * 0.004 + 0.012;
      this.guides.handlePoint(p, p.target, top, v);
      v.multiplyScalar(PAPER_HALF);
      this.env.board.localToWorld(v);
    }
    v.project(this.world.camera);
    const r = this.world.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  /** Test/demo hook: complete the current fold as if by hand. */
  private autoFold(): void {
    if (this.state === 'intro') this.setState('fold');
    if (this.state === 'fold' && this.prepared) this.settling = 'forward';
  }

  // -------------------------------------------------------------------------

  update(delta: number, time: number): void {
    const vis = this.world.visibilityState.peek();
    if (vis === VisibilityState.VisibleBlurred) {
      // Headset menu open: freeze the world, silence the rustle.
      sound.rustle(0);
      return;
    }
    const dt = Math.min(delta, 1 / 20);
    this.stateT += dt;
    this.simClock += dt;

    if (vis === VisibilityState.NonImmersive) {
      this.placeFlatCamera(time);
    } else if (this.recenterPending > 0) {
      this.recenterPending -= dt;
      if (this.recenterPending <= 0) this.recenter();
    }

    this.hub.update();
    const consumed = this.ui.update(this.hub, dt, this.save.settings.gaze);
    this.env.update(time, dt);
    sound.tick();
    this.stage?.update(time, dt);

    switch (this.state) {
      case 'intro': {
        // Paper slides onto the mat.
        const k = easeInOut(this.stateT / 0.8);
        this.foldSpace.position.set(0, (1 - k) * 0.3, (1 - k) * 0.08);
        this.foldSpace.rotation.z = (1 - k) * 0.4;
        this.view?.pose(null, 0);
        if (this.stateT > 0.8) {
          this.foldSpace.position.set(0, 0, 0);
          this.foldSpace.rotation.z = 0;
          this.setState('fold');
          if (this.prepared) this.guides.show(this.sheet, this.prepared);
          this.drawInstruction();
        }
        break;
      }
      case 'fold':
        this.updateFold(dt, time, consumed);
        this.updateSharpen();
        if (this.undoBtn.enabled !== this.stepIndex > 0) {
          this.undoBtn.enabled = this.stepIndex > 0;
          this.undoBtn.draw();
        }
        break;
      case 'life':
        this.updateLife(dt);
        break;
      case 'act': {
        this.actT += dt;
        if (this.stage && this.creature && this.stage.act(this.creature, this.actT, dt)) this.finishChapter();
        break;
      }
      case 'done':
      case 'menu':
        break;
    }

    this.decayGlow(dt);

    // Sparks.
    for (const sp of this.sparks) {
      if (sp.life <= 0) continue;
      sp.life -= dt;
      sp.v.y -= dt * 0.05;
      sp.s.position.addScaledVector(sp.v, dt);
      const a = Math.max(0, sp.life);
      (sp.s.material as SpriteMaterial).opacity = Math.min(1, a * 1.5);
      sp.s.scale.setScalar(0.004 + a * 0.008);
      if (sp.life <= 0) sp.s.visible = false;
    }
  }

  private glowLevel = 0;
  private decayGlow(dt: number): void {
    if (!this.view) return;
    this.glowLevel = Math.max(0, this.glowLevel - dt * 0.9);
    this.view.setGlow(this.glowLevel);
  }

  /** Desktop view: a seated vantage point looking over the desk. */
  private placeFlatCamera(time: number): void {
    const cam = this.world.camera;
    const eye = new Vector3(0, 1.22, 0);
    if (!this.flatCamSet) {
      this.env.recenter(eye, 0);
      this.flatCamSet = true;
    }
    if (this.camOverride) {
      const o = this.camOverride;
      cam.position.set(o.pos[0], eye.y + o.pos[1], o.pos[2]);
      cam.lookAt(o.look[0], eye.y + o.look[1], o.look[2]);
      cam.fov = o.fov;
      cam.updateProjectionMatrix();
      return;
    }
    // A gentle drift so the diorama reads as 3D.
    const sway = Math.sin(time * 0.25) * 0.015;
    cam.position.set(sway, eye.y + 0.02, 0.06);
    cam.lookAt(0, eye.y - 0.4, -0.62);
    cam.fov = 58;
    cam.updateProjectionMatrix();
  }
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return m ? `${m}m ${String(r).padStart(2, '0')}s` : `${r}s`;
}

export type { Facet };
