// Keys/easing integration: what compileScene emits for tweens and springs, checked against the ease math.
import { describe, expect, it } from 'vitest';
import { jsx } from '../../src/dsl/jsx-runtime.ts';
import { scene, Composition, Solid, Shape, Rect, Fill, tween, spring, keys } from '../../src/dsl/index.ts';
import { compileScene } from '../../src/compile/compile.ts';
import { curveKnots, knotsToKeys } from '../../src/compile/keys.ts';
import { aeSegmentValue, bezierToEase, cssBezier } from '../../src/shared/bezier.ts';
import { resolveEasing } from '../../src/shared/easing.ts';
import { spring as springValue } from '../../src/shared/spring.ts';

const h = (type: any, props: Record<string, any> | null = {}, ...children: any[]) =>
  jsx(type, children.length ? { ...(props ?? {}), children: children.length === 1 ? children[0] : children } : { ...(props ?? {}) });
const solid = (props: Record<string, any>, cfg: Record<string, any> = {}) =>
  compileScene(scene({ name: 'K', duration: 4, ...cfg } as any, () => h(Composition, {}, h(Solid, { id: 's', ...props })))).ir.comps[0].layers[0];
const prop = (L: any, p: string) => L.props.find((s: any) => s.p === p);
const TG = 'ADBE Transform Group';

/** Value of a 1-D AE key list at time t (bezier segments, holds). */
function evalKeys(ks: any[], t: number, dim = 0): number {
  const val = (k: any) => (Array.isArray(k.v) ? k.v[dim] : k.v);
  if (t <= ks[0].t) return val(ks[0]);
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i], b = ks[i + 1];
    if (t > b.t) continue;
    if (a.o === 'hold') return val(a);
    const oe = a.oe[Math.min(dim, a.oe.length - 1)], ie = b.ie[Math.min(dim, b.ie.length - 1)];
    return aeSegmentValue(a.t, b.t, val(a), val(b), oe.speed, oe.influence / 100, ie.speed, ie.influence / 100, t);
  }
  return val(ks[ks.length - 1]);
}

describe('tween → exact 2-key bezier', () => {
  it("'easeOutCubic' on opacity: 2 keys, influence 33.33 / 33.33, speeds equal bezierToEase", () => {
    const op = prop(solid({ animate: { opacity: tween({ from: 0, to: 100, duration: 0.8, delay: 0.5, easing: 'easeOutCubic' }) } }), `${TG}/ADBE Opacity`);
    expect(op.keys).toHaveLength(2);
    const [k0, k1] = op.keys;
    expect([k0.t, k0.v, k1.v]).toEqual([0.5, 0, 100]);
    expect(k1.t).toBeCloseTo(1.3, 12);
    expect(k0.oe).toHaveLength(1);
    expect(k0.oe[0].influence).toBeCloseTo(100 / 3, 9);
    expect(k1.ie[0].influence).toBeCloseTo(100 / 3, 9);
    const ref = bezierToEase(resolveEasing('easeOutCubic').bezier!, 100, 0.8);
    expect(k0.oe[0].speed).toBeCloseTo(ref.out.speed, 9);
    expect(k1.ie[0].speed).toBeCloseTo(ref.in.speed, 9);
    expect(k0.oe[0].speed).toBeCloseTo(375, 9); // 3 × 100 / 0.8
    expect(k1.ie[0].speed).toBe(0);
    expect(k0.i ?? 'bezier').toBe('bezier');
    expect(op.expr).toBeUndefined();
  });
  it('the 2 keys reproduce the CSS curve in AE (sampled)', () => {
    for (const name of ['easeOutCubic', 'easeInOutQuart', 'snappy', 'easeOutBack', 'smooth']) {
      const op = prop(solid({ animate: { opacity: tween({ from: 20, to: 90, duration: 1.2, easing: name }) } }), `${TG}/ADBE Opacity`);
      expect(op.keys, name).toHaveLength(2);
      const b = resolveEasing(name).bezier!;
      for (let i = 0; i <= 48; i++) {
        const t = (i / 48) * 1.2;
        expect(Math.abs(evalKeys(op.keys, t) - (20 + 70 * cssBezier(b, t / 1.2))), `${name} @ ${t}`).toBeLessThan(1e-6);
      }
    }
  });
  it('multi-dimensional props get one ease per dimension, scaled by each dimension\'s delta', () => {
    const sc = prop(solid({ animate: { scale: tween({ from: [0, 50], to: [100, 100], duration: 0.5, easing: 'easeOutQuart' }) } }), `${TG}/ADBE Scale`);
    const [k0, k1] = sc.keys;
    expect(k0.v).toEqual([0, 50, 100]);
    expect(k1.v).toEqual([100, 100, 100]);
    const b = resolveEasing('easeOutQuart').bezier!;
    expect(k0.oe.map((e: any) => e.speed)).toEqual([100, 50, 0].map((dv) => expect.closeTo(bezierToEase(b, dv, 0.5).out.speed, 9)));
    expect(k0.oe.every((e: any) => Math.abs(e.influence - 25) < 1e-9)).toBe(true);
  });
  it('cubic-bezier strings and tuples are exact too; the default easing is easeOutCubic', () => {
    const a = prop(solid({ animate: { opacity: tween({ from: 0, duration: 1, easing: 'cubic-bezier(0.2, 0.8, 0.4, 1)' }) } }), `${TG}/ADBE Opacity`).keys;
    const b = prop(solid({ animate: { opacity: tween({ from: 0, duration: 1, easing: [0.2, 0.8, 0.4, 1] }) } }), `${TG}/ADBE Opacity`).keys;
    expect(a).toEqual(b);
    expect(a[0].oe[0].influence).toBeCloseTo(20, 9);
    expect(a[0].oe[0].speed).toBeCloseTo(400, 9); // (0.8 / 0.2) × 100 / 1
    const d = prop(solid({ animate: { opacity: tween({ from: 0, duration: 1 }) } }), `${TG}/ADBE Opacity`).keys;
    expect(d[0].oe[0].influence).toBeCloseTo(100 / 3, 9);
    expect(d[0].oe[0].speed).toBeCloseTo(300, 9);
  });
  it('non-bezier easings are baked into more keys within tolerance', () => {
    const op = prop(solid({ animate: { opacity: tween({ from: 0, to: 100, duration: 1, easing: 'bounce' }) } }), `${TG}/ADBE Opacity`);
    expect(op.keys.length).toBeGreaterThanOrEqual(5);
    const fn = resolveEasing('bounce').fn;
    for (let i = 0; i <= 60; i++) expect(Math.abs(evalKeys(op.keys, i / 60) - 100 * fn(i / 60))).toBeLessThan(0.15);
  });
  it('unknown easing names fail with suggestions', () => {
    expect(() => solid({ animate: { opacity: tween({ from: 0, duration: 1, easing: 'easeOutCubik' }) } })).toThrow(/unknown easing "easeOutCubik"\. Did you mean: .*easeOutCubic/);
  });
});

describe('spring → fitted keys', () => {
  it('a spring on x: separated position, ≥ 3 keys, ending exactly at the target, matching the spring', () => {
    const L = solid({ animate: { x: spring({ from: -200, delay: 0.25 }) } });
    expect(prop(L, `${TG}/ADBE Position`)).toEqual({ p: `${TG}/ADBE Position`, sep: true });
    expect(prop(L, `${TG}/ADBE Position_1`)).toEqual({ p: `${TG}/ADBE Position_1`, v: 540 });
    const x = prop(L, `${TG}/ADBE Position_0`);
    const ks = x.keys;
    expect(ks.length).toBeGreaterThanOrEqual(3);
    expect(ks[0].t).toBeCloseTo(0.25, 9);
    expect(ks[0].v).toBe(760);
    const last = ks[ks.length - 1];
    expect(last.v).toBe(960); // exactly the rest value, not 959.x
    expect(last.ie[0].speed).toBe(0);
    for (let i = 1; i < ks.length; i++) expect(ks[i].t).toBeGreaterThan(ks[i - 1].t);
    for (const k of ks) {
      expect(typeof k.v).toBe('number');
      for (const e of [...k.ie, ...k.oe]) {
        expect(e.influence).toBeGreaterThanOrEqual(0.1);
        expect(e.influence).toBeLessThanOrEqual(100);
      }
    }
    // overshoots past 960 (default damping 10), and follows Remotion's spring within the 0.1 px tolerance
    // on every segment but the last one (whose end is snapped to the target, see the it.fails below)
    expect(Math.max(...ks.map((k: any) => k.v))).toBeGreaterThan(960);
    const tLast = ks[ks.length - 2].t;
    for (let f = 0; 0.25 + f / 30 <= tLast; f += 0.25) {
      const t = 0.25 + f / 30;
      const ref = springValue({ frame: f, fps: 30, from: 760, to: 960 });
      expect(Math.abs(evalKeys(ks, t) - ref), `t=${t}`).toBeLessThan(0.1);
    }
  });
  // Regression (was a bug, fixed): the final spring knot is snapped to p = 1 / slope 0 AFTER its segment was fitted (src/compile/keys.ts:40-42),
  // so the last segment drifts from Remotion's curve by up to ~0.6 % of the travel (1.2 px on this 200 px move at
  // t = 1.1 s; ~6 px on a 1000 px move): more than TOL.px (0.1 px) and more than Remotion's own 0.5 % rest threshold.
  it("a spring stays within Remotion's rest threshold (0.5 % of the travel) all the way to the last key", () => {
    const ks = prop(solid({ animate: { x: spring({ from: -200, delay: 0.25 }) } }), `${TG}/ADBE Position_0`).keys;
    const end = ks[ks.length - 1].t;
    for (let f = 0; 0.25 + f / 30 <= end + 1e-9; f += 0.25) {
      const t = 0.25 + f / 30;
      expect(Math.abs(evalKeys(ks, t) - springValue({ frame: f, fps: 30, from: 760, to: 960 })), `t=${t}`).toBeLessThanOrEqual(0.005 * 200);
    }
  });
  it('a spring on y alone also separates; x stays static', () => {
    const L = solid({ x: 300, animate: { y: spring({ from: 80, damping: 14 }) } });
    expect(prop(L, `${TG}/ADBE Position_0`)).toEqual({ p: `${TG}/ADBE Position_0`, v: 300 });
    const y = prop(L, `${TG}/ADBE Position_1`).keys;
    expect(y[0].v).toBe(620);
    expect(y[y.length - 1].v).toBe(540);
  });
  it('position given as a whole with a non-overshooting tween stays unseparated', () => {
    const L = solid({ animate: { position: tween({ from: [0, 0], to: [100, 50], duration: 1 }) } });
    const pos = prop(L, `${TG}/ADBE Position`);
    expect(pos.sep).toBeUndefined();
    expect(pos.keys.map((k: any) => k.v)).toEqual([[0, 0], [100, 50]]);
  });
  it('spring duration stretches the settle time exactly', () => {
    const ks = prop(solid({ animate: { opacity: spring({ from: 0, to: 100, duration: 1, damping: 200 }) } }), `${TG}/ADBE Opacity`).keys;
    expect(ks[0].t).toBe(0);
    expect(ks[ks.length - 1].t).toBeCloseTo(1, 6);
    expect(ks[ks.length - 1].v).toBe(100);
  });
  it('rig: "expression" emits a closed-form spring expression instead of keys', () => {
    const op = prop(solid({ animate: { opacity: spring({ from: 0, to: 100, rig: 'expression', stiffness: 150 }) } }), `${TG}/ADBE Opacity`);
    expect(op.keys).toBeUndefined();
    expect(op.v).toBe(100);
    expect(op.expr).toContain('var k = 150, c = 10, m = 1;');
    expect(op.expr.trim().endsWith('0 + (100 - 0) * x;')).toBe(true);
    const fn = new Function('time', 'thisComp', `${op.expr.replace(/([^\n]*)$/, 'return $1')}`) as (t: number, c: any) => number;
    for (const f of [0, 5, 12, 30]) expect(fn(f / 30, { frameDuration: 1 / 30 })).toBeCloseTo(springValue({ frame: f, fps: 30, from: 0, to: 100, stiffness: 150 }), 9);
  });
  it('a spring on a shape (fill color) uses per-channel eases and ends on the target color', () => {
    const r = compileScene(scene({ name: 'C', duration: 3 }, () => h(Composition, {}, h(Shape, {}, h(Rect, {}), h(Fill, { color: spring({ from: '#000000' as any, to: '#ff8000' as any }) })))));
    const fill = r.ir.comps[0].layers[0].groups[0].items[1].props[0];
    const last = fill.keys[fill.keys.length - 1];
    expect(last.v).toEqual([1, 128 / 255, 0, 1]);
    expect(last.ie).toHaveLength(4);
  });
});

describe('keys() and knotsToKeys', () => {
  it('per-segment easing; hold keys; values convert per property', () => {
    const op = prop(solid({ animate: { opacity: keys({ t: 0, v: 0, easing: 'easeOutCubic' }, { t: 0.5, v: 100, hold: true }, { t: 1, v: 0, easing: 'linear' }, { t: 2, v: 50 }) } }), `${TG}/ADBE Opacity`);
    expect(op.keys.map((k: any) => [k.t, k.v, k.o ?? 'bezier'])).toEqual([[0, 0, 'bezier'], [0.5, 100, 'hold'], [1, 0, 'bezier'], [2, 50, 'bezier']]);
    expect(op.keys[0].oe[0].influence).toBeCloseTo(100 / 3, 9);
    expect(evalKeys(op.keys, 0.75)).toBe(100); // held
  });
  it('knotsToKeys: spatial and color kinds take a single ease (path speed, color in 0–255 units)', () => {
    const kn = curveKnots(resolveEasing('easeOutCubic'), 1, 30, 0.001);
    const sp = knotsToKeys(kn, [0, 0], [300, 400], 2, 'spatial');
    expect(sp.map((k) => k.t)).toEqual([2, 3]);
    expect(sp[0].oe).toEqual([{ speed: expect.closeTo(1500, 9), influence: expect.closeTo(100 / 3, 9) }]); // |Δ| = 500
    const col = knotsToKeys(kn, [0, 0, 0, 1], [1, 0, 0, 1], 0, 'color');
    expect(col[0].oe![0].speed).toBeCloseTo(3 * 255, 9);
    const one = knotsToKeys(kn, [10], [20], 0, 'oneD');
    expect(one.map((k) => k.v)).toEqual([10, 20]);
    const multi = knotsToKeys(kn, [0, 10], [30, 10], 0, 'multi');
    expect(multi[0].oe!.map((e) => e.speed)).toEqual([expect.closeTo(90, 9), 0]);
  });
  it('curveKnots: bezier curves give exactly 2 knots; x1 = 0 is clamped to AE\'s 0.1 % influence', () => {
    const kn = curveKnots(resolveEasing('linear'), 2, 30, 0.001);
    expect(kn).toHaveLength(2);
    expect(kn[0].outInf).toBeCloseTo(0.001, 12);
    expect(kn[1].inInf).toBeCloseTo(0.001, 12);
  });
});
