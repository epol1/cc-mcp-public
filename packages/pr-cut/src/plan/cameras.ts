// Camera awareness for switched multi-camera programs (a live show or podcast master): tiny frames sampled around
// the cut points tell whether both sides of a cut show the same camera. In a program that already cuts between
// cameras, a cut that stays on one camera reads as a jump, and a punch-in doesn't hide it (the user's note on the
// KATG cut). Frames are 32×18 RGB at 5 per second, decoded only in the windows a plan uses, cached on disk.
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const W = 32, H = 18, RATE = 5, BYTES = W * H * 3;
const CACHE = path.join(os.homedir(), '.ae-compose', 'cache', 'camera-frames');

export interface CameraProbe {
  /** Decode (or load) the frames of a source window, seconds. */
  ensure(from: number, to: number): Promise<void>;
  /** The source is a switched program: camera cuts in what was sampled (at least 2, about one a minute or more). */
  isProgram(): boolean;
  /** Both moments show the same camera (false when either wasn't sampled). */
  sameCamera(a: number, b: number): boolean;
  /**
   * Start of a `len`-second stretch inside one shot (0.4 s clear of its camera cuts), unlike the frames at `avoid`,
   * outside the `used` source ranges, nearest to `near` (within `within` s).
   */
  cutaway(near: number, avoid: number[], len: number, within: number, used?: [number, number][]): number | null;
}

type Win = { from: number; frames: Uint8Array[] };

function run(args: string[]): Promise<Buffer> {
  return new Promise((res, rej) => execFile('ffmpeg', args, { encoding: 'buffer', maxBuffer: 2 ** 30, windowsHide: true, timeout: 600_000 }, (e, so, se) => (e ? rej(new Error(`ffmpeg: ${String(se).slice(-300)}`)) : res(so))));
}

const dist = (a: Uint8Array, b: Uint8Array) => { let s = 0; for (let i = 0; i < BYTES; i++) s += Math.abs(a[i] - b[i]); return s / BYTES; };

export function cameraProbe(file: string): CameraProbe {
  const wins: Win[] = [];
  let st: { size: number; mtime: number } | null = null;
  const key = (from: number, dur: number) => {
    st ??= (() => { const s = fs.statSync(file); return { size: s.size, mtime: Math.round(s.mtimeMs) }; })();
    return crypto.createHash('sha1').update(`${path.resolve(file)}|${st.size}|${st.mtime}|${from.toFixed(1)}|${dur.toFixed(1)}`).digest('hex');
  };
  const frameAt = (t: number): Uint8Array | null => {
    for (const w of wins) { const i = Math.round((t - w.from) * RATE); if (i >= 0 && i < w.frames.length) return w.frames[i]; }
    return null;
  };
  // Consecutive differences per window: the camera cuts are the outliers.
  const stats = () => {
    const d: number[] = [];
    for (const w of wins) for (let i = 1; i < w.frames.length; i++) d.push(dist(w.frames[i - 1], w.frames[i]));
    const sorted = [...d].sort((x, y) => x - y);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const cutT = Math.max(12, median * 5);
    const cuts = d.filter((x) => x > cutT);
    const cm = [...cuts].sort((x, y) => x - y)[Math.floor(cuts.length / 2)] ?? 30;
    return { cutT, sameT: Math.min(40, Math.max(10, cm * 0.5)), cuts: cuts.length, seconds: d.length / RATE };
  };
  let cached: ReturnType<typeof stats> | null = null;
  const S = () => (cached ??= stats());
  return {
    async ensure(from, to) {
      from = Math.max(0, Math.floor(from)); to = Math.ceil(to);
      // Only the parts not sampled yet.
      const covered = (t: number) => wins.some((w) => t >= w.from && t < w.from + w.frames.length / RATE);
      let a = from;
      while (a < to) {
        while (a < to && covered(a)) a += 1;
        if (a >= to) break;
        let b = a;
        while (b < to && !covered(b)) b += 1;
        const dur = b - a, k = key(a, dur), f = path.join(CACHE, `${k}.bin`);
        let buf: Buffer;
        if (fs.existsSync(f)) buf = fs.readFileSync(f);
        else {
          buf = await run(['-v', 'error', '-ss', String(a), '-t', String(dur), '-i', file, '-an', '-vf', `fps=${RATE},scale=${W}:${H}:flags=area`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-']);
          fs.mkdirSync(CACHE, { recursive: true });
          fs.writeFileSync(f, buf);
        }
        const frames: Uint8Array[] = [];
        for (let o = 0; o + BYTES <= buf.length; o += BYTES) frames.push(new Uint8Array(buf.buffer, buf.byteOffset + o, BYTES));
        if (frames.length) wins.push({ from: a, frames });
        cached = null;
        a = b;
      }
    },
    isProgram() { const s = S(); return s.cuts >= 2 && s.cuts / (s.seconds / 60) >= 0.75; },
    sameCamera(a, b) {
      const fa = frameAt(a), fb = frameAt(b);
      return !!fa && !!fb && dist(fa, fb) < S().sameT;
    },
    cutaway(near, avoid, len, within, used = []) {
      const s = S(), av = avoid.map(frameAt).filter((x): x is Uint8Array => !!x), n = Math.ceil(len * RATE), m = 2;
      let best: number | null = null;
      for (const w of wins) {
        for (let i = m; i + n + m < w.frames.length; i++) {
          const t = w.from + i / RATE;
          if (Math.abs(t - near) > within || (best !== null && Math.abs(t - near) >= Math.abs(best - near))) continue;
          if (used.some(([x, y]) => t < y + 1 && t + len > x - 1)) continue;
          let ok = av.every((x) => dist(x, w.frames[i]) >= s.sameT && dist(x, w.frames[i + n]) >= s.sameT);
          for (let j = i - m + 1; ok && j <= i + n + m; j++) if (dist(w.frames[j - 1], w.frames[j]) > s.cutT) ok = false;
          if (ok) best = t;
        }
      }
      return best;
    },
  };
}
