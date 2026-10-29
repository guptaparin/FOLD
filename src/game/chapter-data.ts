/**
 * Lightweight chapter data (model + paper). Kept free of Three.js so the
 * landing page can import it and render instantly, before the 3D runtime loads.
 */
import { BOAT, CUP, FOX, OrigamiModel, PLANE, SWAN, TENT } from './fold/models.js';

export interface PaperStyleData {
  base: string;
  ink: string;
  pattern: 'plain' | 'seigaiha' | 'asanoha' | 'dots' | 'stripes' | 'stars' | 'kikko' | 'sakura';
  cells: number;
  inkAlpha: number;
}

export interface ChapterData {
  index: number;
  numeral: string;
  model: OrigamiModel;
  paper: PaperStyleData;
  /** MIDI root of the generative music for this chapter. */
  root: number;
}

export const CHAPTER_DATA: ChapterData[] = [
  { index: 0, numeral: 'I', model: TENT, paper: { base: '#e2704f', ink: '#fff1dc', pattern: 'seigaiha', cells: 7, inkAlpha: 0.32 }, root: 57 },
  { index: 1, numeral: 'II', model: BOAT, paper: { base: '#2f5d8f', ink: '#e8f1ff', pattern: 'kikko', cells: 8, inkAlpha: 0.22 }, root: 55 },
  { index: 2, numeral: 'III', model: FOX, paper: { base: '#e07a2e', ink: '#fff0d6', pattern: 'asanoha', cells: 6, inkAlpha: 0.3 }, root: 60 },
  { index: 3, numeral: 'IV', model: CUP, paper: { base: '#2f8a86', ink: '#e6fff8', pattern: 'dots', cells: 9, inkAlpha: 0.3 }, root: 58 },
  { index: 4, numeral: 'V', model: PLANE, paper: { base: '#6b8fd6', ink: '#ffffff', pattern: 'stripes', cells: 10, inkAlpha: 0.2 }, root: 62 },
  { index: 5, numeral: 'VI', model: SWAN, paper: { base: '#f1ece2', ink: '#9aa6c9', pattern: 'sakura', cells: 7, inkAlpha: 0.35 }, root: 53 },
];
