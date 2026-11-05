// K2 data viz kit: scales, data normalization, and every chart compiled to IR. The generated expressions are run in
// Node against a mock of AE's expression globals (the rig effect's values, time, in/out points, createPath), so the
// live maths is checked without After Effects: heights, labels, trims, pops, highlight and exit.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileScene } from '../../src/compile/compile.ts';
import { scene } from '../../src/dsl/scene.ts';
import { jsx, childrenOf } from '../../src/dsl/jsx-runtime.ts';
import { Composition, Sequence } from '../../src/dsl/primitives.ts';
import { control } from '../../src/dsl/control.ts';
import { BarChart, StackedBarChart, LineChart, AreaChart, DonutChart, PieChart, Counter, niceScale, formatNumber } from '../../src/dsl/dataviz/index.ts';
import { normalizeData } from '../../src/dsl/dataviz/common.ts';
import { validateIr } from '../../src/ir/schema.ts';
import { loadScene } from '../../src/scene/load.ts';
import { parseColor } from '@cc-mcp/core/units.ts';
import { libObject } from '../../src/aeclib/index.ts';

// ---------- harness ----------
type Rigs = Map<string, Record<string, Record<string, any>>>; // layer id → effect instance → param → value

/** Rig effect values per layer id, found by expanding the components like the compiler does. */
function rigsOf(root: any): Rigs {
  const out: Rigs = new Map();
  const walk = (node: any) => {
    for (const el of childrenOf(node)) {
      if (typeof el === 'string') continue;
      if (typeof el.type === 'function' && !el.type.aec) { walk(el.type({ ...el.props })); continue; }
      const kids = childrenOf(el.props?.children ?? []);
      for (const k of kids) if (typeof k !== 'string' && k.type?.aec === 'rigEffect') {
        const fx = { ...(out.get(el.props.id) ?? {}) };
        fx[k.props.name ?? k.props.def.name] = { ...k.props.values };
        out.set(el.props.id, fx);
      }
      if (el.type?.aec === 'composition' || el.type?.aec === 'sequence') walk(el.props.children);
    }
  };
  walk(root);
  return out;
}

function build(el: any, opts: { dur?: number; seq?: [number, number] } = {}) {
  const dur = opts.dur ?? 8;
  const body = opts.seq ? jsx(Sequence, { from: opts.seq[0], duration: opts.seq[1], children: el }) : el;
  const def = scene({ name: 'T', duration: dur }, () => jsx(Composition, { children: [body] }));
  const r = compileScene(def);
  const tree = def.render({ seed: 1 } as any);
  return { ...r, rigs: rigsOf(tree) };
}
const main = (r: any) => r.ir.comps.find((c: any) => c.id === r.ir.main);
const layer = (r: any, id: string) => { const L = main(r).layers.find((l: any) => l.id === id); if (!L) throw new Error(`no layer ${id}`); return L; };
/** The expression (or else the value) spec of a layer prop, by path suffix. */
const prop = (L: any, suffix: string) => (L.props ?? []).find((s: any) => s.p.endsWith(suffix) && s.expr) ?? (L.props ?? []).find((s: any) => s.p.endsWith(suffix));
/** Expression of a shape-contents prop, by item name path and prop suffix. */
function itemExpr(L: any, names: string[], suffix: string): string {
  let items = L.groups.find((g: any) => g.at === 'ADBE Root Vectors Group').items;
  let it: any;
  for (const n of names) {
    it = items.find((x: any) => x.name === n || x.mn === n);
    if (!it) throw new Error(`no item ${n} in ${L.id}`);
    items = it.kids?.[0]?.items ?? [];
  }
  const s = it.props.find((x: any) => x.p.endsWith(suffix));
  if (!s?.expr) throw new Error(`no expression ${suffix} on ${names.join('/')}`);
  return s.expr;
}

const conv = (v: any) => (typeof v === 'string' && /^#|^rgb/.test(v) ? parseColor(v) : typeof v === 'boolean' ? (v ? 1 : 0) : v && typeof v === 'object' && v.$control ? v.default : v);
const runner = new Function('scope', 'code', 'with (scope) { return eval(code); }') as (s: any, c: string) => any;

/** Runs one expression of layer L (in the main comp) at comp time t. `set` overrides rig values (live edits). */
function run(r: any, L: any, code: string, t: number, set: Record<string, any> = {}, value: any = [0, 0]): any {
  const c = main(r);
  const byName = new Map(c.layers.map((x: any) => [x.name, x.id]));
  const effectOf = (id: string) => (fx: string) => {
    const vals = r.rigs.get(id)?.[fx];
    if (!vals) throw new Error(`layer ${id} has no effect "${fx}"`);
    return (param: string) => {
      if (!(param in vals)) throw new Error(`effect "${fx}" has no param "${param}"`);
      return { value: conv(param in set ? set[param] : vals[param]) };
    };
  };
  const scope = {
    time: t, inPoint: L.in, outPoint: L.out, value, index: 1,
    thisComp: { duration: c.dur, frameDuration: 1 / c.fps, layer: (n: string) => { const id = byName.get(n) as string; if (!id) throw new Error(`no layer named ${n}`); return { effect: effectOf(id) }; } },
    thisLayer: { sourceRectAtTime: () => ({ left: 0, top: 0, width: 120, height: 40 }) },
    effect: effectOf(L.id),
    createPath: (pts: number[][], ins: number[][], outs: number[][], closed: boolean) => ({ pts, ins, outs, closed }),
  };
  return runner(scope, code);
}
const finite = (x: any): boolean => (typeof x === 'boolean' ? true : typeof x === 'number' ? Number.isFinite(x) : Array.isArray(x) ? x.every(finite) : typeof x === 'string' ? true : x && typeof x === 'object' ? Object.values(x).every(finite) : false);

/** Every expression of every layer evaluates to finite values at these times. */
function runAll(r: any, times: number[]): number {
  let n = 0;
  const c = main(r);
  const visit = (L: any, o: any) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach((x) => visit(L, x)); return; }
    // (Text animator selectors are the compiler's, not the kit's: textIndex isn't mocked.)
    if (typeof o.expr === 'string' && !o.expr.includes('textIndex')) for (const t of times) {
      let v: any;
      try { v = run(r, L, o.expr, t, {}, o.v ?? [0, 0]); } catch (e: any) { throw new Error(`${L.id} ${o.p} @${t}: ${e.message}\n${o.expr.split('\n').filter((l: string) => !l.startsWith('function aecLib')).join('\n')}`); }
      if (!finite(v)) throw new Error(`${L.id} ${o.p} @${t}: not finite: ${JSON.stringify(v)}`);
      n++;
    }
    for (const k of Object.keys(o)) if (k !== 'expr') visit(L, o[k]);
  };
  for (const L of c.layers) { visit(L, L.props); visit(L, L.groups); }
  return n;
}

const MONTHS = [{ label: 'JAN', value: 42 }, { label: 'FEB', value: 58 }, { label: 'MAR', value: 51 }, { label: 'APR', value: 77 }, { label: 'MAY', value: 96 }, { label: 'JUN', value: 128 }];

// ---------- scales & data ----------
describe('niceScale', () => {
  it('picks 1/2/2.5/5 steps with about five intervals', () => {
    expect(niceScale(0, 128)).toMatchObject({ min: 0, max: 150, step: 25, ticks: [0, 25, 50, 75, 100, 125, 150], decimals: 0 });
    expect(niceScale(0, 96)).toMatchObject({ min: 0, max: 100, step: 20 });
    expect(niceScale(0, 0.73)).toMatchObject({ max: 0.8, step: 0.2, decimals: 1 });
    expect(niceScale(-30, 80)).toMatchObject({ min: -40, max: 80, step: 20 });
    expect(niceScale(120, 180, { zero: false })).toMatchObject({ min: 120, max: 180 });
  });
  it('a fixed min and max split into exactly `ticks` intervals', () => {
    expect(niceScale(0, 128, { min: 0, max: 140, ticks: 4 })).toMatchObject({ step: 35, ticks: [0, 35, 70, 105, 140] });
  });
  it('formatNumber matches the expression library', () => {
    expect(formatNumber(1234567.891, { prefix: '$', suffix: 'M', decimals: 2 })).toBe('$1,234,567.89M');
    expect(formatNumber(1234.5, { decimals: 1, separator: '.', decimalMark: ',' })).toBe('1.234,5');
    const L = libObject();
    for (const [v, d, s, m] of [[0, 0, ',', '.'], [-1234567.891, 2, ',', '.'], [999.995, 2, ' ', ','], [1e9, 0, '', '.'], [12.3, 3, ',', '.']] as const) expect(formatNumber(v, { decimals: d, separator: s, decimalMark: m })).toBe(L.num(v, d, s, m));
  });
});

describe('data normalization', () => {
  it('numbers, rows, columns and series', () => {
    expect(normalizeData({ data: [1, 2, 3] }, 'x')).toMatchObject({ labels: ['1', '2', '3'], series: [{ values: [1, 2, 3] }] });
    expect(normalizeData({ data: MONTHS.slice(0, 2) }, 'x')).toMatchObject({ labels: ['JAN', 'FEB'], series: [{ name: 'Value', values: [42, 58] }] });
    expect(normalizeData({ data: [{ label: 'Q1', ios: 3, android: 4 }, { label: 'Q2', ios: 5, android: 6 }] }, 'x').series.map((s) => [s.name, s.values])).toEqual([['ios', [3, 5]], ['android', [4, 6]]]);
    expect(normalizeData({ series: [{ name: 'A', values: [1, 2] }, { name: 'B', values: [3, 4] }], labels: ['x', 'y'] }, 'x').series[1].color).toBe('#ffd23f');
  });
  it('errors say what to change', () => {
    expect(() => normalizeData({}, '<BarChart id="b">')).toThrow(/give data=/);
    expect(() => normalizeData({ series: [{ name: 'A', values: [1, 2] }, { name: 'B', values: [3] }] }, 'x')).toThrow(/one value per category/);
    expect(() => normalizeData({ data: [1, 'x' as any] }, 'x')).toThrow(/data\[1\]/);
  });
});

// ---------- bar charts ----------
describe('BarChart', () => {
  const bars = (extra: any = {}) => BarChart({ id: 'rev', name: 'Revenue', data: MONTHS, format: { prefix: '$', suffix: 'k' }, ...extra });

  it('one controller null with the "Bar Chart" rig; every layer parented to it, ids from the chart id', () => {
    const r = build(bars());
    const ctl = layer(r, 'rev.ctl');
    expect(ctl.type).toBe('null');
    expect(ctl.name).toBe('Revenue');
    const fx = ctl.groups[0].items[0];
    expect(fx.name).toBe('Bar Chart');
    expect(fx.mn).toMatch(/^Pseudo\/aec Bar Chart /);
    const vals = r.rigs.get('rev.ctl')!['Bar Chart'];
    expect(vals).toMatchObject({ JAN: 42, JUN: 128, 'Axis Min': 0, 'Axis Max': 150, Delay: 0.5, Stagger: 0.08, Easing: 1, Highlight: 1, Decimals: 0 });
    const ids = main(r).layers.map((l: any) => l.id);
    for (const id of ['rev.grid', 'rev.tick0', 'rev.tick6', 'rev.cat0', 'rev.bar0', 'rev.bar5', 'rev.val5']) expect(ids).toContain(id);
    for (const L of main(r).layers) if (L.id !== 'rev.ctl') expect(L.parent).toBe('rev.ctl');
    expect(() => validateIr(r.ir)).not.toThrow();
  });

  it('bar heights read the live values × eased progress; labels count up to the formatted value', () => {
    const r = build(bars());
    const bar = (i: number) => layer(r, `rev.bar${i}`);
    const size = (i: number, t: number, set?: any) => run(r, bar(i), itemExpr(bar(i), ['Bar'], 'Rect Size'), t, set);
    const PH = size(5, 7, { JUN: 150 })[1]; // a bar at Axis Max fills the plot
    expect(PH).toBeGreaterThan(400);
    expect(size(5, 7)[1]).toBeCloseTo((PH * 128) / 150, 3);
    expect(size(0, 7)[1]).toBeCloseTo((PH * 42) / 150, 3);
    expect(size(5, 0.2)[1]).toBe(0); // before its delay
    const mid = size(5, 0.5 + 5 * 0.08 + 0.2)[1];
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan((PH * 128) / 150);
    // live: a designer types a new value / range
    expect(size(5, 7, { JUN: 60 })[1]).toBeCloseTo((PH * 60) / 150, 3);
    expect(size(5, 7, { 'Axis Max': 300 })[1]).toBeCloseTo((PH * 128) / 300, 3);
    expect(size(0, 7)[0]).toBeGreaterThan(50); // Bar Width % of the slot
    // the square base keeps the bottom corners square
    expect(run(r, bar(5), itemExpr(bar(5), ['Square Base'], 'Rect Size'), 7)[1]).toBe(6);
    const val = layer(r, 'rev.val5');
    expect(val.text.text).toBe('$128k'); // measured at the final width
    expect(run(r, val, prop(val, 'ADBE Text Document').expr, 7)).toBe('$128k');
    expect(run(r, val, prop(val, 'ADBE Text Document').expr, 7, { JUN: 1234.5, Decimals: 1 })).toBe('$1,234.5k');
    const mv = run(r, val, prop(val, 'ADBE Text Document').expr, 0.5 + 5 * 0.08 + 0.15);
    expect(Number(mv.replace(/[^0-9.]/g, ''))).toBeLessThan(128);
    // the label sits above the bar's top
    const pos = run(r, val, prop(val, 'ADBE Position').expr, 7);
    expect(pos[1]).toBeLessThan(layer(r, 'rev.bar5').props.find((s: any) => s.p.endsWith('ADBE Position')).v[1] - (PH * 128) / 150);
    // tick labels follow Axis Max live
    const tick = layer(r, 'rev.tick6');
    expect(tick.text.text).toBe('$150k');
    expect(run(r, tick, prop(tick, 'ADBE Text Document').expr, 7, { 'Axis Max': 300 })).toBe('$300k');
  });

  it('highlight: the chosen bar turns the highlight color and punches, the others dim', () => {
    const r = build(bars({ highlight: { at: 'JUN', color: '#ff0000', dim: 30 } }));
    expect(r.rigs.get('rev.ctl')!['Bar Chart'].Highlight).toBe(7); // None, JAN…JUN
    const fill = (i: number, t: number, set?: any) => run(r, layer(r, `rev.bar${i}`), itemExpr(layer(r, `rev.bar${i}`), ['ADBE Vector Graphic - Fill'], 'Fill Color'), t, set);
    expect(fill(5, 7)[0]).toBeCloseTo(1, 3);
    expect(fill(4, 7)).toEqual(parseColor('#4683c4'));
    const op = (i: number, t: number, set?: any) => run(r, layer(r, `rev.bar${i}`), prop(layer(r, `rev.bar${i}`), 'ADBE Opacity').expr, t, set);
    expect(op(0, 7)).toBeCloseTo(30, 3);
    expect(op(5, 7)).toBe(100);
    expect(op(0, 0.5)).toBe(100); // before the highlight
    expect(op(0, 7, { Highlight: 1 })).toBe(100); // switched off live
    const land = 0.5 + 5 * 0.08 + 0.9 + 0.25;
    const sc = run(r, layer(r, 'rev.bar5'), prop(layer(r, 'rev.bar5'), 'ADBE Scale').expr, land + 0.2);
    expect(sc[0]).toBeGreaterThan(104); // punch
    expect(run(r, layer(r, 'rev.bar5'), prop(layer(r, 'rev.bar5'), 'ADBE Scale').expr, 7)[0]).toBeCloseTo(100, 3);
  });

  it('exit: in a Sequence that ends before the comp, the bars shrink back by the out point; a final chart holds', () => {
    const r = build(bars(), { seq: [0, 4], dur: 8 });
    const b5 = layer(r, 'rev.bar5');
    const h = (t: number) => run(r, b5, itemExpr(b5, ['Bar'], 'Rect Size'), t)[1];
    expect(h(3.4)).toBeGreaterThan(300);
    expect(h(4 - 1 / 30)).toBeLessThan(0.5); // gone on the last frame
    const held = build(bars(), { dur: 4 });
    const hb = layer(held, 'rev.bar5');
    expect(run(held, hb, itemExpr(hb, ['Bar'], 'Rect Size'), 3.99)[1]).toBeGreaterThan(300);
    expect(run(held, hb, itemExpr(hb, ['Bar'], 'Rect Size'), 4 - 1 / 30, { Exit: 2 })[1]).toBeLessThan(0.5); // Exit: On
  });

  it('grouped, stacked and horizontal', () => {
    const series = [{ name: '2025', values: [38, 44, 21] }, { name: '2026', values: [52, 57, 36] }];
    const g = build(BarChart({ id: 'g', series, labels: ['EU', 'NA', 'APAC'] }));
    const gv = g.rigs.get('g.ctl')!['Bar Chart'];
    expect(gv).toMatchObject({ '2025 EU': 38, '2026 APAC': 36, '2025 Color': '#4683c4', '2026 Color': '#ffd23f' });
    const x = (id: string) => layer(g, id).props.find((s: any) => s.p.endsWith('ADBE Position')).v[0];
    expect(x('g.bar0_0')).toBeLessThan(x('g.bar1_0'));
    expect(main(g).layers.some((l: any) => l.id === 'g.key1')).toBe(true); // legend
    expect(runAll(g, [0, 0.6, 1.2, 7.9])).toBeGreaterThan(50);

    const s = build(StackedBarChart({ id: 's', series: [{ name: 'A', values: [10, 20] }, { name: 'B', values: [5, 5] }], labels: ['Q1', 'Q2'] }));
    expect(s.rigs.get('s.ctl')!['Bar Chart']['Axis Max']).toBe(25); // totals 15, 25
    const seg = (sid: string, t: number) => { const L = layer(s, sid); return [run(s, L, itemExpr(L, ['Bar'], 'Rect Size'), t)[1], run(s, L, itemExpr(L, ['Bar'], 'Rect Position'), t)[1]]; };
    const [hA, yA] = seg('s.bar0_1', 7), [hB, yB] = seg('s.bar1_1', 7);
    expect(hB / hA).toBeCloseTo(0.25, 3);
    expect(-yB - hB / 2).toBeCloseTo(hA, 3); // B starts where A ends
    expect(-yA - hA / 2).toBeCloseTo(0, 3);
    const total = layer(s, 's.val1');
    expect(run(s, total, prop(total, 'ADBE Text Document').expr, 7)).toBe('25');
    expect(main(s).layers.some((l: any) => l.id === 's.val0_1')).toBe(false); // totals only

    const h = build(BarChart({ id: 'h', orientation: 'horizontal', data: MONTHS.slice(0, 3) }));
    const hb = layer(h, 'h.bar2');
    const sz = run(h, hb, itemExpr(hb, ['Bar'], 'Rect Size'), 7);
    expect(sz[0]).toBeGreaterThan(sz[1]); // grows along x
    expect(run(h, hb, itemExpr(hb, ['Bar'], 'Rect Position'), 7)[0]).toBeCloseTo(sz[0] / 2, 3);
    expect(layer(h, 'h.cat0').anchorBox).toBeDefined();
  });

  it('annotate: a leader and a text that arrive after the data lands and hold', () => {
    const r = build(bars({ annotate: { at: 'JUN', text: 'Record month' } }));
    expect(r.rigs.get('rev.ctl')!['Bar Chart']['Callout After']).toBe(0.45);
    const line = layer(r, 'rev.callout'), text = layer(r, 'rev.calloutText');
    expect(text.text.text).toBe('Record month');
    const land = 0.5 + 5 * 0.08 + 0.9 + 0.45;
    const trim = (t: number) => run(r, line, itemExpr(line, ['ADBE Vector Filter - Trim'], 'Trim End'), t);
    expect(trim(land - 0.05)).toBe(0);
    expect(trim(land + 0.6)).toBeCloseTo(100, 3);
    const op = (t: number) => run(r, text, prop(text, 'ADBE Opacity').expr, t);
    expect(op(land)).toBe(0);
    expect(op(7)).toBeCloseTo(100, 3);
    const lp = run(r, line, prop(line, 'ADBE Position').expr, 7);
    expect(lp[1]).toBeLessThan(run(r, layer(r, 'rev.val5'), prop(layer(r, 'rev.val5'), 'ADBE Position').expr, 7)[1]); // above the value label
  });

  it('pop style uses the spring; every expression evaluates', () => {
    const r = build(bars({ style: 'pop', highlight: 'MAY', annotate: { at: 3, text: 'Launch' } }));
    expect(r.rigs.get('rev.ctl')!['Bar Chart'].Easing).toBe(6);
    expect(runAll(r, [0, 0.4, 0.8, 1.3, 2, 2.5, 7.99])).toBeGreaterThan(200);
  });

  it('labels become param names when they can (no clash with the rig, no "/", unique)', () => {
    const r = build(BarChart({ id: 'n', data: [{ label: 'Delay', value: 1 }, { label: 'A/B', value: 2 }, { label: 'A-B', value: 3 }] }));
    const v = r.rigs.get('n.ctl')!['Bar Chart'];
    expect(v).toMatchObject({ Delay: 0.5, 'Value 1': 1, 'A-B': 2, 'Value 3': 3 });
    expect(runAll(r, [0, 1, 7])).toBeGreaterThan(30);
  });

  it('rejects bad input with messages that say what to change', () => {
    expect(() => build(BarChart({ data: [1] } as any))).toThrow(/needs an id/);
    expect(() => build(BarChart({ id: 'x', data: [1, 2], highlight: 'NOPE' }))).toThrow(/no category "NOPE"/);
    expect(() => build(BarChart({ id: 'x', data: [1, 2], width: 80, height: 80 }))).toThrow(/make it larger/);
  });
});

// ---------- line & area ----------
describe('LineChart / AreaChart', () => {
  const series = [{ name: '2025', values: [100, 62, 48, 41] }, { name: '2026', values: [100, 74, 63, 57] }];
  it('the path is a createPath expression over the live values; Trim draws it on; points pop as the line reaches them', () => {
    const r = build(LineChart({ id: 'ret', series, labels: ['D1', 'D7', 'D14', 'D30'], highlight: 'D30', annotate: { at: 'D30', series: 1, text: 'Best yet' } }));
    const vals = r.rigs.get('ret.ctl')!['Line Chart'];
    expect(vals).toMatchObject({ '2025 D1': 100, '2026 D30': 57, 'Line Width': 6, Easing: 5 });
    const line = layer(r, 'ret.line1');
    const pathExpr = prop(line, 'ADBE Root Vectors Group/Line/ADBE Vector Shape').expr;
    const path7 = run(r, line, pathExpr, 7);
    expect(path7.pts).toHaveLength(4);
    expect(path7.closed).toBe(false);
    const y = (v: number, set?: any) => run(r, line, pathExpr, 7, set).pts[3][1];
    expect(y(57, { '2026 D30': 0 })).toBeGreaterThan(path7.pts[3][1]); // lower value = lower on screen
    expect(path7.pts[0][1]).toBeLessThan(path7.pts[3][1]);
    const trimEnd = (t: number) => run(r, line, itemExpr(line, ['ADBE Vector Filter - Trim'], 'Trim End'), t);
    expect(trimEnd(0.4)).toBe(0);
    expect(trimEnd(1.3)).toBeGreaterThan(0);
    expect(trimEnd(2.2)).toBeCloseTo(100, 3);
    // points: the first pops at once, the last only when the line arrives
    const pop = (i: number, t: number) => run(r, layer(r, `ret.dot1_${i}`), prop(layer(r, `ret.dot1_${i}`), 'ADBE Scale').expr, t)[0];
    expect(pop(0, 0.8)).toBeGreaterThan(50);
    expect(pop(3, 0.8)).toBe(0);
    expect(pop(3, 2.6)).toBeGreaterThan(90);
    const dotPos = run(r, layer(r, 'ret.dot1_3'), prop(layer(r, 'ret.dot1_3'), 'ADBE Position').expr, 7);
    expect(dotPos).toEqual(path7.pts[3]);
    expect(runAll(r, [0, 0.7, 1.4, 2.1, 3, 7.99])).toBeGreaterThan(200);
  });
  it('rise style: points rise from the baseline with a stagger', () => {
    const r = build(LineChart({ id: 'l', data: [3, 5, 4], style: 'rise', curve: 'linear' }));
    const L = layer(r, 'l.line');
    const e = prop(L, 'Line/ADBE Vector Shape').expr;
    const p0 = run(r, L, e, 0.55), p1 = run(r, L, e, 7);
    expect(p0.pts[2][1]).toBeGreaterThan(p1.pts[2][1]);
    expect(p1.ins.every((v: number[]) => v[0] === 0 && v[1] === 0)).toBe(true);
  });
  it('AreaChart: a closed area under the line, with a gradient to transparent (or a live solid fill)', () => {
    const r = build(AreaChart({ id: 'pl', data: [310, 380, 360, 450] }));
    const A = layer(r, 'pl.area');
    const items = A.groups[0].items;
    expect(items.some((x: any) => /G-Fill/.test(x.mn))).toBe(true);
    const e = prop(A, 'Area/ADBE Vector Shape').expr;
    const done = run(r, A, e, 7);
    expect(done.closed).toBe(true);
    expect(done.pts).toHaveLength(6);
    const line = run(r, layer(r, 'pl.line'), prop(layer(r, 'pl.line'), 'Line/ADBE Vector Shape').expr, 7);
    expect(done.pts.slice(0, 4)).toEqual(line.pts); // the area's top is the line
    const early = run(r, A, e, 0.7);
    expect(early.pts[3][1]).toBeCloseTo(done.pts[4][1], 3); // the last point hasn't risen yet
    expect(r.rigs.get('pl.ctl')!['Area Chart']).toBeDefined();
    const solid = build(AreaChart({ id: 'pl', data: [1, 2, 3], area: { gradient: false, opacity: 40 } }));
    expect(solid.rigs.get('pl.ctl')!['Area Chart']['Area Opacity']).toBe(40);
    expect(runAll(solid, [0, 1, 2, 7])).toBeGreaterThan(40);
  });
});

// ---------- donut & pie ----------
describe('DonutChart / PieChart', () => {
  const MIX = [{ label: 'HARDWARE', value: 46 }, { label: 'SOFTWARE', value: 31 }, { label: 'SERVICES', value: 23 }];
  it('segments trim to their share of the live total; labels count their percentage; the centre counts the total', () => {
    const r = build(DonutChart({ id: 'mix', data: MIX, gap: 0, center: { label: 'REVENUE', format: { prefix: '$', suffix: 'k' } } }));
    const v = r.rigs.get('mix.ctl')!['Donut Chart'];
    expect(v).toMatchObject({ HARDWARE: 46, 'HARDWARE Color': '#4683c4', Gap: 0, 'Start Angle': 0 });
    const trim = (i: number, which: string, t: number, set?: any) => { const L = layer(r, `mix.seg${i}`); return run(r, L, itemExpr(L, ['ADBE Vector Filter - Trim'], which), t, set); };
    expect(trim(0, 'Trim Start', 7)).toBeCloseTo(0, 3);
    expect(trim(0, 'Trim End', 7)).toBeCloseTo(46, 3);
    expect(trim(1, 'Trim Start', 7)).toBeCloseTo(46, 3);
    expect(trim(2, 'Trim End', 7)).toBeCloseTo(100, 3);
    expect(trim(0, 'Trim End', 7, { HARDWARE: 0 })).toBeCloseTo(0, 3); // live re-flow
    expect(trim(1, 'Trim Start', 7, { HARDWARE: 0 })).toBeCloseTo(0, 3);
    expect(trim(2, 'Trim End', 0.5)).toBeCloseTo(77, 3); // not started: start == end
    const pct = layer(r, 'mix.pct0');
    expect(pct.text.text).toBe('46%');
    expect(run(r, pct, prop(pct, 'ADBE Text Document').expr, 7)).toBe('46%');
    const tot = layer(r, 'mix.total');
    expect(tot.text.text).toBe('$100k');
    expect(run(r, tot, prop(tot, 'ADBE Text Document').expr, 7)).toBe('$100k');
    expect(layer(r, 'mix.totalLabel').text.text).toBe('REVENUE');
    expect(runAll(r, [0, 0.5, 1, 1.5, 2.5, 7.99])).toBeGreaterThan(100);
  });
  it('pie: solid (thickness = radius), sweep style, highlight pulls a wedge out', () => {
    const r = build(PieChart({ id: 'pie', data: [46, 34, 20], style: 'sweep', highlight: 1 }));
    const v = r.rigs.get('pie.ctl')!['Pie Chart'];
    expect(v.Thickness).toBe(v.Radius);
    const seg = layer(r, 'pie.seg1');
    const d = run(r, seg, itemExpr(seg, ['Ring'], 'Ellipse Size'), 7);
    expect(d[0]).toBe(v.Radius);
    const base = seg.props.find((s: any) => s.p.endsWith('ADBE Position') && s.v).v;
    const pos = run(r, seg, prop(seg, 'ADBE Position').expr, 7, {}, base);
    expect(Math.hypot(pos[0] - base[0], pos[1] - base[1])).toBeGreaterThan(5);
    expect(main(r).layers.some((l: any) => l.id === 'pie.total')).toBe(false);
    expect(runAll(r, [0, 0.8, 1.5, 7.99])).toBeGreaterThan(50);
  });
});

// ---------- counter ----------
describe('Counter', () => {
  it('a Text whose Source Text counts From → Value from its own "Counter" effect, formatted by L.num', () => {
    const r = build(Counter({ id: 'n', value: 1200000, prefix: '$', suffix: '+', delay: 0.5, font: 'Inter-Black', size: 120 }));
    const L = layer(r, 'n');
    expect(L.type).toBe('text');
    expect(L.text.text).toBe('$1,200,000+');
    expect(L.groups[0].items[0].name).toBe('Counter');
    const e = prop(L, 'ADBE Text Document').expr;
    expect(e).toMatch(/^function aecLib\(\)/m);
    expect(run(r, L, e, 0.4)).toBe('$0+');
    const mid = Number(run(r, L, e, 0.9).replace(/[^0-9]/g, ''));
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1200000);
    expect(run(r, L, e, 5)).toBe('$1,200,000+');
    expect(run(r, L, e, 5, { Value: 42.5, Decimals: 1 })).toBe('$42.5+');
    const c = build(Counter({ id: 'c', value: control('Users', 300), easing: 'spring' }));
    expect(c.rigs.get('c')!.Counter.Easing).toBe(6);
    expect(prop(layer(c, 'c'), 'ADBE Text Document').expr).toContain('L.spring(');
  });
});

// ---------- the integration scene ----------
describe('dataviz integration scene', () => {
  it('compiles to a valid IR and every expression evaluates over the whole timeline', async () => {
    const { def, file } = await loadScene({ file: path.resolve('tests/integration/dataviz-scene.tsx') });
    const r: any = compileScene(def, { sceneFile: file });
    r.rigs = rigsOf(def.render({ seed: 1 } as any));
    expect(() => validateIr(r.ir)).not.toThrow();
    const c = main(r);
    expect(c).toMatchObject({ w: 1920, h: 1080, fps: 30 });
    expect(c.dur).toBeLessThanOrEqual(10);
    for (const id of ['rev.ctl', 'players.ctl', 'platforms.ctl', 'mix.ctl', 'retention.ctl', 'quarters.ctl', 'regions.ctl', 'play.count']) expect(c.layers.some((l: any) => l.id === id)).toBe(true);
    const times = Array.from({ length: 21 }, (_, k) => Math.min(9.99, k * 0.5));
    expect(runAll(r, times)).toBeGreaterThan(2000);
  }, 60_000);
});
