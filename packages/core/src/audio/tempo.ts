// Tempo candidates from the onset envelope: windowed autocorrelation weighted by a log-Gaussian
// prior around 120 BPM, plus the metrical relatives (×2, ×½, ×3/2, ×2/3) that the beat tracker arbitrates.

export interface TempoCandidate { bpm: number; score: number }

export const PRIOR_BPM = 120, PRIOR_OCTAVES = 1;

/** Log-Gaussian tempo prior (1 at 120 BPM, one octave standard deviation). */
export const tempoPrior = (bpm: number): number => Math.exp(-0.5 * (Math.log2(bpm / PRIOR_BPM) / PRIOR_OCTAVES) ** 2);

/** Mean of normalized autocorrelations over ~8 s windows (half overlap), for lags 0..maxLag frames. */
export function windowedAutocorrelation(env: Float32Array, fps: number, maxLag: number, windowSeconds = 8): Float64Array {
  const len = env.length, win = Math.min(len, Math.max(maxLag * 2, Math.round(windowSeconds * fps)));
  const acc = new Float64Array(maxLag + 1);
  if (len < 4) return acc;
  const step = Math.max(1, win >> 1), x = new Float64Array(win);
  let windows = 0;
  for (let s = 0; s + win <= len; s += step) {
    let mean = 0;
    for (let i = 0; i < win; i++) mean += env[s + i];
    mean /= win;
    let e = 0;
    for (let i = 0; i < win; i++) { x[i] = env[s + i] - mean; e += x[i] * x[i]; }
    if (e <= 1e-12) continue;
    for (let lag = 0; lag <= maxLag && lag < win; lag++) {
      let r = 0;
      for (let i = 0; i + lag < win; i++) r += x[i] * x[i + lag];
      acc[lag] += r / e;
    }
    windows++;
  }
  if (windows > 0) for (let lag = 0; lag <= maxLag; lag++) acc[lag] /= windows;
  return acc;
}

/**
 * How periodic the envelope is at a tempo: the best normalized autocorrelation at 1, 2 or 4 beats
 * (±2 % for drift). Around 0 for noise or unrelated hits, 0.3–0.8 for music with a pulse.
 */
export function periodicity(env: Float32Array, fps: number, bpm: number): number {
  if (!(bpm > 0)) return 0;
  const lag = (60 * fps) / bpm, ac = windowedAutocorrelation(env, fps, Math.ceil(4 * lag * 1.02) + 1);
  let best = 0;
  for (const k of [1, 2, 4]) for (let x = Math.floor(k * lag * 0.98); x <= Math.ceil(k * lag * 1.02); x++) if (x < ac.length) best = Math.max(best, ac[x]);
  return best;
}

const sampleAt = (a: Float64Array, x: number): number => {
  const i = Math.floor(x), f = x - i;
  if (i < 0) return a[0];
  if (i >= a.length - 1) return a[a.length - 1];
  return a[i] * (1 - f) + a[i + 1] * f;
};

/** Prior-weighted autocorrelation peaks inside [minBpm, maxBpm], best first, with their metrical relatives. */
export function tempoCandidates(env: Float32Array, fps: number, minBpm: number, maxBpm: number, peaks = 3): TempoCandidate[] {
  const maxLag = Math.ceil((60 * fps) / minBpm) + 2;
  const ac = windowedAutocorrelation(env, fps, maxLag);
  const grid: TempoCandidate[] = [];
  for (let bpm = minBpm; bpm <= maxBpm + 1e-9; bpm += 0.25) grid.push({ bpm, score: Math.max(0, sampleAt(ac, (60 * fps) / bpm)) * tempoPrior(bpm) });
  const maxima = grid.filter((g, i) => g.score > 0 && (i === 0 || g.score >= grid[i - 1].score) && (i === grid.length - 1 || g.score > grid[i + 1].score));
  maxima.sort((a, b) => b.score - a.score);
  const scoreOf = (bpm: number) => Math.max(0, sampleAt(ac, (60 * fps) / bpm)) * tempoPrior(bpm);
  const out: TempoCandidate[] = [];
  const add = (bpm: number) => {
    if (bpm < minBpm - 1e-9 || bpm > maxBpm + 1e-9) return;
    if (out.some((c) => Math.abs(Math.log(c.bpm / bpm)) < 0.03)) return;
    out.push({ bpm, score: scoreOf(bpm) });
  };
  for (const m of maxima.slice(0, peaks)) add(m.bpm);
  for (const m of maxima.slice(0, peaks)) for (const r of [2, 0.5, 1.5, 2 / 3]) add(m.bpm * r);
  if (out.length === 0) add((minBpm * maxBpm) ** 0.5);
  return out;
}
