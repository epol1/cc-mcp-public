// Curve baking: fits AE bezier keys to a normalized progress curve p(t) within a tolerance.
// Knots carry exact values and one-sided slopes; per segment we fit the two influences against the real
// AE segment shape (bezier.ts), then split at the worst sample until max error ≤ tol (docs/research §2.3).
import { aeSegmentValue } from './bezier.ts';

export interface Knot { t: number; p: number; dl: number; dr: number } // slopes in progress/second
export interface FitKnot extends Knot { inInf: number; outInf: number } // influences as fractions (0.001..1)

export interface BakeOpts {
  fps: number;
  tol: number; // max |error| in progress units
  maxKeys?: number;
  frameSnap?: boolean;
  seed?: Knot[]; // exact knots (skip detection), e.g. bounce
}

const H = 1e-5;

function slopes(fn: (t: number) => number, t: number, T: number): { dl: number; dr: number } {
  const dl = t - H >= 0 ? (fn(t) - fn(t - H)) / H : (fn(t + H) - fn(t)) / H;
  const dr = t + H <= T ? (fn(t + H) - fn(t)) / H : dl;
  return { dl: t === 0 ? dr : dl, dr };
}

function knotAt(fn: (t: number) => number, t: number, T: number): Knot {
  const s = slopes(fn, t, T);
  return { t, p: fn(t), dl: s.dl, dr: s.dr };
}

function sampleTimes(t0: number, t1: number, fps: number): number[] {
  const ts: number[] = [];
  const step = 0.5 / fps;
  const first = Math.ceil(t0 / step + 1e-9) * step;
  for (let t = first; t < t1 - 1e-9; t += step) ts.push(t);
  return ts;
}

function segError(fn: (t: number) => number, k0: Knot, k1: Knot, a: number, b: number, ts: number[]): { err: number; at: number } {
  let err = 0, at = -1;
  for (const t of ts) {
    const v = aeSegmentValue(k0.t, k1.t, k0.p, k1.p, k0.dr, a, k1.dl, b, t);
    const e = Math.abs(v - fn(t));
    if (e > err) { err = e; at = t; }
  }
  return { err, at };
}

/** Best influences for one segment: coarse grid then pattern search. */
function fitSegment(fn: (t: number) => number, k0: Knot, k1: Knot, fps: number): { a: number; b: number; err: number; at: number } {
  const ts = sampleTimes(k0.t, k1.t, fps);
  if (!ts.length) return { a: 1 / 3, b: 1 / 3, err: 0, at: -1 };
  let best = { a: 1 / 3, b: 1 / 3, ...segError(fn, k0, k1, 1 / 3, 1 / 3, ts) };
  for (let i = 1; i <= 20; i++) for (let j = 1; j <= 20; j++) {
    const a = i / 20, b = j / 20;
    const r = segError(fn, k0, k1, a, b, ts);
    if (r.err < best.err) best = { a, b, ...r };
  }
  let step = 0.025;
  while (step > 0.0005) {
    let improved = false;
    for (const [da, db] of [[step, 0], [-step, 0], [0, step], [0, -step], [step, step], [-step, -step], [step, -step], [-step, step]]) {
      const a = Math.min(1, Math.max(0.001, best.a + da)), b = Math.min(1, Math.max(0.001, best.b + db));
      const r = segError(fn, k0, k1, a, b, ts);
      if (r.err < best.err - 1e-12) { best = { a, b, ...r }; improved = true; }
    }
    if (!improved) step /= 2;
  }
  return best;
}

/** Local extrema of fn on (0, T): sign changes of the finite difference on a fine grid, refined by golden section. */
function extrema(fn: (t: number) => number, T: number, fps: number): number[] {
  const n = Math.max(8, Math.ceil(T * fps * 4));
  const out: number[] = [];
  let prev = fn(0), prevD = 0;
  for (let i = 1; i <= n; i++) {
    const t = (i / n) * T;
    const v = fn(t);
    const d = v - prev;
    if (i > 1 && Math.abs(d) > 1e-12 && Math.abs(prevD) > 1e-12 && Math.sign(d) !== Math.sign(prevD)) {
      // extremum in [t - 2dt, t]: golden section on |fn - fn(lo)| direction
      let lo = ((i - 2) / n) * T, hi = t;
      const isMax = prevD > 0;
      const g = (x: number) => (isMax ? -fn(x) : fn(x));
      for (let k = 0; k < 60; k++) {
        const m1 = lo + (hi - lo) * 0.382, m2 = lo + (hi - lo) * 0.618;
        if (g(m1) < g(m2)) hi = m2; else lo = m1;
      }
      out.push((lo + hi) / 2);
    }
    if (Math.abs(d) > 1e-12) prevD = d;
    prev = v;
  }
  return out;
}

export function bake(fn: (t: number) => number, T: number, opts: BakeOpts): FitKnot[] {
  const maxKeys = opts.maxKeys ?? 40;
  const snap = (t: number) => (opts.frameSnap === false ? t : Math.min(T, Math.max(0, Math.round(t * opts.fps) / opts.fps)));
  let knots: Knot[];
  if (opts.seed) knots = opts.seed.map((k) => ({ ...k }));
  else {
    const ts = [0, ...extrema(fn, T, opts.fps).map(snap), T];
    const uniq = [...new Set(ts.map((t) => +t.toFixed(9)))].sort((a, b) => a - b);
    knots = uniq.map((t) => knotAt(fn, t, T));
    // At a frame-snapped extremum the true slope is ~0; force it so the key is a clean peak.
    if (opts.frameSnap !== false) for (const k of knots) if (k.t > 0 && k.t < T && Math.sign(k.dl) !== Math.sign(k.dr)) { k.dl = 0; k.dr = 0; }
  }
  let fits = knots.slice(0, -1).map((k, i) => fitSegment(fn, k, knots[i + 1], opts.fps));
  for (let guard = 0; guard < maxKeys; guard++) {
    let worst = -1;
    for (let i = 0; i < fits.length; i++) if (fits[i].err > opts.tol && (worst < 0 || fits[i].err > fits[worst].err)) worst = i;
    if (worst < 0 || knots.length >= maxKeys) break;
    let t = snap(fits[worst].at);
    if (t <= knots[worst].t || t >= knots[worst + 1].t) t = fits[worst].at; // segment shorter than a frame
    const nk = knotAt(fn, t, T);
    knots.splice(worst + 1, 0, nk);
    fits.splice(worst, 1, fitSegment(fn, knots[worst], nk, opts.fps), fitSegment(fn, nk, knots[worst + 2], opts.fps));
  }
  return knots.map((k, i) => ({
    ...k,
    outInf: i < fits.length ? fits[i].a : 1 / 6,
    inInf: i > 0 ? fits[i - 1].b : 1 / 6,
  }));
}

/** Max error of fitted knots against fn at half-frame samples (for tests and reports). */
export function bakeError(fn: (t: number) => number, knots: FitKnot[], fps: number): number {
  let err = 0;
  for (let i = 0; i < knots.length - 1; i++) {
    const k0 = knots[i], k1 = knots[i + 1];
    err = Math.max(err, segError(fn, k0, k1, k0.outInf, k1.inInf, sampleTimes(k0.t, k1.t, fps)).err);
  }
  return err;
}
