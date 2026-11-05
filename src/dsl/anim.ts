// Animation descriptors: plain data the compiler lowers to exact AE keyframes, text animators or expressions.
// Times: seconds or "400ms" / "0.5s" / "12f". Delays are relative to the layer's start (its Sequence).
import type { EasingSpec } from '../shared/easing.ts';
import type { Time } from '@cc-mcp/core/units.ts';
import type { ControlRef } from './control.ts';

export type Vec = number | readonly number[];
export type Num = number | ControlRef;
export type T = Time | ControlRef;
export type ValueOrControl<V> = V | ControlRef;

export interface TweenAnim { $anim: 'tween'; from?: ValueOrControl<Vec>; to?: ValueOrControl<Vec>; duration?: T; delay?: T; easing?: EasingSpec }
export interface SpringAnim {
  $anim: 'spring';
  from?: ValueOrControl<Vec>;
  to?: ValueOrControl<Vec>;
  delay?: T;
  stiffness?: Num;
  damping?: Num;
  mass?: Num;
  overshootClamping?: boolean;
  /** Stretch the spring so it settles in exactly this time (Remotion durationInFrames). */
  duration?: T;
  /** "keys" (default): fitted native keys. "expression": closed-form spring expression, every param live. */
  rig?: 'keys' | 'expression';
}
export interface KeysAnim { $anim: 'keys'; keys: { t: T; v: ValueOrControl<Vec>; easing?: EasingSpec; hold?: boolean }[] }
export interface SeqAnim { $anim: 'seq'; parts: Anim[] }
export interface WiggleAnim { $anim: 'wiggle'; freq: Num; amp: Num; octaves?: number; ampMult?: number; seed?: number }
export interface LoopAnim { $anim: 'loop'; anim: Anim; mode: 'cycle' | 'pingpong' | 'offset' | 'continue' }
export interface ExprAnim { $anim: 'expr'; code: string; /** Controls referenced in code as __AEC_CONTROL(Name)__. */ refs?: ControlRef[] }
export interface FnAnim { $anim: 'fn'; fn: (t: number) => Vec; duration: T; delay?: T; as?: 'keys' | 'expression' }
export type Anim = TweenAnim | SpringAnim | KeysAnim | SeqAnim | WiggleAnim | LoopAnim | ExprAnim | FnAnim;

export function isAnim(x: any): x is Anim {
  return !!x && typeof x === 'object' && typeof x.$anim === 'string';
}

/**
 * Two-key tween with exact easing (2 native keys for cubic-bezier presets).
 * `tween(0, 100, '0.4s', 'easeOutCubic')` or `tween({ from: 0, to: 100, duration: '0.4s', delay: 0.2 })`.
 * Omit `to` to end at the layer's rest value; on x/y/z/position `from` alone is an offset from rest.
 */
export function tween(from: ValueOrControl<Vec> | Omit<TweenAnim, '$anim'>, to?: ValueOrControl<Vec>, duration?: T, easing?: EasingSpec): TweenAnim {
  if (from !== null && typeof from === 'object' && !Array.isArray(from) && !(from as any).$control) return { $anim: 'tween', ...(from as any) };
  return { $anim: 'tween', from: from as any, to, duration, easing };
}

/** Remotion-exact spring. Defaults: stiffness 100, damping 10, mass 1. `from` alone on x/y is an offset from rest. */
export function spring(opts: Omit<SpringAnim, '$anim'> = {}): SpringAnim {
  return { $anim: 'spring', ...opts };
}

/** Explicit keyframes. `easing` is the easing of the segment leaving that key. */
export function keys(...k: KeysAnim['keys']): KeysAnim {
  return { $anim: 'keys', keys: k };
}

/** Plays animations one after another (each part's delay counts from the end of the previous part). */
export function seq(...parts: Anim[]): SeqAnim {
  return { $anim: 'seq', parts };
}

/** AE wiggle() expression, seeded for reproducible variants. */
export function wiggle(freq: Num, amp: Num, opts: { octaves?: number; ampMult?: number; seed?: number } = {}): WiggleAnim {
  return { $anim: 'wiggle', freq, amp, ...opts };
}

/** Repeats an animation with loopOut(). */
export function loop(anim: Anim, mode: LoopAnim['mode'] = 'cycle'): LoopAnim {
  return { $anim: 'loop', anim, mode };
}

/** Raw AE expression (escape hatch). */
export function expr(code: string, refs?: ControlRef[]): ExprAnim {
  return { $anim: 'expr', code, refs };
}

/** Arbitrary (t)=>value curve, sampled and reduced to native keys within tolerance. t is seconds from start. */
export function sample(fn: (t: number) => Vec, opts: { duration: T; delay?: T; as?: 'keys' | 'expression' }): FnAnim {
  return { $anim: 'fn', fn, ...opts };
}

// ---------- Presets (common marketing moves) ----------
export const fade = {
  in: (duration: T = '0.4s', opts: { delay?: T; easing?: EasingSpec } = {}): TweenAnim => tween({ from: 0, duration, easing: opts.easing ?? 'easeOutCubic', delay: opts.delay }),
  out: (at: T, duration: T = '0.4s', opts: { easing?: EasingSpec } = {}): TweenAnim => tween({ to: 0, duration, delay: at, easing: opts.easing ?? 'easeInCubic' }),
};

export function slideIn(dir: 'up' | 'down' | 'left' | 'right', distance = 80, opts: { duration?: T; delay?: T; easing?: EasingSpec; spring?: Omit<SpringAnim, '$anim'> } = {}): Anim {
  const d = dir === 'up' || dir === 'left' ? distance : -distance;
  if (opts.spring) return spring({ from: d, delay: opts.delay, ...opts.spring });
  return tween({ from: d, duration: opts.duration ?? '0.6s', delay: opts.delay, easing: opts.easing ?? 'easeOutExpo' });
}

export function popIn(opts: { delay?: T; damping?: number; stiffness?: number } = {}): SpringAnim {
  return spring({ from: 0, delay: opts.delay, damping: opts.damping ?? 12, stiffness: opts.stiffness ?? 180 });
}

// ---------- Per-unit text animation (native text animator + Expression Selector) ----------
export interface TextUnitFrom {
  x?: number; y?: number; z?: number;
  opacity?: number; scale?: number; rotation?: number; rotationX?: number; rotationY?: number;
  blur?: number; tracking?: number; skew?: number; fill?: string; characterOffset?: number;
}
export interface TextUnitsAnim {
  $text: 'units';
  by: 'char' | 'charNoSpaces' | 'word' | 'line';
  /** Animator values at the start ("from" state); units animate to rest. */
  from: TextUnitFrom;
  each?: T; // stagger between units (default 40ms chars, 80ms words, 150ms lines)
  duration?: T; // per-unit duration (default 0.5s)
  delay?: T;
  easing?: EasingSpec;
  spring?: { stiffness?: Num; damping?: Num; mass?: Num };
  order?: 'start' | 'end' | 'center' | 'edges' | 'random';
  seed?: number;
  /** "in" (default) animates from → rest; "out" animates rest → from starting at `delay`. */
  direction?: 'in' | 'out';
  /**
   * What `delay` counts from: "start" (default) = the layer's in point; "end" = BEFORE the layer's out point,
   * e.g. an exit with { direction: 'out', anchor: 'end', delay: 0.6 } starts 0.6 s before the layer ends and
   * follows the end when a Sequence gets longer or a ripple edit moves it.
   */
  anchor?: 'start' | 'end';
  /**
   * "expression" (default): an Expression Selector evaluates the exact easing/spring per unit, and every timing can
   * be a live control. "range": a native Range Selector (Ramp shape) whose Offset is keyframed, the way designers
   * build it by hand, so the reveal is ordinary keys in the graph editor. Range mode takes fixed times (no
   * controls), orders "start", "end" or "random", and an easing (not a spring) for the Offset sweep.
   */
  selector?: 'expression' | 'range';
  name?: string;
  /**
   * Live rig (D74): the timing (Each, Duration, Delay, plus Damping/Stiffness for springs) becomes one
   * "aec Text Reveal" effect on the text layer, named like the animator ("Reveal (words)"), so a designer retimes
   * the reveal in Effect Controls without a rebuild. Values given as control() link to those controls instead.
   */
  live?: boolean;
}

function units(by: TextUnitsAnim['by'], o: Omit<TextUnitsAnim, '$text' | 'by'>): TextUnitsAnim {
  return { $text: 'units', by, ...o };
}
export const perChar = (o: Omit<TextUnitsAnim, '$text' | 'by'>) => units('char', o);
export const perWord = (o: Omit<TextUnitsAnim, '$text' | 'by'>) => units('word', o);
export const perLine = (o: Omit<TextUnitsAnim, '$text' | 'by'>) => units('line', o);

/** Ready-made text reveals. Each accepts overrides (each, duration, delay, easing, spring, order). */
export const textPresets = {
  riseIn: (by: TextUnitsAnim['by'] = 'word', o: Partial<TextUnitsAnim> = {}) => units(by, { from: { y: 60, opacity: 0 }, easing: 'easeOutExpo', ...o }),
  fadeUp: (by: TextUnitsAnim['by'] = 'word', o: Partial<TextUnitsAnim> = {}) => units(by, { from: { y: 24, opacity: 0 }, easing: 'easeOutCubic', ...o }),
  blurIn: (by: TextUnitsAnim['by'] = 'char', o: Partial<TextUnitsAnim> = {}) => units(by, { from: { blur: 18, opacity: 0, scale: 110 }, easing: 'easeOutQuart', ...o }),
  popIn: (by: TextUnitsAnim['by'] = 'char', o: Partial<TextUnitsAnim> = {}) => units(by, { from: { scale: 0, opacity: 0 }, spring: { damping: 11, stiffness: 220 }, ...o }),
  trackingIn: (o: Partial<TextUnitsAnim> = {}) => units('char', { from: { tracking: 60, opacity: 0, blur: 6 }, easing: 'easeOutExpo', each: 0, duration: '0.9s', ...o }),
  typewriter: (o: Partial<TextUnitsAnim> = {}) => units('char', { from: { opacity: 0 }, easing: [0, 0, 0, 1] as any, duration: '1f', each: '45ms', ...o }),
  flipIn: (by: TextUnitsAnim['by'] = 'char', o: Partial<TextUnitsAnim> = {}) => units(by, { from: { rotationX: -90, opacity: 0, y: 20 }, easing: 'easeOutBack', ...o }),
  slideMask: (by: TextUnitsAnim['by'] = 'line', o: Partial<TextUnitsAnim> = {}) => units(by, { from: { y: 110, opacity: 0 }, easing: 'easeOutQuint', duration: '0.7s', ...o }),
  scramble: (o: Partial<TextUnitsAnim> = {}) => units('char', { from: { characterOffset: 20, opacity: 0 }, easing: 'easeOutCubic', duration: '0.6s', ...o }),
};
