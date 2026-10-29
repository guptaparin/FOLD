/**
 * Design tool: folds every model headlessly and writes an SVG contact sheet of
 * each step (top-down view of fold space, layers drawn in order).
 *
 *   npx tsx tools/preview.ts [modelId] > out.svg
 */
import { Sheet } from '../src/game/fold/engine.js';
import { apply } from '../src/game/fold/math.js';
import { MODELS } from '../src/game/fold/models.js';

const only = process.argv[2];
const models = MODELS.filter((m) => !only || m.id === only);
const cell = 220;
const scale = 60;
let rows = '';
let y = 0;
let width = 0;

for (const model of models) {
  const s = new Sheet(model.turn);
  const frames: string[] = [];
  const draw = (label: string, guide?: [number[], number[]], handle?: number[]): void => {
    const sorted = [...s.facets].sort((a, b) => a.order - b.order);
    let g = '';
    for (const f of sorted) {
      const pts = f.poly.map((p) => apply(f.m, [p[0], p[1], 0]));
      const up = f.m[10] > 0;
      const showsColor = up === model.colorUp;
      const fill = !f.flat ? '#9bd' : showsColor ? '#e9785b' : '#f4eee0';
      g += `<polygon points="${pts.map((p) => `${p[0] * scale},${-p[1] * scale}`).join(' ')}" fill="${fill}" fill-opacity="0.92" stroke="#3a2a20" stroke-width="1"/>`;
    }
    if (guide) {
      g += `<line x1="${guide[0][0] * scale}" y1="${-guide[0][1] * scale}" x2="${guide[1][0] * scale}" y2="${-guide[1][1] * scale}" stroke="#2a7" stroke-dasharray="4 3" stroke-width="2"/>`;
    }
    if (handle) g += `<circle cx="${handle[0] * scale}" cy="${-handle[1] * scale}" r="6" fill="#2a7"/>`;
    frames.push(
      `<g transform="translate(${frames.length * cell + cell / 2},${y + cell / 2})">${g}<text x="${-cell / 2 + 6}" y="${cell / 2 - 8}" font-size="11" font-family="sans-serif">${label}</text></g>`,
    );
  };
  for (let i = 0; i < model.steps.length; i++) {
    const p = s.prepare(model.steps[i], i);
    draw(`${i}: ${model.steps[i].say.slice(0, 32)}`, [p.guide[0], p.guide[1]], p.handle);
    s.commit(p);
  }
  draw(`${model.name} — done (max stack ${s.maxStack()}, ${s.facets.length} facets)`);
  rows += frames.join('');
  width = Math.max(width, frames.length * cell);
  y += cell;
}
console.log(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${y}" style="background:#fff"><rect width="100%" height="100%" fill="#fff"/>${rows}</svg>`,
);

// Sanity: every committed fold step should have a recoverable crease.
for (const model of models) {
  const s = new Sheet(model.turn);
  model.steps.forEach((st, i) => s.commit(s.prepare(st, i)));
  for (const o of model.opens) {
    if (!s.creases[o.step]) console.error(`[warn] ${model.id}: no crease for open step ${o.step}`);
  }
}
