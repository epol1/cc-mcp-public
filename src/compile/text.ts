// Text: TextDocument spec, style runs, and per-unit animation as native text animators with an
// Expression Selector whose amount evaluates the exact easing/spring per unit (D25).
import type { TextUnitsAnim } from '../dsl/anim.ts';
import { isControl } from '../dsl/control.ts';
import type { TextProps } from '../dsl/primitives.ts';
import { resolveEasing } from '../shared/easing.ts';
import { parseColor, parseTime, rgb } from '@ae-mcp/core/units.ts';
import type { ValueCtx } from './values.ts';
import type { PseudoEffectDef, PseudoParam } from './ffx/pseudo.ts';
import { rigEffectSpec, rigRef } from './rigfx.ts';
import { curveKnots, knotsToKeys } from './keys.ts';

export function textDoc(p: TextProps, text: string): any {
  const color = isControl(p.color) ? (p.color as any).default : (p.color as any);
  return {
    text,
    font: p.font ?? 'Inter-Bold',
    size: p.size ?? 72,
    fill: color === undefined ? [1, 1, 1] : rgb(color),
    stroke: p.stroke ? rgb(p.stroke) : undefined,
    strokeWidth: p.strokeWidth,
    strokeOverFill: p.strokeOverFill,
    tracking: p.tracking ?? 0,
    leading: p.leading ?? 'auto',
    justify: p.align === 'justify' ? 'justifyLeft' : p.align ?? 'center',
    caps: p.caps,
    fauxBold: p.fauxBold,
    fauxItalic: p.fauxItalic,
    box: p.box ? { w: p.box.width, h: p.box.height ?? Math.round((p.size ?? 72) * 6) } : undefined,
    runs: p.runs?.map((r) => ({ start: r.start, end: r.end, font: r.font, size: r.size, fill: r.color ? rgb(r.color) : undefined, tracking: r.tracking, baselineShift: r.baselineShift })),
  };
}

const BASED_ON = { char: 1, charNoSpaces: 2, word: 3, line: 4 } as const;
const GROUPING = { char: 1, charNoSpaces: 1, word: 2, line: 3 } as const;
const DEFAULT_EACH = { char: 0.035, charNoSpaces: 0.035, word: 0.08, line: 0.15 } as const;

function timeRef(v: any, ctx: ValueCtx, def: number): string {
  if (v === undefined) return String(def);
  if (isControl(v)) return v.plus ? `(${ctx.controls.use(v)} + ${v.plus})` : ctx.controls.use(v);
  return String(parseTime(v, ctx.fps));
}
function numRef(v: any, ctx: ValueCtx, def: number): string {
  if (v === undefined) return String(def);
  if (isControl(v)) return ctx.controls.use(v);
  return String(v);
}

/** Default instance name of a unit animator (also its live rig effect's name). */
export const animatorName = (a: TextUnitsAnim) => a.name ?? `${a.direction === 'out' ? 'Exit' : 'Reveal'} (${a.by}s)`;

/** "aec Text Reveal" / "aec Spring Reveal": the live timing of a per-unit animator as one effect (D74). */
function revealDef(spring: boolean): PseudoEffectDef {
  const params: PseudoParam[] = [
    { kind: 'slider', name: 'Each', default: 0.08, min: 0, max: 0.5, validMin: 0, precision: 3 },
    { kind: 'slider', name: 'Duration', default: 0.5, min: 0.05, max: 3, validMin: 0.001, precision: 2 },
    { kind: 'slider', name: 'Delay', default: 0, min: 0, max: 10, precision: 2 },
  ];
  if (spring) params.push({ kind: 'slider', name: 'Damping', default: 10, min: 1, max: 60, validMin: 0.1, precision: 1 }, { kind: 'slider', name: 'Stiffness', default: 100, min: 10, max: 600, validMin: 1, precision: 0 });
  return { name: spring ? 'aec Spring Reveal' : 'aec Text Reveal', params };
}

/** The live rig effect of an animator with `live: true`: param values from its timing (numbers, times or controls). */
export function revealRig(a: TextUnitsAnim, ctx: ValueCtx): any {
  const t = (v: any, d: number) => (v === undefined ? d : isControl(v) ? v : parseTime(v, ctx.fps));
  const values: Record<string, any> = { Each: t(a.each, DEFAULT_EACH[a.by]), Duration: t(a.duration, 0.5), Delay: t(a.delay, 0) };
  if (a.spring) { values.Damping = a.spring.damping ?? 10; values.Stiffness = a.spring.stiffness ?? 100; }
  return rigEffectSpec(revealDef(!!a.spring), animatorName(a), values, ctx);
}

/** Expression Selector "Amount" expression: 100 = fully at the "from" state, 0 = at rest. */
export function unitAmountExpr(a: TextUnitsAnim, ctx: ValueCtx, layerStartOffset: number): string {
  // Live: every timing reads the animator's own rig effect on this layer.
  const rig = (param: string) => rigRef(animatorName(a), param);
  const each = a.live ? rig('Each') : timeRef(a.each, ctx, DEFAULT_EACH[a.by]);
  const dur = a.live ? rig('Duration') : timeRef(a.duration, ctx, 0.5);
  const delay = a.live ? rig('Delay') : timeRef(a.delay, ctx, 0);
  const order: Record<string, string> = {
    start: 'textIndex - 1',
    end: 'textTotal - textIndex',
    center: 'Math.abs(textIndex - (textTotal + 1) / 2)',
    edges: '(textTotal - 1) / 2 - Math.abs(textIndex - (textTotal + 1) / 2)',
    random: `(seedRandom(${a.seed ?? ctx.seed} * 7919 + textIndex, true), random(0, textTotal))`,
  };
  const lines = [
    `// ae-compose: per-${a.by} ${a.direction === 'out' ? 'exit' : 'reveal'}; each/duration/delay may be live controls`,
    `var each = ${each}, dur = Math.max(${dur}, 0.0001), delay = ${delay};`,
    `var i = ${order[a.order ?? 'start']};`,
    a.anchor === 'end' ? `var t = time - outPoint + delay - i * each;` : `var t = time - inPoint - ${layerStartOffset.toFixed(6)} - delay - i * each;`,
  ];
  // The easing comes from the expression library (D73): the compiler adds the functions used.
  if (a.spring) {
    const damping = a.live ? rigRef(animatorName(a), 'Damping') : numRef(a.spring.damping, ctx, 10);
    const stiffness = a.live ? rigRef(animatorName(a), 'Stiffness') : numRef(a.spring.stiffness, ctx, 100);
    lines.push(`var p = L.spring(t, 1 / thisComp.frameDuration, ${damping}, ${stiffness}, ${numRef(a.spring.mass, ctx, 1)});`);
  } else {
    const c = resolveEasing(a.easing ?? 'easeOutCubic');
    if (!c.bezier) throw new Error(`per-unit text easing "${c.name}" is not a cubic bezier; use a bezier preset or spring: {...}`);
    lines.push(`var p = L.bezier(${c.bezier.join(', ')}, t / dur);`);
  }
  lines.push(a.direction === 'out' ? 'var a = p * 100;' : 'var a = (1 - p) * 100;');
  lines.push('[a, a, a];');
  return lines.join('\n');
}

/** How many units AE counts for "Based On" (Characters include spaces). */
export function unitCount(text: string, by: TextUnitsAnim['by']): number {
  if (by === 'char') return text.replace(/\r\n|\r|\n/g, '').length;
  if (by === 'charNoSpaces') return text.replace(/\s/g, '').length;
  if (by === 'word') return text.split(/\s+/).filter(Boolean).length;
  return text.split(/\r\n|\r|\n/).length;
}

/**
 * Range Selector selector props: a Ramp window of width W % swept by keyed Offset. Ramp Up selects everything past
 * its End edge fully, so Offset −W → 100 % reveals from the start of the text; Ramp Down is the mirror (verified in
 * AE with a scale-to-0 animator). W is chosen so one unit's transition lasts `duration` while the sweep staggers
 * units by `each`: W = 100·dur / ((n − 1)·each).
 */
function rangeSelector(a: TextUnitsAnim, ctx: ValueCtx, text: string, layer: { in: number; out: number }): any {
  const fixed = (v: any, name: string, def: number) => {
    if (v === undefined) return def;
    if (isControl(v)) throw new Error(`text animator with selector: 'range' needs a fixed ${name}, not a live control (use the default expression selector for live timing)`);
    return parseTime(v, ctx.fps);
  };
  if (a.spring) throw new Error("text animator with selector: 'range' takes an easing, not a spring (springs need the expression selector)");
  const order = a.order ?? 'start';
  if (order === 'center' || order === 'edges') throw new Error(`text animator with selector: 'range' supports order "start", "end" or "random", not "${order}"`);
  const n = Math.max(1, unitCount(text, a.by));
  const each = fixed(a.each, 'each', DEFAULT_EACH[a.by]), dur = Math.max(fixed(a.duration, 'duration', 0.5), 1 / ctx.fps), delay = fixed(a.delay, 'delay', 0);
  const t0 = a.anchor === 'end' ? layer.out - delay : layer.in + delay;
  const reveal = a.direction !== 'out';
  const curve = resolveEasing(a.easing ?? 'linear');
  const keyed = (from: number, to: number, T: number) => knotsToKeys(curveKnots(curve, T, ctx.fps, 0.002), [from], [to], t0, 'oneD').map((k) => ({ ...k, v: Array.isArray(k.v) ? k.v[0] : k.v }));
  const base = [
    { p: 'ADBE Text Range Advanced/ADBE Text Range Units', v: 1 },
    { p: 'ADBE Text Range Advanced/ADBE Text Range Type2', v: BASED_ON[a.by] },
  ];
  // All units together (no stagger): select everything and key the selector's Amount (exact easing).
  if (n === 1 || each <= 0) {
    return { mn: 'ADBE Text Selector', props: [...base, { p: 'ADBE Text Range Advanced/ADBE Text Range Shape', v: 1 }, { p: 'ADBE Text Range Advanced/ADBE Text Selector Max Amount', keys: reveal ? keyed(100, 0, dur) : keyed(0, 100, dur) }] };
  }
  // AE limits Start/End/Offset to ±100 %, so the window is at most 100 %: a looser stagger is stretched.
  const Wexact = (100 * dur) / ((n - 1) * each);
  const W = Math.min(100, Math.max(1, Wexact));
  const T = W < Wexact ? (dur * (100 + W)) / W : (n - 1) * each + dur;
  if (W < Wexact) ctx.warnings?.push(`text animator with selector: 'range': ${n} units × ${each}s stagger with a ${dur}s duration needs a window wider than AE's 100 %; the stagger is stretched (sweep ${T.toFixed(2)}s)`);
  // Which ramp, and which way the window travels: forward = Offset −W → 100.
  const fromStart = order !== 'end';
  const rampUp = reveal === fromStart;
  const [o0, o1] = fromStart ? [-W, 100] : [100, -W];
  return {
    mn: 'ADBE Text Selector',
    props: [
      ...base,
      { p: 'ADBE Text Range Advanced/ADBE Text Range Shape', v: rampUp ? 2 : 3 },
      ...(order === 'random' ? [{ p: 'ADBE Text Range Advanced/ADBE Text Randomize Order', v: 1 }, { p: 'ADBE Text Range Advanced/ADBE Text Random Seed', v: a.seed ?? ctx.seed }] : []),
      { p: 'ADBE Text Percent Start', v: 0 },
      { p: 'ADBE Text Percent End', v: W },
      { p: 'ADBE Text Percent Offset', keys: keyed(o0, o1, T) },
    ],
  };
}

/** GroupSpec for a text animator (plus the layer-level More Options it needs). */
export function unitAnimator(a: TextUnitsAnim, ctx: ValueCtx, layerStartOffset: number, threeD: boolean, text = '', layer: { in: number; out: number } = { in: 0, out: 0 }): { group: any; moreOptions: any[] } {
  const items: any[] = [];
  const f = a.from;
  if (f.x !== undefined || f.y !== undefined || f.z !== undefined) items.push({ mn: 'ADBE Text Position 3D', set: { v: [f.x ?? 0, f.y ?? 0, f.z ?? 0] } });
  if (f.scale !== undefined) items.push({ mn: 'ADBE Text Scale 3D', set: { v: [f.scale, f.scale, 100] } });
  if (f.rotation !== undefined) items.push({ mn: 'ADBE Text Rotation', set: { v: f.rotation } });
  if (f.rotationX !== undefined) items.push({ mn: 'ADBE Text Rotation X', set: { v: f.rotationX } });
  if (f.rotationY !== undefined) items.push({ mn: 'ADBE Text Rotation Y', set: { v: f.rotationY } });
  if (f.skew !== undefined) items.push({ mn: 'ADBE Text Skew', set: { v: f.skew } });
  if (f.tracking !== undefined) items.push({ mn: 'ADBE Text Tracking Amount', set: { v: f.tracking } });
  if (f.characterOffset !== undefined) items.push({ mn: 'ADBE Text Character Offset', set: { v: f.characterOffset } });
  if (f.fill !== undefined) items.push({ mn: 'ADBE Text Fill Color', set: { v: parseColor(f.fill) } });
  if (f.blur !== undefined) items.push({ mn: 'ADBE Text Blur', set: { v: [f.blur, f.blur] } });
  if (f.opacity !== undefined) items.push({ mn: 'ADBE Text Opacity', set: { v: f.opacity } });
  if (!items.length) throw new Error('text unit animation needs at least one "from" property (y, opacity, scale, blur, ...)');
  const group = {
    mn: 'ADBE Text Animator',
    name: animatorName(a),
    kids: [
      { at: 'ADBE Text Animator Properties', items },
      { at: 'ADBE Text Selectors', items: [a.selector === 'range' ? rangeSelector(a, ctx, text, layer) : { mn: 'ADBE Text Expressible Selector', props: [{ p: 'ADBE Text Range Type2', v: BASED_ON[a.by] }, { p: 'ADBE Text Expressible Amount', expr: unitAmountExpr(a, ctx, layerStartOffset) }] }] },
    ],
  };
  if (a.live && a.selector === 'range') throw new Error("text animator: live: true needs the expression selector (selector: 'range' keys fixed times)");
  const moreOptions: any[] = [];
  if (f.scale !== undefined || f.rotation !== undefined || f.rotationX !== undefined || f.rotationY !== undefined) {
    moreOptions.push({ p: 'ADBE Text Properties/ADBE Text More Options/ADBE Text Anchor Point Option', v: GROUPING[a.by] });
    moreOptions.push({ p: 'ADBE Text Properties/ADBE Text More Options/ADBE Text Anchor Point Align', v: [0, -50] });
  }
  void threeD;
  return { group, moreOptions };
}
