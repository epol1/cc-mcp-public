// Beat sync in scenes (A5): beatsOf('music.mp3') analyzes the track once (cached as <file>.beats.json next to it, or
// in ~/.ae-compose/beats when that folder is read-only) and returns the grid: beat(n), bar(b, beat), snap(t),
// between(a, b), bars(n) as a duration. <Audio> places the track; <BeatMarkers> writes beat/bar comp markers so a
// designer sees the grid in AE, expressions can fire on them, and lint flags cuts that land just off a beat.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Fragment, jsx } from './jsx-runtime.ts';
import { Footage, CompMarkers } from './primitives.ts';
import type { FootageProps } from './primitives.ts';
import { beatGrid, offBeatCuts, snapToBeats } from '@ae-mcp/core/audio/beats.ts';
import type { BeatAnalysis, BeatOptions } from '@ae-mcp/core/audio/beats.ts';

export interface BeatSync {
  file: string; bpm: number; confidence: number; beatsPerBar: number;
  beats: number[]; downbeats: number[];
  /** Time of beat n (0 = first), fractional allowed. */
  beat(n: number): number;
  /** Time of beat `beat` (0-based) in bar `bar` (0 = first downbeat's bar). */
  bar(bar: number, beat?: number): number;
  /** Duration of n bars (or beats with unit 'beat') at the track's tempo. */
  bars(n: number, unit?: 'bar' | 'beat'): number;
  /** Nearest beat (or subdivision 2 = eighths, 4 = sixteenths) within `tolerance` s; otherwise t unchanged. */
  snap(t: number, opts?: { tolerance?: number; subdivision?: 1 | 2 | 4 }): number;
  between(a: number, b: number): number[];
  /** Cuts that land just off a beat (within `window`, further than `tolerance`). */
  offBeat(cuts: number[], opts?: { window?: number; tolerance?: number }): { t: number; nearest: number; offBy: number }[];
}

// Scenes run bundled from a temp folder: the loader sets __AEC_ROOT__ to the repo.
const cli = () => path.join((globalThis as any).__AEC_ROOT__ ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'), 'packages', 'core', 'src', 'audio', 'cli.ts');

function analyzeSync(file: string, opts: BeatOptions): BeatAnalysis {
  const stat = fs.statSync(file);
  const key = crypto.createHash('sha1').update(JSON.stringify([path.resolve(file), stat.size, stat.mtimeMs, opts])).digest('hex').slice(0, 12);
  const caches = [`${file}.beats.json`, path.join(os.homedir(), '.ae-compose', 'beats', `${path.basename(file)}.${key}.json`)];
  for (const c of caches) {
    try { const j = JSON.parse(fs.readFileSync(c, 'utf8')); if (j.key === key) return j.analysis; } catch { /* not cached */ }
  }
  const out = execFileSync(process.execPath, ['--import', 'tsx', cli(), file, JSON.stringify(opts)], { encoding: 'utf8', maxBuffer: 64 << 20, timeout: 120_000, cwd: (globalThis as any).__AEC_ROOT__ ?? process.cwd() });
  const analysis = JSON.parse(out) as BeatAnalysis;
  for (const c of caches) {
    try { fs.mkdirSync(path.dirname(c), { recursive: true }); fs.writeFileSync(c, JSON.stringify({ key, analysis })); break; } catch { /* try the next */ }
  }
  return analysis;
}

/** Beat grid of an audio file (relative paths resolve from the scene file). `offset` shifts it (audio placed later). */
export function beatsOf(file: string, opts: BeatOptions & { offset?: number } = {}): BeatSync {
  const abs = path.isAbsolute(file) ? file : path.resolve((globalThis as any).__AEC_SCENE_DIR__ ?? process.cwd(), file);
  if (!fs.existsSync(abs)) throw new Error(`beatsOf: audio file not found: ${abs}`);
  const { offset = 0, ...bo } = opts;
  const a = analyzeSync(abs, bo);
  const sh = (t: number) => t + offset;
  const beats = a.beats.map(sh), downbeats = a.downbeats.map(sh);
  const g = beatGrid({ ...a, beats, downbeats });
  const period = a.bpm > 0 ? 60 / a.bpm : 0.5;
  return {
    file: abs, bpm: a.bpm, confidence: a.confidence, beatsPerBar: a.beatsPerBar, beats, downbeats,
    beat: g.beat, bar: g.bar, between: g.between,
    bars: (n, unit = 'bar') => n * period * (unit === 'bar' ? a.beatsPerBar : 1),
    snap: (t, o) => snapToBeats(t, beats, o).t,
    offBeat: (cuts, o) => offBeatCuts(cuts, beats, o),
  };
}

/** The track as an audio layer (no picture). */
export function Audio(p: Omit<FootageProps, 'fit'> & { src: string }) {
  return jsx(Footage, { ...p, fit: 'none', audio: true } as any);
}

/**
 * Comp markers on the beat grid: "bar 3" on downbeats and "beat" on the others (`every: 'bar'` marks bars only),
 * between `from` and `to`. Expressions can fire on them (thisComp.marker), and lint checks cuts against them.
 */
export function BeatMarkers(p: { beats: BeatSync; every?: 'beat' | 'bar'; from?: number; to?: number }) {
  const from = p.from ?? 0, to = p.to ?? Infinity;
  const down = new Set(p.beats.downbeats.map((t) => t.toFixed(4)));
  let bar = 0;
  const markers: { t: number; comment: string }[] = [];
  for (const t of p.beats.beats) {
    const isBar = down.has(t.toFixed(4));
    if (isBar) bar++;
    if (t < from || t >= to) continue;
    if (isBar) markers.push({ t, comment: `bar ${bar}` });
    else if (p.every !== 'bar') markers.push({ t, comment: 'beat' });
  }
  return jsx(Fragment, { children: [jsx(CompMarkers, { markers })] });
}
