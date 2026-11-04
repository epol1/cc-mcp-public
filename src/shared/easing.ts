// Easing library: Remotion's Easing set plus named motion-design presets.
// Every easing is a normalized curve p(t): [0,1] → value progress. Ones that are exactly a cubic bezier
// carry `bezier`, so the compiler emits 2 exact keys; the rest are baked into fitted keys.
import type { Bezier } from './bezier.ts';
import { cssBezier } from './bezier.ts';

export interface EasingCurve {
  name: string;
  fn: (t: number) => number;
  /** Exact cubic-bezier form (2 keys) when the curve is one. */
  bezier?: Bezier;
  /** Exact piecewise representation: knots (t, p, left slope, right slope) for curves like bounce. */
  knots?: { t: number; p: number; dl: number; dr: number }[];
}

const bez = (name: string, b: Bezier): EasingCurve => ({ name, bezier: b, fn: (t) => cssBezier(b, t) });

/** Named presets (CSS/easings.net forms designers know). Exact as 2-key AE eases. */
const PRESETS: Record<string, Bezier> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1], // CSS "ease" (note: Remotion's Easing.ease is CSS ease-in)
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
  easeInSine: [0.12, 0, 0.39, 0],
  easeOutSine: [0.61, 1, 0.88, 1],
  easeInOutSine: [0.37, 0, 0.63, 1],
  easeInQuad: [1 / 3, 0, 2 / 3, 1 / 3],
  easeOutQuad: [1 / 3, 2 / 3, 2 / 3, 1],
  easeInOutQuad: [0.45, 0, 0.55, 1],
  easeInCubic: [1 / 3, 0, 2 / 3, 0],
  easeOutCubic: [1 / 3, 1, 2 / 3, 1],
  easeInOutCubic: [0.65, 0, 0.35, 1],
  easeInQuart: [0.5, 0, 0.75, 0],
  easeOutQuart: [0.25, 1, 0.5, 1],
  easeInOutQuart: [0.76, 0, 0.24, 1],
  easeInQuint: [0.64, 0, 0.78, 0],
  easeOutQuint: [0.22, 1, 0.36, 1],
  easeInOutQuint: [0.83, 0, 0.17, 1],
  easeInExpo: [0.7, 0, 0.84, 0],
  easeOutExpo: [0.16, 1, 0.3, 1],
  easeInOutExpo: [0.87, 0, 0.13, 1],
  easeInCirc: [0.55, 0, 1, 0.45],
  easeOutCirc: [0, 0.55, 0.45, 1],
  easeInOutCirc: [0.85, 0, 0.15, 1],
  easeInBack: [0.36, 0, 0.66, -0.56],
  easeOutBack: [0.34, 1.56, 0.64, 1],
  easeInOutBack: [0.68, -0.6, 0.32, 1.6],
  // Motion-design shorthands
  smooth: [0.4, 0, 0.2, 1], // Material standard
  snappy: [0.2, 0.9, 0.1, 1],
  punchy: [0.7, 0, 0.1, 1],
  gentle: [0.33, 0, 0.2, 1],
  anticipate: [0.38, -0.4, 0.88, 0.65],
  overshoot: [0.3, 1.4, 0.5, 1],
  // AE's own "Easy Ease" (33.3 % influence, zero speed both sides)
  easyEase: [1 / 3, 0, 2 / 3, 1],
  easyEaseIn: [1 / 3, 0, 1, 1],
  easyEaseOut: [0, 0, 2 / 3, 1],
};

// ---- Remotion Easing (exact formulas; see docs/research/remotion-lottie-easing.md §1.7) ----
type Fn = (t: number) => number;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
export const Easing = {
  linear: (t: number) => t,
  ease: (t: number) => cssBezier([0.42, 0, 1, 1], t),
  quad: (t: number) => t * t,
  cubic: (t: number) => t * t * t,
  poly: (n: number): Fn => (t) => Math.pow(t, n),
  sin: (t: number) => 1 - Math.cos((t * Math.PI) / 2),
  circle: (t: number) => { const u = clamp01(t); return 1 - Math.sqrt(1 - u * u); },
  exp: (t: number) => Math.pow(2, 10 * (t - 1)),
  elastic: (b = 1): Fn => (t) => 1 - Math.pow(Math.cos((t * Math.PI) / 2), 3) * Math.cos(t * b * Math.PI),
  back: (s = 1.70158): Fn => (t) => t * t * ((s + 1) * t - s),
  bounce: (t: number) => {
    const u = clamp01(t);
    if (u < 1 / 2.75) return 7.5625 * u * u;
    if (u < 2 / 2.75) { const v = u - 1.5 / 2.75; return 7.5625 * v * v + 0.75; }
    if (u < 2.5 / 2.75) { const v = u - 2.25 / 2.75; return 7.5625 * v * v + 0.9375; }
    const v = u - 2.625 / 2.75; return 7.5625 * v * v + 0.984375;
  },
  bezier: (x1: number, y1: number, x2: number, y2: number): Fn => (t) => cssBezier([x1, y1, x2, y2], t),
  in: (f: Fn): Fn => f,
  out: (f: Fn): Fn => (t) => 1 - f(1 - t),
  inOut: (f: Fn): Fn => (t) => (t < 0.5 ? f(2 * t) / 2 : 1 - f(2 * (1 - t)) / 2),
};

/** Exact bounce knots (4 parabolas → 5 keys) for Easing.bounce. */
function bounceKnots(): EasingCurve['knots'] {
  const k = 7.5625;
  const pts = [0, 1 / 2.75, 2 / 2.75, 2.5 / 2.75, 1];
  const centers = [0, 1.5 / 2.75, 2.25 / 2.75, 2.625 / 2.75];
  return pts.map((t, i) => {
    const dl = i === 0 ? 0 : 2 * k * (t - centers[i - 1]);
    const dr = i === pts.length - 1 ? 0 : 2 * k * (t - centers[i]);
    return { t, p: Easing.bounce(t), dl, dr };
  });
}

export type EasingSpec = string | readonly [number, number, number, number] | ((t: number) => number) | EasingCurve;

export function easingNames(): string[] {
  return [...Object.keys(PRESETS), 'bounce', 'elastic'];
}

/** Resolves any easing spec to a curve. Unknown names throw with suggestions. */
export function resolveEasing(spec: EasingSpec | undefined): EasingCurve {
  if (spec === undefined) return bez('easeOutCubic', PRESETS.easeOutCubic);
  if (typeof spec === 'object' && !Array.isArray(spec) && 'fn' in (spec as any)) return spec as EasingCurve;
  if (Array.isArray(spec)) return bez(`cubic-bezier(${spec.join(',')})`, spec as unknown as Bezier);
  if (typeof spec === 'function') return { name: 'custom', fn: spec as Fn };
  const name = String(spec);
  if (PRESETS[name]) return bez(name, PRESETS[name]);
  if (name === 'bounce' || name === 'easeOutBounce') return { name: 'bounce', fn: Easing.bounce, knots: bounceKnots() };
  if (name === 'easeInBounce') return { name, fn: Easing.in((t) => 1 - Easing.bounce(1 - t)) };
  if (name === 'elastic' || name === 'easeOutElastic') return { name: 'elastic', fn: Easing.out(Easing.elastic(1)) };
  const m = /^cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)$/.exec(name);
  if (m) return bez(name, [+m[1], +m[2], +m[3], +m[4]]);
  const close = easingNames().filter((n) => n.toLowerCase().includes(name.toLowerCase().replace(/^ease/, '')) || levenshtein(n.toLowerCase(), name.toLowerCase()) <= 3).slice(0, 6);
  throw new Error(`unknown easing "${name}". ${close.length ? `Did you mean: ${close.join(', ')}?` : `Known: ${easingNames().join(', ')}`}`);
}

export function levenshtein(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
