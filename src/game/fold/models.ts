/**
 * Origami models, written the way real diagrams are: named paper points,
 * "bring A to B" folds, and folds along lines through two points.
 *
 * Paper coordinates: the square spans -1..1. With turn 0, +Y is the far edge
 * of the sheet (away from the player) and +X is to the right. A model with
 * turn 45 starts as a diamond.
 */

import type { Step } from './engine.js';
import type { V2 } from './math.js';

export type { V2 };

// Named points of the square.
export const TL: V2 = [-1, 1];
export const TR: V2 = [1, 1];
export const BL: V2 = [-1, -1];
export const BR: V2 = [1, -1];
export const C: V2 = [0, 0];
export const T: V2 = [0, 1];
export const B: V2 = [0, -1];
export const L: V2 = [-1, 0];
export const R: V2 = [1, 0];

/** Point at fraction t from a to b. */
export const along = (a: V2, b: V2, t: number): V2 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];

export interface LifeOpen {
  /** Re-open the fold made at this step index by `angle` radians. */
  step: number;
  angle: number;
}

export interface OrigamiModel {
  id: string;
  name: string;
  /** Initial sheet rotation in degrees. */
  turn: number;
  /** Start coloured side facing up. */
  colorUp: boolean;
  steps: Step[];
  /** Folds that relax open when the model comes to life, giving it volume. */
  opens: LifeOpen[];
  /**
   * In-plane rotation (degrees) applied when the model stands up in the
   * diorama, so its silhouette reads upright.
   */
  standRoll: number;
  /** Show the coloured or the white face to the audience when standing. */
  standFace: 'front' | 'back';
}

const PI = Math.PI;

// ---------------------------------------------------------------------------
// Shelter — a single fold that teaches pinch, pull, release.
export const TENT: OrigamiModel = {
  id: 'tent',
  name: 'Shelter',
  turn: 0,
  colorUp: false,
  steps: [
    {
      kind: 'fold',
      say: 'Fold the paper in half: bring the far edge to the near edge.',
      line: { bisect: [T, B] },
      move: T,
      handle: T,
    },
  ],
  opens: [{ step: 0, angle: PI * 0.42 }],
  standRoll: 0,
  standFace: 'front',
};

// ---------------------------------------------------------------------------
// Little Fox — diamond, triangle, sides down, ears back up, turn over.
const A = Math.SQRT2;
export const FOX: OrigamiModel = {
  id: 'fox',
  name: 'Little Fox',
  turn: 45,
  colorUp: false,
  steps: [
    {
      kind: 'fold',
      say: 'Bring the top corner down to the bottom corner.',
      line: { bisect: [TR, BL] },
      move: TR,
    },
    {
      kind: 'fold',
      say: 'Fold the left corner down to the bottom point.',
      line: { through: [C, L] },
      move: TL,
    },
    {
      kind: 'fold',
      say: 'Fold the right corner down to meet it.',
      line: { through: [C, B] },
      move: BR,
    },
    {
      kind: 'fold',
      say: 'Fold the left flap back up into an ear.',
      line: { bisect: [{ at: [-0.02, -A + 0.02] }, { at: [-0.62, 0.34] }] },
      move: { at: [-0.04, -A + 0.08] },
      sel: { movedIn: [1] },
    },
    {
      kind: 'fold',
      say: 'Fold the right flap up into the other ear.',
      line: { bisect: [{ at: [0.02, -A + 0.02] }, { at: [0.62, 0.34] }] },
      move: { at: [0.04, -A + 0.08] },
      sel: { movedIn: [2] },
    },
    {
      kind: 'flip',
      say: 'Turn the paper over.',
      axis: 'y',
    },
  ],
  opens: [
    { step: 3, angle: PI * 0.1 },
    { step: 4, angle: PI * 0.1 },
  ],
  standRoll: 0,
  standFace: 'front',
};

// ---------------------------------------------------------------------------
// Lantern Boat — fold in half, then tuck the two keel corners.
export const BOAT: OrigamiModel = {
  id: 'boat',
  name: 'Lantern Boat',
  turn: 0,
  colorUp: false,
  steps: [
    {
      kind: 'fold',
      say: 'Fold the near edge up to the far edge.',
      line: { bisect: [B, T] },
      move: B,
    },
    {
      kind: 'fold',
      say: 'Fold the left corner up to make the bow.',
      line: { through: [{ at: [-1, 0.55] }, { at: [-0.45, 0] }] },
      move: { at: [-0.98, 0.02] },
    },
    {
      kind: 'fold',
      say: 'Fold the right corner up for the stern.',
      line: { through: [{ at: [1, 0.55] }, { at: [0.45, 0] }] },
      move: { at: [0.98, 0.02] },
    },
  ],
  opens: [{ step: 0, angle: PI * 0.08 }],
  standRoll: 180,
  standFace: 'front',
};

// ---------------------------------------------------------------------------
// Water Cup — the classic drinking cup.
const cupT = (2 * A) / (2 + Math.SQRT2);
export const CUP: OrigamiModel = {
  id: 'cup',
  name: 'Water Cup',
  turn: 45,
  colorUp: true,
  steps: [
    {
      kind: 'fold',
      say: 'Bring the top corner down to the bottom corner.',
      line: { bisect: [TR, BL] },
      move: TR,
    },
    {
      kind: 'fold',
      say: 'Fold the right corner across to the left edge.',
      line: { bisect: [{ at: [A, 0] }, { at: [-A + cupT, -cupT] }] },
      move: { at: [A - 0.02, -0.005] },
    },
    {
      kind: 'fold',
      say: 'Fold the left corner across to the right edge.',
      line: { bisect: [{ at: [-A, 0] }, { at: [A - cupT, -cupT] }] },
      move: { at: [-A + 0.02, -0.005] },
    },
    {
      kind: 'fold',
      say: 'Fold the front flap down into the cup.',
      line: { through: [{ at: [-1, -cupT] }, { at: [1, -cupT] }] },
      move: { at: [0, -0.05] },
      sel: { movedIn: [0], notMovedIn: [1, 2] },
    },
    {
      kind: 'flip',
      say: 'Turn the cup over.',
      axis: 'y',
    },
    {
      kind: 'fold',
      say: 'Fold the last flap down. A cup!',
      line: { through: [{ at: [-1, -cupT] }, { at: [1, -cupT] }] },
      move: { at: [0, -0.05] },
      sel: { notMovedIn: [0, 1, 2] },
    },
  ],
  opens: [],
  standRoll: 0,
  standFace: 'front',
};

// ---------------------------------------------------------------------------
// Paper plane — the classic dart, with a flip between the wings.
const planeFoot = 0.828;
export const PLANE: OrigamiModel = {
  id: 'plane',
  name: 'Paper Plane',
  turn: 0,
  colorUp: false,
  steps: [
    {
      kind: 'fold',
      say: 'Fold the top-left corner to the centre line.',
      line: { through: [T, L] },
      move: TL,
    },
    {
      kind: 'fold',
      say: 'And the top-right corner.',
      line: { through: [T, R] },
      move: TR,
    },
    {
      kind: 'fold',
      say: 'Fold the new left edge to the centre again.',
      line: { through: [T, [-planeFoot, -1]] },
      move: BL,
      handle: L,
    },
    {
      kind: 'fold',
      say: 'And the right edge.',
      line: { through: [T, [planeFoot, -1]] },
      move: BR,
      handle: R,
    },
    {
      kind: 'fold',
      say: 'Fold the plane in half.',
      line: { through: [T, B] },
      move: [-planeFoot, -1],
    },
    {
      kind: 'fold',
      say: 'Fold the first wing down.',
      line: { through: [T, [-0.26, -1]] },
      move: [-planeFoot, -1],
      sel: { movedIn: [4] },
    },
    {
      kind: 'flip',
      say: 'Turn it over.',
      axis: 'y',
    },
    {
      kind: 'fold',
      say: 'Fold the second wing to match.',
      line: { through: [T, [0.26, -1]] },
      move: [planeFoot, -1],
      sel: { notMovedIn: [4] },
    },
  ],
  opens: [
    { step: 5, angle: PI * 0.5 },
    { step: 7, angle: PI * 0.5 },
    { step: 4, angle: PI * 0.12 },
  ],
  standRoll: 0,
  standFace: 'front',
};

// ---------------------------------------------------------------------------
// Moon Swan — kite base, narrowed, neck and head. Floats flat; the neck rises.
const k1 = 2.164; // kite hinge distance along 112.5 degrees from the bottom point
export const SWAN: OrigamiModel = {
  id: 'swan',
  name: 'Moon Swan',
  turn: 45,
  colorUp: true,
  steps: [
    {
      kind: 'fold',
      say: 'Fold the lower-left edge to the centre line.',
      line: { through: [BL, { at: [-0.383 * k1, -A + 0.924 * k1] }] },
      move: TL,
    },
    {
      kind: 'fold',
      say: 'Fold the lower-right edge to match. A kite!',
      line: { through: [BL, { at: [0.383 * k1, -A + 0.924 * k1] }] },
      move: BR,
    },
    {
      kind: 'flip',
      say: 'Turn the kite over.',
      axis: 'y',
    },
    {
      kind: 'fold',
      say: 'Fold the left edge to the centre again.',
      line: { through: [{ at: [0, -A] }, { at: [-0.234, -0.237] }] },
      move: { at: [-0.6, 0.3] },
    },
    {
      kind: 'fold',
      say: 'And the right edge.',
      line: { through: [{ at: [0, -A] }, { at: [0.234, -0.237] }] },
      move: { at: [0.6, 0.3] },
    },
    {
      kind: 'fold',
      say: 'Fold the long point up. This is the neck.',
      line: { bisect: [{ at: [0, -A] }, { at: [0, 0.95] }] },
      move: { at: [0, -A + 0.03] },
    },
    {
      kind: 'fold',
      say: 'Fold the tip down to make the head.',
      line: { bisect: [{ at: [0, 0.95] }, { at: [0, 0.55] }] },
      move: { at: [0, 0.92] },
      sel: { movedIn: [5] },
    },
  ],
  opens: [
    { step: 5, angle: PI * 0.55 },
    { step: 6, angle: PI * 0.35 },
  ],
  standRoll: 0,
  standFace: 'front',
};

export const MODELS: OrigamiModel[] = [TENT, BOAT, FOX, CUP, PLANE, SWAN];
