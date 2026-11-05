// Lowers one prop value (static | animation descriptor | control) into IR PropSpecs with exact keys.
import type { Anim, SpringAnim, TweenAnim } from '../dsl/anim.ts';
import { isAnim } from '../dsl/anim.ts';
import type { ControlRef } from '../dsl/control.ts';
import { isControl } from '../dsl/control.ts';
import { isField } from '../dsl/field.ts';
import type { EasingCurve } from '../shared/easing.ts';
import { resolveEasing } from '../shared/easing.ts';
import { springProgress } from '../shared/spring.ts';
import { bake } from '../shared/bake.ts';
import { parseTime } from '../shared/units.ts';
import type { IrKey } from './keys.ts';
import { curveKnots, knotsToKeys } from './keys.ts';
import type { ControlRegistry } from './controls.ts';

export interface PropSpec { p: string; v?: any; keys?: IrKey[]; expr?: string; sep?: boolean; eg?: string }

export interface ValueCtx {
  fps: number;
  /** Absolute comp time (s) the animation timeline starts at (the layer's start). */
  t0: number;
  controls: ControlRegistry;
  seed: number;
  /** Build warnings (compile-time notes the agent should see). */
  warnings?: string[];
}

export interface PropTarget {
  path: string;
  /** Rest value (static value, or default) as an array. */
  rest: number[];
  /** Max allowed error in property units (baking tolerance). */
  tol: number;
  /** Treat `from` alone as an offset from rest (x/y/z/position). */
  offset?: boolean;
  /** Converts an authored value (number | array | color string) to the property's array form. */
  conv?: (v: any) => number[];
  /** Number of components AE stores (e.g. scale 3). */
  dims: number;
}

/** Number/array → `dims` components. Short arrays pad with `pad` (0: a 2D position gets z = 0), or repeat their last value ('last': scale). */
const toArr = (v: any, dims: number, pad: number | 'last' = 'last'): number[] => {
  if (typeof v === 'number') return Array(dims).fill(v);
  if (Array.isArray(v)) return v.length >= dims ? v.slice(0, dims) : [...v, ...Array(dims - v.length).fill(pad === 'last' ? v[v.length - 1] ?? 0 : pad)];
  throw new Error(`expected a number or array, got ${JSON.stringify(v)}`);
};

function out(target: PropTarget, arr: number[]): number | number[] {
  return target.dims === 1 ? arr[0] : arr;
}

interface Resolved { from: number[]; to: number[]; delay: number; dur: number; rig: RigParts }
interface RigParts { delay?: { ref: string; def: number }; dur?: { ref: string; def: number }; amp?: { ref: string; def: number } }

function num(v: any, ctx: ValueCtx, what: string, rig: RigParts, slot: keyof RigParts, fallback: number, isTime: boolean): number {
  if (v === undefined) return fallback;
  if (isControl(v)) {
    const def = isTime ? parseTime(v.default, ctx.fps) : Number(v.default);
    rig[slot] = { ref: ctx.controls.use(v), def };
    return def + (v.plus ?? 0);
  }
  return isTime ? parseTime(v, ctx.fps) : Number(v);
}

function endpoints(a: { from?: any; to?: any }, target: PropTarget, ctx: ValueCtx, rig: RigParts): { from: number[]; to: number[] } {
  const conv = target.conv ?? ((v: any) => toArr(v, target.dims));
  const val = (v: any, which: 'from' | 'to') => {
    if (isControl(v)) {
      const d = v.default;
      // A control on `from` of an offset prop becomes an amplitude control (distance).
      if (which === 'from' && target.offset && typeof d === 'number') rig.amp = { ref: ctx.controls.use(v), def: d };
      else throw new Error(`control "${v.name}" can't drive \`${which}\` of ${target.path}; use it for delay/duration/distance or as a static value`);
      return d;
    }
    return v;
  };
  const fromRaw = a.from !== undefined ? val(a.from, 'from') : undefined;
  const toRaw = a.to !== undefined ? val(a.to, 'to') : undefined;
  let from: number[], to: number[];
  if (target.offset && toRaw === undefined && fromRaw !== undefined) {
    const off = toArr(fromRaw, target.dims);
    to = target.rest.slice();
    from = to.map((r, i) => r + (off[i] ?? 0));
  } else {
    from = fromRaw !== undefined ? conv(fromRaw) : target.rest.slice();
    to = toRaw !== undefined ? conv(toRaw) : target.rest.slice();
  }
  return { from, to };
}

function tolNorm(target: PropTarget, from: number[], to: number[]): number {
  const range = Math.max(...to.map((t, i) => Math.abs(t - from[i])), 1e-9);
  return Math.min(0.01, (target.tol / range) * 0.6);
}

/** Expression implementing the retimable-keys rig (D24): delay offset, duration scale, amplitude scale. */
function rigExpression(rig: RigParts, t0: number, base: number[], dims: number): string | undefined {
  if (!rig.delay && !rig.dur && !rig.amp) return undefined;
  const lines = [`// ae-compose rig: live timing/amplitude controls (keys authored at default values)`, `var t0 = ${t0.toFixed(6)};`];
  lines.push(rig.delay ? `var d = (${rig.delay.ref}) - ${rig.delay.def};` : 'var d = 0;');
  lines.push(rig.dur ? `var s = Math.max((${rig.dur.ref}) / ${rig.dur.def}, 0.0001);` : 'var s = 1;');
  lines.push('var v = valueAtTime(t0 + (time - t0 - d) / s);');
  if (rig.amp && rig.amp.def !== 0) {
    const k = `((${rig.amp.ref}) / ${rig.amp.def})`;
    const b = dims === 1 ? String(base[0]) : `[${base.join(', ')}]`;
    lines.push(dims === 1 ? `v = ${b} + (v - ${b}) * ${k};` : `v = add(${b}, mul(sub(v, ${b}), ${k}));`);
  }
  lines.push('v;');
  return lines.join('\n');
}

function curveFor(a: TweenAnim | SpringAnim, dur: number, ctx: ValueCtx, rig: RigParts): { curve: EasingCurve; dur: number } {
  if (a.$anim === 'tween') return { curve: resolveEasing(a.easing), dur };
  const cfg = { stiffness: num(a.stiffness, ctx, 'stiffness', {}, 'amp', 100, false), damping: num(a.damping, ctx, 'damping', {}, 'amp', 10, false), mass: num(a.mass, ctx, 'mass', {}, 'amp', 1, false), overshootClamping: a.overshootClamping };
  const stretched = a.duration !== undefined ? num(a.duration, ctx, 'duration', rig, 'dur', 0, true) : undefined;
  const sp = springProgress({ ...cfg, durationInFrames: stretched !== undefined ? stretched * ctx.fps : undefined }, ctx.fps);
  // Natural springs settle asymptotically (curveKnots runs them on until within tolerance); stretched ones jump to 1 at `duration` like Remotion.
  return { curve: { name: 'spring', fn: (t: number) => sp.fn(t * sp.settleSec), asymptotic: stretched === undefined } as EasingCurve, dur: sp.settleSec };
}

/** Keys for a single tween/spring starting at absolute time `start`. */
function segmentKeys(a: TweenAnim | SpringAnim, target: PropTarget, ctx: ValueCtx, start: number, rig: RigParts): { keys: IrKey[]; end: number; to: number[] } {
  const { from, to } = endpoints(a, target, ctx, rig);
  const delay = num(a.delay, ctx, 'delay', rig, 'delay', 0, true);
  const dur0 = a.$anim === 'tween' ? num(a.duration, ctx, 'duration', rig, 'dur', 0.6, true) : 0;
  const { curve, dur } = curveFor(a, dur0, ctx, rig);
  const knots = curveKnots(curve, Math.max(dur, 1 / ctx.fps), ctx.fps, tolNorm(target, from, to));
  const keys = knotsToKeys(knots, from, to, start + delay, target.dims === 1 ? 'oneD' : 'multi');
  if (target.dims === 1) for (const k of keys) if (Array.isArray(k.v)) k.v = k.v[0];
  // A spring may run past its nominal settle time (see curveKnots): the animation ends at its last key.
  return { keys, end: Math.max(start + delay + dur, keys[keys.length - 1].t), to };
}

/** Merges consecutive key lists: a key that starts a part at the same time as the previous end takes the previous in-ease. */
function mergeKeys(lists: IrKey[][]): IrKey[] {
  const outK: IrKey[] = [];
  for (const list of lists) for (const k of list) {
    const last = outK[outK.length - 1];
    if (last && Math.abs(last.t - k.t) < 1e-6) { last.oe = k.oe; last.v = k.v; if (k.o) last.o = k.o; continue; }
    if (last && k.t < last.t) throw new Error(`animation parts overlap in time (${k.t.toFixed(3)}s < ${last.t.toFixed(3)}s)`);
    outK.push(k);
  }
  return outK;
}

function lowerAnim(a: Anim, target: PropTarget, ctx: ValueCtx, start: number): { keys?: IrKey[]; expr?: string; rest?: number[]; end?: number } {
  const rig: RigParts = {};
  switch (a.$anim) {
    case 'tween':
    case 'spring': {
      if (a.$anim === 'spring') {
        // Live physics (a control on stiffness/damping/mass) needs the closed-form expression: fitted keys can't follow it.
        const livePhysics = [a.stiffness, a.damping, a.mass].some(isControl);
        if (livePhysics && a.rig === 'keys') throw new Error('spring stiffness/damping/mass controls need rig: "expression" (keys are fitted once at build time)');
        if (a.rig === 'expression' || livePhysics) return springExpression(a, target, ctx, start);
      }
      const r = segmentKeys(a, target, ctx, start, rig);
      return { keys: r.keys, expr: rigExpression(rig, start + (rig.delay?.def ?? 0), r.to, target.dims), end: r.end };
    }
    case 'keys': {
      const conv = target.conv ?? ((v: any) => toArr(v, target.dims));
      for (const k of a.keys) if (isControl(k.t) || isControl(k.v)) throw new Error(`keys(): controls can't drive individual key ${isControl(k.t) ? 'times' : 'values'}; use tween/spring with a control on delay/duration/from, or seq()`);
      const ks = a.keys.map((k) => ({ t: start + num(k.t, ctx, 't', rig, 'delay', 0, true), v: conv(k.v), easing: k.easing, hold: k.hold }));
      ks.sort((x, y) => x.t - y.t);
      const lists: IrKey[][] = [];
      for (let i = 0; i < ks.length - 1; i++) {
        const k0 = ks[i], k1 = ks[i + 1];
        if (k0.hold) { lists.push([{ t: k0.t, v: out(target, k0.v), i: 'bezier', o: 'hold' }, { t: k1.t, v: out(target, k1.v) }]); continue; }
        const curve = resolveEasing(k0.easing);
        const knots = curveKnots(curve, k1.t - k0.t, ctx.fps, tolNorm(target, k0.v, k1.v));
        const seg = knotsToKeys(knots, k0.v, k1.v, k0.t, target.dims === 1 ? 'oneD' : 'multi');
        if (target.dims === 1) for (const k of seg) if (Array.isArray(k.v)) k.v = k.v[0];
        lists.push(seg);
      }
      if (ks.length === 1) lists.push([{ t: ks[0].t, v: out(target, ks[0].v) }]);
      return { keys: mergeKeys(lists), end: ks[ks.length - 1].t };
    }
    case 'seq': {
      let cursor = start;
      const lists: IrKey[][] = [];
      let prevTo: number[] | undefined;
      for (const part of a.parts) {
        if (part.$anim !== 'tween' && part.$anim !== 'spring') throw new Error('seq(...) parts must be tween() or spring()');
        const p = { ...part } as any;
        if (p.from === undefined && prevTo) p.from = target.dims === 1 ? prevTo[0] : prevTo;
        const tgt = prevTo ? { ...target, offset: false } : target;
        const r = segmentKeys(p, tgt, ctx, cursor, {});
        lists.push(r.keys);
        cursor = r.end;
        prevTo = r.to;
      }
      return { keys: mergeKeys(lists), end: cursor };
    }
    case 'wiggle': {
      const f = isControl(a.freq) ? ctx.controls.use(a.freq) : String(a.freq);
      const amp = isControl(a.amp) ? ctx.controls.use(a.amp) : String(a.amp);
      const seed = a.seed ?? ctx.seed;
      return { expr: `seedRandom(${seed}, true);\nwiggle(${f}, ${amp}, ${a.octaves ?? 1}, ${a.ampMult ?? 0.5});` };
    }
    case 'loop': {
      const inner = lowerAnim(a.anim, target, ctx, start);
      const mode = a.mode === 'pingpong' ? 'pingpong' : a.mode;
      return { keys: inner.keys, expr: `loopOut(${JSON.stringify(mode)});` };
    }
    case 'expr': {
      let code = a.code;
      for (const ref of a.refs ?? []) code = code.split(`__AEC_CONTROL(${ref.name})__`).join(`(${ctx.controls.use(ref)})`);
      return { expr: code };
    }
    case 'fn': {
      if (a.as === 'expression') throw new Error('sample({ as: "expression" }) is not supported: a JS function cannot run in AE; omit `as` to bake it into keys, or write expr(...)');
      const dur = parseTime(a.duration as any, ctx.fps);
      const delay = parseTime(a.delay as any, ctx.fps, 0);
      const v0 = toArr(a.fn(0), target.dims);
      const v1 = toArr(a.fn(dur), target.dims);
      // Bake each dimension's normalized curve on the dimension with the largest swing; others share its knots.
      const samples = Array.from({ length: Math.ceil(dur * ctx.fps * 4) + 1 }, (_, i) => toArr(a.fn((i / (Math.ceil(dur * ctx.fps * 4))) * dur), target.dims));
      let dim = 0, best = -1;
      for (let d = 0; d < target.dims; d++) { const r = Math.max(...samples.map((s) => s[d])) - Math.min(...samples.map((s) => s[d])); if (r > best) { best = r; dim = d; } }
      const lo = Math.min(...samples.map((s) => s[dim])), hi = Math.max(...samples.map((s) => s[dim]));
      const range = Math.max(hi - lo, 1e-9);
      const knots = bake((t) => (toArr(a.fn(t), target.dims)[dim] - lo) / range, dur, { fps: ctx.fps, tol: (target.tol / range) * 0.6 });
      const keys: IrKey[] = knots.map((k) => {
        const v = toArr(a.fn(k.t), target.dims);
        const h = 1e-4;
        const dl = toArr(a.fn(Math.max(0, k.t - h)), target.dims).map((x, d) => (v[d] - x) / (k.t - Math.max(0, k.t - h) || h));
        const dr = toArr(a.fn(Math.min(dur, k.t + h)), target.dims).map((x, d) => (x - v[d]) / (Math.min(dur, k.t + h) - k.t || h));
        return { t: start + delay + k.t, v: out(target, v), ie: dl.map((s) => ({ speed: s, influence: k.inInf * 100 })), oe: dr.map((s) => ({ speed: s, influence: k.outInf * 100 })) };
      });
      void v0; void v1;
      return { keys, end: start + delay + dur };
    }
  }
}

/** Closed-form spring as an expression with every parameter live (rig: "expression"). */
function springExpression(a: SpringAnim, target: PropTarget, ctx: ValueCtx, start: number): { expr: string } {
  const p = (v: any, def: number, time = false) => (isControl(v) ? ctx.controls.use(v) : String(v === undefined ? def : time ? parseTime(v, ctx.fps) : v));
  const { from, to } = endpoints(a, target, ctx, {});
  const lit = (x: number[]) => (target.dims === 1 ? String(x[0]) : `[${x.join(', ')}]`);
  const body = [
    `// ae-compose spring (Remotion-exact closed form)`,
    `var k = ${p(a.stiffness, 100)}, c = ${p(a.damping, 10)}, m = ${p(a.mass, 1)};`,
    `var x = L.spring(time - ${start.toFixed(6)} - (${p(a.delay, 0, true)}), 1 / thisComp.frameDuration, c, k, m);${a.overshootClamping ? ' x = Math.min(x, 1);' : ''}`,
    target.dims === 1 ? `${lit(from)} + (${lit(to)} - ${lit(from)}) * x;` : `add(${lit(from)}, mul(sub(${lit(to)}, ${lit(from)}), x));`,
  ];
  return { expr: body.join('\n') };
}

/**
 * Main entry: value → PropSpec(s). Static numbers/arrays → v; controls → expression link; animations → keys
 * (+ rig expression when timing/amplitude is controlled).
 */
export function lowerValue(value: any, target: PropTarget, ctx: ValueCtx): PropSpec | null {
  if (value === undefined) return null;
  // A field: lowered like its value, then exposed in the comp's Essential Graphics under its name.
  if (isField(value)) { const s = lowerValue(value.value, target, ctx) ?? { p: target.path }; s.eg = value.name; return s; }
  const conv = target.conv ?? ((v: any) => toArr(v, target.dims, /Position|Point of Interest|Anchor/.test(target.path) ? 0 : 'last'));
  if (isControl(value)) {
    const ref = ctx.controls.use(value);
    if (value.kind === 'checkbox') {
      // Checkbox → on/off value: opacity 100/0, anything else 1/0.
      const on = /Opacity$/.test(target.path) ? 100 : 1;
      return { p: target.path, v: out(target, toArr(value.default ? on : 0, target.dims)), expr: on === 1 ? ref : `(${ref}) * ${on}` };
    }
    const def = conv(value.default);
    const expr = value.kind === 'point' && target.dims === 3 ? `var p = ${ref}; [p[0], p[1], value[2]];` : value.kind === 'color' ? ref : target.dims > 1 && (value.kind === 'slider' || value.kind === 'angle') ? `var s = ${ref}; [${Array.from({ length: target.dims }, (_, i) => (target.path.endsWith('Scale') && i === 2 ? '100' : 's')).join(', ')}];` : ref;
    return { p: target.path, v: out(target, def), expr };
  }
  if (isAnim(value)) {
    const r = lowerAnim(value, target, ctx, ctx.t0);
    const spec: PropSpec = { p: target.path };
    if (r.keys && r.keys.length) spec.keys = r.keys;
    else spec.v = out(target, target.rest);
    if (r.expr) spec.expr = r.expr;
    return spec;
  }
  return { p: target.path, v: out(target, conv(value)) };
}

export const TOL = { px: 0.1, deg: 0.05, opacity: 0.1, scale: 0.05, color: 0.5 / 255, percent: 0.05, generic: 0.05 };
