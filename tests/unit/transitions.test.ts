// K4 transitions library: compile scenes with <Beats> and standalone transitions to IR and check timing from the
// beat boundary, mattes, parenting, rigs (keyed Progress), tags and the geometry they compute. No AE.
import { describe, expect, it } from 'vitest';
import { compileScene } from '../../src/compile/compile.ts';
import { scene } from '../../src/dsl/scene.ts';
import { jsx } from '../../src/dsl/jsx-runtime.ts';
import { Composition, Sequence, Solid, Shape, Rect, Ellipse, Star, Fill, Stroke, Text, Stack } from '../../src/dsl/index.ts';
import { Beats, Beat, beatTimeline, ShapeWipe, HandOff, ZoomThrough, PushThrough, ParallaxSplit, LiquidWipe, SliceWipe, GridWipe, LightLeakCut, liquidKeys } from '../../src/dsl/transitions/index.ts';
import { coverScale, silhouetteOf } from '../../src/dsl/transitions/geometry.ts';
import { validateIr } from '../../src/ir/schema.ts';
import { loadScene } from '../../src/scene/load.ts';
import { expressionsOf, isFinite, runExpr } from './ae-expr-mock.ts';
import path from 'node:path';

const h = (type: any, props: Record<string, any> | null = {}, ...children: any[]) =>
  jsx(type, children.length ? { ...(props ?? {}), children: children.length === 1 ? children[0] : children } : { ...(props ?? {}) });
const build = (body: () => any, duration = 12) => compileScene(scene({ name: 'T', duration }, () => h(Composition, {}, body())));
const main = (r: any) => r.ir.comps.find((c: any) => c.id === r.ir.main);
const layer = (r: any, id: string) => { const L = main(r).layers.find((l: any) => l.id === id); if (!L) throw new Error(`no layer ${id}`); return L; };
const has = (r: any, id: string) => main(r).layers.some((l: any) => l.id === id);
const expr = (L: any, p: string) => (L.props ?? []).find((s: any) => s.p.endsWith(p) && s.expr)?.expr as string;
const rig = (L: any) => L.groups.find((g: any) => g.at === 'ADBE Effect Parade').items.find((i: any) => i.pseudo);
const progressKeys = (L: any) => rig(L).props.find((s: any) => s.p === '#1').keys;

const bar = () => h(Shape, { id: 'bar', y: 600 }, h(Rect, { size: [520, 10], roundness: 5 }), h(Fill, { color: '#4683c4' }));
const beatA = () => h(Beat, { name: 'Hook', duration: 3 }, h(Solid, { id: 'a.bg', color: '#101318' }), h(Text, { id: 'a.title', y: 450 }, 'HOOK'), bar());
const beatB = (d = 3) => h(Beat, { name: 'Build', duration: d }, h(Solid, { id: 'b.bg', color: '#1b2436' }), h(Text, { id: 'b.title' }, 'BUILD'));

describe('<Beats>: timing from the beat boundary', () => {
  it('overlap kinds start the next beat when the transition starts; cut kinds at the cut', () => {
    const r = build(() => h(Beats, {},
      beatA(), h(ShapeWipe, { id: 'w', shape: bar(), duration: 0.7 }), beatB(3),
      h(LightLeakCut, { id: 'lk', duration: 0.6 }), h(Beat, { name: 'End', duration: 2 }, h(Solid, { id: 'c.bg' }))));
    const m = main(r).markers.map((k: any) => [k.comment, +k.t.toFixed(3), +k.dur.toFixed(3)]);
    expect(m).toEqual([['Hook', 0, 3], ['Build', 2.3, 3], ['End', 5.3, 2]]);
    expect(layer(r, 'w')).toMatchObject({ in: 2.3 });
    expect(layer(r, 'w').out).toBeCloseTo(3, 6);
    expect(layer(r, 'lk')).toMatchObject({ in: 5 });
    expect(layer(r, 'lk').out).toBeCloseTo(5.6, 6);
    // Progress is keyed over the window: ripple edits remap these keys.
    const k = progressKeys(layer(r, 'w'));
    expect(k.map((x: any) => x.v)).toEqual([0, 100]);
    expect(k[0].t).toBeCloseTo(2.3, 6);
    expect(k[1].t).toBeCloseTo(3, 6);
  });
  it('a longer beat moves every later beat and transition (rebuild) and beatTimeline reports it', () => {
    const t = beatTimeline({ children: [beatA(), h(SliceWipe, { id: 's', duration: 0.8 }), beatB(4), h(GridWipe, { id: 'g', duration: 1 }), h(Beat, { name: 'C', duration: 3 })] });
    expect(t.beats.map((b) => [b.name, +b.start.toFixed(3)])).toEqual([['Hook', 0], ['Build', 2.2], ['C', 5.2]]);
    expect(t.transitions.map((x) => [x.kind, +x.at.toFixed(3), x.duration])).toEqual([['slice-wipe', 2.2, 0.8], ['grid-wipe', 5.2, 1]]);
    expect(+t.end.toFixed(3)).toBe(8.2);
  });
  it('several transitions at one boundary share it (a hand-off over a wipe)', () => {
    const r = build(() => h(Beats, {}, beatA(), h(ShapeWipe, { id: 'w', shape: bar(), duration: 0.6 }),
      h(HandOff, { id: 'ho', element: h(Shape, { id: 'dot' }, h(Ellipse, { size: [40, 40] }), h(Fill, {})), from: { x: 300, y: 300 }, to: { x: 1500, y: 700 }, duration: 0.9 }), beatB()));
    expect(main(r).markers[1]).toMatchObject({ comment: 'Build', t: 2.1 });
    expect(layer(r, 'w').in).toBeCloseTo(2.1, 6);
    expect(layer(r, 'ho').in).toBeCloseTo(2.1, 6);
  });
  it('rejects a misplaced transition or an unnamed beat with a clear message', () => {
    expect(() => build(() => h(Beats, {}, h(ShapeWipe, { id: 'w', shape: bar() }), beatA()))).toThrow(/before the first <Beat>/);
    expect(() => build(() => h(Beats, {}, beatA(), h(ShapeWipe, { id: 'w', shape: bar() })))).toThrow(/after the last <Beat>/);
    expect(() => build(() => h(Beats, {}, h(Beat, { duration: 2 })))).toThrow(/needs a name/);
    expect(() => build(() => h(Beats, {}, beatA(), h(Solid, {})))).toThrow(/must be <Beat> or transitions/);
    expect(() => build(() => h(Beats, {}, beatA(), h(ShapeWipe, { shape: bar() }), beatB()))).toThrow(/needs an id/);
  });
});

describe('ShapeWipe', () => {
  it('a filled clone of the shape grows to cover the frame and mattes the next beat', () => {
    const r = build(() => h(Beats, {}, beatA(), h(ShapeWipe, { id: 'w', shape: bar() }), beatB()));
    const m = layer(r, 'w.shape');
    expect(m.tags).toEqual(['transition:shape-wipe']);
    expect(m.in).toBeCloseTo(2.3, 6);
    expect(m.out).toBeCloseTo(5.3, 6); // stays (covering) until the next beat ends
    expect(expr(m, 'ADBE Scale')).toContain('L.lerp(100, e("Cover X").value, px)');
    expect(expr(m, 'ADBE Scale')).toContain('thisComp.layer("Shape Wipe: w")');
    expect(JSON.stringify(m.groups)).toContain('ADBE Vector Graphic - Fill');
    expect(JSON.stringify(m.groups)).not.toContain('Stroke');
    for (const id of ['b.bg', 'b.title']) expect(layer(r, id).matte).toEqual({ layer: 'w.shape', type: 'alpha', showSource: true });
    for (const id of ['a.bg', 'a.title', 'bar']) expect(layer(r, id).matte).toBeUndefined();
    // A Rect grows to a panel: per-axis cover (fit), 1920 / 520 wide and 2 × 600 / 10 tall, with a 4 % margin; the
    // pill ends (roundness 5 on a 10 px bar) need a little more.
    const v = rig(layer(r, 'w')).props;
    const cx = v.find((s: any) => s.p === '#2').v, cy = v.find((s: any) => s.p === '#3').v;
    expect(cx).toBeGreaterThanOrEqual((1920 / 520) * 104);
    expect(cx).toBeLessThan((1920 / 520) * 104 * 1.03);
    expect(cy).toBeGreaterThanOrEqual((1200 / 10) * 104);
    expect(cy).toBeLessThan((1200 / 10) * 104 * 1.03);
    const sharp = build(() => h(Beats, {}, beatA(), h(ShapeWipe, { id: 'w', shape: h(Shape, { y: 600 }, h(Rect, { size: [520, 10] })) }), beatB()));
    expect(rig(layer(sharp, 'w')).props.find((s: any) => s.p === '#2').v).toBeCloseTo((1920 / 520) * 104 + 0.5, 1);
  });
  it('xy staging and invisible mattes', () => {
    const r = build(() => h(Beats, {}, beatA(), h(ShapeWipe, { id: 'w', shape: bar(), grow: 'xy', show: false }), beatB()));
    expect(expr(layer(r, 'w.shape'), 'ADBE Scale')).toContain('px = L.clamp(P / Math.max(k, 0.001), 0, 1)');
    expect(layer(r, 'b.bg').matte).toEqual({ layer: 'w.shape', type: 'alpha' });
  });
  it('standalone inside the incoming Sequence: at defaults to its start', () => {
    const r = build(() => [h(Sequence, { name: 'A', duration: 3 }, bar()), h(Sequence, { name: 'B', from: 2.4 }, h(ShapeWipe, { id: 'w', shape: bar(), duration: 0.6 }, h(Solid, { id: 'b.bg' })))]);
    expect(layer(r, 'w').in).toBeCloseTo(2.4, 6);
    expect(layer(r, 'b.bg')).toMatchObject({ in: 2.4, matte: { layer: 'w.shape' } });
  });
  it('cover geometry: a circle needs the half diagonal; rotation and roundness count', () => {
    const circle = silhouetteOf(h(Shape, {}, h(Ellipse, { size: [200, 200] })), 1920, 1080);
    const c = coverScale(circle, 1920, 1080, 'uniform', undefined, 1)!;
    expect(Math.abs(c[0] - (Math.hypot(960, 540) + 0.5))).toBeLessThan(3); // (a 48-gon: slightly conservative)
    const tilted = silhouetteOf(h(Shape, { rotation: 45 }, h(Rect, { size: [200, 200] })), 1920, 1080);
    const flat = silhouetteOf(h(Shape, {}, h(Rect, { size: [200, 200] })), 1920, 1080);
    expect(coverScale(tilted, 1920, 1080, 'uniform', undefined, 1)![0]).toBeGreaterThan(coverScale(flat, 1920, 1080, 'uniform', undefined, 1)![0]);
    const star = silhouetteOf(h(Shape, {}, h(Star, { points: 5, outerRadius: 100, innerRadius: 40 })), 1920, 1080);
    expect(coverScale(star, 1920, 1080, 'uniform')![0]).toBeGreaterThan(c[0] * 2); // the inner radius limits it
    // comp-space shapes: the pose is where the contents are
    const cs = silhouetteOf(h(Shape, { space: 'comp' }, h(Rect, { size: [100, 50], position: [300, 200] })), 1920, 1080);
    expect(cs.pos).toEqual([300, 200]);
  });
});

describe('HandOff', () => {
  const dot = () => h(Shape, { id: 'dot', animate: {} }, h(Ellipse, { size: [60, 60] }), h(Fill, { color: '#ffffff' }));
  it('one element spans both beats, parented to a carrier whose rig holds Progress, From/To, arc', () => {
    const r = build(() => h(Beats, {}, beatA(), h(HandOff, { id: 'ho', element: dot(), from: { x: 960, y: 600 }, to: { x: 400, y: 300, scale: 300 }, arc: 120 }), beatB()));
    const el = layer(r, 'dot');
    expect(el.parent).toBe('ho');
    expect(el.in).toBeCloseTo(0, 6);
    expect(el.out).toBeCloseTo(5.2, 6);
    expect(main(r).layers.findIndex((l: any) => l.id === 'dot')).toBeLessThan(main(r).layers.findIndex((l: any) => l.id === 'b.title')); // above the next beat
    const ho = layer(r, 'ho');
    expect(ho.tags).toEqual(['transition:handoff']);
    expect(expr(ho, 'ADBE Position')).toContain('e("Arc").value * 4 * P * (1 - P)');
    const v = rig(ho).props;
    expect(v.find((s: any) => s.p === '#2').v).toEqual([960, 600]);
    expect(v.find((s: any) => s.p === '#3').v).toEqual([400, 300]);
    expect(JSON.stringify(v)).toContain('"v":300');
  });
  it('poses read live from layers (layout placeholders), and size matching', () => {
    const r = build(() => h(Beats, {},
      h(Beat, { name: 'Hook', duration: 3 }, h(Stack, {}, h(Text, { id: 'a.word' }, 'NOW'), h(Shape, { id: 'a.line', hidden: true }, h(Rect, { size: [200, 8] })))),
      h(HandOff, { id: 'ho', element: h(Shape, { id: 'line' }, h(Rect, { size: [200, 8] }), h(Fill, {})), from: 'a.line', to: 'b.rule', match: 'size' }),
      h(Beat, { name: 'Build', duration: 3 }, h(Shape, { id: 'b.rule', name: 'Rule', hidden: true, y: 800 }, h(Rect, { size: [900, 8] })))));
    const fx = rig(layer(r, 'ho')).props;
    const from = fx.find((s: any) => s.p === '#2');
    expect(from.expr).toContain('A.toComp(A.transform.anchorPoint.valueAtTime(t), t)');
    expect(from.expr).toContain('k.key(1).time');
    expect(fx.find((s: any) => s.p === '#3').expr).toContain('thisComp.layer("Rule")');
    expect(JSON.stringify(fx)).toContain('ra.width * sa[0]');
    expect(layer(r, 'line').name).toBe('Hand-off: ho Element');
  });
  it('a planned path: a guide layer and L.onPath', () => {
    const r = build(() => h(HandOff, { id: 'ho', at: 1, element: dot(), from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, path: 'M100 900 C 600 100 1300 100 1800 900', orient: true }));
    expect(layer(r, 'ho.path')).toMatchObject({ guide: true, enabled: false });
    expect(expr(layer(r, 'ho'), 'ADBE Position')).toContain('L.onPath(thisComp.layer("Hand-off: ho Path").content("Hand-off Path").path, P, false)');
    expect(expr(layer(r, 'ho'), 'ADBE Rotate Z')).toContain('L.pathAngle(');
    expect(layer(r, 'ho').in).toBe(1);
  });
});

describe('ZoomThrough', () => {
  const ring = () => h(Shape, { id: 'ring', x: 1200, y: 500 }, h(Ellipse, { size: [300, 300] }), h(Stroke, { color: '#ffd000', width: 24 }));
  it('the outgoing beat zooms about the element, the next beat shows through its silhouette and settles', () => {
    const r = build(() => h(Beats, {}, h(Beat, { name: 'A', duration: 3 }, h(Solid, { id: 'a.bg' }), ring()), h(ZoomThrough, { id: 'z', through: ring() }), beatB()));
    const z = layer(r, 'z');
    expect(z.props.find((s: any) => s.p.endsWith('ADBE Anchor Point')).v).toEqual([1200, 500]);
    expect(expr(z, 'ADBE Scale')).toContain('Math.pow(Math.max(e("Zoom").value, 1), P)');
    for (const id of ['a.bg', 'ring']) expect(layer(r, id).parent).toBe('z');
    for (const id of ['b.bg', 'b.title']) expect(layer(r, id)).toMatchObject({ parent: 'z.in', matte: { layer: 'z.window', type: 'alpha' } });
    const win = layer(r, 'z.window');
    expect(win.parent).toBe('z');
    expect(JSON.stringify(win.groups)).not.toContain('Stroke'); // the ring's disc, filled
    expect(expr(win, 'ADBE Opacity')).toContain('e("Fade In")');
    // Zoom: the 300 px disc (radius 150 + half stroke? no: the fill) must cover the farthest corner from (1200, 500).
    const zoom = rig(z).props.find((s: any) => s.p === '#2').v;
    expect(zoom).toBeGreaterThan(Math.hypot(1200, 580) / 150);
    expect(zoom).toBeLessThan((Math.hypot(1200, 580) / 150) * 1.25);
  });
  it('chained: a beat that zoomed in can part with ParallaxSplit, and zoom out again (carrier adopted)', () => {
    const r = build(() => h(Beats, {}, h(Beat, { name: 'A', duration: 3 }, ring()), h(ZoomThrough, { id: 'z', through: ring() }),
      h(Beat, { name: 'B', duration: 3 }, h(Text, { id: 'b.t', x: 500 }, 'B'), h(Shape, { id: 'ring2', x: 900, y: 540 }, h(Ellipse, { size: [200, 200] }), h(Fill, {}))),
      h(ZoomThrough, { id: 'z2', through: h(Shape, { id: 'ring2', x: 900, y: 540 }, h(Ellipse, { size: [200, 200] }), h(Fill, {})) }),
      h(Beat, { name: 'C', duration: 3 }, h(Text, { id: 'c.t', x: 400 }, 'C')), h(ParallaxSplit, { id: 'ps' }), h(Beat, { name: 'D', duration: 3 }, h(Solid, { id: 'd.bg' }))), 14);
    expect(layer(r, 'z.in').parent).toBe('z2'); // the settle null of the first zoom follows the second
    expect(layer(r, 'b.t').parent).toBe('z.in');
    expect(expr(layer(r, 'c.t'), 'ADBE Position')).toContain('e("Distance")'); // parented to a settle carrier: still parts
    expect(r.warnings.filter((w: string) => /already has a parent/.test(w))).toEqual([]);
  });
});

describe('PushThrough and ParallaxSplit', () => {
  it('PushThrough: both beats 3D, the next one at depth, a camera dollies through', () => {
    const r = build(() => h(Beats, {}, beatA(), h(PushThrough, { id: 'pt', depth: 3000, flat: ['a.bg'] }), beatB()));
    expect(layer(r, 'a.title').threeD).toBe(true);
    expect(layer(r, 'a.bg').threeD).toBeUndefined();
    expect(expr(layer(r, 'a.title'), 'ADBE Opacity')).toContain('L.smooth(e("Fade Start")');
    expect(layer(r, 'b.title').threeD).toBe(true);
    expect(layer(r, 'b.title').props.find((s: any) => s.p.endsWith('ADBE Position')).v).toEqual([960, 540, 3000]);
    const cam = layer(r, 'pt.cam');
    expect(cam.camera).toEqual({ twoNode: false });
    expect(cam.out).toBeCloseTo(5, 6); // frames the next beat until it ends
    expect(expr(cam, 'ADBE Position')).toContain('-cameraOption.zoom + P * 3000');
  });
  it('ParallaxSplit: non-background layers part at different speeds; the next beat opens in the gap', () => {
    const r = build(() => h(Beats, {}, h(Beat, { name: 'A', duration: 3 }, h(Solid, { id: 'a.bg' }), h(Text, { id: 'a.left', x: 500 }, 'L'), h(Text, { id: 'a.right', x: 1400, animate: { x: { $anim: 'tween', from: -40, duration: 0.5 } } }, 'R')),
      h(ParallaxSplit, { id: 'ps', spread: 100 }), beatB()));
    expect(expr(layer(r, 'a.bg'), 'ADBE Position')).toBeUndefined();
    const left = expr(layer(r, 'a.left'), 'ADBE Position');
    expect(left).toContain('* 0) * P');
    expect(left).toContain('add(value, [d, 0]);');
    const right = expr(layer(r, 'a.right'), 'ADBE Position_0'); // separated dimensions: X Position
    expect(right).toContain('* 1) * P');
    expect(right).toContain('value + d;');
    expect(layer(r, 'b.bg').matte).toMatchObject({ layer: 'ps.gap' });
    expect(layer(r, 'ps.gap').tags).toEqual(['transition:parallax-split']);
  });
});

describe('LiquidWipe, SliceWipe, GridWipe, LightLeakCut', () => {
  it('liquid blob keys: same vertex count, off-screen at 0, covering at 1, for every direction', () => {
    for (const dir of ['right', 'left', 'up', 'down'] as const) {
      const ks = liquidKeys(1920, 1080, dir, 140, 1.25, 0);
      expect(new Set(ks.map((k) => k.length)).size).toBe(1);
      const xs = (k: any[]) => k.map((p) => p.p[0]), ys = (k: any[]) => k.map((p) => p.p[1]);
      if (dir === 'right') { expect(Math.max(...xs(ks[0]))).toBeLessThan(0); expect(Math.min(...xs(ks[ks.length - 1]).slice(1, -1))).toBeGreaterThan(1920); }
      if (dir === 'left') { expect(Math.min(...xs(ks[0]))).toBeGreaterThan(1920); expect(Math.max(...xs(ks[ks.length - 1]).slice(1, -1))).toBeLessThan(0); }
      if (dir === 'down') { expect(Math.max(...ys(ks[0]))).toBeLessThan(0); expect(Math.min(...ys(ks[ks.length - 1]).slice(1, -1))).toBeGreaterThan(1080); }
      if (dir === 'up') { expect(Math.min(...ys(ks[0]))).toBeGreaterThan(1080); }
    }
  });
  it('LiquidWipe: path keys played by Progress, a colored lead ahead', () => {
    const r = build(() => h(Beats, {}, beatA(), h(LiquidWipe, { id: 'lq', color: '#ff7a2e', duration: 0.9 }), beatB()));
    const m = layer(r, 'lq.liquid');
    const shape = m.groups[0].items[0].props[0];
    expect(shape.keys).toHaveLength(7);
    expect(shape.keys[0].t).toBeCloseTo(2.1, 6);
    expect(expr(m, 'ADBE Vector Shape')).toContain('valueAtTime(t0 + (t1 - t0) * L.clamp(P, 0, 1))');
    expect(expr(layer(r, 'lq.lead'), 'ADBE Vector Shape')).toContain('e("Lead")');
    expect(layer(r, 'lq.lead').out).toBeCloseTo(3, 6);
    expect(layer(r, 'b.bg').matte.layer).toBe('lq.liquid');
  });
  it('SliceWipe: one group per slice, staggered by rank, Progress linear, eased per slice', () => {
    const r = build(() => h(Beats, {}, beatA(), h(SliceWipe, { id: 's', count: 5, order: 'center', tilt: 10 }), beatB()));
    const m = layer(r, 's.slices');
    const slices = m.groups[0].items[0].kids[0].items;
    expect(slices).toHaveLength(5);
    const ex = slices.map((g: any) => g.props.find((s: any) => s.p.endsWith('Scale')).expr as string);
    expect(ex[2]).toContain('(P - 0 * S)'); // the centre slice goes first
    expect(ex[0]).toContain('(P - 1 * S)');
    expect(ex[1]).toContain('L.eased([0.65, 0, 0.35, 1], u)');
    const k = progressKeys(layer(r, 's'));
    expect(k[0].oe[0].influence).toBeLessThan(1); // linear
    expect(m.groups[0].items[0].props.find((s: any) => s.p.endsWith('Rotation')).v).toBe(10);
  });
  it('GridWipe: rows × columns tiles rippling from an origin, dots squaring off', () => {
    const r = build(() => h(Beats, {}, beatA(), h(GridWipe, { id: 'g', columns: 6, origin: [0, 0] }), beatB()));
    const tiles = layer(r, 'g.tiles').groups[0].items;
    expect(tiles).toHaveLength(6 * 3);
    expect(tiles[0].props.find((s: any) => s.p.endsWith('Scale')).expr).toContain('(P - 0 * S)');
    expect(tiles[17].props.find((s: any) => s.p.endsWith('Scale')).expr).toContain('(P - 1 * S)');
    expect(JSON.stringify(tiles[0].kids)).toContain('L.lerp(160, 0, q)');
  });
  it('LightLeakCut: no overlap, the leak over both beats peaking at the cut, built-in effects', () => {
    const r = build(() => h(Beats, {}, beatA(), h(LightLeakCut, { id: 'lk', color: '#ff9a3c' }), beatB()));
    expect(layer(r, 'b.bg').in).toBe(3);
    expect(layer(r, 'a.bg').out).toBe(3);
    const ids = main(r).layers.map((l: any) => l.id);
    expect(ids.indexOf('lk.leak')).toBeLessThan(ids.indexOf('b.title'));
    const leak = layer(r, 'lk.leak');
    expect(leak.blend).toBe('ADD');
    const fx = leak.groups.find((g: any) => g.at === 'ADBE Effect Parade').items.map((i: any) => i.mn);
    expect(fx).toEqual(['ADBE Fractal Noise', 'ADBE Tritone']);
    expect(expr(leak, 'Midtones')).toContain('e("Color").value');
    expect(expr(leak, 'ADBE Opacity')).toContain('Math.sin(Math.PI');
  });
});

describe('tags for the style lint', () => {
  it('each transition is one (kind, time) entry; different kinds in a row', () => {
    const r = build(() => h(Beats, {}, beatA(), h(ShapeWipe, { id: 'w', shape: bar() }), beatB(),
      h(GridWipe, { id: 'g' }), h(Beat, { name: 'C', duration: 3 }, h(Solid, { id: 'c.bg' })),
      h(LiquidWipe, { id: 'l', color: '#fff' }), h(Beat, { name: 'D', duration: 3 }, h(Solid, { id: 'd.bg' }))));
    const entries = new Map<string, number>();
    for (const L of main(r).layers) for (const t of L.tags ?? []) if (t.startsWith('transition:')) entries.set(`${t}@${L.in.toFixed(2)}`, (entries.get(`${t}@${L.in.toFixed(2)}`) ?? 0) + 1);
    expect([...entries.keys()]).toEqual(['transition:liquid-wipe@6.50', 'transition:grid-wipe@4.40', 'transition:shape-wipe@2.30']);
  });
});

// ---------- expressions, run in a mocked AE (tests/unit/ae-expr-mock.ts) ----------
describe('expressions evaluate (mock AE)', () => {
  const ex = (r: any, id: string, suffix: string) => { const L = layer(r, id); const all = expressionsOf(main(r)).filter((x) => x.layer === L && x.p.endsWith(suffix)); if (!all.length) throw new Error(`no ${suffix} expression on ${id}`); return all[0].expr; };
  it('the integration scene: every expression is finite at the start, middle and end of each transition', async () => {
    const { def, file } = await loadScene({ file: path.resolve('tests/integration/transitions-scene.tsx') });
    const r: any = compileScene(def, { sceneFile: file });
    expect(() => validateIr(r.ir)).not.toThrow();
    expect(r.warnings).toEqual([]);
    const c = main(r);
    const names = new Set<string>(c.layers.map((l: any) => l.name));
    let n = 0;
    for (const x of expressionsOf(c)) {
      if (x.expr.includes('textIndex')) continue; // the compiler's text animators
      for (const P of [0, 0.5, 1]) {
        let v: any;
        try { v = runExpr(x.expr, { P, time: 3, value: x.v ?? (/Rotate|Opacity/.test(x.p) ? 0 : [0, 0]), layerNames: names, valueAtTime: (t: number) => (Array.isArray(x.v) ? x.v : { at: t }) }); } catch (e: any) { throw new Error(`${x.layer.id} ${x.p} @P=${P}: ${e.message}\n${x.expr}`); }
        expect(isFinite(v), `${x.layer.id} ${x.p} @P=${P}: ${JSON.stringify(v)}`).toBe(true);
        n++;
      }
    }
    expect(n).toBeGreaterThan(20);
    expect(c.markers.map((m: any) => m.comment)).toEqual(['Hook', 'Grow', 'Shot', 'End']);
    const kinds = [...new Set(c.layers.flatMap((l: any) => l.tags ?? []))];
    expect(kinds.sort()).toEqual(['transition:handoff', 'transition:liquid-wipe', 'transition:shape-wipe', 'transition:zoom-through']);
  }, 60_000);
  it('ShapeWipe scale: rest at 0, the cover at 1; xy stages the axes', () => {
    const r = build(() => h(Beats, {}, beatA(), h(ShapeWipe, { id: 'w', shape: bar(), grow: 'xy' }), beatB()));
    const code = ex(r, 'w.shape', 'ADBE Scale');
    const params = { 'Cover X': 400, 'Cover Y': 9000, Split: 40 };
    expect(runExpr(code, { P: 0, params })).toEqual([100, 100]);
    expect(runExpr(code, { P: 0.2, params })).toEqual([250, 100]); // x halfway through its 40 %, y not started
    expect(runExpr(code, { P: 1, params })).toEqual([400, 9000]);
  });
  it('HandOff: From at 0, To at 1, bowing up (left of travel) by Arc in the middle', () => {
    const r = build(() => h(HandOff, { id: 'ho', element: h(Shape, {}, h(Ellipse, {})), from: { x: 0, y: 0 }, to: { x: 200, y: 0 } }));
    const code = ex(r, 'ho', 'ADBE Position');
    const params = { From: [0, 0], To: [200, 0], Arc: 50 };
    expect(runExpr(code, { P: 0, params })).toEqual([0, 0]);
    expect(runExpr(code, { P: 1, params })).toEqual([200, 0]);
    const mid = runExpr(code, { P: 0.5, params });
    expect(mid[0]).toBeCloseTo(100, 9);
    expect(mid[1]).toBeCloseTo(-50, 9);
  });
  it('ParallaxSplit: each side parts to its own side, faster in front', () => {
    const r = build(() => h(Beats, {}, h(Beat, { name: 'A', duration: 3 }, h(Text, { id: 'l', x: 500 }, 'L'), h(Text, { id: 'r', x: 1400 }, 'R')), h(ParallaxSplit, { id: 'ps' }), beatB()));
    const params = { Distance: 1000, Spread: 100 };
    const left = runExpr(ex(r, 'l', 'ADBE Position'), { P: 1, params, value: [500, 540], valueAtTime: () => [500, 540] });
    const right = runExpr(ex(r, 'r', 'ADBE Position'), { P: 1, params, value: [1400, 540], valueAtTime: () => [1400, 540] });
    expect(left).toEqual([500 - 1000, 540]); // back layer: speed × 1
    expect(right).toEqual([1400 + 2000, 540]); // front layer: speed × 2
    expect(runExpr(ex(r, 'r', 'ADBE Position'), { P: 0, params, value: [1400, 540], valueAtTime: () => [1400, 540] })).toEqual([1400, 540]);
  });
  it('slices, liquid keys, zoom, light leak and the push camera follow Progress', () => {
    const r = build(() => h(Beats, {}, beatA(), h(SliceWipe, { id: 's', count: 3 }), beatB(), h(LiquidWipe, { id: 'lq', color: '#fff' }), h(Beat, { name: 'C', duration: 3 }, h(Solid, { id: 'c.bg' })),
      h(PushThrough, { id: 'pt', depth: 3000 }), h(Beat, { name: 'D', duration: 3 }, h(Text, { id: 'd.t' }, 'D')), h(LightLeakCut, { id: 'lk' }), h(Beat, { name: 'E', duration: 2 }, h(Solid, { id: 'e.bg' }))), 16);
    const slice = layer(r, 's.slices').groups[0].items[0].kids[0].items[0].props.find((s: any) => s.p.endsWith('Scale')).expr;
    expect(runExpr(slice, { P: 0, params: { Stagger: 50 } })).toEqual([0, 100]);
    expect(runExpr(slice, { P: 1, params: { Stagger: 50 } })).toEqual([100, 100]);
    expect(runExpr(ex(r, 'lq.liquid', 'ADBE Vector Shape'), { P: 0.5, keys: [2, 3] })).toEqual({ at: 2.5 });
    expect(runExpr(ex(r, 'lq.lead', 'ADBE Vector Shape'), { P: 0.5, keys: [2, 3], params: { Lead: 20 } }).at).toBeCloseTo(2.6, 9);
    const cam = ex(r, 'pt.cam', 'ADBE Position');
    expect(runExpr(cam, { P: 0 })[2]).toBeCloseTo(-(50 / 36) * 1920, 6);
    expect(runExpr(cam, { P: 1 })[2]).toBeCloseTo(3000 - (50 / 36) * 1920, 6);
    expect(runExpr(ex(r, 'lk.leak', 'ADBE Opacity'), { P: 0.5, params: { Intensity: 85 } })).toBeCloseTo(85, 9);
    expect(runExpr(ex(r, 'lk.flash', 'ADBE Opacity'), { P: 0, params: { Flash: 50 } })).toBe(0);
  });
  it('ZoomThrough: the zoom is geometric to Zoom×; the next beat settles by 85 % of the window', () => {
    const ring = h(Shape, { id: 'ring', x: 1200, y: 500 }, h(Ellipse, { size: [300, 300] }), h(Fill, {}));
    const r = build(() => h(Beats, {}, h(Beat, { name: 'A', duration: 3 }, ring), h(ZoomThrough, { id: 'z', through: ring }), beatB()));
    const zoom = ex(r, 'z', 'ADBE Scale'), settle = ex(r, 'z.in', 'ADBE Scale');
    expect(runExpr(zoom, { P: 0, params: { Zoom: 16 } })).toEqual([100, 100]);
    expect(runExpr(zoom, { P: 0.5, params: { Zoom: 16 } })).toEqual([400, 400]);
    expect(runExpr(zoom, { P: 1, params: { Zoom: 16 } })).toEqual([1600, 1600]);
    expect(runExpr(settle, { P: 0, params: { Settle: 80 } })).toEqual([80, 80]);
    expect(runExpr(settle, { P: 0.9, params: { Settle: 80 } })).toEqual([100, 100]);
  });
});
