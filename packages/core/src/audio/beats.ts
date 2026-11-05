// Music → beat grid for beat-synced motion graphics (TOOLKIT A5): decode with ffmpeg, find onsets,
// tempo, beats and downbeats, and the helpers that snap cuts to the grid and flag cuts just off a beat.
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { barPhase } from './downbeat.ts';
import { pickOnsets, spectralFlux, type Onset, type SpectralFlux } from './onset.ts';
import { periodicity, tempoCandidates, tempoPrior } from './tempo.ts';
import { beatSupport, envelopeFloor, peakNear, refineBeats, standardize, trackBeats, type BeatSupport } from './track.ts';

export interface BeatAnalysis {
  file: string;
  /** Seconds of audio analyzed. */
  duration: number;
  /** Where the analyzed span starts in the file (all times below are file times). */
  start: number;
  sampleRate: number;
  bpm: number;
  /** 0–1: how periodic the music is at this tempo, how clearly the beats stand out, how steady they are (noise ≈ 0). */
  confidence: number;
  /** Beat times in seconds. */
  beats: number[];
  /** The beats that start a bar (every beatsPerBar-th beat, phase from kick/bass energy and bar-to-bar change). */
  downbeats: number[];
  beatsPerBar: number;
  /** 0–1: margin of the chosen bar phase over the runner-up. */
  downbeatConfidence: number;
  onsets: Onset[];
  /** First beat time. */
  offset: number;
  /** Coefficient of variation of the inter-beat intervals (0.01 = very steady). */
  ibiCv: number;
  /** Tempi the tracker weighed: the chosen one first (it may be a doubled one), then by score relative to the top score. */
  candidates: { bpm: number; score: number }[];
  /** Analysis time in milliseconds (decode included for analyzeBeats). */
  ms: number;
}

export interface BeatOptions {
  minBpm?: number;
  maxBpm?: number;
  beatsPerBar?: number;
  /** Seconds into the file/PCM where analysis starts. */
  start?: number;
  /** Seconds to analyze (default: to the end). */
  duration?: number;
  /** Decode rate for analyzeBeats (default 22050). */
  sampleRate?: number;
}

export const DEFAULT_SAMPLE_RATE = 22050;
/** Added to onset and beat times: the flux peaks ~5 ms before a drum transient (measured on synthetic kits). */
const ONSET_LAG = 0.005;
/**
 * Tempo doubling: the midpoints between beats carry at least DOUBLE_MID of the on-beat accent, and the
 * quarter points at least DOUBLE_SUB of the midpoints' (and more, relatively, than the level below them).
 */
const DOUBLE_MID = 0.5, DOUBLE_SUB = 0.3;

type Analysis = Omit<BeatAnalysis, 'file'>;

function emptyAnalysis(duration: number, start: number, sampleRate: number, beatsPerBar: number, t0: number): Analysis {
  return { duration, start, sampleRate, bpm: 0, confidence: 0, beats: [], downbeats: [], beatsPerBar, downbeatConfidence: 0, onsets: [], offset: 0, ibiCv: 0, candidates: [], ms: performance.now() - t0 };
}

interface Tracked extends BeatSupport { bpm: number; beats: number[]; score: number }

/** Inter-beat-interval spread a correct metrical level stays within; warped tracks score far lower. */
const CV_SCALE = 0.08;

/** Strength of metrical level l relative to the level above it, over the envelope floor. */
const levelRatio = (s: BeatSupport, l: number): number => {
  const above = s.levels[l - 1] - s.floor;
  return above > 0 ? (s.levels[l] - s.floor) / above : 0;
};

/**
 * Tracks every tempo candidate and keeps the best one: strong onsets on the beats, near the prior,
 * steady intervals (a wrong level only hits the onsets by warping). Then doubles it when the level
 * below the beat is nearly as accented as the beat AND has its own busy subdivision: the beat sits
 * one level above the fastest prominent pulse (drum & bass otherwise reads at half time).
 */
function chooseTempo(env: Float32Array, flux: SpectralFlux, minBpm: number, maxBpm: number): { best: Tracked; all: Tracked[] } {
  const floor = envelopeFloor(env);
  const track = (bpm: number): Tracked => {
    const beats = trackBeats(env, (60 * flux.fps) / bpm);
    const s = beatSupport(env, beats, floor);
    return { bpm, beats, ...s, score: Math.max(0, s.levels[0] - floor) * tempoPrior(bpm) * Math.exp(-0.5 * (s.cv / CV_SCALE) ** 2) };
  };
  const all = tempoCandidates(flux.flux, flux.fps, minBpm, maxBpm).map((c) => track(c.bpm));
  all.sort((a, b) => b.score - a.score);
  let best = all[0];
  if (best && best.bpm * 2 <= maxBpm * 1.02 && levelRatio(best, 1) >= DOUBLE_MID && levelRatio(best, 2) >= DOUBLE_SUB && levelRatio(best, 3) < levelRatio(best, 2)) {
    const doubled = all.find((c) => Math.abs(Math.log(c.bpm / (best.bpm * 2))) < 0.04) ?? track(best.bpm * 2);
    if (doubled.cv < 2 * Math.max(best.cv, 0.03)) best = doubled;
  }
  return { best, all };
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/** Envelope autocorrelation at which the pulse counts as fully periodic for confidence. */
const PERIODIC_AC = 0.35;

/**
 * 0–1 confidence: periodicity (autocorrelation at the beat/2-beat/bar lag; noise and random hits
 * have none) times a mix of metrical contrast (beats against the weakest subdivision level),
 * coverage (share of beats on a real onset rather than bridged) and IBI steadiness.
 */
function beatConfidence(env: Float32Array, flux: SpectralFlux, t: Tracked, bpm: number, cv: number): number {
  const on = t.levels[0];
  if (on <= 0 || t.beats.length < 2) return 0;
  const contrast = clamp01(1 - Math.min(t.levels[1], t.levels[2], t.levels[3]) / on);
  const bar = t.floor + 0.25 * Math.max(0, on - t.floor);
  const coverage = t.beats.filter((b) => peakNear(env, b, 2) >= bar).length / t.beats.length;
  const steadiness = clamp01(1 - (cv - 0.02) / 0.1);
  const periodic = clamp01(periodicity(flux.flux, flux.fps, bpm) / PERIODIC_AC);
  return clamp01(periodic * (0.5 * contrast + 0.3 * coverage + 0.2 * steadiness)) * Math.min(1, t.beats.length / 8);
}

function ibiStats(times: number[]): { bpm: number; cv: number } {
  if (times.length < 2) return { bpm: 0, cv: 0 };
  const ibi = times.slice(1).map((t, i) => t - times[i]);
  const med = [...ibi].sort((a, b) => a - b)[ibi.length >> 1];
  const kept = ibi.filter((d) => Math.abs(d / med - 1) < 0.25);
  const mean = kept.reduce((a, b) => a + b, 0) / kept.length;
  const sd = Math.sqrt(kept.reduce((a, d) => a + (d - mean) ** 2, 0) / kept.length);
  return { bpm: 60 / mean, cv: sd / mean };
}

function analyzeSegment(pcm: Float32Array, sampleRate: number, opts: BeatOptions, start: number, t0: number): Analysis {
  const minBpm = opts.minBpm ?? 70, maxBpm = opts.maxBpm ?? 180, beatsPerBar = Math.max(1, Math.round(opts.beatsPerBar ?? 4));
  if (!(minBpm > 0 && maxBpm > minBpm)) throw new Error(`invalid tempo range [${minBpm}, ${maxBpm}]`);
  const duration = pcm.length / sampleRate;
  if (duration < 2) return emptyAnalysis(duration, start, sampleRate, beatsPerBar, t0);
  const flux = spectralFlux(pcm, sampleRate);
  const env = standardize(flux.flux);
  const onsets = pickOnsets(flux.flux, flux.fps, ONSET_LAG).map((o) => ({ t: o.t + start, strength: o.strength }));
  const { best, all } = chooseTempo(env, flux, minBpm, maxBpm);
  if (!best || best.beats.length < 2) return { ...emptyAnalysis(duration, start, sampleRate, beatsPerBar, t0), onsets };

  const period = (60 * flux.fps) / best.bpm;
  const frames = refineBeats(env, best.beats, Math.max(1, Math.round(0.1 * period)));
  const toTime = (f: number) => f / flux.fps + ONSET_LAG + start;
  const beats = frames.map(toTime);
  const { bpm, cv } = ibiStats(beats);
  const bar = barPhase(frames, flux.lowFlux, flux.bandLog, flux.bands, beatsPerBar);
  const downbeats = beats.filter((_, i) => i % beatsPerBar === bar.phase);

  const confidence = beatConfidence(env, flux, best, bpm, cv);
  const top = all[0]?.score || 1;
  const candidates = [best, ...all.filter((c) => c !== best)].slice(0, 6).map((c) => ({ bpm: Math.round(c.bpm * 10) / 10, score: Math.round((c.score / top) * 1000) / 1000 }));
  return {
    duration, start, sampleRate, bpm, confidence, beats, downbeats, beatsPerBar, downbeatConfidence: bar.confidence, onsets,
    offset: beats[0], ibiCv: cv, candidates, ms: performance.now() - t0,
  };
}

/** Pure analysis of mono PCM (start/duration select a span; times stay relative to the PCM start). */
export function analyzePcm(pcm: Float32Array, sampleRate: number, opts: BeatOptions = {}): Omit<BeatAnalysis, 'file'> {
  const t0 = performance.now();
  const start = Math.max(0, opts.start ?? 0);
  const a = Math.min(pcm.length, Math.round(start * sampleRate));
  const b = opts.duration != null ? Math.min(pcm.length, a + Math.round(opts.duration * sampleRate)) : pcm.length;
  return analyzeSegment(pcm.subarray(a, b), sampleRate, opts, a / sampleRate, t0);
}

/** Decodes any ffmpeg-readable audio/video file to mono float32 PCM. */
export function decodePcm(file: string, sampleRate = DEFAULT_SAMPLE_RATE, start?: number, duration?: number): Promise<Float32Array> {
  const args = ['-v', 'error', '-nostdin'];
  if (start && start > 0) args.push('-ss', String(start));
  if (duration != null && duration > 0) args.push('-t', String(duration));
  args.push('-i', file, '-vn', '-ac', '1', '-ar', String(sampleRate), '-f', 'f32le', '-acodec', 'pcm_f32le', 'pipe:1');
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let err = '';
    proc.stdout.on('data', (c: Buffer) => chunks.push(c));
    proc.stderr.on('data', (c: Buffer) => { err += String(c); });
    proc.on('error', (e) => reject(new Error(`ffmpeg not available (${e.message}); install it and put it on PATH`)));
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg could not decode ${file}: ${err.trim().slice(-600) || `exit ${code}`}`));
      const buf = Buffer.concat(chunks), out = new Float32Array(buf.length >> 2);
      new Uint8Array(out.buffer).set(buf.subarray(0, out.length * 4));
      resolve(out);
    });
  });
}

/** Decodes a music file (ffmpeg) and analyzes its beats. Times are seconds from the start of the file. */
export async function analyzeBeats(file: string, opts: BeatOptions = {}): Promise<BeatAnalysis> {
  const t0 = performance.now();
  const sampleRate = opts.sampleRate ?? DEFAULT_SAMPLE_RATE, start = Math.max(0, opts.start ?? 0);
  const pcm = await decodePcm(file, sampleRate, start, opts.duration);
  return { file, ...analyzeSegment(pcm, sampleRate, opts, start, t0) };
}

/** Index of the sorted-array element nearest to t (-1 when empty). */
function nearestIndex(sorted: number[], t: number): number {
  if (sorted.length === 0) return -1;
  let lo = 0, hi = sorted.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < t) lo = mid + 1; else hi = mid; }
  return lo > 0 && t - sorted[lo - 1] <= sorted[lo] - t ? lo - 1 : lo;
}

/** Snap a time to the nearest beat (or subdivision: 2 = eighths, 4 = sixteenths) when within tolerance (default 0.12 s). */
export function snapToBeats(t: number, beats: number[], opts: { tolerance?: number; subdivision?: 1 | 2 | 4 } = {}): { t: number; snapped: boolean; offBy: number; beat: number } {
  const tolerance = opts.tolerance ?? 0.12, sub = opts.subdivision ?? 1;
  const i = nearestIndex(beats, t);
  if (i < 0) return { t, snapped: false, offBy: Infinity, beat: -1 };
  // The subdivision grid around beat i: the neighbouring interval on the side of t.
  const j = t >= beats[i] ? i : i - 1;
  let beat = i, grid = beats[i];
  if (sub > 1 && j >= 0 && j + 1 < beats.length) {
    const a = beats[j], d = beats[j + 1] - a, k = Math.round(((t - a) / d) * sub);
    beat = j + k / sub;
    grid = a + (k / sub) * d;
  }
  const offBy = t - grid;
  return Math.abs(offBy) <= tolerance ? { t: grid, snapped: true, offBy, beat } : { t, snapped: false, offBy, beat };
}

/** Cuts that land just off a beat: within `window` (default 0.15 s) of a beat but further than `tolerance` (default 1 frame at 30 fps = 0.034 s). */
export function offBeatCuts(cuts: number[], beats: number[], opts: { window?: number; tolerance?: number } = {}): { t: number; nearest: number; offBy: number }[] {
  const window = opts.window ?? 0.15, tolerance = opts.tolerance ?? 0.034;
  const out: { t: number; nearest: number; offBy: number }[] = [];
  for (const t of cuts) {
    const i = nearestIndex(beats, t);
    if (i < 0) continue;
    const offBy = t - beats[i];
    if (Math.abs(offBy) > tolerance && Math.abs(offBy) <= window) out.push({ t, nearest: beats[i], offBy });
  }
  return out;
}

export interface BeatGrid {
  /** Time of beat n (0 = first beat). Fractional n interpolates; outside the track it extrapolates at the tempo. */
  beat(n: number): number;
  /** Time of beat `beat` (0-based, fractional allowed) in bar `bar` (0 = the bar of the first downbeat). */
  bar(bar: number, beat?: number): number;
  /** Beat times t with a ≤ t < b. */
  between(a: number, b: number): number[];
  /** Fractional beat index at time t (inverse of beat). */
  indexAt(t: number): number;
}

/** Addresses an analysis as a grid: beat(n), bar(bar, beatInBar), between(a, b) and indexAt(t). */
export function beatGrid(a: Pick<BeatAnalysis, 'beats' | 'downbeats' | 'bpm' | 'beatsPerBar'>): BeatGrid {
  const beats = a.beats, n = beats.length;
  const period = a.bpm > 0 ? 60 / a.bpm : n > 1 ? (beats[n - 1] - beats[0]) / (n - 1) : 0.5;
  const firstDown = a.downbeats.length ? Math.max(0, beats.indexOf(a.downbeats[0])) : 0;
  const beat = (k: number): number => {
    if (n === 0) return k * period;
    if (k <= 0) return beats[0] + k * period;
    if (k >= n - 1) return beats[n - 1] + (k - (n - 1)) * period;
    const i = Math.floor(k), f = k - i;
    return beats[i] + f * (beats[i + 1] - beats[i]);
  };
  const indexAt = (t: number): number => {
    if (n === 0) return t / period;
    if (t <= beats[0]) return (t - beats[0]) / period;
    if (t >= beats[n - 1]) return n - 1 + (t - beats[n - 1]) / period;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (beats[mid] <= t) lo = mid; else hi = mid; }
    return lo + (t - beats[lo]) / (beats[hi] - beats[lo]);
  };
  return {
    beat,
    bar: (bar, b = 0) => beat(firstDown + bar * a.beatsPerBar + b),
    between: (t0, t1) => beats.filter((t) => t >= t0 && t < t1),
    indexAt,
  };
}
