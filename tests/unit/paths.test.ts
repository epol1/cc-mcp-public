// P3 path tools: shape-morph matching (pure, on real shapes) and the FollowPath / Trail / Echo / DrawOn / Morph
// components compiled to IR. No AE.
import { describe, expect, it } from 'vitest';
import { compileScene } from '../../src/compile/compile.ts';
import { scene } from '../../src/dsl/scene.ts';
import { jsx } from '../../src/dsl/jsx-runtime.ts';
import { Composition, Shape, Ellipse, Fill, Text, tween, control } from '../../src/dsl/index.ts';
import { FollowPath, Trail, Echo, DrawOn, Morph } from '../../src/dsl/paths.ts';
import { parseSvgPath } from '../../src/shared/svgpath.ts';
import { matchShapes, matchSequence, resample, reverseShape, rotateShape, flatten, shapeLength, signedArea, travel, segmentCount, cubicPoint, segment } from '../../src/shared/morph.ts';
import type { AeShape } from '../../src/shared/svgpath.ts';
import { validateIr } from '../../src/ir/schema.ts';
import { loadScene } from '../../src/scene/load.ts';
import { expressionsOf, isFinite, runExpr } from './ae-expr-mock.ts';
import path from 'node:path';

const h = (type: any, props: Record<string, any> | null = {}, ...children: any[]) =>
  jsx(type, children.length ? { ...(props ?? {}), children: children.length === 1 ? children[0] : children } : { ...(props ?? {}) });
const build = (body: () => any) => compileScene(scene({ name: 'P', duration: 4 }, () => h(Composition, {}, body())));
const main = (r: any) => r.ir.comps.find((c: any) => c.id === r.ir.main);
const layer = (r: any, id: string) => { const L = main(r).layers.find((l: any) => l.id === id); if (!L) throw new Error(`no layer ${id}`); return L; };
const expr = (L: any, p: string) => (L.props ?? []).find((s: any) => s.p.endsWith(p) && s.expr)?.expr as string;
const one = (d: string) => parseSvgPath(d)[0];

const CIRCLE = 'M0 -100 A100 100 0 1 1 0 100 A100 100 0 1 1 0 -100 Z';
const star = (n = 5, R = 100, r = 45) => 'M' + Array.from({ length: 2 * n }, (_, i) => { const a = (-90 + (i * 180) / n) * Math.PI / 180, rad = i % 2 ? r : R; return `${(rad * Math.cos(a)).toFixed(3)} ${(rad * Math.sin(a)).toFixed(3)}`; }).join(' L') + ' Z';
const SQUARE = 'M-100 -100 L100 -100 L100 100 L-100 100 Z';
const TRIANGLE = 'M0 -110 L110 90 L-110 90 Z';

/** Max distance of the outline of `s` from a circle of radius r about the origin. */
const offCircle = (s: AeShape, r: number) => Math.max(...flatten(s, 24).map((p) => Math.abs(Math.hypot(p[0], p[1]) - r)));
/** Max distance of points of `s` from the polygon edges of `ref` (straight segments). */
const offPolygon = (s: AeShape, ref: AeShape) => Math.max(...flatten(s, 8).map((p) => Math.min(...ref.v.map((a, k) => {
  const b = ref.v[(k + 1) % ref.v.length], ex = b[0] - a[0], ey = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / (ex * ex + ey * ey)));
  return Math.hypot(p[0] - (a[0] + t * ex), p[1] - (a[1] + t * ey));
}))));

describe('morph matching (src/shared/morph.ts)', () => {
  it('resample subdivides the longest segments and keeps the outline exactly', () => {
    const c = one(CIRCLE);
    expect(c.v).toHaveLength(4);
    const r = resample(c, 10);
    expect(r.v).toHaveLength(10);
    expect(offCircle(r, 100)).toBeLessThan(0.15); // the arc approximation's own error
    expect(Math.abs(shapeLength(r) - shapeLength(c)) / shapeLength(c)).toBeLessThan(5e-4);
    // spread evenly: 3, 3, 2, 2 pieces over the four quarter arcs
    const ang = r.v.map((v) => Math.round((Math.atan2(v[1], v[0]) * 180) / Math.PI));
    expect(ang).toEqual([-90, -60, -30, 0, 30, 60, 90, 135, 180, -135]);
    expect(r.v.every((v) => Math.abs(Math.hypot(v[0], v[1]) - 100) < 0.15)).toBe(true);
  });
  it('circle → star: 10 vertices each, same winding, the tip at the top meets the top of the circle', () => {
    const m = matchShapes(one(CIRCLE), one(star()));
    expect(m.a.v).toHaveLength(10);
    expect(m.b.v).toHaveLength(10);
    expect(Math.sign(signedArea(m.a))).toBe(Math.sign(signedArea(m.b)));
    expect(offCircle(m.a, 100)).toBeLessThan(0.15);
    // No other start vertex travels less.
    for (let r = 1; r < 10; r++) expect(travel(m.a, rotateShape(m.b, r))).toBeGreaterThanOrEqual(m.cost - 1e-6);
    // Every vertex moves to a star point at a nearby angle (no twist through the middle).
    const angle = (v: number[]) => Math.atan2(v[1], v[0]) * 180 / Math.PI;
    const dev = m.a.v.map((v, k) => { const d = Math.abs(angle(v) - angle(m.b.v[k])) % 360; return Math.min(d, 360 - d); });
    expect(Math.max(...dev)).toBeLessThan(40);
    expect(m.reversed).toBe(false);
  });
  it('square → triangle: the triangle gets a fourth vertex on its longest edge; corners pair up', () => {
    const m = matchShapes(one(SQUARE), one(TRIANGLE));
    expect(m.b.v).toHaveLength(4);
    expect(offPolygon(m.b, one(TRIANGLE))).toBeLessThan(1e-6); // still the same triangle
    expect(m.a.v).toEqual(one(SQUARE).v); // the square is untouched
    // each square corner moves to a nearby triangle point (no crossing): total travel well under the worst rotation
    const worst = Math.max(...[0, 1, 2, 3].map((r) => travel(m.a, rotateShape(m.b, r))));
    expect(m.cost).toBeLessThan(worst * 0.75);
    expect(Math.sign(signedArea(m.a))).toBe(Math.sign(signedArea(m.b)));
  });
  it('open line → curve: resampled along the line, reversed when drawn the other way', () => {
    const curve = one('M0 0 C50 -80 100 -80 150 0 S250 80 300 0');
    expect(curve.v).toHaveLength(3);
    const fwd = matchShapes(one('M0 0 L300 0'), curve);
    expect(fwd.a.v).toHaveLength(3);
    expect(fwd.a.v[1][0]).toBeCloseTo(150, 6);
    expect(fwd.a.v[1][1]).toBeCloseTo(0, 6);
    expect(fwd.reversed).toBe(false);
    const back = matchShapes(one('M300 0 L0 0'), curve);
    expect(back.reversed).toBe(true);
    expect(back.b.v[0]).toEqual([300, 0]);
  });
  it('reverseShape keeps the outline; segments map onto each other', () => {
    const s = one(star(4));
    const r = reverseShape(s);
    expect(r.v[0]).toEqual(s.v[0]);
    expect(segmentCount(r)).toBe(segmentCount(s));
    expect(Math.sign(signedArea(r))).toBe(-Math.sign(signedArea(s)));
    const c = one(CIRCLE), rc = reverseShape(c);
    expect(cubicPoint(segment(rc, 0), 0.5)[0]).toBeCloseTo(cubicPoint(segment(c, c.v.length - 1), 0.5)[0], 6);
  });
  it('matchSequence: a chain shares one vertex count; closed vs open is refused', () => {
    const seq = matchSequence([one(SQUARE), one(CIRCLE), one(star(6))]);
    expect(seq.map((s) => s.v.length)).toEqual([12, 12, 12]);
    expect(() => matchShapes(one(SQUARE), one('M0 0 L10 10'))).toThrow(/closed path into an open/);
  });
});

describe('FollowPath', () => {
  const D = 'M100 800 C 600 200 1300 1000 1800 300';
  it('a guide path layer and a follower reading it at the rig Progress', () => {
    const r = build(() => h(FollowPath, { id: 'ball', d: D, duration: 2, easing: 'easeInOutSine' }, h(Shape, { x: 50 }, h(Ellipse, { size: [40, 40] }), h(Fill, {}))));
    const g = layer(r, 'ball.path');
    expect(g).toMatchObject({ guide: true, enabled: false });
    const f = layer(r, 'ball');
    expect(expr(f, 'ADBE Position')).toContain('L.onPath(thisComp.layer("ball Path").content("Follow Path").path, e("Progress").value / 100, false)');
    expect(expr(f, 'ADBE Position')).toContain('hasParent ? parent.fromComp(q) : q;');
    expect(expr(f, 'ADBE Rotate Z')).toContain('L.pathAngle(');
    const fx = f.groups.find((x: any) => x.at === 'ADBE Effect Parade').items[0];
    expect(fx.name).toBe('Follow Path');
    expect(fx.props.find((s: any) => s.p === '#1').keys.map((k: any) => k.v)).toEqual([0, 100]);
    expect(fx.props.find((s: any) => s.p === '#2').v).toBe(1); // Orient on
    expect(r.warnings.some((w: string) => /replaced by the path/.test(w))).toBe(true);
  });
  it('progress can be a live control and the path can be shown', () => {
    const r = build(() => h(FollowPath, { id: 'f', d: 'M0 0 L100 0 L100 100 Z', progress: control('Ride', 25), orient: false, show: { color: '#ff0000', width: 2 } }, h(Text, {}, 'x')));
    expect(layer(r, 'f.path').guide).toBeUndefined();
    expect(JSON.stringify(layer(r, 'f.path').groups)).toContain('Stroke');
    expect(expr(layer(r, 'f'), 'ADBE Position')).toContain(', true))'); // closed path wraps
    const fx = layer(r, 'f').groups.find((x: any) => x.at === 'ADBE Effect Parade').items[0];
    expect(fx.props.find((s: any) => s.p === '#1').expr).toContain('Ride');
  });
});

describe('Trail / Echo', () => {
  it('copies below the leader read it at time − k·Lag with an opacity ramp', () => {
    const r = build(() => h(Trail, { id: 'tr', count: 4, lag: 0.05, opacity: [80, 10] }, h(Shape, { id: 'dot', animate: { x: tween({ from: -400, duration: 1 }) } }, h(Ellipse, { size: [30, 30] }), h(Fill, {}))));
    const ids = main(r).layers.map((l: any) => l.id);
    expect(ids).toEqual(['dot', 'tr.echo1', 'tr.echo2', 'tr.echo3', 'tr.echo4']); // leader on top
    const e1 = layer(r, 'tr.echo1'), e4 = layer(r, 'tr.echo4');
    expect(expr(e1, 'ADBE Position')).toContain('T.transform.position.valueAtTime(t)');
    expect(expr(e1, 'ADBE Position')).toContain('time - 1 * e("Lag").value');
    expect(expr(e4, 'ADBE Opacity')).toContain('L.lerp(e("Start Opacity").value, e("End Opacity").value, 1)');
    expect(expr(e1, 'ADBE Opacity')).toContain('e("End Opacity").value, 0)');
    expect(e1.props.find((s: any) => s.p.endsWith('ADBE Position_0'))).toBeUndefined(); // copies don't keep the leader's keys
    const fx = layer(r, 'dot').groups.find((x: any) => x.at === 'ADBE Effect Parade').items[0];
    expect(fx.name).toBe('Trail');
    expect(fx.props.find((s: any) => s.p === '#1').v).toBe(0.05);
  });
  it('wraps a FollowPath (echoes the follower; the copies drop its rig) and Echo has its own defaults', () => {
    const r = build(() => h(Echo, { id: 'ec' }, h(FollowPath, { id: 'rider', d: 'M0 0 L1000 0' }, h(Shape, {}, h(Ellipse, { size: [30, 30] }), h(Fill, {})))));
    const ids = main(r).layers.map((l: any) => l.id);
    expect(ids).toEqual(['rider', 'ec.echo1', 'ec.echo2', 'ec.echo3', 'rider.path']);
    const echo = layer(r, 'ec.echo2');
    expect(echo.groups.some((g: any) => g.at === 'ADBE Effect Parade')).toBe(false);
    expect(expr(echo, 'ADBE Rotate Z')).toContain('T.transform.rotation.valueAtTime(t)');
    const leader = layer(r, 'rider').groups.find((x: any) => x.at === 'ADBE Effect Parade').items.map((i: any) => i.name);
    expect(leader).toEqual(['Follow Path', 'Trail']);
  });
});

describe('DrawOn', () => {
  it('Trim End keys, round cap, taper on the drawing head', () => {
    const r = build(() => h(DrawOn, { id: 'line', d: 'M100 500 C 500 100 900 900 1300 500', width: 8, taper: 40, delay: 0.3, duration: 1 }));
    const L = layer(r, 'line');
    const items = L.groups[0].items;
    expect(items.map((i: any) => i.mn)).toEqual(['ADBE Vector Shape - Group', 'ADBE Vector Filter - Trim', 'ADBE Vector Graphic - Stroke']);
    const end = items[1].props.find((s: any) => s.p === 'ADBE Vector Trim End');
    expect(end.keys.map((k: any) => [k.t, k.v])).toEqual([[0.3, 0], [1.3, 100]]);
    const stroke = items[2].props;
    expect(stroke).toContainEqual({ p: 'ADBE Vector Stroke Line Cap', v: 2 });
    expect(stroke).toContainEqual({ p: 'ADBE Vector Stroke Taper/ADBE Vector Taper End Length', v: 40 });
    expect(L.props.find((s: any) => s.p.endsWith('ADBE Position')).v).toEqual([0, 0]); // comp space
  });
  it('a travelling tail, and reverse draws from the end of the path', () => {
    const r = build(() => [h(DrawOn, { id: 'a', d: 'M0 0 L100 0', tail: 0.4, duration: 1 }), h(DrawOn, { id: 'b', d: 'M0 0 L100 0', reverse: true })]);
    const start = layer(r, 'a').groups[0].items[1].props.find((s: any) => s.p === 'ADBE Vector Trim Start');
    expect(start.keys[0].t).toBeCloseTo(0.4, 6);
    const shape = layer(r, 'b').groups[0].items[0].props[0].v;
    expect(shape.v[0]).toEqual([100, 0]);
  });
});

describe('Morph', () => {
  it('one path keyed A → B with matched vertex counts and the easing on the first key', () => {
    const r = build(() => h(Morph, { id: 'm', from: CIRCLE, to: star(), duration: 1, delay: 0.5, easing: 'easeInOutQuint', fill: '#7a3cff' }));
    const keys = layer(r, 'm').groups[0].items[0].props[0].keys;
    expect(keys.map((k: any) => k.t)).toEqual([0.5, 1.5]);
    expect(keys[0].v.v).toHaveLength(10);
    expect(keys[1].v.v).toHaveLength(10);
    expect(keys[0].v.c).toBe(true);
    expect(keys[0].oe[0].influence).toBeCloseTo(83, 0); // easeInOutQuint x1 = 0.83
    expect(JSON.stringify(layer(r, 'm').groups[0].items[1])).toContain('Fill');
  });
  it('a chain holds between morphs', () => {
    const r = build(() => h(Morph, { id: 'm', shapes: [SQUARE, CIRCLE, TRIANGLE], duration: 0.6, hold: 0.5, stroke: { width: 3 } }));
    const items = layer(r, 'm').groups[0].items;
    expect(items[0].props[0].keys.map((k: any) => +k.t.toFixed(3))).toEqual([0, 0.6, 1.1, 1.7]);
    expect(items.map((i: any) => i.mn)).toEqual(['ADBE Vector Shape - Group', 'ADBE Vector Graphic - Stroke']);
    expect(() => build(() => h(Morph, { id: 'x', from: SQUARE }))).toThrow(/needs from and to/);
  });
});

// ---------- expressions, run in a mocked AE (tests/unit/ae-expr-mock.ts) ----------
describe('path tool expressions (mock AE)', () => {
  it('FollowPath reads the path at Progress and turns along it', () => {
    const r = build(() => h(FollowPath, { id: 'f', d: 'M0 0 L100 0', rotationOffset: 10 }, h(Shape, {}, h(Ellipse, {}))));
    const L = layer(r, 'f');
    expect(runExpr(expr(L, 'ADBE Position'), { params: { Progress: 50 } })).toEqual([50, 0]); // mock path: u × 100 along x
    expect(runExpr(expr(L, 'ADBE Rotate Z'), { value: 5, params: { Progress: 50, Orient: 1, 'Rotation Offset': 10 } })).toBeCloseTo(5 + 90 + 10, 9); // mock tangent points down
    expect(runExpr(expr(L, 'ADBE Rotate Z'), { value: 5, params: { Orient: 0 } })).toBe(5);
  });
  it('Trail copy k reads the leader k × Lag earlier, on its opacity ramp and end scale', () => {
    const r = build(() => h(Trail, { id: 't', count: 3 }, h(Shape, { id: 'lead' }, h(Ellipse, {}))));
    const e2 = layer(r, 't.echo2');
    const params = { Lag: 0.1, 'Start Opacity': 60, 'End Opacity': 0, 'End Scale': 70 };
    expect(runExpr(expr(e2, 'ADBE Position'), { time: 1, params })[0]).toBeCloseTo(0.8, 9); // mock position x = read time
    expect(runExpr(expr(e2, 'ADBE Rotate Z'), { time: 1, params })).toBeCloseTo(1.6, 9);
    expect(runExpr(expr(e2, 'ADBE Opacity'), { time: 1, params })).toBeCloseTo(80 * 30 / 100, 9); // leader 80 × the middle of 60 → 0
    expect(runExpr(expr(e2, 'ADBE Scale'), { time: 1, params })).toEqual([80, 80]); // 100 → 70 at k / n = 2 / 3
  });
  it('the integration scene compiles, validates and every expression is finite', async () => {
    const { def, file } = await loadScene({ file: path.resolve('tests/integration/paths-scene.tsx') });
    const r: any = compileScene(def, { sceneFile: file });
    expect(() => validateIr(r.ir)).not.toThrow();
    expect(r.warnings).toEqual([]);
    const c = main(r);
    const names = new Set<string>(c.layers.map((l: any) => l.name));
    let n = 0;
    for (const x of expressionsOf(c)) {
      if (x.expr.includes('textIndex')) continue;
      for (const time of [0, 1.3, 4]) {
        let v: any;
        try { v = runExpr(x.expr, { time, value: x.v ?? (/Rotate|Opacity/.test(x.p) ? 0 : [0, 0]), layerNames: names, valueAtTime: () => x.v ?? [0, 0] }); } catch (e: any) { throw new Error(`${x.layer.id} ${x.p}: ${e.message}\n${x.expr}`); }
        expect(isFinite(v), `${x.layer.id} ${x.p}`).toBe(true);
        n++;
      }
    }
    expect(n).toBeGreaterThan(60);
    const morph = layer(r, 'morph').groups[0].items[0].props[0].keys;
    expect(new Set(morph.map((k: any) => k.v.v.length)).size).toBe(1);
  }, 60_000);
});
