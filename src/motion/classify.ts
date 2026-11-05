// Easing classification: how a move feels, judged from its sampled progress along one channel (position projected
// on the direction of travel, scale, rotation or opacity). Reversals around the target mean overshoot or a spring;
// otherwise the shape of the normalized curve decides: S = progress at 20 % of the time ÷ 0.2 (start speed
// relative to the average) and E = remaining progress at 80 % ÷ 0.2 (end speed). Linear ≈ 1 / 1 and flat,
// ease-out has S ≫ E, ease-in E ≫ S, ease-in-out both low. Calibrated on the presets in src/shared/easing.ts and on
// Remotion springs (see tests/unit/motion.test.ts).
import type { EasingClass } from './types.ts';

export interface EaseJudgement {
  ease: EasingClass;
  /** Fraction past the target (overshoot, spring-like) or backed up before going (anticipate). */
  overshoot?: number;
  /** Start and end speed relative to the average speed, and the peak relative to the average. */
  start: number; end: number; peakRatio: number;
}

/** Below this the normalized curve counts as linear at the ends; also the ease-in-out ceiling for both ends. */
const END_LINEAR = 0.65;
/** A linear move's speed never exceeds its average by more than this factor. */
const FLAT_PEAK = 1.4;
/** A reversal must swing back by at least this fraction of the move. */
const SWING = 0.01;

/** Values at the turning points of a sequence, ignoring swings smaller than `h`. */
export function turningPoints(q: number[], h = SWING): number[] {
  const turns: number[] = [];
  let dir = 0, ext = q[0];
  for (const v of q) {
    if (dir === 0) {
      if (v - ext > h) dir = 1; else if (ext - v > h) dir = -1;
      if (dir !== 0) ext = v;
    } else if (dir === 1) {
      if (v > ext) ext = v; else if (ext - v > h) { turns.push(ext); dir = -1; ext = v; }
    } else if (v < ext) ext = v; else if (v - ext > h) { turns.push(ext); dir = 1; ext = v; }
  }
  return turns;
}

function interp(tau: number[], q: number[], x: number): number {
  for (let i = 1; i < tau.length; i++) {
    if (tau[i] >= x) {
      const a = tau[i - 1], b = tau[i];
      return b > a ? q[i - 1] + ((x - a) / (b - a)) * (q[i] - q[i - 1]) : q[i];
    }
  }
  return q[q.length - 1];
}

/** Classify the shape of a monotone-ish normalized curve q(τ) from 0 to 1. */
function shapeClass(tau: number[], q: number[]): Omit<EaseJudgement, 'overshoot'> {
  const start = interp(tau, q, 0.2) / 0.2, end = (1 - interp(tau, q, 0.8)) / 0.2;
  let peakRatio = 0;
  for (let i = 1; i < q.length; i++) if (tau[i] > tau[i - 1]) peakRatio = Math.max(peakRatio, Math.abs(q[i] - q[i - 1]) / (tau[i] - tau[i - 1]));
  let ease: EasingClass;
  if (start >= END_LINEAR && end >= END_LINEAR && peakRatio <= FLAT_PEAK) ease = 'linear';
  else if (start < END_LINEAR && end < END_LINEAR) ease = 'ease-in-out';
  else if (start >= END_LINEAR && end >= END_LINEAR && Math.abs(start - end) < 0.25 * Math.max(start, end)) ease = 'ease-in-out';
  else ease = start > end ? 'ease-out' : 'ease-in';
  return { ease, start, end, peakRatio };
}

/**
 * Judge a move from its samples: times `ts` and signed progress `ps` along the dominant channel (same length,
 * first and last sample included). `built` is the easing name from the build when known: a spring that
 * overshoots is reported as spring-like even when only one reversal is visible.
 */
export function classifyProgress(ts: number[], ps: number[], built?: string): EaseJudgement {
  const n = ts.length;
  const flat: EaseJudgement = { ease: 'step', start: 1, end: 1, peakRatio: 1 };
  if (n < 4 || ts[n - 1] <= ts[0]) return flat;
  const e = ps.map((p) => p - ps[0]);
  const total = e[n - 1];
  const maxAbs = Math.max(...e.map(Math.abs));
  if (!(maxAbs > 0)) return flat;
  const tau = ts.map((t) => (t - ts[0]) / (ts[n - 1] - ts[0]));

  // Out and back (a pulse): judge the travelled distance, there's no target to overshoot.
  if (Math.abs(total) < 0.3 * maxAbs) {
    const cum = [0];
    for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.abs(e[i] - e[i - 1]));
    return shapeClass(tau, cum.map((c) => c / cum[n - 1]));
  }

  const q = e.map((v) => v / total);
  const turns = turningPoints(q);
  const anticipates = turns.length > 0 && turns[0] < -SWING;
  const around = turns.slice(anticipates ? 1 : 0);
  const over = Math.max(...q) - 1, back = -Math.min(...q);
  const spring = built === 'spring';
  const shape = shapeClass(tau, q.map((v) => Math.min(1, Math.max(0, v))));
  if (around.length >= 2 || (spring && around.length === 1 && over > SWING)) return { ...shape, ease: 'spring-like', overshoot: over };
  if (around.length === 1 && over > SWING) return { ...shape, ease: 'overshoot', overshoot: over };
  if (anticipates) return { ...shape, ease: 'anticipate', overshoot: back };
  return shape;
}
