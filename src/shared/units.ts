// Units: time strings, colors. Time is seconds (number) or "6s" | "400ms" | "12f" | "00:00:02:15" (hh:mm:ss:ff).

export type Time = number | string;

export function parseTime(v: Time | undefined, fps: number, fallback = 0): number {
  if (v === undefined || v === null) return fallback;
  if (typeof v === 'number') return v;
  const s = v.trim();
  // Sums ("12f+6f", "1s+200ms") let helpers add times without knowing the fps.
  const plus = s.indexOf('+', 1);
  if (plus > 0 && !/e$/i.test(s.slice(0, plus))) return parseTime(s.slice(0, plus), fps) + parseTime(s.slice(plus + 1), fps);
  const r = parseTime1(s, fps);
  if (!Number.isFinite(r)) throw new Error(`invalid time "${v}": use seconds (1.5), "1.5s", "400ms", "12f" or "hh:mm:ss:ff"`);
  return r;
}

function parseTime1(s: string, fps: number): number {
  let m: RegExpExecArray | null;
  if ((m = /^(-?[\d.]+)\s*ms$/.exec(s))) return +m[1] / 1000;
  if ((m = /^(-?[\d.]+)\s*s$/.exec(s))) return +m[1];
  if ((m = /^(-?[\d.]+)\s*f$/.exec(s))) return +m[1] / fps;
  if ((m = /^(\d+):(\d+):(\d+):(\d+)$/.exec(s))) return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / fps;
  if ((m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(s))) return +m[1] * 60 + +m[2];
  if (/^-?[\d.]+$/.test(s)) return +s;
  return NaN;
}

/** Snaps seconds to the frame grid. */
export function snapFrame(t: number, fps: number): number {
  return Math.round(t * fps) / fps;
}

export type ColorSpec = string | readonly number[];

const NAMED: Record<string, string> = {
  white: '#ffffff', black: '#000000', red: '#ff0000', green: '#00ff00', blue: '#0000ff', transparent: '#00000000',
  gray: '#808080', grey: '#808080', yellow: '#ffff00', cyan: '#00ffff', magenta: '#ff00ff', orange: '#ff8000',
};

/** Parses a color to [r, g, b, a] in 0..1. Accepts #rgb, #rrggbb, #rrggbbaa, rgb()/rgba(), hsl(), names, arrays (0..1 or 0..255). */
export function parseColor(c: ColorSpec): [number, number, number, number] {
  if (Array.isArray(c)) {
    const a = c as number[];
    const scale = a.slice(0, 3).some((x) => x > 1) ? 255 : 1;
    return [a[0] / scale, a[1] / scale, a[2] / scale, a.length > 3 ? (a[3] > 1 ? a[3] / 255 : a[3]) : 1];
  }
  let s = String(c).trim().toLowerCase();
  if (NAMED[s]) s = NAMED[s];
  let m: RegExpExecArray | null;
  if ((m = /^#([0-9a-f]{3,8})$/.exec(s))) {
    let h = m[1];
    if (h.length === 5 || h.length === 7) throw new Error(`invalid color "${c}": hex colors have 3, 4, 6 or 8 digits`);
    if (h.length === 3 || h.length === 4) h = h.split('').map((x) => x + x).join('');
    const n = (i: number) => parseInt(h.substr(i, 2), 16) / 255;
    return [n(0), n(2), n(4), h.length === 8 ? n(6) : 1];
  }
  if ((m = /^rgba?\(([^)]+)\)$/.exec(s))) {
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map((x) => (x.endsWith('%') ? (parseFloat(x) / 100) * 255 : parseFloat(x)));
    return [p[0] / 255, p[1] / 255, p[2] / 255, p.length > 3 ? (p[3] > 1 ? p[3] / 255 : p[3]) : 1];
  }
  if ((m = /^hsla?\(([^)]+)\)$/.exec(s))) {
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map((x, i) => (i === 3 && x.endsWith('%') ? parseFloat(x) / 100 : parseFloat(x)));
    const [h, sat, l] = [((p[0] % 360) + 360) % 360, p[1] / 100, p[2] / 100];
    const k = (n: number) => (n + h / 30) % 12;
    const a = sat * Math.min(l, 1 - l);
    const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [f(0), f(8), f(4), p.length > 3 ? p[3] : 1];
  }
  throw new Error(`invalid color "${c}": use "#4683c4", "rgb(70,131,196)", "hsl(210,52%,52%)", a name, or [r,g,b] (0–1)`);
}

export function rgb(c: ColorSpec): [number, number, number] {
  const [r, g, b] = parseColor(c);
  return [r, g, b];
}
