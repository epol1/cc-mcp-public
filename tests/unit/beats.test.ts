// Spec for src/audio/beats.ts: beat, tempo and downbeat accuracy on synthesized tracks with exactly
// known beats (several genres and tempi, a drifting noisy one), the ffmpeg path end to end, and the
// snap / off-beat / grid helpers. Tracks are generated in memory; WAV/M4A fixtures go to os.tmpdir().
// The per-track accuracy table prints after the run (pass --silent=false to see it when all pass).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { analyzeBeats, analyzePcm, beatGrid, decodePcm, offBeatCuts, snapToBeats, type BeatAnalysis } from '@cc-mcp/core/audio/beats.ts';
import { realPowerSpectrum } from '@cc-mcp/core/audio/fft.ts';

// ---------------------------------------------------------------- synthesis

const SR = 22050;

function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Synth { sr: number; buf: Float32Array; rand: () => number; gauss: () => number }

function synth(seconds: number, seed: number, sr = SR): Synth {
  const rand = prng(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
  return { sr, buf: new Float32Array(Math.round(seconds * sr)), rand, gauss };
}

/** Adds gen(τ) for τ in [0, len) seconds starting at t0. */
function place(s: Synth, t0: number, len: number, gain: number, gen: (tau: number) => number): void {
  const a = Math.round(t0 * s.sr), n = Math.round(len * s.sr);
  for (let i = 0; i < n; i++) { const k = a + i; if (k >= 0 && k < s.buf.length) s.buf[k] += gain * gen(i / s.sr); }
}

function noiseSource(s: Synth, order: number): () => number {
  let p1 = 0, p2 = 0;
  return () => {
    const x = s.rand() * 2 - 1, d1 = x - p1, d2 = d1 - p2;
    p1 = x; p2 = d1;
    return order === 0 ? x : order === 1 ? d1 / 2 : d2 / 4;
  };
}

const kick = (s: Synth, t: number, g: number) => {
  let ph = 0; const click = noiseSource(s, 1);
  place(s, t, 0.35, g, (tau) => { ph += (2 * Math.PI * (48 + 110 * Math.exp(-tau / 0.03))) / s.sr; return Math.sin(ph) * Math.exp(-tau / 0.13) + (tau < 0.003 ? 0.4 * click() : 0); });
};
const snare = (s: Synth, t: number, g: number) => {
  const nz = noiseSource(s, 1);
  place(s, t, 0.25, g, (tau) => 0.8 * nz() * Math.exp(-tau / 0.07) + 0.5 * Math.sin(2 * Math.PI * 190 * tau) * Math.exp(-tau / 0.04));
};
const clap = (s: Synth, t: number, g: number) => {
  const nz = noiseSource(s, 1);
  place(s, t, 0.2, g, (tau) => { const b = [0, 0.008, 0.016].reduce((a, o) => a + (tau >= o && tau < 0.024 ? Math.exp(-(tau - o) / 0.004) : 0), 0); return nz() * (b + (tau >= 0.024 ? Math.exp(-(tau - 0.024) / 0.06) : 0)); });
};
const hat = (s: Synth, t: number, g: number, decay = 0.015) => { const nz = noiseSource(s, 2); place(s, t, Math.min(0.5, decay * 6), g, (tau) => nz() * Math.exp(-tau / decay)); };
const crash = (s: Synth, t: number, g: number) => { const nz = noiseSource(s, 2); place(s, t, 2.5, g, (tau) => nz() * Math.exp(-tau / 0.8)); };

/** Harmonic tone with a raised-cosine attack and exponential decay (piano-like when attack is short). */
function tone(s: Synth, t: number, freq: number, len: number, g: number, attack = 0.005, decay = 0.6, harmonics = 6): void {
  const amps = Array.from({ length: harmonics }, (_, h) => 1 / (h + 1) ** 1.3);
  const norm = amps.reduce((a, b) => a + b, 0);
  place(s, t, len, g / norm, (tau) => {
    const env = (tau < attack ? 0.5 - 0.5 * Math.cos((Math.PI * tau) / attack) : 1) * Math.exp(-tau / decay) * Math.min(1, (len - tau) / 0.02);
    let v = 0;
    for (let h = 0; h < harmonics; h++) if (freq * (h + 1) < s.sr / 2) v += amps[h] * Math.sin(2 * Math.PI * freq * (h + 1) * tau);
    return v * env;
  });
}

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

interface TrackTruth { name: string; pcm: Float32Array; bpm: number; beats: number[]; downbeats: number[] }

/** Beat times for a tempo curve (BPM as a function of time), first beat at `offset`. */
function beatTimes(seconds: number, offset: number, tempo: (t: number) => number): number[] {
  const out = [offset];
  let phase = 0;
  for (let t = offset, dt = 0.0005; t < seconds; t += dt) {
    phase += (tempo(t) / 60) * dt;
    if (phase >= 1) { phase -= 1; out.push(t + dt); }
  }
  return out.filter((t) => t < seconds - 0.05);
}

/** Time of fractional beat position q on the truth grid (with ± jitter seconds). */
const at = (beats: number[], q: number, jitter = 0) => {
  const i = Math.floor(q), f = q - i;
  const a = beats[Math.min(i, beats.length - 1)], b = beats[i + 1] ?? a + (a - (beats[i - 1] ?? a - 0.5));
  return a + f * (b - a) + jitter;
};

function finish(s: Synth, name: string, bpm: number, beats: number[]): TrackTruth {
  let peak = 0;
  for (const v of s.buf) peak = Math.max(peak, Math.abs(v));
  for (let i = 0; i < s.buf.length; i++) s.buf[i] *= 0.9 / peak;
  return { name, pcm: s.buf, bpm, beats, downbeats: beats.filter((_, i) => i % 4 === 0) };
}

/** Bars of four beats over the whole truth grid; fn(bar, beatIndexOfBarStart). */
const eachBar = (beats: number[], fn: (bar: number, q0: number) => void) => { for (let q0 = 0, bar = 0; q0 < beats.length; q0 += 4, bar++) fn(bar, q0); };

function house(bpm: number, seconds: number, seed: number): TrackTruth {
  const s = synth(seconds, seed), beats = beatTimes(seconds, 0.4, () => bpm);
  const j = () => 0.003 * s.gauss(), v = () => 1 + 0.08 * s.gauss();
  const roots = [45, 41, 48, 43];
  eachBar(beats, (bar, q0) => {
    const breakdown = bar % 8 === 6 || bar % 8 === 7;
    for (let k = 0; k < 4; k++) {
      if (!breakdown) kick(s, at(beats, q0 + k, j()), 1 * v());
      if (k % 2 === 1) clap(s, at(beats, q0 + k, j()), 0.45 * v());
      hat(s, at(beats, q0 + k + 0.5, j()), 0.3 * v(), 0.09);
      for (const sx of [0.25, 0.75]) hat(s, at(beats, q0 + k + sx, j()), 0.1 * v());
      if (!breakdown) tone(s, at(beats, q0 + k + 0.5, j()), midi(roots[bar % 4] - 12 + 12), 0.2, 0.35, 0.004, 0.12, 4);
    }
    for (const n of [0, 3, 7]) tone(s, at(beats, q0), midi(roots[bar % 4] + 24 + n), (60 / bpm) * 3.5, 0.12, 0.01, 1.2);
  });
  return finish(s, `house ${bpm}`, bpm, beats);
}

function hiphop(bpm: number, seconds: number, seed: number): TrackTruth {
  const s = synth(seconds, seed), beats = beatTimes(seconds, 0.3, () => bpm);
  const j = () => 0.004 * s.gauss(), v = () => 1 + 0.1 * s.gauss();
  const roots = [41, 48, 46, 50];
  eachBar(beats, (bar, q0) => {
    kick(s, at(beats, q0, j()), 1 * v());
    kick(s, at(beats, q0 + 2, j()), 0.95 * v());
    if (bar % 2 === 1) kick(s, at(beats, q0 + 2.5, j()), 0.6 * v());
    snare(s, at(beats, q0 + 1, j()), 0.8 * v());
    snare(s, at(beats, q0 + 3, j()), 0.8 * v());
    for (let k = 0; k < 4; k++) { hat(s, at(beats, q0 + k, j()), 0.22 * v()); hat(s, at(beats, q0 + k + 0.64, j()), 0.16 * v()); }
    tone(s, at(beats, q0), midi(roots[bar % 4] - 12), (60 / bpm) * 1.6, 0.5, 0.004, 0.7, 2);
    for (const n of [0, 3, 7, 10]) tone(s, at(beats, q0, j()), midi(roots[bar % 4] + 24 + n), (60 / bpm) * 4, 0.1, 0.012, 1.5);
  });
  return finish(s, `hip-hop ${bpm} swung`, bpm, beats);
}

function rock(bpm: number, seconds: number, seed: number, sr = SR): TrackTruth {
  const s = synth(seconds, seed, sr), beats = beatTimes(seconds, 0.25, () => bpm);
  const j = () => 0.005 * s.gauss(), v = () => 1 + 0.1 * s.gauss();
  const roots = [40, 48, 43, 50];
  eachBar(beats, (bar, q0) => {
    if (bar % 4 === 0) crash(s, at(beats, q0, j()), 0.35);
    kick(s, at(beats, q0, j()), 1 * v());
    kick(s, at(beats, q0 + 2, j()), 0.9 * v());
    kick(s, at(beats, q0 + 2.5, j()), 0.7 * v());
    snare(s, at(beats, q0 + 1, j()), 0.9 * v());
    snare(s, at(beats, q0 + 3, j()), 0.9 * v());
    for (let e = 0; e < 8; e++) {
      hat(s, at(beats, q0 + e / 2, j()), (e % 2 ? 0.12 : 0.2) * v());
      tone(s, at(beats, q0 + e / 2, j()), midi(roots[bar % 4] - 12), (60 / bpm) * 0.45, 0.3, 0.003, 0.2, 5);
    }
    for (const n of [0, 7, 12]) tone(s, at(beats, q0, j()), midi(roots[bar % 4] + 12 + n), (60 / bpm) * 4, 0.12, 0.006, 2, 10);
  });
  return finish(s, `rock ${bpm}`, bpm, beats);
}

function ambient(bpm: number, seconds: number, seed: number): TrackTruth {
  const s = synth(seconds, seed), beats = beatTimes(seconds, 0.5, () => bpm);
  const j = () => 0.008 * s.gauss();
  const roots = [57, 53, 60, 55], scale = [0, 2, 4, 7, 9, 12, 14];
  eachBar(beats, (bar, q0) => {
    const r = roots[bar % 4], beat = 60 / bpm;
    if (bar % 2 === 0) for (const n of [0, 4, 7]) tone(s, at(beats, q0), midi(r - 12 + n), beat * 8, 0.05, 0.9, 6, 3); // pad swell
    tone(s, at(beats, q0, j()), midi(r - 24), beat * 4, 0.25, 0.03, 2.2, 3);
    for (const n of [0, 4, 7]) tone(s, at(beats, q0, j()), midi(r + n), beat * 4, 0.16, 0.035, 2.0, 6);
    for (let k = 0; k < 4; k++) {
      tone(s, at(beats, q0 + k, j()), midi(r + 12 + scale[Math.floor(s.rand() * scale.length)]), beat * 1.5, 0.3 * (0.75 + 0.25 * s.rand()), 0.025, 0.8, 6);
      if (s.rand() < 0.2) tone(s, at(beats, q0 + k + 0.5, j()), midi(r + 12 + scale[Math.floor(s.rand() * scale.length)]), beat, 0.12, 0.03, 0.5, 6);
    }
  });
  return finish(s, `ambient piano ${bpm}`, bpm, beats);
}

function dnb(bpm: number, seconds: number, seed: number): TrackTruth {
  const s = synth(seconds, seed), beats = beatTimes(seconds, 0.2, () => bpm);
  const j = () => 0.003 * s.gauss(), v = () => 1 + 0.08 * s.gauss();
  const roots = [38, 38, 41, 36];
  eachBar(beats, (bar, q0) => {
    kick(s, at(beats, q0, j()), 1 * v());
    kick(s, at(beats, q0 + 2.5, j()), 0.9 * v());
    snare(s, at(beats, q0 + 1, j()), 0.9 * v());
    snare(s, at(beats, q0 + 3, j()), 0.9 * v());
    if (bar % 2 === 1) snare(s, at(beats, q0 + 1.75, j()), 0.25 * v());
    for (let e = 0; e < 8; e++) hat(s, at(beats, q0 + e / 2, j()), (e % 2 ? 0.22 : 0.1) * v(), e % 2 ? 0.04 : 0.015);
    if (bar % 2 === 0) for (const d of [0, 0.3]) tone(s, at(beats, q0), midi(roots[(bar >> 1) % 4] - 12) + d, (60 / bpm) * 8, 0.18, 0.05, 6, 8);
  });
  return finish(s, `drum & bass ${bpm}`, bpm, beats);
}

/** Funk/pop groove whose tempo drifts ±2 % (sinusoid, 30 s period), with white noise at ~10 dB SNR. */
function driftNoisy(bpm: number, seconds: number, seed: number): TrackTruth {
  const s = synth(seconds, seed), beats = beatTimes(seconds, 0.35, (t) => bpm * (1 + 0.02 * Math.sin((2 * Math.PI * t) / 30)));
  const j = () => 0.005 * s.gauss(), v = () => 1 + 0.1 * s.gauss();
  const roots = [43, 46, 48, 41];
  eachBar(beats, (bar, q0) => {
    kick(s, at(beats, q0, j()), 1 * v());
    kick(s, at(beats, q0 + 2, j()), 0.85 * v());
    if (bar % 2) kick(s, at(beats, q0 + 2.5, j()), 0.6 * v());
    snare(s, at(beats, q0 + 1, j()), 0.85 * v());
    snare(s, at(beats, q0 + 3, j()), 0.85 * v());
    for (let e = 0; e < 8; e++) hat(s, at(beats, q0 + e / 2, j()), (e % 2 ? 0.1 : 0.16) * v());
    for (let k = 0; k < 4; k++) tone(s, at(beats, q0 + k, j()), midi(roots[bar % 4] - 12 + (k === 3 ? 7 : 0)), 0.3, 0.35, 0.004, 0.18, 4);
  });
  let rms = 0;
  for (const x of s.buf) rms += x * x;
  rms = Math.sqrt(rms / s.buf.length);
  const nz = noiseSource(s, 0), noiseGain = (rms / 3.16) * Math.sqrt(3);
  for (let i = 0; i < s.buf.length; i++) s.buf[i] += noiseGain * nz();
  const mean = beats.slice(1).reduce((a, t, i) => a + t - beats[i], 0) / (beats.length - 1);
  return finish(s, `drift ±2% + noise ${bpm}`, 60 / mean, beats);
}

// ---------------------------------------------------------------- metrics

/** Beat F-measure with one-to-one matching inside ±tol, and the mean signed error of the matches. */
function fMeasure(ref: number[], est: number[], tol = 0.07): { f: number; precision: number; recall: number; meanErr: number } {
  const used = new Set<number>();
  let hits = 0, err = 0;
  for (const r of ref) {
    let bi = -1, bd = tol;
    est.forEach((e, i) => { const d = Math.abs(e - r); if (!used.has(i) && d <= bd) { bd = d; bi = i; } });
    if (bi >= 0) { used.add(bi); hits++; err += est[bi] - r; }
  }
  const precision = est.length ? hits / est.length : 0, recall = ref.length ? hits / ref.length : 0;
  return { f: precision + recall ? (2 * precision * recall) / (precision + recall) : 0, precision, recall, meanErr: hits ? err / hits : 0 };
}

function writeWav(file: string, pcm: Float32Array, sr: number): void {
  const data = Buffer.alloc(pcm.length * 2);
  for (let i = 0; i < pcm.length; i++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(pcm[i] * 32767))), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sr, 24);
  h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}

const report: string[] = [];
const score = (t: TrackTruth, a: Omit<BeatAnalysis, 'file'>) => {
  const m = fMeasure(t.beats, a.beats), d = fMeasure(t.downbeats, a.downbeats);
  const bpmErr = Math.abs(a.bpm / t.bpm - 1);
  report.push(`${t.name.padEnd(24)} F=${m.f.toFixed(3)} (P ${m.precision.toFixed(2)} R ${m.recall.toFixed(2)}) bpm ${a.bpm.toFixed(2)} vs ${t.bpm.toFixed(2)} (${(bpmErr * 100).toFixed(2)}%) err ${(m.meanErr * 1000).toFixed(1)} ms downbeats ${d.f.toFixed(2)} conf ${a.confidence.toFixed(2)} ${a.ms.toFixed(0)} ms`);
  return { ...m, bpmErr, downF: d.f };
};
afterAll(() => { if (report.length) console.log(`\nbeat accuracy (±70 ms)\n${report.join('\n')}`); });

// ---------------------------------------------------------------- specs

describe('fft', () => {
  it('matches a direct DFT power spectrum', () => {
    const n = 64, x = Float64Array.from({ length: n }, (_, i) => Math.sin(i * 0.7) + 0.3 * Math.cos(i * 2.1) + (i % 5) * 0.1);
    const out = new Float64Array(n / 2 + 1);
    realPowerSpectrum(n)(x, out);
    for (let k = 0; k <= n / 2; k++) {
      let re = 0, im = 0;
      for (let i = 0; i < n; i++) { re += x[i] * Math.cos((2 * Math.PI * k * i) / n); im -= x[i] * Math.sin((2 * Math.PI * k * i) / n); }
      expect(out[k]).toBeCloseTo(re * re + im * im, 6);
    }
  });
});

describe('beat tracking on synthesized genres', () => {
  const cases: { track: TrackTruth; minF: number; maxBpmErr: number; minDownF: number }[] = [
    { track: house(128, 32, 1), minF: 0.9, maxBpmErr: 0.02, minDownF: 0.75 },
    { track: house(124, 32, 2), minF: 0.9, maxBpmErr: 0.02, minDownF: 0.75 },
    { track: hiphop(90, 32, 3), minF: 0.9, maxBpmErr: 0.02, minDownF: 0.75 },
    { track: rock(110, 32, 4), minF: 0.9, maxBpmErr: 0.02, minDownF: 0.75 },
    { track: dnb(172, 32, 5), minF: 0.9, maxBpmErr: 0.02, minDownF: 0.75 },
    { track: driftNoisy(100, 40, 6), minF: 0.9, maxBpmErr: 0.02, minDownF: 0.75 },
    // Soft attacks and no drums: the looser bar the roadmap allows (it currently scores like the rest).
    { track: ambient(75, 36, 7), minF: 0.8, maxBpmErr: 0.03, minDownF: 0.5 },
  ];
  for (const c of cases) {
    it(`${c.track.name}: F ≥ ${c.minF} at ±70 ms, BPM within ${c.maxBpmErr * 100}%`, () => {
      const a = analyzePcm(c.track.pcm, SR);
      const m = score(c.track, a);
      expect(m.f).toBeGreaterThanOrEqual(c.minF);
      expect(m.bpmErr).toBeLessThanOrEqual(c.maxBpmErr);
      expect(m.downF).toBeGreaterThanOrEqual(c.minDownF);
      expect(Math.abs(m.meanErr)).toBeLessThan(0.03);
      expect(a.confidence).toBeGreaterThan(0.6);
      expect(a.offset).toBe(a.beats[0]);
      expect(a.downbeats.every((d) => a.beats.includes(d))).toBe(true);
      expect(a.onsets.length).toBeGreaterThan(a.beats.length * 0.8);
      expect(a.onsets.every((o, i) => o.strength > 0 && o.strength <= 1 && (i === 0 || o.t > a.onsets[i - 1].t))).toBe(true);
    });
  }

  it('a 3-minute track analyzes in well under 10 s and stays accurate', () => {
    // Six copies of a 30 s, 16-bar house loop (128 BPM puts exactly 64 beats in 30 s, so the grid is seamless).
    const loop = house(128, 30, 8), pcm = new Float32Array(loop.pcm.length * 6);
    for (let j = 0; j < 6; j++) pcm.set(loop.pcm, j * loop.pcm.length);
    const beats = [0, 1, 2, 3, 4, 5].flatMap((j) => loop.beats.map((b) => b + 30 * j));
    const t: TrackTruth = { name: 'house 128, 3 min', pcm, bpm: 128, beats, downbeats: beats.filter((_, i) => i % 4 === 0) };
    const a = analyzePcm(t.pcm, SR);
    const m = score(t, a);
    expect(a.ms).toBeLessThan(10_000);
    expect(m.f).toBeGreaterThanOrEqual(0.9);
    expect(m.bpmErr).toBeLessThanOrEqual(0.02);
  });

  it('puts no beats in leading/trailing silence and reports start/duration spans in PCM time', () => {
    const t = rock(110, 30, 9);
    const padded = new Float32Array(t.pcm.length + 6 * SR);
    padded.set(t.pcm, 3 * SR);
    const a = analyzePcm(padded, SR);
    expect(a.beats[0]).toBeGreaterThan(3 - 0.07);
    expect(a.beats[a.beats.length - 1]).toBeLessThan(33 + 0.07);
    expect(fMeasure(t.beats.map((b) => b + 3), a.beats).f).toBeGreaterThanOrEqual(0.9);

    const span = analyzePcm(t.pcm, SR, { start: 8, duration: 12 });
    expect(span.start).toBe(8);
    expect(span.duration).toBeCloseTo(12, 6);
    expect(span.beats.every((b) => b >= 8 && b <= 20)).toBe(true);
    expect(fMeasure(t.beats.filter((b) => b >= 8.1 && b <= 19.9), span.beats).recall).toBeGreaterThanOrEqual(0.9);
  });

  it('noise, random hits and silence get low confidence', () => {
    const s = synth(20, 10), nz = noiseSource(s, 0);
    for (let i = 0; i < s.buf.length; i++) s.buf[i] = 0.3 * nz();
    expect(analyzePcm(s.buf, SR).confidence).toBeLessThan(0.3);
    const r = synth(20, 11);
    for (let t = 0.3; t < 19; t += 0.1 + r.rand() * 0.9) place(r, t, 0.01, 0.8, () => r.rand() * 2 - 1);
    expect(analyzePcm(r.buf, SR).confidence).toBeLessThan(0.3);
    const quiet = analyzePcm(new Float32Array(SR * 5), SR);
    expect(quiet.confidence).toBe(0);
    expect(quiet.beats).toEqual([]);
    expect(analyzePcm(new Float32Array(SR), SR).bpm).toBe(0);
  });

  it('honours the tempo range: a narrower window can force the other octave', () => {
    const t = dnb(172, 24, 12);
    const half = analyzePcm(t.pcm, SR, { minBpm: 60, maxBpm: 120 });
    expect(Math.abs(half.bpm / 86 - 1)).toBeLessThan(0.02);
    expect(() => analyzePcm(t.pcm, SR, { minBpm: 150, maxBpm: 100 })).toThrow(/tempo range/);
  });
});

describe('analyzeBeats through ffmpeg', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aec-beats-'));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  const t = rock(110, 24, 13, 44100);
  const wav = path.join(dir, 'rock110.wav');
  writeWav(wav, t.pcm, 44100);

  it('decodes a 44.1 kHz WAV to 22.05 kHz mono and finds the same beats', async () => {
    const pcm = await decodePcm(wav);
    expect(Math.abs(pcm.length - 24 * 22050)).toBeLessThan(64);
    const a = await analyzeBeats(wav);
    expect(a.file).toBe(wav);
    expect(a.sampleRate).toBe(22050);
    const m = score({ ...t, name: 'rock 110 (WAV, ffmpeg)' }, a);
    expect(m.f).toBeGreaterThanOrEqual(0.9);
    expect(m.bpmErr).toBeLessThanOrEqual(0.02);
  });

  it('keeps file times when analyzing a span', async () => {
    const a = await analyzeBeats(wav, { start: 6, duration: 10 });
    expect(a.start).toBe(6);
    expect(a.beats.every((b) => b >= 6 && b <= 16)).toBe(true);
    expect(fMeasure(t.beats.filter((b) => b >= 6.1 && b <= 15.9), a.beats).recall).toBeGreaterThanOrEqual(0.9);
  });

  it('an AAC/M4A encode lands on the same beats (encoder delay compensated)', async () => {
    const m4a = path.join(dir, 'rock110.m4a');
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', wav, '-c:a', 'aac', '-b:a', '160k', m4a], { windowsHide: true });
    const a = await analyzeBeats(m4a);
    const m = score({ ...t, name: 'rock 110 (AAC, ffmpeg)' }, a);
    expect(m.f).toBeGreaterThanOrEqual(0.9);
    expect(Math.abs(m.meanErr)).toBeLessThan(0.03);
  });

  it('a missing file rejects with the ffmpeg message', async () => {
    await expect(decodePcm(path.join(dir, 'nope.mp3'))).rejects.toThrow(/could not decode/);
  });
});

describe('snapToBeats', () => {
  const beats = [1, 1.5, 2, 2.5, 3];
  it('snaps within tolerance and reports the signed offset and beat index', () => {
    expect(snapToBeats(1.55, beats)).toEqual({ t: 1.5, snapped: true, offBy: expect.closeTo(0.05, 9), beat: 1 });
    expect(snapToBeats(1.96, beats)).toEqual({ t: 2, snapped: true, offBy: expect.closeTo(-0.04, 9), beat: 2 });
    const far = snapToBeats(1.75, beats, { tolerance: 0.1 });
    expect(far.snapped).toBe(false);
    expect(far.t).toBe(1.75);
    expect(Math.abs(far.offBy)).toBeCloseTo(0.25, 9);
  });
  it('subdivisions snap to eighths and sixteenths with fractional beat indices', () => {
    expect(snapToBeats(1.74, beats, { subdivision: 2 })).toEqual({ t: 1.75, snapped: true, offBy: expect.closeTo(-0.01, 9), beat: 1.5 });
    expect(snapToBeats(2.13, beats, { subdivision: 4 })).toEqual({ t: 2.125, snapped: true, offBy: expect.closeTo(0.005, 9), beat: 2.25 });
    expect(snapToBeats(2.4, beats, { subdivision: 4 }).t).toBe(2.375);
  });
  it('outside the grid it snaps only to the end beats; no beats means no snap', () => {
    expect(snapToBeats(0.95, beats).t).toBe(1);
    expect(snapToBeats(5, beats).snapped).toBe(false);
    expect(snapToBeats(1, [])).toEqual({ t: 1, snapped: false, offBy: Infinity, beat: -1 });
  });
});

describe('offBeatCuts', () => {
  const beats = [0, 0.5, 1, 1.5, 2];
  it('flags cuts just off a beat, not on-beat cuts or cuts far from any beat', () => {
    const cuts = [0.5, 1.02, 1.08, 1.25, 1.62, 2.14, 2.4];
    expect(offBeatCuts(cuts, beats)).toEqual([
      { t: 1.08, nearest: 1, offBy: expect.closeTo(0.08, 9) },
      { t: 1.62, nearest: 1.5, offBy: expect.closeTo(0.12, 9) },
      { t: 2.14, nearest: 2, offBy: expect.closeTo(0.14, 9) },
    ]);
  });
  it('window and tolerance are adjustable', () => {
    expect(offBeatCuts([1.08], beats, { tolerance: 0.1 })).toEqual([]);
    expect(offBeatCuts([1.2], beats, { window: 0.25 })).toHaveLength(1);
    expect(offBeatCuts([1.2], [])).toEqual([]);
  });
});

describe('beatGrid', () => {
  const a = { beats: [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5], downbeats: [1, 3, 5], bpm: 120, beatsPerBar: 4 };
  const g = beatGrid(a);
  it('addresses beats by index, interpolating and extrapolating at the tempo', () => {
    expect(g.beat(0)).toBe(0.5);
    expect(g.beat(3)).toBe(2);
    expect(g.beat(2.5)).toBe(1.75);
    expect(g.beat(-1)).toBe(0);
    expect(g.beat(10)).toBe(5.5);
    expect(g.indexAt(1.75)).toBe(2.5);
    expect(g.indexAt(5.5)).toBe(10);
  });
  it('bars count from the first downbeat', () => {
    expect(g.bar(0)).toBe(1);
    expect(g.bar(1)).toBe(3);
    expect(g.bar(1, 2)).toBe(4);
    expect(g.bar(0, -1)).toBe(0.5);
    expect(g.bar(2)).toBe(5);
  });
  it('between is half-open', () => {
    expect(g.between(1, 2.5)).toEqual([1, 1.5, 2]);
    expect(g.between(10, 20)).toEqual([]);
  });
  it('works on a real analysis', () => {
    const t = hiphop(90, 16, 14);
    const r = analyzePcm(t.pcm, SR);
    const grid = beatGrid(r);
    expect(grid.bar(0)).toBe(r.downbeats[0]);
    expect(grid.bar(1)).toBe(r.downbeats[1]);
    expect(grid.between(0, 100)).toEqual(r.beats);
  });
});
