// Text: TextDocument spec, style runs, and per-unit animation as native text animators with an
// Expression Selector whose amount evaluates the exact easing/spring per unit (D25).
import type { TextUnitsAnim } from '../dsl/anim.ts';
import { isControl } from '../dsl/control.ts';
import type { TextProps } from '../dsl/primitives.ts';
import { resolveEasing } from '../shared/easing.ts';
import { parseColor, parseTime, rgb } from '../shared/units.ts';
import type { ValueCtx } from './values.ts';
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

const BEZ_FN = 'function bz(x1, y1, x2, y2, x) { if (x <= 0) return 0; if (x >= 1) return 1; var u = x, i, cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by; for (i = 0; i < 8; i++) { var xu = ((ax * u + bx) * u + cx) * u - x, d = (3 * ax * u + 2 * bx) * u + cx; if (Math.abs(xu) < 1e-6 || Math.abs(d) < 1e-6) break; u -= xu / d; } var lo = 0, hi = 1; if (Math.abs(((ax * u + bx) * u + cx) * u - x) > 1e-4) { for (i = 0; i < 30; i++) { u = (lo + hi) / 2; if (((ax * u + bx) * u + cx) * u < x) lo = u; else hi = u; } } return ((ay * u + by) * u + cy) * u; }';
const SPRING_FN = 'function su(f, fps, c, k, m) { if (f <= 0) return 0; var st = Math.min(1000 / fps, 64), w = Math.floor(f), t = (w * st + Math.min((f - w) * 1000 / fps, 64)) / 1000; var z = c / (2 * Math.sqrt(k * m)), w0 = Math.sqrt(k / m); if (z < 1) { var w1 = w0 * Math.sqrt(1 - z * z); return 1 - Math.exp(-z * w0 * t) * (Math.cos(w1 * t) + (z * w0 / w1) * Math.sin(w1 * t)); } return 1 - Math.exp(-w0 * t) * (1 + w0 * t); }';

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

/** Expression Selector "Amount" expression: 100 = fully at the "from" state, 0 = at rest. */
export function unitAmountExpr(a: TextUnitsAnim, ctx: ValueCtx, layerStartOffset: number): string {
  const each = timeRef(a.each, ctx, DEFAULT_EACH[a.by]);
  const dur = timeRef(a.duration, ctx, 0.5);
  const delay = timeRef(a.delay, ctx, 0);
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
  if (a.spring) {
    lines.unshift(SPRING_FN);
    lines.push(`var fps = 1 / thisComp.frameDuration;`);
    lines.push(`var p = su(t * fps, fps, ${numRef(a.spring.damping, ctx, 10)}, ${numRef(a.spring.stiffness, ctx, 100)}, ${numRef(a.spring.mass, ctx, 1)});`);
  } else {
    const c = resolveEasing(a.easing ?? 'easeOutCubic');
    if (!c.bezier) throw new Error(`per-unit text easing "${c.name}" is not a cubic bezier; use a bezier preset or spring: {...}`);
    lines.unshift(BEZ_FN);
    lines.push(`var p = bz(${c.bezier.join(', ')}, t / dur);`);
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
    name: a.name ?? `${a.direction === 'out' ? 'Exit' : 'Reveal'} (${a.by}s)`,
    kids: [
      { at: 'ADBE Text Animator Properties', items },
      { at: 'ADBE Text Selectors', items: [a.selector === 'range' ? rangeSelector(a, ctx, text, layer) : { mn: 'ADBE Text Expressible Selector', props: [{ p: 'ADBE Text Range Type2', v: BASED_ON[a.by] }, { p: 'ADBE Text Expressible Amount', expr: unitAmountExpr(a, ctx, layerStartOffset) }] }] },
    ],
  };
  const moreOptions: any[] = [];
  if (f.scale !== undefined || f.rotation !== undefined || f.rotationX !== undefined || f.rotationY !== undefined) {
    moreOptions.push({ p: 'ADBE Text Properties/ADBE Text More Options/ADBE Text Anchor Point Option', v: GROUPING[a.by] });
    moreOptions.push({ p: 'ADBE Text Properties/ADBE Text More Options/ADBE Text Anchor Point Align', v: [0, -50] });
  }
  void threeD;
  return { group, moreOptions };
}
