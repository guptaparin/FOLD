/** Prints the folded fox as SVG polygons (used for app icons and the thumbnail). */
import { Sheet } from '../src/game/fold/engine.js';
import { apply } from '../src/game/fold/math.js';
import { CHAPTER_DATA } from '../src/game/chapter-data.js';

const ch = CHAPTER_DATA[2];
const s = new Sheet(ch.model.turn);
ch.model.steps.forEach((st, i) => s.commit(s.prepare(st, i)));
const [mn, mx] = s.bounds();
const size = 100;
const k = (size * 0.9) / Math.max(mx[0] - mn[0], mx[1] - mn[1]);
const cx = (mn[0] + mx[0]) / 2;
const cy = (mn[1] + mx[1]) / 2;
const polys = [...s.facets]
  .sort((a, b) => a.order - b.order)
  .map((f) => {
    const pts = f.poly
      .map((p) => apply(f.m, [p[0], p[1], 0]))
      .map((q) => `${(50 + (q[0] - cx) * k).toFixed(2)},${(50 - (q[1] - cy) * k).toFixed(2)}`)
      .join(' ');
    const up = f.m[10] > 0;
    const col = up === ch.model.colorUp ? ch.paper.base : '#f3ead8';
    return `<polygon points="${pts}" fill="${col}" stroke="rgba(40,25,15,.3)" stroke-width="0.4" stroke-linejoin="round"/>`;
  })
  .join('');
console.log(polys);
