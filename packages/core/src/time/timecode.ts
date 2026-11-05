// Video time for editing tools: Premiere ticks, rational frame rates, frames, and SMPTE timecode (drop-frame for
// 29.97/59.94). Premiere's tick rate (254 016 000 000 per second) makes one frame an exact integer number of ticks
// at every common rate, so all conversions go through integer frames and never accumulate float error.

export const TICKS_PER_SECOND = 254_016_000_000;

/** A frame rate as a fraction: 24000/1001 is 23.976. */
export interface Rate { num: number; den: number }

const KNOWN: Record<string, Rate> = {
  '23.976': { num: 24000, den: 1001 }, '23.98': { num: 24000, den: 1001 }, '24': { num: 24, den: 1 },
  '25': { num: 25, den: 1 }, '29.97': { num: 30000, den: 1001 }, '30': { num: 30, den: 1 },
  '47.952': { num: 48000, den: 1001 }, '48': { num: 48, den: 1 }, '50': { num: 50, den: 1 },
  '59.94': { num: 60000, den: 1001 }, '60': { num: 60, den: 1 }, '119.88': { num: 120000, den: 1001 }, '120': { num: 120, den: 1 },
};

/** A rate from "23.976", 29.97, "30000/1001", ffprobe's "24000/1001", or ticks per frame from Premiere's `timebase`. */
export function rate(r: number | string | Rate): Rate {
  if (typeof r === 'object') return r;
  const s = String(r).trim();
  const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(s);
  if (frac) {
    // "2997/100" or "30000/1001.0"-style fractions of a standard rate become that rate (integer ticks per frame).
    const v = +frac[1] / +frac[2];
    for (const [k, known] of Object.entries(KNOWN)) if (Math.abs(v - Number(k)) < 0.006 && (known.num / known.den) !== v) return known;
    return { num: +frac[1], den: +frac[2] };
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`frame rate "${r}" is not a number or fraction`);
  if (n > 1e6) return fromTicksPerFrame(n);
  for (const [k, v] of Object.entries(KNOWN)) if (Math.abs(n - Number(k)) < 0.006) return v;
  // NTSC-style rates not in the table: x * 1000/1001 when close, else an exact rational for the decimal.
  const ntsc = Math.round(n * 1.001);
  if (Math.abs(n - (ntsc * 1000) / 1001) < 0.002) return { num: ntsc * 1000, den: 1001 };
  return { num: Math.round(n * 1000), den: 1000 };
}

/** Premiere's `sequence.timebase` (ticks per frame) as a rate. */
export function fromTicksPerFrame(tpf: number | string): Rate {
  const t = Number(tpf);
  for (const v of Object.values(KNOWN)) if (ticksPerFrame(v) === t) return v;
  return { num: TICKS_PER_SECOND, den: t };
}

export const fps = (r: Rate) => r.num / r.den;
/** Exact ticks per frame (an integer for every rate in the table). */
export const ticksPerFrame = (r: Rate) => (TICKS_PER_SECOND * r.den) / r.num;
/** NTSC flag and integer timebase, as FCP7 XML writes rates (23.976 → timebase 24, ntsc TRUE). */
export function xmlRate(r: Rate): { timebase: number; ntsc: boolean } {
  return { timebase: Math.round(fps(r)), ntsc: r.den === 1001 };
}
export const isDropFrameRate = (r: Rate) => r.den === 1001 && (Math.round(fps(r)) % 30 === 0);

export const framesToTicks = (frames: number, r: Rate) => Math.round(frames) * ticksPerFrame(r);
export const framesToSeconds = (frames: number, r: Rate) => (frames * r.den) / r.num;
export const ticksToSeconds = (ticks: number | string) => Number(ticks) / TICKS_PER_SECOND;
export const secondsToTicks = (s: number) => Math.round(s * TICKS_PER_SECOND);

export type Rounding = 'round' | 'floor' | 'ceil';
/** Seconds → whole frames. `floor` for a cut that must not include the next frame, `ceil` to keep a whole word. */
export function secondsToFrames(s: number, r: Rate, mode: Rounding = 'round'): number {
  const f = (s * r.num) / r.den;
  const e = 1e-6; // float noise: 1.001 s at 23.976 is exactly frame 24, not 23.9999999
  return mode === 'floor' ? Math.floor(f + e) : mode === 'ceil' ? (Math.ceil(f - e) || 0) : Math.round(f);
}
export function ticksToFrames(ticks: number | string, r: Rate, mode: Rounding = 'round'): number {
  const f = Number(ticks) / ticksPerFrame(r);
  const e = 1e-6;
  return mode === 'floor' ? Math.floor(f + e) : mode === 'ceil' ? (Math.ceil(f - e) || 0) : Math.round(f);
}

/**
 * Frames → SMPTE timecode. Drop-frame (29.97/59.94, `;` separator) skips frame numbers 0–1 (0–3 at 59.94) at the
 * start of every minute except each tenth, so the label tracks wall-clock time.
 */
export function framesToTimecode(frames: number, r: Rate, opts: { dropFrame?: boolean } = {}): string {
  const base = Math.round(fps(r));
  const df = (opts.dropFrame ?? isDropFrameRate(r)) && isDropFrameRate(r);
  let f = Math.round(frames);
  const neg = f < 0;
  if (neg) f = -f;
  if (df) {
    const drop = Math.round(base / 15); // 2 at 29.97, 4 at 59.94
    const perMin = base * 60 - drop;
    const per10 = perMin * 10 + drop;
    const d = Math.floor(f / per10), m = f % per10;
    f += drop * 9 * d + (m > drop ? drop * Math.floor((m - drop) / perMin) : 0);
  }
  const ff = f % base, s = Math.floor(f / base) % 60, mi = Math.floor(f / (base * 60)) % 60, h = Math.floor(f / (base * 3600));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${neg ? '-' : ''}${p(h)}:${p(mi)}:${p(s)}${df ? ';' : ':'}${p(ff)}`;
}

/** SMPTE timecode → frames. `;` or `.` before the frames field (or `dropFrame: true`) means drop-frame. */
export function timecodeToFrames(tc: string, r: Rate, opts: { dropFrame?: boolean } = {}): number {
  const m = /^(-)?(\d{1,2})[:;.](\d{2})[:;.](\d{2})([:;.])(\d{2,3})$/.exec(tc.trim());
  if (!m) throw new Error(`timecode "${tc}" is not HH:MM:SS:FF`);
  const [, neg, H, M, S, sep, F] = m;
  const base = Math.round(fps(r));
  if (+F >= base) throw new Error(`timecode "${tc}": frame ${F} is out of range at ${base} fps`);
  const df = (opts.dropFrame ?? (sep === ';' || sep === '.')) && isDropFrameRate(r);
  const totalMin = +H * 60 + +M;
  let frames = ((+H * 3600 + +M * 60 + +S) * base) + +F;
  if (df) {
    const drop = Math.round(base / 15);
    if (+S === 0 && +F < drop && +M % 10 !== 0) throw new Error(`timecode "${tc}" does not exist in drop-frame (frames 0–${drop - 1} are skipped at that minute)`);
    frames -= drop * (totalMin - Math.floor(totalMin / 10));
  }
  return neg ? -frames : frames;
}

/**
 * A human or tool time → seconds: a number (seconds), "3.5s", "250ms", "1:02.5" (m:ss.s), "12f" (needs `r`),
 * or SMPTE "00:03:12:04" / "00;03;12;04" (needs `r`).
 */
export function parseTime(t: number | string, r?: Rate): number {
  if (typeof t === 'number') return t;
  const s = t.trim();
  let m: RegExpExecArray | null;
  if ((m = /^(-?[\d.]+)\s*s$/.exec(s))) return +m[1];
  if ((m = /^(-?[\d.]+)\s*ms$/.exec(s))) return +m[1] / 1000;
  if ((m = /^(-?\d+)\s*f$/.exec(s))) {
    if (!r) throw new Error(`"${t}" is in frames: a frame rate is needed`);
    return framesToSeconds(+m[1], r);
  }
  if (/^-?\d{1,2}[:;.]\d{2}[:;.]\d{2}[:;.]\d{2,3}$/.test(s)) {
    if (!r) throw new Error(`"${t}" is a timecode: a frame rate is needed`);
    return framesToSeconds(timecodeToFrames(s, r), r);
  }
  if ((m = /^(-)?(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(s))) return (m[1] ? -1 : 1) * ((+(m[2] ?? 0)) * 3600 + +m[3] * 60 + +m[4]);
  if (/^-?[\d.]+$/.test(s)) return +s;
  throw new Error(`time "${t}": use seconds (3.5 or "3.5s"), "250ms", "1:02.5", "12f" or a timecode "00:00:03:12"`);
}

/** Seconds → "m:ss.s" for readable reports (transcripts, outlines). */
export function clock(s: number, digits = 1): string {
  const neg = s < 0; s = Math.abs(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const ss = sec.toFixed(digits).padStart(digits ? 3 + digits : 2, '0');
  return `${neg ? '-' : ''}${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${ss}`;
}
