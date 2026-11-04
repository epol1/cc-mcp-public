// Cubic-bezier math shared by the compiler, the baker and tests.
// CSS timing functions: cubic-bezier(x1, y1, x2, y2) with P0 = (0,0), P3 = (1,1).
// AE segments: P0 = (t0, v0), P1 = (t0 + a·Δt, v0 + s0·a·Δt), P2 = (t1 − b·Δt, v1 − s1·b·Δt), P3 = (t1, v1),
// where a/b are influence/100 and s0/s1 are out/in speeds (value units per second).

export type Bezier = readonly [number, number, number, number];

function cubic(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const m = 1 - u;
  return m * m * m * p0 + 3 * m * m * u * p1 + 3 * m * u * u * p2 + u * u * u * p3;
}

function dcubic(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const m = 1 - u;
  return 3 * m * m * (p1 - p0) + 6 * m * u * (p2 - p1) + 3 * u * u * (p3 - p2);
}

/** Solves x(u) = x for u in [0, 1] (x(u) monotone): Newton with bisection fallback. */
export function solveU(x0: number, x1: number, x2: number, x3: number, x: number): number {
  if (x <= x0) return 0;
  if (x >= x3) return 1;
  let u = (x - x0) / (x3 - x0);
  for (let i = 0; i < 8; i++) {
    const fx = cubic(x0, x1, x2, x3, u) - x;
    const d = dcubic(x0, x1, x2, x3, u);
    if (Math.abs(fx) < 1e-12) return u;
    if (Math.abs(d) < 1e-9) break;
    const nu = u - fx / d;
    if (nu < 0 || nu > 1) break;
    u = nu;
  }
  let lo = 0, hi = 1;
  for (let i = 0; i < 60; i++) {
    u = (lo + hi) / 2;
    if (cubic(x0, x1, x2, x3, u) < x) lo = u; else hi = u;
  }
  return u;
}

/** CSS cubic-bezier easing evaluated at progress t ∈ [0, 1]. */
export function cssBezier(b: Bezier, t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const u = solveU(0, b[0], b[2], 1, t);
  return cubic(0, b[1], b[3], 1, u);
}

/** Value of an AE bezier segment at time t (1-D). a/b are influences in 0..1. */
export function aeSegmentValue(t0: number, t1: number, v0: number, v1: number, s0: number, a: number, s1: number, b: number, t: number): number {
  const dt = t1 - t0;
  const u = solveU(t0, t0 + a * dt, t1 - b * dt, t1, t);
  return cubic(v0, v0 + s0 * a * dt, v1 - s1 * b * dt, v1, u);
}

/** Inverse mapping: CSS bezier over one segment → AE out-ease of the first key and in-ease of the second. */
export function bezierToEase(b: Bezier, dv: number, dt: number): { out: { speed: number; influence: number }; in: { speed: number; influence: number } } {
  const EPS = 0.001; // AE minimum influence 0.1 %
  const x1 = Math.max(b[0], EPS);
  const x2 = Math.min(b[2], 1 - EPS);
  const avg = dv / dt;
  return {
    out: { speed: (b[1] / x1) * avg, influence: x1 * 100 },
    in: { speed: ((1 - b[3]) / (1 - x2)) * avg, influence: (1 - x2) * 100 },
  };
}
