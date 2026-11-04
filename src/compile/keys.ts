// Lowers normalized animation curves into exact IR keyframes for a property.
// Every animation is from→to with a normalized progress curve p(t); knots (fitted or exact) carry p and
// slopes dp/dt, which become AE values and per-dimension speeds. Spatial props get one ease whose speed
// is along the (straight) path; knots sit at extrema so each segment is monotone and |speed| is correct.
import type { FitKnot } from '../shared/bake.ts';
import { bake } from '../shared/bake.ts';
import type { EasingCurve } from '../shared/easing.ts';

export interface IrEase { speed: number; influence: number }
export interface IrKey {
  t: number;
  v: number | number[];
  i?: 'bezier' | 'linear' | 'hold';
  o?: 'bezier' | 'linear' | 'hold';
  ie?: IrEase[];
  oe?: IrEase[];
  tc?: boolean;
  sp?: { ti?: number[]; to?: number[]; cont?: boolean; auto?: boolean };
}

/** color: one ease whose speed is the Euclidean RGB(A) distance in 0–255 units per second (calibrated in AE 26.5). */
export type PropKind = 'oneD' | 'multi' | 'spatial' | 'color';

/** Normalized knots for a curve over duration T (seconds): exact for bezier/knotted curves, fitted otherwise. */
export function curveKnots(curve: EasingCurve, T: number, fps: number, tolNorm: number): FitKnot[] {
  if (curve.bezier) {
    const [x1, y1, x2, y2] = curve.bezier;
    const a = Math.max(x1, 0.001), b = Math.max(1 - x2, 0.001);
    return [
      { t: 0, p: 0, dl: 0, dr: y1 / a / T, inInf: 1 / 6, outInf: a },
      { t: T, p: 1, dl: (1 - y2) / b / T, dr: 0, inInf: b, outInf: 1 / 6 },
    ];
  }
  const fn = (t: number) => curve.fn(t / T);
  if (curve.knots) {
    const seed = curve.knots.map((k) => ({ t: k.t * T, p: k.p, dl: k.dl / T, dr: k.dr / T }));
    return bake(fn, T, { fps, tol: tolNorm, seed, frameSnap: false });
  }
  let knots = bake(fn, T, { fps, tol: tolNorm });
  // Curves that settle asymptotically (springs) must end on the exact target, at rest, so nothing is left at
  // 99.6 %. Snapping a key that is still visibly short would bend the last segment off the curve, so first run
  // the curve on (whole frames) until the remaining distance is within tolerance, then snap.
  if ((curve as any).asymptotic && Math.abs(knots[knots.length - 1].p - 1) > tolNorm) {
    let T2 = T;
    const step = Math.max(1 / fps, Math.ceil((T * 0.05) * fps) / fps);
    for (let i = 0; i < 200 && (Math.abs(fn(T2) - 1) > tolNorm * 0.5 || Math.abs(fn(T2 - 1 / fps) - 1) > tolNorm * 0.5); i++) T2 += step;
    knots = bake(fn, T2, { fps, tol: tolNorm });
  }
  const last = knots[knots.length - 1];
  if (Math.abs(last.p - 1) < 0.02) { last.p = 1; last.dl = 0; last.dr = 0; }
  return knots;
}

/** Converts normalized knots into keys for a from→to animation starting at `start` seconds. */
export function knotsToKeys(knots: FitKnot[], from: number[], to: number[], start: number, kind: PropKind): IrKey[] {
  const dv = to.map((t, d) => t - from[d]);
  const len = kind === 'color' ? 255 * Math.hypot(...dv) : Math.hypot(...dv);
  const scalar = from.length === 1 && kind !== 'spatial';
  return knots.map((k) => {
    const v = from.map((f, d) => f + dv[d] * k.p);
    let ie: IrEase[], oe: IrEase[];
    if (kind === 'spatial' || kind === 'color') {
      ie = [{ speed: len * Math.abs(k.dl), influence: k.inInf * 100 }];
      oe = [{ speed: len * Math.abs(k.dr), influence: k.outInf * 100 }];
    } else {
      ie = dv.map((d) => ({ speed: d * k.dl, influence: k.inInf * 100 }));
      oe = dv.map((d) => ({ speed: d * k.dr, influence: k.outInf * 100 }));
    }
    return { t: start + k.t, v: scalar ? v[0] : v, ie, oe };
  });
}
