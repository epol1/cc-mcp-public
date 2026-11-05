// Word boundaries from the audio itself. Whisper places word starts early (measured 0.2–0.3 s in normal speech and
// up to ~1 s after a long pause, D108), which would clip onsets at a cut. Here every boundary is snapped to the
// loudness envelope: a word starts where the sound rises out of the noise floor and ends where it falls back.
import { execFile } from 'node:child_process';
import type { Word } from './types.ts';

/** Loudness in dB per hop (default 10 ms), from 16 kHz mono PCM decoded by ffmpeg. */
export interface Envelope { hop: number; db: Float32Array; floor: number; speech: number }

export function decodePcm16k(file: string, opts: { start?: number; duration?: number } = {}): Promise<Float32Array> {
  const args = ['-nostdin', '-v', 'error'];
  if (opts.start) args.push('-ss', String(opts.start));
  args.push('-i', file);
  if (opts.duration) args.push('-t', String(opts.duration));
  args.push('-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', '-');
  return new Promise((res, rej) => {
    execFile('ffmpeg', args, { encoding: 'buffer', maxBuffer: 2 ** 31, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return rej(new Error(`ffmpeg could not decode ${file}: ${String(stderr).slice(-300)}`));
      const b = stdout as Buffer;
      res(new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4)).slice());
    });
  });
}

export function envelope(pcm: Float32Array, rate = 16000, hop = 0.01): Envelope {
  const n = Math.round(rate * hop), frames = Math.floor(pcm.length / n);
  const db = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let k = f * n, e = k + n; k < e; k++) s += pcm[k] * pcm[k];
    db[f] = 10 * Math.log10(s / n + 1e-12);
  }
  const sorted = Array.from(db).sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? -120;
  const floor = q(0.1), loud = q(0.9);
  // Speech threshold between room tone and typical speech level: at least 8 dB over the floor.
  const speech = floor + Math.max(8, (loud - floor) * 0.3);
  return { hop, db, floor, speech };
}

export interface RefineOptions {
  /** How far before a recognizer start to look for an earlier onset, seconds. */
  lookBack?: number;
  /** How far after a recognizer start an onset may be, seconds (Whisper's early bias after pauses). */
  lookAhead?: number;
  /** Kept before an onset / after an offset so plosives and breaths aren't clipped, seconds. */
  attack?: number;
  release?: number;
}

/**
 * Snap word starts to energy onsets and ends to offsets. Words keep their order; a word never starts before the
 * previous one ends. The recognizer's times stay in `raw`.
 */
export function refineWords(words: Word[], env: Envelope, o: RefineOptions = {}): Word[] {
  const lookBack = o.lookBack ?? 0.15, lookAhead = o.lookAhead ?? 1.2, attack = o.attack ?? 0.03, release = o.release ?? 0.05;
  const { db, hop, speech } = env;
  const at = (t: number) => db[Math.max(0, Math.min(db.length - 1, Math.round(t / hop)))] ?? -120;
  const loud = (t: number) => at(t) >= speech;
  const out = words.map((w) => ({ ...w, raw: w.raw ?? [w.start, w.end] as [number, number] }));
  for (let i = 0; i < out.length; i++) {
    const w = out[i];
    const prevEnd = i ? out[i - 1].end : 0;
    const [rs, re] = w.raw!;
    const nextRaw = out[i + 1]?.raw?.[0] ?? Infinity;
    // A word quieter than the speech threshold everywhere in and just after its span (a soft word, a whisper) keeps
    // the recognizer's times: there is no onset to snap to.
    let anyLoud = false;
    for (let t = rs; t <= Math.min(re + lookAhead * 0.5, nextRaw); t += hop) if (loud(t)) { anyLoud = true; break; }
    if (!anyLoud) { w.start = round3(Math.max(rs, prevEnd)); w.end = round3(Math.max(re, w.start + hop)); continue; }
    let start = rs;
    if (!loud(rs)) {
      // Starts in silence: move to the first loud frame (Whisper's early start), never onto the next word.
      const limit = Math.min(re + lookAhead * 0.5, rs + lookAhead, nextRaw - hop);
      let t = rs;
      while (t < limit && !loud(t)) t += hop;
      if (t < limit) start = Math.max(prevEnd, t - attack);
    } else {
      // Starts in sound: walk back to where the sound began, but not into the previous word.
      let t = rs;
      while (t > rs - lookBack && t - hop > prevEnd && loud(t - hop)) t -= hop;
      start = Math.max(prevEnd, t - attack);
    }
    let end = Math.max(re, start + hop);
    if (!loud(end)) {
      let t = end;
      while (t > start + hop && !loud(t)) t -= hop;
      end = t + release;
    } else {
      const next = out[i + 1]?.raw?.[0] ?? Infinity;
      let t = end;
      while (t < end + 0.3 && t + hop < next && loud(t + hop)) t += hop;
      end = t + release;
    }
    w.start = round3(start);
    w.end = round3(Math.max(end, start + hop));
  }
  // Keep order: an end never runs past the next start.
  for (let i = 0; i + 1 < out.length; i++) if (out[i].end > out[i + 1].start) out[i].end = round3(Math.max(out[i].start + hop, out[i + 1].start));
  return out;
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** Quietest point between two times (for placing a cut inside a gap), seconds. */
export function quietestBetween(env: Envelope, a: number, b: number): number {
  if (b <= a) return a;
  let best = a, min = Infinity;
  for (let t = a; t <= b; t += env.hop) {
    const v = env.db[Math.round(t / env.hop)] ?? -120;
    if (v < min) { min = v; best = t; }
  }
  return round3(best);
}
