// Audio sync: where one recording of an event sits in another (camera angles, a sound recorder), from their sound.
// Loudness envelopes (log RMS over 10 ms) are cross-correlated: coarse at 10 Hz over every placement, then refined at
// 100 Hz around the best one. Envelopes are cached by file identity (path, size, mtime).
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CACHE = path.join(os.homedir(), '.ae-compose', 'cache', 'envelopes');
const SR = 8000, HOP = 80; // 100 envelope points a second

/** 100 Hz loudness envelope (log RMS) of a file's sound, cached. */
export async function envelope(file: string): Promise<Float32Array> {
  const st = fs.statSync(file);
  const key = crypto.createHash('sha1').update(`${path.resolve(file)}|${st.size}|${Math.round(st.mtimeMs)}`).digest('hex');
  const f = path.join(CACHE, `${key}.f32`);
  if (fs.existsSync(f)) { const b = fs.readFileSync(f); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); }
  const pcm = await new Promise<Buffer>((res, rej) => execFile('ffmpeg', ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(SR), '-f', 's16le', '-'], { encoding: 'buffer', maxBuffer: 2 ** 31 - 1, windowsHide: true, timeout: 1_800_000 }, (e, so, se) => (e ? rej(new Error(`ffmpeg: ${String(se).slice(-300)}`)) : res(so))));
  const n = Math.floor(pcm.length / 2 / HOP), env = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < HOP; k++) { const v = pcm.readInt16LE((i * HOP + k) * 2) / 32768; s += v * v; }
    env[i] = Math.log10(Math.sqrt(s / HOP) + 1e-4);
  }
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(f, Buffer.from(env.buffer, env.byteOffset, env.byteLength));
  return env;
}

/**
 * Onsets of an envelope (rises in loudness: sharp, unlike the envelope itself, so placements don't smear), downsampled
 * by `k` keeping the strongest onset of each block, then zero-mean, unit-variance.
 */
function prep(e: Float32Array, k: number): Float32Array {
  const n = Math.floor(e.length / k), out = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < k; j++) { const x = i * k + j; const d = x ? e[x] - e[x - 1] : 0; if (d > s) s = d; } out[i] = s; }
  let m = 0; for (const v of out) m += v; m /= n || 1;
  let sd = 0; for (const v of out) sd += (v - m) ** 2; sd = Math.sqrt(sd / (n || 1)) || 1;
  for (let i = 0; i < n; i++) out[i] = (out[i] - m) / sd;
  return out;
}

/** Correlation of b placed at lag L in a (b[i] against a[i + L]), over their overlap; null when the overlap is short. */
function corr(a: Float32Array, b: Float32Array, L: number, minOverlap: number): number | null {
  const i0 = Math.max(0, -L), i1 = Math.min(b.length, a.length - L);
  if (i1 - i0 < minOverlap) return null;
  let s = 0;
  for (let i = i0; i < i1; i++) s += a[i + L] * b[i];
  return s / (i1 - i0);
}

export interface SyncResult {
  /** Seconds to add to a time in `other` to get the same moment in `ref` (t_ref = t_other + offset). */
  offset: number;
  /** Correlation at the best placement (about 0.3+ for the same event, near 0 for unrelated sound). */
  score: number;
  /** Best score over the best score at least 10 s away from it; above ~1.5 the match is unambiguous. */
  confidence: number;
}

/** Where `other` sits in `ref`, by their sound. `maxOffset` limits the search (seconds; default: every placement). */
export async function syncOffset(ref: string, other: string, opts: { maxOffset?: number } = {}): Promise<SyncResult> {
  const [er, eo] = await Promise.all([envelope(ref), envelope(other)]);
  return syncEnvelopes(er, eo, opts);
}

export function syncEnvelopes(er: Float32Array, eo: Float32Array, opts: { maxOffset?: number } = {}): SyncResult {
  // Coarse: 10 Hz, every placement where at least half the shorter recording (or 20 s) overlaps.
  const a = prep(er, 10), b = prep(eo, 10);
  const minOv = Math.max(200, Math.floor(Math.min(a.length, b.length) / 2));
  const lim = opts.maxOffset !== undefined ? Math.ceil(opts.maxOffset * 10) : Infinity;
  const scores: [number, number][] = [];
  for (let L = Math.max(-b.length, -lim); L <= Math.min(a.length, lim); L++) { const c = corr(a, b, L, minOv); if (c !== null) scores.push([L, c]); }
  if (!scores.length) throw new Error('the recordings are too short to compare (need 20 s of overlap)');
  scores.sort((x, y) => y[1] - x[1]);
  const [bestL, best] = scores[0];
  const second = scores.find(([L]) => Math.abs(L - bestL) > 100)?.[1] ?? 0;
  // Fine: 100 Hz within ±1 s of the coarse placement.
  const A = prep(er, 1), B = prep(eo, 1);
  let fine = bestL * 10, fineScore = -Infinity;
  for (let L = bestL * 10 - 100; L <= bestL * 10 + 100; L++) { const c = corr(A, B, L, minOv * 10); if (c !== null && c > fineScore) { fineScore = c; fine = L; } }
  return { offset: fine / 100, score: Math.round(best * 1000) / 1000, confidence: Math.round((best / Math.max(1e-3, second)) * 100) / 100 };
}
