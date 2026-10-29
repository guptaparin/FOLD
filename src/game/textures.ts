/**
 * Procedural textures. Everything in FOLD is generated at start-up, so the app
 * cold-starts from a ~1 MB bundle with no image downloads.
 */
import { CanvasTexture, RepeatWrapping, SRGBColorSpace, Texture } from '@iwsdk/core';

export type PatternKind =
  | 'plain'
  | 'seigaiha'
  | 'asanoha'
  | 'dots'
  | 'stripes'
  | 'stars'
  | 'kikko'
  | 'sakura';

export interface PaperStyle {
  base: string;
  ink: string;
  pattern: PatternKind;
  /** Pattern scale (cells across the sheet). */
  cells: number;
  /** 0..1 strength of the printed pattern. */
  inkAlpha: number;
}

/** Deterministic PRNG so the same seed always yields the same sheet. */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  return [c, g];
}

function finish(c: HTMLCanvasElement, repeat = false): Texture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

/** Washi fibres and grain on top of whatever is already drawn. */
function fibres(g: CanvasRenderingContext2D, size: number, seed: number, dark = 0.06, light = 1, count = 520): void {
  const r = rng(seed);
  // Mottled grain.
  const img = g.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * 14;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  // Long kozo fibres.
  g.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const x = r() * size;
    const y = r() * size;
    const len = 10 + r() * 70;
    const a = r() * Math.PI * 2;
    const isLight = r() > 0.45;
    g.strokeStyle = isLight ? `rgba(255,255,255,${(0.1 + r() * 0.18) * light})` : `rgba(60,40,20,${dark * r()})`;
    g.lineWidth = 0.6 + r() * 1.3;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(
      x + Math.cos(a) * len * 0.5 + (r() - 0.5) * 16,
      y + Math.sin(a) * len * 0.5 + (r() - 0.5) * 16,
      x + Math.cos(a) * len,
      y + Math.sin(a) * len,
    );
    g.stroke();
  }
}

function drawPattern(g: CanvasRenderingContext2D, size: number, s: PaperStyle, seed: number): void {
  const cell = size / s.cells;
  g.save();
  g.globalAlpha = s.inkAlpha;
  g.strokeStyle = s.ink;
  g.fillStyle = s.ink;
  const r = rng(seed + 7);
  switch (s.pattern) {
    case 'seigaiha': {
      g.lineWidth = cell * 0.05;
      for (let row = -1; row < s.cells * 2 + 2; row++) {
        for (let col = -1; col < s.cells + 2; col++) {
          const cx = col * cell + (row % 2 ? cell / 2 : 0);
          const cy = row * cell * 0.5;
          for (let k = 4; k >= 1; k--) {
            g.beginPath();
            g.arc(cx, cy, (cell * 0.5 * k) / 4, Math.PI, 0);
            g.stroke();
          }
        }
      }
      break;
    }
    case 'asanoha': {
      g.lineWidth = cell * 0.025;
      const h = cell * Math.sqrt(3) * 0.5;
      for (let row = -1; row < size / h + 2; row++) {
        for (let col = -1; col < s.cells + 2; col++) {
          const cx = col * cell + (row % 2 ? cell / 2 : 0);
          const cy = row * h;
          for (let k = 0; k < 6; k++) {
            const a = (k * Math.PI) / 3 + Math.PI / 6;
            g.beginPath();
            g.moveTo(cx, cy);
            g.lineTo(cx + Math.cos(a) * cell * 0.577, cy + Math.sin(a) * cell * 0.577);
            g.stroke();
            const b = (k * Math.PI) / 3;
            g.beginPath();
            g.moveTo(cx, cy);
            g.lineTo(cx + Math.cos(b) * cell * 0.5, cy + Math.sin(b) * cell * 0.5);
            g.stroke();
          }
        }
      }
      break;
    }
    case 'dots': {
      for (let row = 0; row < s.cells * 2; row++) {
        for (let col = 0; col < s.cells; col++) {
          const cx = col * cell + (row % 2 ? cell / 2 : 0) + cell / 4;
          const cy = row * cell * 0.5 + cell / 4;
          g.beginPath();
          g.arc(cx, cy, cell * 0.12, 0, Math.PI * 2);
          g.fill();
        }
      }
      break;
    }
    case 'stripes': {
      for (let i = -s.cells; i < s.cells * 2; i++) {
        g.save();
        g.translate(i * cell, 0);
        g.rotate(Math.PI / 4);
        g.fillRect(0, -size, cell * 0.22, size * 3);
        g.restore();
      }
      break;
    }
    case 'stars': {
      for (let i = 0; i < s.cells * s.cells * 1.4; i++) {
        const cx = r() * size;
        const cy = r() * size;
        const rad = cell * (0.08 + r() * 0.14);
        g.beginPath();
        for (let k = 0; k < 10; k++) {
          const a = (k * Math.PI) / 5 - Math.PI / 2;
          const rr = k % 2 ? rad * 0.45 : rad;
          g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
        }
        g.closePath();
        g.fill();
      }
      break;
    }
    case 'kikko': {
      g.lineWidth = cell * 0.04;
      const w = cell;
      const h = cell * 0.866;
      for (let row = -1; row < size / h + 1; row++) {
        for (let col = -1; col < s.cells + 1; col++) {
          const cx = col * w * 1.5;
          const cy = row * h * 2 + (col % 2 ? h : 0);
          g.beginPath();
          for (let k = 0; k <= 6; k++) {
            const a = (k * Math.PI) / 3;
            g.lineTo(cx + Math.cos(a) * w * 0.8, cy + Math.sin(a) * w * 0.8);
          }
          g.stroke();
        }
      }
      break;
    }
    case 'sakura': {
      for (let i = 0; i < s.cells * s.cells * 0.9; i++) {
        const cx = r() * size;
        const cy = r() * size;
        const rad = cell * (0.18 + r() * 0.16);
        const rot = r() * Math.PI;
        for (let k = 0; k < 5; k++) {
          const a = rot + (k * Math.PI * 2) / 5;
          g.beginPath();
          g.ellipse(
            cx + Math.cos(a) * rad * 0.55,
            cy + Math.sin(a) * rad * 0.55,
            rad * 0.5,
            rad * 0.32,
            a,
            0,
            Math.PI * 2,
          );
          g.fill();
        }
      }
      break;
    }
    case 'plain':
      break;
  }
  g.restore();
}

const cache = new Map<string, Texture>();

/** Coloured, printed front of an origami sheet. */
export function paperFront(style: PaperStyle, seed = 1): Texture {
  const key = `front:${JSON.stringify(style)}:${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const size = 1024;
  const [c, g] = canvas(size);
  g.fillStyle = style.base;
  g.fillRect(0, 0, size, size);
  // Soft dye variation.
  const r = rng(seed * 31 + 3);
  for (let i = 0; i < 14; i++) {
    const grd = g.createRadialGradient(r() * size, r() * size, 0, r() * size, r() * size, size * (0.2 + r() * 0.4));
    grd.addColorStop(0, `rgba(255,255,255,${0.05 * r()})`);
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, size, size);
  }
  drawPattern(g, size, style, seed);
  fibres(g, size, seed, 0.05);
  const t = finish(c);
  cache.set(key, t);
  return t;
}

/** Cream white back of the sheet. */
export function paperBack(seed = 2): Texture {
  const key = `back:${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const size = 512;
  const [c, g] = canvas(size);
  g.fillStyle = '#f6efe1';
  g.fillRect(0, 0, size, size);
  fibres(g, size, seed, 0.07);
  const t = finish(c);
  cache.set(key, t);
  return t;
}

/** Generic tinted craft paper for scenery cut-outs (tileable-ish). */
export function craftPaper(color: string, seed = 5, size = 256): Texture {
  const key = `craft:${color}:${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, g] = canvas(size);
  g.fillStyle = color;
  g.fillRect(0, 0, size, size);
  // Dark papers get faint fibres; bright ones read fine with more.
  const lum = parseInt(color.slice(1, 3), 16) + parseInt(color.slice(3, 5), 16) + parseInt(color.slice(5, 7), 16);
  fibres(g, size, seed, 0.08, lum < 300 ? 0.08 : lum < 420 ? 0.22 : 0.5, 60);
  const t = finish(c, true);
  cache.set(key, t);
  return t;
}

/** Warm wood for the desk. */
export function woodTexture(): Texture {
  const hit = cache.get('wood');
  if (hit) return hit;
  const w = 1024;
  const h = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const r = rng(91);
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, '#6b4429');
  grd.addColorStop(1, '#5a3822');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 140; i++) {
    const y = r() * h;
    g.strokeStyle = `rgba(${r() > 0.5 ? '40,22,10' : '150,100,60'},${0.08 + r() * 0.12})`;
    g.lineWidth = 0.6 + r() * 2.5;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= w; x += 32) {
      g.lineTo(x, y + Math.sin(x * 0.006 + i) * 6 + Math.sin(x * 0.03 + i * 3) * 1.5);
    }
    g.stroke();
  }
  // Knots.
  for (let k = 0; k < 3; k++) {
    const cx = r() * w;
    const cy = r() * h;
    for (let j = 0; j < 9; j++) {
      g.strokeStyle = `rgba(40,20,8,${0.12 - j * 0.01})`;
      g.lineWidth = 1.5;
      g.beginPath();
      g.ellipse(cx, cy, 6 + j * 6, 3 + j * 2.4, 0, 0, Math.PI * 2);
      g.stroke();
    }
  }
  const t = finish(c, true);
  cache.set('wood', t);
  return t;
}

/** Deep green cutting mat with a subtle grid. */
export function matTexture(): Texture {
  const hit = cache.get('mat');
  if (hit) return hit;
  const size = 1024;
  const [c, g] = canvas(size);
  g.fillStyle = '#23463c';
  g.fillRect(0, 0, size, size);
  const r = rng(12);
  const img = g.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * 10;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  const step = size / 16;
  for (let i = 0; i <= 16; i++) {
    g.strokeStyle = i % 4 === 0 ? 'rgba(220,240,220,0.32)' : 'rgba(220,240,220,0.13)';
    g.lineWidth = i % 4 === 0 ? 2.2 : 1.2;
    g.beginPath();
    g.moveTo(i * step, 0);
    g.lineTo(i * step, size);
    g.moveTo(0, i * step);
    g.lineTo(size, i * step);
    g.stroke();
  }
  // Diagonal guides, as on a real origami mat.
  g.strokeStyle = 'rgba(220,240,220,0.12)';
  g.setLineDash([10, 8]);
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(size, size);
  g.moveTo(size, 0);
  g.lineTo(0, size);
  g.stroke();
  const t = finish(c);
  cache.set('mat', t);
  return t;
}

/** Soft radial glow sprite. */
export function glowTexture(): Texture {
  const hit = cache.get('glow');
  if (hit) return hit;
  const size = 128;
  const [c, g] = canvas(size);
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = finish(c);
  cache.set('glow', t);
  return t;
}
