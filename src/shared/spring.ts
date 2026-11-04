// Remotion-exact spring (closed form; matches remotion@4.0.540 to ~1e-12, see research §1.8).
// Written ES3-style so the same text can be embedded in AE expressions (springExpressionLib).

export interface SpringConfig {
  stiffness?: number; // default 100
  damping?: number; // default 10
  mass?: number; // default 1
  overshootClamping?: boolean;
}

export function springUnit(frame: number, fps: number, c: number, k: number, m: number): number {
  if (frame <= 0) return 0;
  const stepMs = Math.min(1000 / fps, 64);
  const whole = Math.floor(frame);
  const t = (whole * stepMs + Math.min(((frame - whole) * 1000) / fps, 64)) / 1000;
  const zeta = c / (2 * Math.sqrt(k * m));
  const w0 = Math.sqrt(k / m);
  if (zeta < 1) {
    const w1 = w0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(w1 * t) + ((zeta * w0) / w1) * Math.sin(w1 * t));
  }
  return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
}

export function measureSpring(fps: number, cfg: SpringConfig = {}, threshold = 0.005): number {
  const c = cfg.damping ?? 10, k = cfg.stiffness ?? 100, m = cfg.mass ?? 1;
  if (threshold === 0) return Infinity;
  if (threshold === 1) return 0;
  let frame = 0;
  while (Math.abs(springUnit(frame, fps, c, k, m) - 1) >= threshold) frame++;
  let fin = frame;
  for (let i = 0; i < 20; i++) {
    frame++;
    if (Math.abs(springUnit(frame, fps, c, k, m) - 1) >= threshold) { i = 0; fin = frame + 1; }
  }
  return fin;
}

export interface SpringArgs extends SpringConfig {
  frame: number;
  fps: number;
  from?: number;
  to?: number;
  durationInFrames?: number;
  durationRestThreshold?: number;
  delay?: number; // frames
  reverse?: boolean;
}

/** Same semantics as Remotion's spring(): returns the value at `frame`. */
export function spring(a: SpringArgs): number {
  const c = a.damping ?? 10, k = a.stiffness ?? 100, m = a.mass ?? 1;
  const from = a.from ?? 0, to = a.to ?? 1, delay = a.delay ?? 0;
  const thr = a.durationRestThreshold ?? 0.005;
  const hasDur = a.durationInFrames !== undefined;
  const nat = a.reverse || hasDur ? measureSpring(a.fps, { damping: c, stiffness: k, mass: m }, thr) : 0;
  const rp = a.reverse ? (hasDur ? (a.durationInFrames as number) : nat) - a.frame : a.frame;
  const dp = rp + (a.reverse ? delay : -delay);
  if (hasDur && dp > (a.durationInFrames as number)) return to;
  const p = hasDur ? dp / ((a.durationInFrames as number) / nat) : dp;
  let x = springUnit(p, a.fps, c, k, m);
  if (a.overshootClamping) x = Math.min(x, 1);
  return from === 0 && to === 1 ? x : from + (to - from) * x;
}

/** Normalized progress p(t) in seconds for the baker (t relative to the animation start, delay excluded). */
export function springProgress(cfg: SpringConfig & { durationInFrames?: number }, fps: number): { fn: (tSec: number) => number; settleSec: number } {
  const c = cfg.damping ?? 10, k = cfg.stiffness ?? 100, m = cfg.mass ?? 1;
  const nat = measureSpring(fps, { damping: c, stiffness: k, mass: m });
  const D = cfg.durationInFrames;
  const fn = (tSec: number) => {
    const f = tSec * fps;
    if (D !== undefined && f > D) return 1;
    const p = D !== undefined ? f / (D / nat) : f;
    let x = springUnit(p, fps, c, k, m);
    if (cfg.overshootClamping) x = Math.min(x, 1);
    return x;
  };
  return { fn, settleSec: (D ?? nat) / fps };
}
