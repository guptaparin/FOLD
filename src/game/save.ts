/** Local progress. Everything is saved after every crease. */
import type { PaperStyle } from './textures.js';

export interface DailyEntry {
  date: string;
  chapter: number;
  paper: PaperStyle;
  seconds: number;
}

export interface SaveData {
  version: 1;
  done: boolean[];
  best: (number | null)[];
  /** Mid-chapter resume point. */
  resume: { chapter: number; step: number; daily: boolean } | null;
  daily: { last: string | null; streak: number; shelf: DailyEntry[] };
  settings: {
    assist: boolean;
    gaze: boolean;
    muted: boolean;
    contrast: boolean;
  };
}

const KEY = 'fold.save.v1';

export function fresh(): SaveData {
  return {
    version: 1,
    done: [false, false, false, false, false, false],
    best: [null, null, null, null, null, null],
    resume: null,
    daily: { last: null, streak: 0, shelf: [] },
    settings: { assist: false, gaze: false, muted: false, contrast: false },
  };
}

export function load(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const d = JSON.parse(raw) as SaveData;
    const f = fresh();
    return {
      ...f,
      ...d,
      daily: { ...f.daily, ...d.daily },
      settings: { ...f.settings, ...d.settings },
    };
  } catch {
    return fresh();
  }
}

export function store(d: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    // Private mode or storage blocked: progress just won't persist.
  }
}

/** Days between two YYYY-MM-DD keys. */
export function dayGap(a: string, b: string): number {
  const pa = new Date(`${a}T12:00:00`);
  const pb = new Date(`${b}T12:00:00`);
  return Math.round((pb.getTime() - pa.getTime()) / 86400000);
}
