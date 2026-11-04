// DSL → IR (compileScene): shape contents, gradients, effects, masks, motion blur, 3D renderer selection.
import { afterAll, describe, expect, it, vi } from 'vitest';

// Gradient presets are written to ~/.ae-compose/ffx at compile time: point the home dir at a temp folder first
// (gradients.ts resolves the folder when it is imported).
const TMP_HOME = vi.hoisted(() => {
  const base = (process.env.TEMP || process.env.TMPDIR || '/tmp').replace(/\\/g, '/');
  const dir = `${base}/aec-test-home-${process.pid}`;
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  return { dir, saved };
});

import fs from 'node:fs';
import { jsx } from '../../src/dsl/jsx-runtime.ts';
import {
  scene, Composition, Solid, Adjustment, Text, Shape, Null, Camera, Light, Model, Footage,
  Rect, Ellipse, Star, Path, Group, Fill, Stroke, GradientFill, GradientStroke, Trim, Repeater, Merge, ZigZag, WigglePaths,
  Effect, Mask, MotionBlur, tween,
} from '../../src/dsl/index.ts';
import { compileScene } from '../../src/compile/compile.ts';
import { parseColor } from '../../src/shared/units.ts';
import { parseSvgPath } from '../../src/shared/svgpath.ts';

afterAll(() => {
  fs.rmSync(TMP_HOME.dir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(TMP_HOME.saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
});

const h = (type: any, props: Record<string, any> | null = {}, ...children: any[]) =>
  jsx(type, children.length ? { ...(props ?? {}), children: children.length === 1 ? children[0] : children } : { ...(props ?? {}) });
const build = (cfg: Record<string, any>, ...layers: any[]) => compileScene(scene({ name: 'L', duration: 3, ...cfg } as any, () => h(Composition, {}, ...layers)));
const one = (...layers: any[]) => build({}, ...layers).ir.comps[0].layers[0];
const group = (L: any, at: string) => (L.groups ?? []).find((g: any) => g.at === at);
const contents = (L: any) => group(L, 'ADBE Root Vectors Group').items;
const fxOf = (L: any) => group(L, 'ADBE Effect Parade')?.items ?? [];
const pv = (item: any, p: string) => item.props.find((s: any) => s.p === p);
const V = 'ADBE Vector ';

describe('shape contents', () => {
  it('Rect, Fill and Stroke in AE Contents order (first child = frontmost)', () => {
    const L = one(h(Shape, { id: 's' },
      h(Rect, { name: 'Card', size: [400, 200], position: [10, 20], roundness: 24 }),
      h(Fill, { color: '#ff0000', opacity: 80, rule: 'evenOdd' }),
      h(Stroke, { color: [0, 0, 1], width: 6, opacity: 50, cap: 'round', join: 'bevel', taperStart: 10, taperEnd: 20 }),
    ));
    expect(L.type).toBe('shape');
    const [rect, fill, stroke] = contents(L);
    expect(rect).toEqual({ mn: `${V}Shape - Rect`, name: 'Card', props: [{ p: `${V}Rect Size`, v: [400, 200] }, { p: `${V}Rect Position`, v: [10, 20] }, { p: `${V}Rect Roundness`, v: 24 }] });
    expect(fill.mn).toBe(`${V}Graphic - Fill`);
    expect(fill.props).toEqual([{ p: `${V}Fill Color`, v: [1, 0, 0, 1] }, { p: `${V}Fill Opacity`, v: 80 }, { p: `${V}Fill Rule`, v: 2 }]);
    expect(stroke.mn).toBe(`${V}Graphic - Stroke`);
    expect(stroke.props).toEqual([
      { p: `${V}Stroke Color`, v: [0, 0, 1, 1] }, { p: `${V}Stroke Width`, v: 6 }, { p: `${V}Stroke Opacity`, v: 50 },
      { p: `${V}Stroke Line Cap`, v: 2 }, { p: `${V}Stroke Line Join`, v: 3 },
      { p: `${V}Stroke Taper/${V}Taper Start Length`, v: 10 }, { p: `${V}Stroke Taper/${V}Taper End Length`, v: 20 },
    ]);
    expect(stroke.kids).toBeUndefined();
    expect(L.anchorBox).toBeUndefined(); // shapes keep their anchor unless asked
  });
  it('defaults: Rect 100×100, white Fill, 4 px white Stroke, Repeater 3 copies offset 100 px', () => {
    const [rect, fill, stroke, rep] = contents(one(h(Shape, {}, h(Rect, {}), h(Fill, {}), h(Stroke, {}), h(Repeater, {}))));
    expect(rect.props).toEqual([{ p: `${V}Rect Size`, v: [100, 100] }]);
    expect(fill.props).toEqual([{ p: `${V}Fill Color`, v: [1, 1, 1, 1] }]);
    expect(stroke.props).toEqual([{ p: `${V}Stroke Color`, v: [1, 1, 1, 1] }, { p: `${V}Stroke Width`, v: 4 }]);
    expect(rep.props).toEqual([{ p: `${V}Repeater Copies`, v: 3 }, { p: `${V}Repeater Transform/${V}Repeater Position`, v: [100, 0] }]);
  });
  it('Stroke dashes become Dash/Gap items plus an (animatable) Offset', () => {
    const [stroke] = contents(one(h(Shape, {}, h(Stroke, { dash: [12, 6, 3, 6], dashOffset: tween({ from: 0, to: 36, duration: 1, easing: 'linear' }) }))));
    expect(stroke.kids).toHaveLength(1);
    const d = stroke.kids[0];
    expect(d.at).toBe(`${V}Stroke Dashes`);
    expect(d.items.map((x: any) => x.mn)).toEqual([`${V}Stroke Dash 1`, `${V}Stroke Gap 1`, `${V}Stroke Dash 2`, `${V}Stroke Gap 2`, `${V}Stroke Offset`]);
    expect(d.items.slice(0, 4).map((x: any) => x.set.v)).toEqual([12, 6, 3, 6]);
    expect(d.items[4].set.keys.map((k: any) => [k.t, k.v])).toEqual([[0, 0], [1, 36]]);
    const [plain] = contents(one(h(Shape, {}, h(Stroke, { dash: [5] }))));
    expect(plain.kids[0].items).toEqual([{ mn: `${V}Stroke Dash 1`, set: { v: 5 } }, { mn: `${V}Stroke Offset`, set: { v: 0 } }]);
  });
  it('Trim (animated), Repeater transform paths, Merge, ZigZag, WigglePaths (seeded)', () => {
    const items = contents(build({ params: { seed: 9 } }, h(Shape, {},
      h(Trim, { start: 10, end: tween({ from: 0, to: 100, duration: 1 }), offset: 45, individually: true }),
      h(Repeater, { copies: 5, offset: 1, position: [50, 0], scale: [90, 90], rotation: 15, anchor: [1, 2], startOpacity: 100, endOpacity: 0, order: 'above' }),
      h(Merge, { mode: 'subtract' }),
      h(ZigZag, { size: 8, ridges: 4, points: 'smooth' }),
      h(WigglePaths, { size: 5 }),
    )).ir.comps[0].layers[0]);
    const [trim, rep, merge, zz, wig] = items;
    expect(trim.mn).toBe(`${V}Filter - Trim`);
    expect(pv(trim, `${V}Trim Start`).v).toBe(10);
    expect(pv(trim, `${V}Trim End`).keys.map((k: any) => k.v)).toEqual([0, 100]);
    expect(pv(trim, `${V}Trim Offset`).v).toBe(45);
    expect(pv(trim, `${V}Trim Type`).v).toBe(2);
    const rt = `${V}Repeater Transform`;
    expect(rep.mn).toBe(`${V}Filter - Repeater`);
    expect(rep.props).toEqual([
      { p: `${V}Repeater Copies`, v: 5 }, { p: `${V}Repeater Offset`, v: 1 }, { p: `${V}Repeater Order`, v: 2 },
      { p: `${rt}/${V}Repeater Position`, v: [50, 0] }, { p: `${rt}/${V}Repeater Anchor`, v: [1, 2] }, { p: `${rt}/${V}Repeater Scale`, v: [90, 90] },
      { p: `${rt}/${V}Repeater Rotation`, v: 15 }, { p: `${rt}/${V}Repeater Opacity 1`, v: 100 }, { p: `${rt}/${V}Repeater Opacity 2`, v: 0 },
    ]);
    expect(merge).toEqual({ mn: `${V}Filter - Merge`, props: [{ p: `${V}Merge Type`, v: 3 }] });
    expect(zz.props).toEqual([{ p: `${V}Zigzag Size`, v: 8 }, { p: `${V}Zigzag Detail`, v: 4 }, { p: `${V}Zigzag Points`, v: 2 }]);
    expect(pv(wig, `${V}Random Seed`).v).toBe(9);
  });
  it('Group: transform paths under "ADBE Vector Transform Group" and nested contents', () => {
    const [g] = contents(one(h(Shape, {}, h(Group, { name: 'Icon', position: [10, 20], anchor: 5, scale: 50, rotation: 45, opacity: 60, skew: 10 },
      h(Ellipse, { size: 40, position: [1, 2] }),
      h(Group, { name: 'Inner' }, h(Star, { type: 'polygon', points: 6, outerRadius: 30, innerRadius: 99 })),
      h(Fill, { color: '#00ff00' }),
    ))));
    const tg = `${V}Transform Group`;
    expect(g.mn).toBe(`${V}Group`);
    expect(g.name).toBe('Icon');
    expect(g.props).toEqual([
      { p: `${tg}/${V}Position`, v: [10, 20] }, { p: `${tg}/${V}Anchor`, v: [5, 5] }, { p: `${tg}/${V}Scale`, v: [50, 50] },
      { p: `${tg}/${V}Rotation`, v: 45 }, { p: `${tg}/${V}Group Opacity`, v: 60 }, { p: `${tg}/${V}Skew`, v: 10 },
    ]);
    expect(g.kids).toHaveLength(1);
    expect(g.kids[0].at).toBe('ADBE Vectors Group');
    const [ell, inner, fill] = g.kids[0].items;
    expect(ell).toEqual({ mn: `${V}Shape - Ellipse`, props: [{ p: `${V}Ellipse Size`, v: [40, 40] }, { p: `${V}Ellipse Position`, v: [1, 2] }] });
    expect(inner.kids[0].items[0].mn).toBe(`${V}Shape - Star`);
    expect(inner.kids[0].items[0].props).toEqual([{ p: `${V}Star Type`, v: 2 }, { p: `${V}Star Points`, v: 6 }, { p: `${V}Star Outer Radius`, v: 30 }]); // polygons have no inner radius
    expect(fill.props[0].v).toEqual([0, 1, 0, 1]);
  });
  it('Path: SVG d (one Shape - Group per subpath), pen points, morph keys', () => {
    const d = 'M0 0 L100 0 L100 100 Z M200 0 L300 0';
    const items = contents(one(h(Shape, {},
      h(Path, { name: 'Logo', d }),
      h(Path, { points: [{ p: [0, 0], out: [10, 0] }, { p: [50, 50], in: [-10, 0] }], closed: false }),
      h(Path, { name: 'M', morph: [{ t: 0, d: 'M0 0 L10 0 L10 10 Z' }, { t: 1, d: 'M0 0 L20 0 L20 20 Z', easing: 'linear' }] }),
    )));
    const shapes = parseSvgPath(d);
    expect(items.slice(0, 2)).toEqual([
      { mn: `${V}Shape - Group`, name: 'Logo 1', props: [{ p: `${V}Shape`, v: shapes[0] }] },
      { mn: `${V}Shape - Group`, name: 'Logo 2', props: [{ p: `${V}Shape`, v: shapes[1] }] },
    ]);
    expect(items[2].props[0].v).toEqual({ v: [[0, 0], [50, 50]], i: [[0, 0], [-10, 0]], o: [[10, 0], [0, 0]], c: false });
    const mk = items[3].props[0].keys;
    expect(mk.map((k: any) => k.t)).toEqual([0, 1]);
    expect(mk[1].v.v).toEqual([[0, 0], [20, 0], [20, 20]]);
    expect(mk[0].oe[0].speed).toBe(0);
    expect(mk[0].oe[0].influence).toBeCloseTo(65, 9); // default easeInOutCubic [0.65, 0, 0.35, 1] out of key 1
    expect(() => one(h(Shape, {}, h(Path, {})))).toThrow(/<Path> needs `d`/);
  });
  it('animated contents props become keys at the layer\'s start', () => {
    const [rect] = contents(build({}, h(Solid, {}), h(Shape, { from: 1 }, h(Rect, { size: tween({ from: [0, 0], to: [200, 100], duration: 0.5 }) }))).ir.comps[0].layers[0]);
    const k = pv(rect, `${V}Rect Size`).keys;
    expect(k.map((x: any) => [x.t, x.v])).toEqual([[1, [0, 0]], [1.5, [200, 100]]]);
    expect(k[0].oe).toHaveLength(2); // per-dimension eases
  });
  it('invalid shape children fail with the list of valid ones', () => {
    expect(() => one(h(Shape, {}, h(Solid, {})))).toThrow(/<solid> is not valid inside <Shape>\. Use Rect, Ellipse/);
    expect(() => one(h(Shape, {}, 'hello'))).toThrow(/text "hello" inside <Shape>/);
  });
});

describe('gradients', () => {
  it('GradientFill → G-Fill item with Type/Start/End, stops (sorted) in its name and a generated .ffx preset', () => {
    const [, g] = contents(one(h(Shape, {}, h(Rect, { size: [460, 300] }),
      h(GradientFill, { type: 'linear', start: [-230, 0], end: [230, 0], stops: [{ offset: 0, color: '#4683c4' }, { offset: 1, color: '#ff5a8a' }, { offset: 0.5, color: '#7a3cff' }] }))));
    expect(g.mn).toBe('ADBE Vector Graphic - G-Fill');
    expect(g.name).toBe('Gradient Fill [#4683c4@0 #7a3cff@0.5 #ff5a8a@1]');
    expect(g.props).toEqual([{ p: 'ADBE Vector Grad Type', v: 1 }, { p: 'ADBE Vector Grad Start Pt', v: [-230, 0] }, { p: 'ADBE Vector Grad End Pt', v: [230, 0] }]);
    expect(g.ffx).toMatch(/\/[0-9a-f]{16}\.ffx$/);
    expect(g.ffx.startsWith(`${TMP_HOME.dir}/.ae-compose/ffx/`)).toBe(true);
    expect(fs.existsSync(g.ffx)).toBe(true);
    const body = fs.readFileSync(g.ffx, 'latin1');
    expect(body).not.toMatch(/points\[/); // every stop placeholder was filled
    expect(body).toContain(`<float>${(0x46 / 255).toFixed(8)}</float>`);
  });
  it('the preset file name is a content hash: same stops → same file, different stops → different file', () => {
    const ffx = (stops: any[]) => contents(one(h(Shape, {}, h(GradientFill, { stops }))))[0].ffx;
    const a = ffx([{ offset: 0, color: '#000' }, { offset: 1, color: '#fff' }]);
    expect(ffx([{ offset: 1, color: '#fff' }, { offset: 0, color: '#000' }])).toBe(a);
    expect(ffx([{ offset: 0, color: '#000' }, { offset: 1, color: '#f00' }])).not.toBe(a);
  });
  it('GradientStroke: radial type, width, custom name', () => {
    const [g] = contents(one(h(Shape, {}, h(GradientStroke, { name: 'Ring', type: 'radial', width: 24, opacity: 50, start: [0, 0], end: [150, 0], stops: [{ offset: 0, color: '#ffd23f' }, { offset: 1, color: '#ee4266' }] }))));
    expect(g.mn).toBe('ADBE Vector Graphic - G-Stroke');
    expect(g.name).toBe('Ring [#ffd23f@0 #ee4266@1]');
    expect(g.props).toEqual([
      { p: 'ADBE Vector Stroke Opacity', v: 50 }, { p: 'ADBE Vector Stroke Width', v: 24 }, { p: 'ADBE Vector Grad Type', v: 2 },
      { p: 'ADBE Vector Grad Start Pt', v: [0, 0] }, { p: 'ADBE Vector Grad End Pt', v: [150, 0] },
    ]);
  });
  it('fewer than 2 stops throws; more than 8 are resampled with a warning', () => {
    expect(() => one(h(Shape, {}, h(GradientFill, { stops: [{ offset: 0, color: '#fff' }] })))).toThrow(/at least 2 stops/);
    const r = build({}, h(Shape, {}, h(GradientFill, { stops: Array.from({ length: 10 }, (_, i) => ({ offset: i / 9, color: i % 2 ? '#fff' : '#000' })) })));
    expect(r.warnings.some((w) => /10 stops.*resampled to 8/.test(w))).toBe(true);
  });
});

describe('effects', () => {
  it('friendly names resolve to matchNames ("Glow" → ADBE Glo2); matchNames pass through', () => {
    const L = one(h(Solid, {},
      h(Effect, { name: 'Glow', label: 'Soft Glow', params: { 'Glow Radius': 30, 'Glow Intensity': tween({ from: 0, to: 2, duration: 1 }) } }),
      h(Effect, { name: 'gaussian blur', params: { Blurriness: 12 } }),
      h(Effect, { name: 'ADBE Drop Shadow', enabled: false }),
      h(Effect, { name: 'Fill', params: { Color: '#ff8000', 'Fill Mask': { layer: 'other' } } }),
    ));
    const fx = fxOf(L);
    expect(fx.map((e: any) => e.mn)).toEqual(['ADBE Glo2', 'ADBE Gaussian Blur 2', 'ADBE Drop Shadow', 'ADBE Fill']);
    expect(fx[0].name).toBe('Soft Glow');
    expect(pv(fx[0], 'Glow Radius')).toEqual({ p: 'Glow Radius', v: 30 });
    expect(pv(fx[0], 'Glow Intensity').keys.map((k: any) => k.v)).toEqual([0, 2]);
    expect(fx[2].attrs).toEqual({ enabled: false });
    expect(pv(fx[3], 'Color').v).toEqual(parseColor('#ff8000'));
    expect(pv(fx[3], 'Fill Mask')).toEqual({ p: 'Fill Mask', v: { layer: 'other' } });
  });
  it('effects given as a list (effects=) are appended after <Effect> children', () => {
    const fx = fxOf(one(h(Solid, { effects: [h(Effect, { name: 'Tint' })] }, h(Effect, { name: 'Glow' }))));
    expect(fx.map((e: any) => e.mn)).toEqual(['ADBE Glo2', 'ADBE Tint']);
  });
  it('unknown effects fail with "Did you mean" suggestions', () => {
    expect(() => one(h(Solid, {}, h(Effect, { name: 'Glowz' })))).toThrow(/unknown effect "Glowz"\. Did you mean: "Glow" \(ADBE Glo2\)/);
    expect(() => one(h(Solid, {}, h(Effect, { name: 'Gausian Blur' })))).toThrow(/Did you mean:.*Gaussian Blur/);
  });
  it('<Effect>/<Mask> outside a layer are rejected', () => {
    expect(() => build({}, h(Effect, { name: 'Glow' }))).toThrow(/must be a child of a layer/);
    expect(() => build({}, h(Mask, { rect: { x: 0, y: 0, width: 1, height: 1 } }))).toThrow(/must be a child of a layer/);
  });
});

describe('masks', () => {
  it('rect, SVG path and pen points; mode, inverted, feather, expansion, opacity', () => {
    const L = one(h(Solid, {},
      h(Mask, { name: 'Box', rect: { x: 10, y: 20, width: 100, height: 50 }, mode: 'subtract', feather: 10, expansion: -2, opacity: 75, inverted: true }),
      h(Mask, { path: 'M0 0 C 50 -20 100 -20 150 0 L150 80 Z' }),
      h(Mask, { points: [{ p: [0, 0] }, { p: [10, 0], in: [-2, 0] }, { p: [10, 10] }], feather: [4, 8], mode: 'intersect' }),
    ));
    const masks = group(L, 'ADBE Mask Parade').items;
    expect(masks.map((m: any) => m.mn)).toEqual(['ADBE Mask Atom', 'ADBE Mask Atom', 'ADBE Mask Atom']);
    expect(masks[0]).toEqual({
      mn: 'ADBE Mask Atom', name: 'Box', attrs: { maskMode: 'SUBTRACT', inverted: true },
      props: [
        { p: 'ADBE Mask Shape', v: { v: [[10, 20], [110, 20], [110, 70], [10, 70]], i: [[0, 0], [0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0], [0, 0]], c: true } },
        { p: 'ADBE Mask Feather', v: [10, 10] }, { p: 'ADBE Mask Offset', v: -2 }, { p: 'ADBE Mask Opacity', v: 75 },
      ],
    });
    expect(masks[1].attrs).toEqual({ maskMode: 'ADD', inverted: false });
    expect(masks[1].props[0].v).toEqual(parseSvgPath('M0 0 C 50 -20 100 -20 150 0 L150 80 Z')[0]);
    expect(masks[2].props[0].v).toEqual({ v: [[0, 0], [10, 0], [10, 10]], i: [[0, 0], [-2, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0]], c: true });
    expect(masks[2].props[1]).toEqual({ p: 'ADBE Mask Feather', v: [4, 8] });
    expect(masks[2].attrs.maskMode).toBe('INTERSECT');
  });
  it('masks come before effects; a mask without a shape throws', () => {
    const L = one(h(Solid, {}, h(Effect, { name: 'Glow' }), h(Mask, { rect: { x: 0, y: 0, width: 5, height: 5 } })));
    expect(L.groups.map((g: any) => g.at)).toEqual(['ADBE Mask Parade', 'ADBE Effect Parade']);
    expect(() => one(h(Solid, {}, h(Mask, {})))).toThrow(/<Mask> needs path, points or rect/);
  });
});

describe('motion blur', () => {
  it('true → layer switch and the comp switch is turned on', () => {
    const r = build({}, h(Solid, { id: 'a', motionBlur: true }), h(Solid, { id: 'b' }));
    const [b, a] = r.ir.comps[0].layers;
    expect(a.motionBlur).toBe(true);
    expect(b.motionBlur).toBeUndefined();
    expect(r.ir.comps[0].motionBlur).toBe(true);
    expect(fxOf(a)).toEqual([]);
  });
  it('an explicit comp motionBlur: false is not overridden by a layer switch', () => {
    const r = build({ motionBlur: false }, h(Solid, { motionBlur: true }));
    expect(r.ir.comps[0].motionBlur).toBe(false);
    expect(r.ir.comps[0].layers[0].motionBlur).toBe(true);
    expect(build({ motionBlur: { shutterAngle: 360, shutterPhase: -180, samples: 64, adaptiveLimit: 128 } }).ir.comps[0]).toMatchObject({ motionBlur: true, shutterAngle: 360, shutterPhase: -180, samples: 64, adaptive: 128 });
  });
  it("'force' adds CC Force Motion Blur (and does not set the layer switch)", () => {
    const r = build({}, h(Solid, { motionBlur: 'force' }), h(Text, { motionBlur: { mode: 'force', samples: 32, shutterAngle: 270, shutterPhase: -90 } }, 'x'));
    const [txt, sol] = r.ir.comps[0].layers;
    expect(sol.motionBlur).toBeUndefined();
    expect(r.ir.comps[0].motionBlur).toBeUndefined();
    expect(fxOf(sol)).toEqual([{ mn: 'CC Force Motion Blur', props: [{ p: 'Motion Blur Samples', v: 16 }, { p: 'Override Shutter Settings', v: 1 }, { p: 'Shutter Angle', v: 180 }, { p: 'Shutter Phase', v: 0 }, { p: 'Native Motion Blur', v: 2 }] }]);
    expect(fxOf(txt)[0].props.map((p: any) => p.v)).toEqual([32, 1, 270, -90, 2]);
  });
  it("'pixel' adds Pixel Motion Blur; <MotionBlur> is a forced-blur adjustment layer", () => {
    expect(fxOf(one(h(Solid, { motionBlur: 'pixel' })))[0]).toEqual({ mn: 'ADBE OFMotionBlur', props: [{ p: 'Shutter Control', v: 1 }, { p: 'Shutter Angle', v: 180 }, { p: 'Shutter Samples', v: 8 }] });
    const adj = one(h(MotionBlur, { samples: 24 }));
    expect(adj).toMatchObject({ type: 'adjustment', name: 'Force Motion Blur', solid: { color: [1, 1, 1], w: 1920, h: 1080 } });
    expect(fxOf(adj)[0].mn).toBe('CC Force Motion Blur');
    expect(fxOf(adj)[0].props[0]).toEqual({ p: 'Motion Blur Samples', v: 24 });
    expect(one(h(Adjustment, {})).type).toBe('adjustment');
  });
});

describe('3D renderer selection', () => {
  it('extrusion with renderer classic3d throws, naming the renderers that support it', () => {
    const run = () => build({ renderer: 'classic3d' }, h(Text, { threeD: true, geometry: { extrusion: 20 } }, 'AE'));
    expect(run).toThrow(/comp "L_v001": extruded\/beveled 3D text or shapes not supported by the Classic 3D renderer/);
    expect(run).toThrow(/Advanced 3D/);
    expect(run).toThrow(/Cinema 4D/);
  });
  it('extrusion without a renderer auto-selects Advanced 3D and writes extrusion props', () => {
    const r = build({}, h(Text, { threeD: true, geometry: { extrusion: 60, bevel: { style: 'convex', depth: 6, direction: 'outward' } }, material: { castsShadows: true } }, 'AE'));
    const c = r.ir.comps[0];
    expect(c.renderer).toBe('ADBE Calder');
    expect(r.warnings).toContain('[L_v001] renderer set to Advanced 3D (needed for: extrusion)');
    expect(c.layers[0].props).toEqual(expect.arrayContaining([
      { p: 'ADBE Extrsn Options Group/ADBE Extrsn Depth', v: 60 },
      { p: 'ADBE Extrsn Options Group/ADBE Bevel Styles', v: 4 },
      { p: 'ADBE Extrsn Options Group/ADBE Bevel Depth', v: 6 },
      { p: 'ADBE Extrsn Options Group/ADBE Bevel Direction', v: 2 },
      { p: 'ADBE Material Options Group/ADBE Casts Shadows', v: 1 },
    ]));
    expect(comp3d('cinema4d', h(Text, { threeD: true, geometry: { extrusion: 10 } }, 'x')).renderer).toBe('ADBE Ernst');
  });
  it('models auto-select "ADBE Calder" and register a file asset', () => {
    const r = compileScene(scene({ name: 'Mod', duration: 1 }, () => h(Composition, {}, h(Model, { id: 'bot', src: 'robot.glb' }))), { sceneFile: '/scenes/demo/scene.tsx' });
    const c = r.ir.comps[0];
    expect(c.renderer).toBe('ADBE Calder');
    expect(r.ir.assets).toHaveLength(1);
    expect(r.ir.assets[0].id).toBe('asset.robot-glb');
    expect(r.ir.assets[0].path.replace(/\\/g, '/')).toMatch(/\/scenes\/demo\/robot\.glb$/);
    expect(c.layers[0]).toMatchObject({ id: 'bot', type: 'model', threeD: true, footage: { asset: 'asset.robot-glb' } });
    expect(() => comp3d('cinema4d', h(Model, { src: 'x.glb' }))).toThrow(/3D model layers .* not supported by the Cinema 4D renderer \(supported by: Advanced 3D\)/);
    expect(() => build({}, h(Model, {}))).toThrow(/<Model> needs src/);
  });
  it('plain 3D layers get Classic 3D; 2D-only comps get no renderer', () => {
    expect(build({}, h(Solid, { threeD: true })).ir.comps[0].renderer).toBe('ADBE Advanced 3d');
    expect(build({}, h(Solid, {})).ir.comps[0].renderer).toBeUndefined();
    expect(build({ renderer: 'advanced3d' }, h(Solid, {})).ir.comps[0].renderer).toBe('ADBE Calder');
  });
  it('effects on a 3D text layer are rejected under Advanced 3D, with a workaround', () => {
    expect(() => comp3d('advanced3d', h(Text, { threeD: true }, 'x', h(Effect, { name: 'Glow' })))).toThrow(/effects\/masks\/mattes\/blend modes on 3D text.*Put the effect on an adjustment layer above/);
  });
  it('soft requirements become warnings (motion blur on 3D layers under Advanced 3D)', () => {
    const r = compileScene(scene({ name: 'MB', duration: 1, renderer: 'advanced3d' }, () => h(Composition, {}, h(Solid, { threeD: true, motionBlur: true }))));
    expect(r.warnings.some((w) => /motion blur not supported by the Advanced 3D renderer.*it will be ignored/.test(w))).toBe(true);
  });
  it('camera: lens → zoom, rest z = -zoom, look-at and focus expressions resolve layer ids', () => {
    const r = build({}, h(Null, { id: 'target', name: 'Target' }), h(Camera, { id: 'cam', lens: 36, dof: true, focusOn: 'target', fStop: 2 }), h(Light, { id: 'key', kind: 'spot', lookAt: 'target', intensity: 120, color: '#ffeedd', coneAngle: 60, castsShadows: true }), h(Light, { kind: 'ambient', intensity: 20 }));
    const L = (id: string) => r.ir.comps[0].layers.find((x: any) => x.id === id);
    const cam = L('cam');
    const z = 1920; // 36 mm on a 36 mm back = comp width
    expect(cam).toMatchObject({ type: 'camera', threeD: true, camera: { twoNode: true } });
    expect(cam.props).toEqual(expect.arrayContaining([
      { p: 'ADBE Transform Group/ADBE Position', v: [960, 540, -z] },
      { p: 'ADBE Camera Options Group/ADBE Camera Zoom', v: z },
      { p: 'ADBE Camera Options Group/ADBE Camera Depth of Field', v: 1 },
      { p: 'ADBE Camera Options Group/ADBE Camera Aperture', v: z / 2 },
    ]));
    const focus = cam.props.find((p: any) => p.p === 'ADBE Camera Options Group/ADBE Camera Focus Distance');
    expect(focus.expr).toContain('var t = thisComp.layer("Target");');
    const key = L('key');
    expect(key.light).toEqual({ kind: 'spot' });
    expect(key.props.find((p: any) => p.p === 'ADBE Transform Group/ADBE Anchor Point').expr).toContain('thisComp.layer("Target")');
    expect(key.props.find((p: any) => p.p === 'ADBE Light Options Group/ADBE Light Color').v).toEqual(parseColor('#ffeedd'));
    const amb = r.ir.comps[0].layers.find((x: any) => x.light?.kind === 'ambient');
    expect(amb.props.some((p: any) => p.p.startsWith('ADBE Transform Group'))).toBe(false); // ambient lights have no transform
    expect(r.ir.comps[0].renderer).toBe('ADBE Advanced 3d');
  });
});

describe('footage', () => {
  it('src → file asset; item → project item; trim/speed map to start/out/stretch', () => {
    const r = compileScene(scene({ name: 'F', duration: 10 }, () => h(Composition, {},
      h(Footage, { id: 'clip', src: 'media/Hero Clip.mov', trim: ['1s', '3s'], speed: 2, muted: true, loop: true, fit: 'contain' }),
      h(Footage, { id: 'still', item: 'Logo.png' }),
      h(Footage, { id: 'again', src: 'media/Hero Clip.mov' }),
    )), { sceneFile: '/proj/scene.tsx' });
    expect(r.ir.assets.map((a: any) => a.id)).toEqual(['asset.hero-clip-mov', 'item.logo-png']);
    expect(r.ir.assets[1]).toEqual({ id: 'item.logo-png', item: 'Logo.png' });
    const L = (id: string) => r.ir.comps[0].layers.find((x: any) => x.id === id);
    expect(L('clip')).toMatchObject({ type: 'footage', footage: { asset: 'asset.hero-clip-mov' }, fit: 'contain', in: 0, start: -0.5, out: 1, stretch: 50, muted: true, loop: true });
    expect(L('still')).toMatchObject({ fit: 'cover', start: 0, out: 10 });
    expect(L('again').footage.asset).toBe('asset.hero-clip-mov'); // same file → one asset
    expect(() => build({}, h(Footage, {}))).toThrow(/<Footage> needs src/);
  });
});

function comp3d(renderer: string, ...layers: any[]) {
  return compileScene(scene({ name: 'R', duration: 1, renderer } as any, () => h(Composition, {}, ...layers))).ir.comps[0];
}
