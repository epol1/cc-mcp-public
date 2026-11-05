// Downbeat (bar phase) estimation: the beat phase with the most low-frequency onset energy
// (kick, bass) and the strongest bar-to-bar spectral change (chord and bass-note changes).
import { peakNear } from './track.ts';

export interface BarPhase { phase: number; confidence: number; scores: number[] }

/** Mean log-band spectrum over frames [a, b). */
function meanSpectrum(bandLog: Float32Array, bands: number, a: number, b: number): Float64Array {
  const out = new Float64Array(bands), lo = Math.max(0, Math.floor(a)), hi = Math.max(lo + 1, Math.floor(b));
  const frames = bandLog.length / bands;
  let count = 0;
  for (let m = lo; m < hi && m < frames; m++, count++) for (let k = 0; k < bands; k++) out[k] += bandLog[m * bands + k];
  if (count > 0) for (let k = 0; k < bands; k++) out[k] /= count;
  return out;
}

/** Per-beat novelty: L1 distance between the bar-long mean spectra after and before the beat. */
function barNovelty(beats: number[], bandLog: Float32Array, bands: number, beatsPerBar: number): number[] {
  return beats.map((_, i) => {
    if (i < beatsPerBar || i + beatsPerBar >= beats.length) return NaN;
    const before = meanSpectrum(bandLog, bands, beats[i - beatsPerBar], beats[i]);
    const after = meanSpectrum(bandLog, bands, beats[i], beats[i + beatsPerBar]);
    let d = 0;
    for (let k = 0; k < bands; k++) d += Math.abs(after[k] - before[k]);
    return d;
  });
}

const meanByPhase = (values: number[], beatsPerBar: number): number[] => {
  const sum = new Array<number>(beatsPerBar).fill(0), count = new Array<number>(beatsPerBar).fill(0);
  values.forEach((v, i) => { if (Number.isFinite(v)) { sum[i % beatsPerBar] += v; count[i % beatsPerBar]++; } });
  return sum.map((s, p) => (count[p] ? s / count[p] : 0));
};

const normalizeMax = (v: number[]): number[] => { const m = Math.max(...v); return v.map((x) => (m > 0 ? x / m : 0)); };

/** Which beat index (mod beatsPerBar) starts the bar. `beats` are fractional frame positions. */
export function barPhase(beats: number[], lowFlux: Float32Array, bandLog: Float32Array, bands: number, beatsPerBar: number): BarPhase {
  if (beatsPerBar <= 1 || beats.length < beatsPerBar * 2) return { phase: 0, confidence: 0, scores: [1] };
  const low = normalizeMax(meanByPhase(beats.map((b) => peakNear(lowFlux, b, 2)), beatsPerBar));
  const nov = normalizeMax(meanByPhase(barNovelty(beats, bandLog, bands, beatsPerBar), beatsPerBar));
  const scores = low.map((l, p) => l + nov[p]);
  const order = scores.map((s, p) => [s, p] as const).sort((a, b) => b[0] - a[0]);
  const [best, second] = [order[0][0], order[1]?.[0] ?? 0];
  return { phase: order[0][1], confidence: best > 0 ? Math.max(0, Math.min(1, (best - second) / best)) : 0, scores };
}
