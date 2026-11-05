// Onset analysis for beat detection: STFT → log band energies → band-weighted spectral flux,
// plus adaptive-threshold peak picking that turns the flux envelope into discrete onsets.
import { realPowerSpectrum } from './fft.ts';

export interface SpectralFlux {
  /** Envelope frames per second (sampleRate / hop). */
  fps: number;
  hop: number;
  /** FFT size. */
  n: number;
  frames: number;
  /** Band-weighted (lows ×2) half-wave-rectified log spectral flux; frame m is centered at m·hop. */
  flux: Float32Array;
  /** The same flux over the bands below 150 Hz (kick and bass): drives downbeat detection. */
  lowFlux: Float32Array;
  /** Log-compressed band energies, row-major [frame][band]. */
  bandLog: Float32Array;
  bands: number;
}

export interface Onset { t: number; strength: number }

/** Soft log compression knee: energies 1/COMPRESSION below the loudest band frame map to ≈ log 2. */
const COMPRESSION = 1e4;
const LOW_WEIGHT_HZ = 200, LOW_BAND_HZ = 150;
/**
 * Flux compares each frame with the maximum of the previous few frames (~46 ms), not just the last
 * one: a rising attack still counts in full, but band energy that only wobbles (partials beating
 * inside a band, noise, tremolo) never exceeds its own recent maximum and adds nothing.
 */
const MAX_LAG_FRAMES = 4;

/** FFT size giving ~46 ms frames at any sample rate (1024 at 22.05 kHz). */
export const fftSizeFor = (sampleRate: number): number => 2 ** Math.round(Math.log2(sampleRate / 21.5));

/** Third-octave band edges in FFT bins, starting at bin 1, each band at least one bin wide. */
function bandEdges(n: number, sampleRate: number): number[] {
  const binHz = sampleRate / n, last = n >> 1;
  const edges = [1];
  for (let f = 40; f < sampleRate / 2; f *= 2 ** (1 / 3)) {
    const b = Math.max(edges[edges.length - 1] + 1, Math.round(f / binHz));
    if (b >= last) break;
    edges.push(b);
  }
  edges.push(last + 1);
  return edges;
}

function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/** Band energies per frame (centered frames, zero padded at the edges). */
function bandEnergies(pcm: Float32Array, n: number, hop: number, edges: number[]): { energy: Float32Array; frames: number } {
  const bands = edges.length - 1, frames = Math.floor(pcm.length / hop) + 1;
  const spectrum = realPowerSpectrum(n), win = hann(n);
  const frame = new Float64Array(n), power = new Float64Array((n >> 1) + 1);
  const energy = new Float32Array(frames * bands);
  for (let m = 0; m < frames; m++) {
    const s0 = m * hop - (n >> 1);
    for (let i = 0; i < n; i++) { const s = s0 + i; frame[i] = s >= 0 && s < pcm.length ? pcm[s] * win[i] : 0; }
    spectrum(frame, power);
    for (let b = 0; b < bands; b++) {
      let e = 0;
      for (let k = edges[b]; k < edges[b + 1]; k++) e += power[k];
      energy[m * bands + b] = e;
    }
  }
  return { energy, frames };
}

/** Spectral flux envelope of mono PCM. */
export function spectralFlux(pcm: Float32Array, sampleRate: number): SpectralFlux {
  const n = fftSizeFor(sampleRate), hop = n >> 2;
  const edges = bandEdges(n, sampleRate), bands = edges.length - 1, binHz = sampleRate / n;
  const { energy, frames } = bandEnergies(pcm, n, hop, edges);
  let peak = 0;
  for (let i = 0; i < energy.length; i++) if (energy[i] > peak) peak = energy[i];
  const gain = peak > 0 ? COMPRESSION / peak : 0;
  const bandLog = new Float32Array(energy.length);
  for (let i = 0; i < energy.length; i++) bandLog[i] = Math.log1p(gain * energy[i]);

  const centerHz = edges.slice(0, -1).map((e, b) => ((e + edges[b + 1] - 1) / 2) * binHz);
  const weight = centerHz.map((f) => (f < LOW_WEIGHT_HZ ? 2 : 1));
  const low = centerHz.map((f) => f < LOW_BAND_HZ);
  const wSum = weight.reduce((a, b) => a + b, 0), lowCount = Math.max(1, low.filter(Boolean).length);
  const flux = new Float32Array(frames), lowFlux = new Float32Array(frames);
  for (let m = 1; m < frames; m++) {
    let f = 0, lf = 0;
    for (let b = 0; b < bands; b++) {
      let recent = -Infinity;
      for (let k = 1; k <= MAX_LAG_FRAMES && k <= m; k++) recent = Math.max(recent, bandLog[(m - k) * bands + b]);
      const d = bandLog[m * bands + b] - recent;
      if (d <= 0) continue;
      f += weight[b] * d;
      if (low[b]) lf += d;
    }
    flux[m] = f / wSum;
    lowFlux[m] = lf / lowCount;
  }
  return { fps: sampleRate / hop, hop, n, frames, flux, lowFlux, bandLog, bands };
}

/** Value at the q-quantile (0..1) of a numeric array (copy-sorted). */
export function quantile(values: ArrayLike<number>, q: number): number {
  if (values.length === 0) return 0;
  const s = Float64Array.from(values).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
}

/** Sub-frame peak position by parabolic interpolation around index i (returns i + δ, |δ| ≤ 0.5). */
export function parabolicPeak(env: ArrayLike<number>, i: number): number {
  if (i <= 0 || i >= env.length - 1) return i;
  const a = env[i - 1], b = env[i], c = env[i + 1], den = a - 2 * b + c;
  if (den >= 0) return i;
  return i + Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den));
}

/**
 * Peak picking: local maxima within ±30 ms that exceed the ±100 ms moving mean by `delta`
 * (envelope normalized so its strong peaks sit near 1), at least 30 ms apart.
 * `lagSeconds` is added to every onset time (the flux peaks slightly before the audible attack).
 */
export function pickOnsets(flux: Float32Array, fps: number, lagSeconds = 0, delta = 0.06): Onset[] {
  const len = flux.length;
  const smooth = new Float32Array(len);
  for (let i = 0; i < len; i++) smooth[i] = (flux[Math.max(0, i - 1)] + 2 * flux[i] + flux[Math.min(len - 1, i + 1)]) / 4;
  const maxima: number[] = [];
  for (let i = 1; i < len - 1; i++) if (smooth[i] > smooth[i - 1] && smooth[i] >= smooth[i + 1]) maxima.push(smooth[i]);
  const norm = quantile(maxima, 0.98) || 1;
  const pre = Math.max(1, Math.round(0.03 * fps)), avg = Math.max(1, Math.round(0.1 * fps)), wait = Math.max(1, Math.round(0.03 * fps));
  const prefix = new Float64Array(len + 1);
  for (let i = 0; i < len; i++) prefix[i + 1] = prefix[i] + smooth[i];
  const out: Onset[] = [];
  let lastIdx = -Infinity;
  for (let i = 1; i < len - 1; i++) {
    const v = smooth[i];
    if (v <= 0) continue;
    let isMax = true;
    for (let j = Math.max(0, i - pre); j <= Math.min(len - 1, i + pre) && isMax; j++) if (smooth[j] > v || (smooth[j] === v && j < i)) isMax = false;
    if (!isMax) continue;
    const a = Math.max(0, i - avg), b = Math.min(len, i + avg + 1);
    const mean = (prefix[b] - prefix[a]) / (b - a);
    if (v / norm < mean / norm + delta || i - lastIdx < wait) continue;
    out.push({ t: parabolicPeak(smooth, i) / fps + lagSeconds, strength: Math.min(1, v / norm) });
    lastIdx = i;
  }
  return out;
}
