/**
 * Paper-tag UI. Cards and buttons are canvas-textured planes styled as cut
 * paper. Buttons accept a finger poke, a pinch along the hand ray, gaze +
 * pinch, a controller trigger, or a mouse click.
 */
import {
  CanvasTexture,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
} from '@iwsdk/core';
import { sound } from './audio.js';
import type { InputHub, Pointer } from './input.js';

export const SERIF = '"Fraunces Variable", Georgia, serif';
export const SANS = '"Inter Variable", system-ui, sans-serif';

const PX_PER_M = 2600;

export interface CardStyle {
  bg: string;
  ink: string;
  accent?: string;
  radius?: number;
  /** Deckled paper edge instead of crisp rounded rectangle. */
  deckle?: boolean;
  shadow?: boolean;
}

export const STYLES = {
  cream: { bg: '#f7efdf', ink: '#2c2118', accent: '#c4553a', deckle: true, shadow: true },
  ink: { bg: '#25303f', ink: '#f6ecd8', accent: '#ffc56b', radius: 0.4, shadow: true },
  glass: { bg: 'rgba(20,24,36,0.62)', ink: '#f6ecd8', accent: '#ffc56b', radius: 0.5 },
  ember: { bg: '#d9603f', ink: '#fff6ea', accent: '#ffe2a6', radius: 0.5, shadow: true },
  moss: { bg: '#3f6b55', ink: '#f6f1e3', accent: '#ffe2a6', radius: 0.5, shadow: true },
} satisfies Record<string, CardStyle>;

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function deckle(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: number): void {
  let s = seed;
  const r = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  const j = Math.min(w, h) * 0.012;
  g.beginPath();
  const steps = 60;
  for (let i = 0; i <= steps; i++) g.lineTo(x + (w * i) / steps, y + r() * j);
  for (let i = 0; i <= steps; i++) g.lineTo(x + w - r() * j, y + (h * i) / steps);
  for (let i = steps; i >= 0; i--) g.lineTo(x + (w * i) / steps, y + h - r() * j);
  for (let i = steps; i >= 0; i--) g.lineTo(x + r() * j, y + (h * i) / steps);
  g.closePath();
}

/** A canvas-backed plane, sized in metres, that you draw into. */
export class Card {
  readonly mesh: Mesh;
  readonly canvas: HTMLCanvasElement;
  readonly g: CanvasRenderingContext2D;
  readonly tex: CanvasTexture;
  readonly pw: number;
  readonly ph: number;
  readonly pad: number;

  constructor(
    readonly w: number,
    readonly h: number,
    public style: CardStyle = STYLES.cream,
  ) {
    this.canvas = document.createElement('canvas');
    const scale = Math.min(1, 1600 / (Math.max(w, h) * PX_PER_M));
    this.pw = Math.round(w * PX_PER_M * scale);
    this.ph = Math.round(h * PX_PER_M * scale);
    this.pad = this.ph * 0.02 + 6;
    this.canvas.width = this.pw;
    this.canvas.height = this.ph;
    this.g = this.canvas.getContext('2d')!;
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    this.tex.anisotropy = 8;
    const mat = new MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: true, alphaTest: 0.02 });
    this.mesh = new Mesh(new PlaneGeometry(w, h), mat);
  }

  /** Clear and paint the paper background; returns the content rect. */
  background(seed = 3): { x: number; y: number; w: number; h: number } {
    const { g, pw, ph, style } = this;
    g.clearRect(0, 0, pw, ph);
    const inset = this.pad;
    const x = inset;
    const y = inset;
    const w = pw - inset * 2;
    const h = ph - inset * 2;
    g.save();
    if (style.shadow) {
      g.shadowColor = 'rgba(0,0,0,0.35)';
      g.shadowBlur = inset * 0.8;
      g.shadowOffsetY = inset * 0.25;
    }
    g.fillStyle = style.bg;
    if (style.deckle) deckle(g, x, y, w, h, seed);
    else roundRect(g, x, y, w, h, Math.min(w, h) * 0.5 * (style.radius ?? 0.2));
    g.fill();
    g.restore();
    if (style.deckle) {
      // Fibres for the paper feel.
      g.save();
      g.globalAlpha = 0.07;
      g.strokeStyle = '#5a4030';
      let s = seed * 7;
      const r = () => {
        s = (s * 9301 + 49297) % 233280;
        return s / 233280;
      };
      for (let i = 0; i < 90; i++) {
        const fx = x + r() * w;
        const fy = y + r() * h;
        g.lineWidth = 1 + r();
        g.beginPath();
        g.moveTo(fx, fy);
        g.lineTo(fx + (r() - 0.5) * 40, fy + (r() - 0.5) * 40);
        g.stroke();
      }
      g.restore();
    }
    return { x, y, w, h };
  }

  /** Text helper with wrapping; returns the y after the last line. */
  text(
    str: string,
    x: number,
    y: number,
    opts: {
      size: number;
      font?: string;
      weight?: number;
      color?: string;
      align?: CanvasTextAlign;
      maxW?: number;
      lineH?: number;
      italic?: boolean;
      spacing?: number;
    },
  ): number {
    const g = this.g;
    const size = opts.size;
    g.font = `${opts.italic ? 'italic ' : ''}${opts.weight ?? 400} ${size}px ${opts.font ?? SANS}`;
    g.fillStyle = opts.color ?? this.style.ink;
    g.textAlign = opts.align ?? 'left';
    g.textBaseline = 'alphabetic';
    if (opts.spacing !== undefined) (g as unknown as { letterSpacing: string }).letterSpacing = `${opts.spacing}px`;
    const maxW = opts.maxW ?? this.pw;
    const lineH = opts.lineH ?? size * 1.25;
    const words = str.split(' ');
    let line = '';
    let yy = y;
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (g.measureText(test).width > maxW && line) {
        g.fillText(line, x, yy);
        line = word;
        yy += lineH;
      } else line = test;
    }
    if (line) g.fillText(line, x, yy);
    if (opts.spacing !== undefined) (g as unknown as { letterSpacing: string }).letterSpacing = '0px';
    return yy + lineH;
  }

  commit(): void {
    this.tex.needsUpdate = true;
  }

  dispose(): void {
    this.tex.dispose();
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
  }
}

export interface ButtonOpts {
  label: string;
  sub?: string;
  w?: number;
  h?: number;
  style?: CardStyle;
  icon?: string;
  onPress: () => void;
}

/** A pokeable, pinchable paper button. */
export class Button {
  readonly root = new Group();
  readonly card: Card;
  hovered = false;
  enabled = true;
  private press = 0;
  private hoverAnim = 0;
  private lastPress = 0;
  private prevZ = new Map<string, number>();
  constructor(public opts: ButtonOpts) {
    this.card = new Card(opts.w ?? 0.12, opts.h ?? 0.045, opts.style ?? STYLES.ink);
    this.root.add(this.card.mesh);
    this.draw();
  }

  setLabel(label: string, sub?: string): void {
    this.opts.label = label;
    this.opts.sub = sub;
    this.draw();
  }

  draw(): void {
    const c = this.card;
    const r = c.background(7);
    const hasSub = !!this.opts.sub;
    const size = r.h * (hasSub ? 0.36 : 0.44);
    const cx = r.x + r.w / 2;
    let label = this.opts.label;
    if (this.opts.icon) label = `${this.opts.icon}  ${label}`;
    c.text(label, cx, r.y + r.h * (hasSub ? 0.5 : 0.64), {
      size,
      weight: 600,
      align: 'center',
      font: SANS,
      color: this.enabled ? c.style.ink : 'rgba(150,150,150,0.8)',
    });
    if (hasSub) {
      c.text(this.opts.sub!, cx, r.y + r.h * 0.82, {
        size: size * 0.62,
        weight: 450,
        align: 'center',
        color: c.style.accent ?? c.style.ink,
      });
    }
    c.commit();
  }

  /** Press feedback animation. */
  animate(dt: number): void {
    this.hoverAnim += ((this.hovered ? 1 : 0) - this.hoverAnim) * Math.min(1, dt * 14);
    this.press = Math.max(0, this.press - dt * 4);
    const s = 1 + this.hoverAnim * 0.05 - this.press * 0.08;
    this.card.mesh.scale.setScalar(s);
    this.card.mesh.position.z = this.hoverAnim * 0.006 - this.press * 0.006;
  }

  fire(): void {
    const now = performance.now();
    if (now - this.lastPress < 350 || !this.enabled) return;
    this.lastPress = now;
    this.press = 1;
    sound.click();
    this.opts.onPress();
  }

  /** Poke detection: fingertip crossing the card plane from the front. */
  poke(p: Pointer, local: Vector3): boolean {
    const hw = this.card.w / 2;
    const hh = this.card.h / 2;
    const inside = Math.abs(local.x) < hw * 1.05 && Math.abs(local.y) < hh * 1.15;
    const prev = this.prevZ.get(p.id) ?? 1;
    this.prevZ.set(p.id, local.z);
    return inside && prev > 0.004 && local.z <= 0.004 && local.z > -0.03;
  }
}

/**
 * Routes pointers to buttons. One button can be hovered per pointer; a pinch
 * (or click) while hovered fires it, and so does a fingertip poke.
 */
export class UIManager {
  readonly buttons = new Set<Button>();
  private inv = new Matrix4();
  private lo = new Vector3();
  private ld = new Vector3();
  private tip = new Vector3();
  private hoverOf = new Map<string, Button | null>();
  /** True if any pointer is currently over a button (blocks paper grabs). */
  busy = false;

  add(b: Button): Button {
    this.buttons.add(b);
    return b;
  }

  remove(b: Button): void {
    this.buttons.delete(b);
  }

  /** Returns true if a pointer consumed its pinch on UI this frame. */
  update(input: InputHub, dt: number, gazeMode: boolean): Set<string> {
    const consumed = new Set<string>();
    for (const b of this.buttons) b.hovered = false;
    this.busy = false;
    for (const p of input.all) {
      if (p.kind === 'none') continue;
      let best: Button | null = null;
      let bestT = Infinity;
      for (const b of this.buttons) {
        if (!b.enabled || !isVisible(b.root)) continue;
        const m = b.card.mesh;
        m.updateWorldMatrix(true, false);
        this.inv.copy(m.matrixWorld).invert();
        // Poke with fingertip.
        if (p.kind === 'hand' || p.kind === 'controller') {
          this.tip.copy(p.tipPos).applyMatrix4(this.inv);
          if (b.poke(p, this.tip)) {
            b.fire();
            consumed.add(p.id);
          }
          if (Math.abs(this.tip.z) < 0.04 && Math.abs(this.tip.x) < b.card.w / 2 && Math.abs(this.tip.y) < b.card.h / 2) {
            best = b;
            bestT = 0;
          }
        }
        // Ray (hand ray, gaze, controller or mouse).
        const useGaze = gazeMode && p.kind === 'hand';
        if (!useGaze && !p.rayValid) continue;
        this.lo.copy(useGaze ? input.gazeOrigin : p.rayOrigin).applyMatrix4(this.inv);
        this.ld
          .copy(useGaze ? input.gazeDir : p.rayDir)
          .transformDirection(this.inv);
        if (Math.abs(this.ld.z) < 1e-4) continue;
        const t = -this.lo.z / this.ld.z;
        if (t <= 0) continue;
        const hx = this.lo.x + this.ld.x * t;
        const hy = this.lo.y + this.ld.y * t;
        if (Math.abs(hx) <= b.card.w / 2 && Math.abs(hy) <= b.card.h / 2 && t < bestT) {
          best = b;
          bestT = t;
        }
      }
      if (best) {
        best.hovered = true;
        this.busy = true;
        if (this.hoverOf.get(p.id) !== best) sound.hover();
        if (p.pinchDown) {
          best.fire();
          consumed.add(p.id);
        }
      }
      this.hoverOf.set(p.id, best);
    }
    for (const b of this.buttons) b.animate(dt);
    return consumed;
  }
}

function isVisible(o: { visible: boolean; parent: unknown }): boolean {
  let cur: { visible: boolean; parent: unknown } | null = o;
  while (cur) {
    if (!cur.visible) return false;
    cur = cur.parent as { visible: boolean; parent: unknown } | null;
  }
  return true;
}
