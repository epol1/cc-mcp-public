// Beat tracking by dynamic programming (Ellis 2007): the beat sequence that best balances onset
// strength against deviation from the target period, then trimmed and refined to the onset peaks.
import { parabolicPeak } from './onset.ts';

/** Default DP tightness: how strongly inter-beat intervals are held to the target period. */
export const TIGHTNESS = 400;

/** Envelope divided by its standard deviation (the DP's score units). */
export function standardize(env: Float32Array): Float32Array {
  let mean = 0;
  for (let i = 0; i < env.length; i++) mean += env[i];
  mean /= Math.max(1, env.length);
  let v = 0;
  for (let i = 0; i < env.length; i++) v += (env[i] - mean) ** 2;
  const sd = Math.sqrt(v / Math.max(1, env.length)) || 1;
  const out = new Float32Array(env.length);
  for (let i = 0; i < env.length; i++) out[i] = env[i] / sd;
  return out;
}

/** Gaussian smoothing with σ = period/32 frames (librosa's local score). */
function localScore(env: Float32Array, period: number): Float64Array {
  const sigma = Math.max(0.5, period / 32), r = Math.ceil(3 * sigma);
  const k = new Float64Array(2 * r + 1);
  for (let i = -r; i <= r; i++) k[i + r] = Math.exp(-0.5 * (i / sigma) ** 2);
  const out = new Float64Array(env.length);
  for (let i = 0; i < env.length; i++) {
    let s = 0;
    for (let j = -r; j <= r; j++) { const t = i + j; if (t >= 0 && t < env.length) s += env[t] * k[j + r]; }
    out[i] = s;
  }
  return out;
}

/**
 * The last beat is where the cumulative score peaks. Scores are ≥ 0 and on-period transitions cost
 * ~0, so cum keeps rising through the music, stays flat through trailing silence, and a spurious
 * onset after the last true beat can only be reached by a costly warped interval.
 */
function lastBeat(cum: Float64Array): number {
  let best = 0;
  for (let i = 1; i < cum.length; i++) if (cum[i] > cum[best]) best = i;
  return best;
}

/**
 * Leading/trailing beats are dropped while their strength stays within this share of the way from
 * the score floor to the RMS beat strength: beats extrapolated into silence or noise go, quiet but
 * real pulses (a breakdown without the kick) stay.
 */
const TRIM = 0.1;

function medianOf(values: Float64Array): number {
  const s = Float64Array.from(values).sort();
  return s[s.length >> 1] ?? 0;
}

function trimBeats(beats: number[], score: Float64Array): number[] {
  if (beats.length < 3) return beats;
  const s = beats.map((b) => score[b]);
  const rms = Math.sqrt(s.reduce((a, v) => a + v * v, 0) / s.length), floor = medianOf(score);
  const thr = floor + TRIM * Math.max(0, rms - floor);
  let a = 0, b = beats.length - 1;
  while (a < b && s[a] < thr) a++;
  while (b > a && s[b] < thr) b--;
  return beats.slice(a, b + 1);
}

/** DP beat tracker. `env` is the standardized onset envelope, `period` the target beat period in frames. */
export function trackBeats(env: Float32Array, period: number, tightness = TIGHTNESS): number[] {
  const n = env.length;
  if (n < 3 || !(period > 1)) return [];
  const score = localScore(env, period);
  let maxScore = 0;
  for (let i = 0; i < n; i++) if (score[i] > maxScore) maxScore = score[i];
  if (maxScore <= 0) return [];
  const lo = Math.max(1, Math.round(period / 2)), hi = Math.max(lo + 1, Math.round(2 * period));
  const tx = new Float64Array(hi + 1);
  for (let d = lo; d <= hi; d++) tx[d] = -tightness * Math.log(d / period) ** 2;
  const cum = new Float64Array(n), back = new Int32Array(n).fill(-1);
  let first = true;
  for (let i = 0; i < n; i++) {
    let best = -Infinity, bestJ = -1;
    for (let d = lo; d <= hi; d++) {
      const j = i - d, v = tx[d] + (j >= 0 ? cum[j] : 0);
      if (v > best) { best = v; bestJ = j; }
    }
    cum[i] = score[i] + best;
    if (first && score[i] < 0.01 * maxScore) back[i] = -1;
    else { back[i] = bestJ; first = false; }
  }
  const beats = [lastBeat(cum)];
  while (back[beats[0]] >= 0) beats.unshift(back[beats[0]]);
  return trimBeats(beats, score);
}

/** Largest envelope value within ±r frames of a (fractional) frame position. */
export function peakNear(env: ArrayLike<number>, x: number, r: number): number {
  let m = 0;
  for (let i = Math.max(0, Math.round(x - r)); i <= Math.min(env.length - 1, Math.round(x + r)); i++) if (env[i] > m) m = env[i];
  return m;
}

export interface BeatSupport {
  /**
   * Mean envelope peak per metrical level: [0] on the beats, [1] on the midpoints between beats,
   * [2] on the quarter points, [3] on the eighth points (each level excludes the ones above it).
   */
  levels: number[];
  /** Median envelope peak over all frames: the level of "nothing in particular". */
  floor: number;
  /** Coefficient of variation of the inter-beat intervals. */
  cv: number;
}

/** Median of the ±r-frame envelope peak over every frame. */
export function envelopeFloor(env: Float32Array, r = 1): number {
  const v = new Float64Array(env.length);
  for (let i = 0; i < env.length; i++) v[i] = peakNear(env, i, r);
  v.sort();
  return v[v.length >> 1] ?? 0;
}

/** Metrical-level evidence for a beat sequence (fractional frame positions). */
export function beatSupport(env: Float32Array, beats: number[], floor: number, r = 1): BeatSupport {
  const levels = [0, 0, 0, 0];
  if (beats.length < 2) return { levels, floor, cv: 1 };
  let sum = 0, sq = 0;
  for (const b of beats) levels[0] += peakNear(env, b, r);
  for (let i = 0; i + 1 < beats.length; i++) {
    const a = beats[i], d = beats[i + 1] - a;
    levels[1] += peakNear(env, a + d / 2, r);
    levels[2] += (peakNear(env, a + d / 4, r) + peakNear(env, a + (3 * d) / 4, r)) / 2;
    levels[3] += [1, 3, 5, 7].reduce((s, q) => s + peakNear(env, a + (q * d) / 8, r), 0) / 4;
    sum += d; sq += d * d;
  }
  const k = beats.length - 1, mean = sum / k;
  levels[0] /= beats.length;
  for (let l = 1; l < 4; l++) levels[l] /= k;
  return { levels, floor, cv: Math.sqrt(Math.max(0, sq / k - mean * mean)) / mean };
}

/**
 * Moves each beat to the strongest onset-envelope peak within ±radius frames (sub-frame, parabolic),
 * when that peak is meaningful; otherwise keeps the DP position. Returns fractional frames.
 */
export function refineBeats(env: Float32Array, beats: number[], radius: number): number[] {
  const strengths = beats.map((b) => peakNear(env, b, radius)).sort((a, b) => a - b);
  const floor = 0.15 * (strengths[strengths.length >> 1] ?? 0);
  return beats.map((b) => {
    let bi = -1, bv = floor;
    for (let i = Math.max(1, b - radius); i <= Math.min(env.length - 2, b + radius); i++) {
      if (env[i] > bv && env[i] >= env[i - 1] && env[i] >= env[i + 1]) { bv = env[i]; bi = i; }
    }
    return bi < 0 ? b : parabolicPeak(env, bi);
  });
}
