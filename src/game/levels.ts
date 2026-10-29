/** Chapters: which model, which paper, which stage, which key the music is in. */
import { CHAPTER_DATA } from './chapter-data.js';
import type { OrigamiModel } from './fold/models.js';
import {
  CanyonStage,
  Diorama,
  FoxStage,
  GardenStage,
  LakeStage,
  RiverStage,
  ShelterStage,
} from './dioramas.js';
import { PaperStyle, PatternKind, rng } from './textures.js';

export interface Chapter {
  index: number;
  numeral: string;
  model: OrigamiModel;
  paper: PaperStyle;
  stage: () => Diorama;
  /** MIDI root of the generative music for this chapter. */
  root: number;
}

const STAGES: (() => Diorama)[] = [
  () => new ShelterStage(),
  () => new RiverStage(),
  () => new FoxStage(),
  () => new GardenStage(),
  () => new CanyonStage(),
  () => new LakeStage(),
];

export const CHAPTERS: Chapter[] = CHAPTER_DATA.map((d, i) => ({ ...d, stage: STAGES[i] }));

const DAILY_BASES = ['#c4553a', '#3f6b8f', '#7a5aa6', '#2f8a6a', '#d6913a', '#b84a6b', '#45607f', '#8a6a3a'];
const DAILY_PATTERNS: PatternKind[] = ['seigaiha', 'asanoha', 'dots', 'stripes', 'stars', 'kikko', 'sakura'];

/** Local date key, e.g. 2026-10-29. */
export function todayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * The daily fold: a date-seeded chapter replay on a one-of-a-kind sheet of
 * paper. Everyone in the world folds the same paper on the same day.
 */
export function dailyFor(key: string): { chapter: Chapter; paper: PaperStyle; seed: number } {
  let h = 2166136261;
  for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const r = rng(h >>> 0);
  const chapter = CHAPTERS[1 + Math.floor(r() * (CHAPTERS.length - 1))];
  const paper: PaperStyle = {
    base: DAILY_BASES[Math.floor(r() * DAILY_BASES.length)],
    ink: '#fff4e0',
    pattern: DAILY_PATTERNS[Math.floor(r() * DAILY_PATTERNS.length)],
    cells: 6 + Math.floor(r() * 5),
    inkAlpha: 0.22 + r() * 0.15,
  };
  return { chapter, paper, seed: h >>> 0 };
}
