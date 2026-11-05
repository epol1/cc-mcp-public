// DSL → IR (compileScene): layout containers (solved in AE) and particle systems.
import { describe, expect, it } from 'vitest';
import { jsx } from '../../src/dsl/jsx-runtime.ts';
import {
  scene, Composition, Sequence, Solid, Null, Text, Shape, Rect, Fill, Precomp,
  Stack, Row, Column, Grid, Align, Center, Padding, Box, Overlay, SafeArea,
  ParticleWorld, Rainfall, ParticleSystemsII, PixelPolly, particlePresets, seedFrom, keys, spring, tween,
} from '../../src/dsl/index.ts';
import { compileScene } from '../../src/compile/compile.ts';
import { parseColor } from '@ae-mcp/core/units.ts';

const h = (type: any, props: Record<string, any> | null = {}, ...children: any[]) =>
  jsx(type, children.length ? { ...(props ?? {}), children: children.length === 1 ? children[0] : children } : { ...(props ?? {}) });
const build = (cfg: Record<string, any>, ...layers: any[]) => compileScene(scene({ name: 'S', duration: 3, ...cfg } as any, () => h(Composition, {}, ...layers)));
const byId = (r: any, id: string) => {
  for (const c of r.ir.comps) for (const L of c.layers) if (L.id === id) return L;
  throw new Error(`no layer ${id}`);
};
const prop = (L: any, p: string) => (L.props ?? []).find((s: any) => s.p === p);
const fx = (L: any) => L.groups.find((g: any) => g.at === 'ADBE Effect Parade').items;
const param = (e: any, p: string) => e.props.find((s: any) => s.p === p);
const TG = 'ADBE Transform Group';

describe('layout', () => {
  it('<Column> becomes a solver tree in comp.layouts over the whole comp; leaves are the layers', () => {
    const r = build({}, h(Solid, { id: 'bg' }), h(Column, { gap: 28, align: 'start', padding: 10 }, h(Text, { id: 't1' }, 'One'), h(Text, { id: 't2', layout: { grow: 1, align: 'end' } }, 'Two')));
    const c = r.ir.comps[0];
    expect(c.layouts).toEqual([{
      root: { id: 's.stack0', kind: 'stack', gap: 28, align: 'start', direction: 'column', padding: [10, 10, 10, 10], children: [{ id: 't1', kind: 'leaf' }, { id: 't2', kind: 'leaf', grow: 1, align: 'end' }] },
      area: { x: 0, y: 0, w: 1920, h: 1080 },
    }]);
    expect(c.layers.map((L: any) => L.id)).toEqual(['t2', 't1', 'bg']);
    expect(byId(r, 'bg').layoutLeaf).toBeUndefined();
  });
  it('a precomp inside a layout is the leaf; the layers inside it are placed in its own space, not as layout leaves', () => {
    const r = build({}, h(Align, { at: 'topLeft' }, h(Box, { width: 0, height: 0, offset: [640, 392] },
      h(Precomp, { id: 'card', width: 440, height: 520 }, h(Shape, { id: 'card.bg' }, h(Rect, { size: [440, 520] }), h(Fill, {}))))));
    expect(byId(r, 'card').layoutLeaf).toBe(true);
    const bg = byId(r, 'card.bg');
    expect(bg.layoutLeaf).toBeUndefined();
    expect(prop(bg, `${TG}/ADBE Position`)).toEqual({ p: `${TG}/ADBE Position`, v: [220, 260] }); // the precomp's centre
  });
  it('laid-out layers: layoutLeaf, centred anchor box, and position as an offset from the slot (rel)', () => {
    const r = build({}, h(Stack, { direction: 'row', gap: 10 },
      h(Text, { id: 'a' }, 'A'),
      h(Shape, { id: 'b', x: 5, y: -5 }, h(Rect, {}), h(Fill, {})),
      h(Text, { id: 'c', anchor: 'left', animate: { y: spring({ from: 40 }), opacity: tween({ from: 0, duration: 0.5 }) } }, 'C'),
    ));
    const a = byId(r, 'a'), b = byId(r, 'b'), c = byId(r, 'c');
    expect(a.layoutLeaf).toBe(true);
    expect(a.anchorBox).toEqual([0.5, 0.5]);
    expect(prop(a, `${TG}/ADBE Position`)).toEqual({ p: `${TG}/ADBE Position`, v: [0, 0], rel: [0, 1] });
    expect(b.anchorBox).toEqual([0.5, 0.5]); // shapes get a centred box inside layouts
    expect(prop(b, `${TG}/ADBE Position`)).toEqual({ p: `${TG}/ADBE Position`, v: [5, -5], rel: [0, 1] });
    expect(c.anchorBox).toEqual([0, 0.5]);
    expect(prop(c, `${TG}/ADBE Position`)).toEqual({ p: `${TG}/ADBE Position`, sep: true });
    expect(prop(c, `${TG}/ADBE Position_0`)).toEqual({ p: `${TG}/ADBE Position_0`, v: 0, rel: [0] });
    const y = prop(c, `${TG}/ADBE Position_1`);
    expect(y.rel).toEqual([1]);
    expect(y.keys[0].v).toBe(40); // rises 40 px into its slot
    expect(y.keys[y.keys.length - 1].v).toBe(0);
    expect(r.ir.comps[0].layouts[0].root).toMatchObject({ kind: 'stack', direction: 'row', gap: 10 });
  });
  it('3D leaves are relative in all three dims', () => {
    const r = build({}, h(Column, {}, h(Solid, { id: 'p', threeD: true, width: 100, height: 100 })));
    expect(prop(byId(r, 'p'), `${TG}/ADBE Position`).rel).toEqual([0, 1, 2]);
  });
  it('SafeArea constrains its children to title-safe (10 %), action-safe (5 %) or custom insets', () => {
    const area = (kind: any) => build({}, h(SafeArea, { kind }, h(Align, { at: 'bottomLeft' }, h(Text, {}, 'x')))).ir.comps[0].layouts[0].area;
    expect(area(undefined)).toEqual({ x: 192, y: 108, w: 1536, h: 864 });
    expect(area('title')).toEqual({ x: 192, y: 108, w: 1536, h: 864 });
    expect(area('action')).toEqual({ x: 96, y: 54, w: 1728, h: 972 });
    expect(area([10, 20, 30, 40])).toEqual({ x: 40, y: 10, w: 1860, h: 1040 });
    const root = build({}, h(SafeArea, {}, h(Align, { at: 'bottomLeft', offset: [0, -20] }, h(Text, { id: 'n' }, 'Name')))).ir.comps[0].layouts[0].root;
    expect(root).toEqual({ id: 's.align0', kind: 'align', at: 'bottomLeft', offset: [0, -20], children: [{ id: 'n', kind: 'leaf' }] });
  });
  it('Grid, Center, Padding, Box, Overlay and nested containers', () => {
    const r = build({},
      h(Grid, { id: 'g', columns: 3, rowGap: 4, colGap: 8 }, h(Solid, { id: 'g1', width: 10, height: 10 }), h(Row, { id: 'r', justify: 'spaceBetween', width: 300 }, h(Text, { id: 'g2' }, 'x'), h(Text, { id: 'g3' }, 'y'))),
      h(Center, {}, h(Padding, { padding: [1, 2, 3, 4] }, h(Box, { width: 200, height: 100, align: 'stretch' }, h(Overlay, {}, h(Text, { id: 'o1' }, 'o'))))),
    );
    const [g, c] = r.ir.comps[0].layouts.map((x: any) => x.root);
    expect(g).toEqual({ id: 'g', kind: 'grid', columns: 3, rowGap: 4, colGap: 8, children: [{ id: 'g1', kind: 'leaf' }, { id: 'r', kind: 'stack', justify: 'spaceBetween', width: 300, direction: 'row', children: [{ id: 'g2', kind: 'leaf' }, { id: 'g3', kind: 'leaf' }] }] });
    expect(c.kind).toBe('align');
    expect(c.at).toBe('center');
    expect(c.children[0]).toMatchObject({ kind: 'padding', padding: [1, 2, 3, 4] });
    expect(c.children[0].children[0]).toMatchObject({ kind: 'box', width: 200, height: 100, align: 'stretch' });
    expect(c.children[0].children[0].children[0]).toMatchObject({ kind: 'overlay', children: [{ id: 'o1', kind: 'leaf' }] });
  });
  it('a Sequence inside a layout times its leaves; a Precomp is one leaf', () => {
    const r = build({ duration: 5 }, h(Column, {}, h(Sequence, { from: 1, duration: 2 }, h(Text, { id: 'late' }, 'late')), h(Precomp, { id: 'card', width: 300, height: 200 }, h(Solid, {}))));
    expect(r.ir.comps.find((c: any) => c.id === 's').layouts[0].root.children).toEqual([{ id: 'late', kind: 'leaf' }, { id: 'card', kind: 'leaf' }]);
    expect(byId(r, 'late')).toMatchObject({ in: 1, out: 3, layoutLeaf: true });
    expect(byId(r, 'card')).toMatchObject({ type: 'precomp', layoutLeaf: true });
  });
  it('SafeArea nested inside a layout is rejected', () => {
    expect(() => build({}, h(Column, {}, h(SafeArea, {}, h(Text, {}, 'x'))))).toThrow(/<SafeArea> must be at the top level/);
  });
});

describe('particles', () => {
  it('ParticleWorld preset → comp-size black solid with CC Particle World, preset params and a Random Seed', () => {
    const r = build({}, h(ParticleWorld, { id: 'dust', preset: 'dustBokeh' }));
    const L = byId(r, 'dust');
    expect(L).toMatchObject({ type: 'solid', name: 'Dust Bokeh', solid: { color: [0, 0, 0], w: 1920, h: 1080 } });
    const [pw] = fx(L);
    expect(pw.mn).toBe('CC Particle World');
    expect(param(pw, 'Random Seed')).toEqual({ p: 'Random Seed', v: seedFrom('dust') });
    expect(param(pw, 'Longevity (sec)')).toEqual({ p: 'Longevity (sec)', v: 6 });
    expect(param(pw, 'Birth Color').v).toEqual(parseColor('#ffe9c8'));
    expect(param(pw, 'Particle Type').v).toBe(5);
  });
  it("the preset's key params are live controls named after the system", () => {
    const r = build({}, h(ParticleWorld, { id: 'dust', preset: 'dustBokeh' }));
    const [pw] = fx(byId(r, 'dust'));
    expect(param(pw, 'Birth Rate')).toEqual({ p: 'Birth Rate', v: 0.25, expr: 'thisComp.layer("Controls").effect("Dust Bokeh Birth Rate")(1)' });
    const ctl = r.ir.comps[0].layers[0];
    expect(ctl.name).toBe('Controls');
    const names = ctl.groups[0].items.map((e: any) => e.name);
    expect(names).toEqual(Object.keys(particlePresets.dustBokeh.live).map((k) => `Dust Bokeh ${k}`));
    // controls: false keeps them static
    const [st] = fx(byId(build({}, h(ParticleWorld, { id: 'dust', preset: 'dustBokeh', controls: false })), 'dust'));
    expect(param(st, 'Birth Rate')).toEqual({ p: 'Birth Rate', v: 0.25 });
  });
  it('explicit seed and param overrides win; seeds are deterministic per id', () => {
    const [pw] = fx(byId(build({}, h(ParticleWorld, { id: 'p', preset: 'sparks', seed: 42, params: { Velocity: 2, 'Birth Color': '#00ff00' }, name: 'My Sparks' })), 'p'));
    expect(param(pw, 'Random Seed').v).toBe(42);
    expect(param(pw, 'Velocity')).toEqual({ p: 'Velocity', v: 2 }); // override replaces the live control
    expect(param(pw, 'Birth Color').v).toEqual([0, 1, 0, 1]);
    expect(seedFrom('dust')).toBe(seedFrom('dust'));
    expect(seedFrom('dust')).not.toBe(seedFrom('trail'));
    expect(seedFrom('dust')).toBeGreaterThanOrEqual(0);
    expect(seedFrom('dust')).toBeLessThan(10000);
  });
  it('burst → hold keys on Birth Rate (0 → rate at `at` → 0 after `duration`)', () => {
    const [pw] = fx(byId(build({}, h(ParticleWorld, { id: 'c', preset: 'confettiBurst', burst: { at: 1.2, duration: 0.2, rate: 14 } })), 'c'));
    const br = param(pw, 'Birth Rate');
    expect(br.expr).toBeUndefined();
    expect(br.keys.map((k: any) => k.v)).toEqual([0, 14, 0]);
    expect(br.keys[0].t).toBe(0);
    expect(br.keys[1].t).toBeCloseTo(1.2, 9);
    expect(br.keys[2].t).toBeCloseTo(1.4, 9);
    expect(br.keys[0].o).toBe('hold');
    expect(br.keys[1].o).toBe('hold');
    // default rate = the preset birth rate (static when controls are off), default duration 0.15 s
    const [d] = fx(byId(build({}, h(ParticleWorld, { id: 'd', preset: 'sparks', controls: false, burst: { at: '500ms' } })), 'd'));
    expect(param(d, 'Birth Rate').keys.map((k: any) => [+k.t.toFixed(6), k.v])).toEqual([[0, 0], [0.5, 2.5], [0.65, 0]]);
  });
  // Regression (was a bug, fixed): with live controls on (the default) the preset's Birth Rate is a ControlRef, so the default burst rate
  // falls back to a hard-coded 8 instead of the preset value (src/dsl/particles.ts:91: `typeof params['Birth Rate'] === 'number'`).
  it('the default burst rate is the preset Birth Rate whether or not controls are on', () => {
    const [d] = fx(byId(build({}, h(ParticleWorld, { id: 'd', preset: 'sparks', burst: { at: '500ms' } })), 'd'));
    expect(param(d, 'Birth Rate').keys[1].v).toBe(2.5); // actual: 8
  });
  // Regression (was a bug, fixed): burst times given in frames (or timecode) are not added (src/dsl/particles.ts:103-107, addTime returns `at`
  // unchanged for "12f"), so the end key lands on the start key and the burst never happens: Birth Rate stays 0.
  it('burst with frame times ("12f" + "6f") rises to the rate at 0.4 s and drops at 0.6 s', () => {
    const [pw] = fx(byId(build({}, h(ParticleWorld, { id: 'c', preset: 'confettiBurst', burst: { at: '12f', duration: '6f', rate: 14 } })), 'c'));
    const br = param(pw, 'Birth Rate');
    expect(br.keys.map((k: any) => k.v)).toEqual([0, 14, 0]); // actual: [0, 0]
    expect(br.keys[2].t).toBeCloseTo(0.6, 9);
  });
  it('emitter.follow → Position X/Y/Z expressions that track the target layer by name', () => {
    const r = build({},
      h(Null, { id: 'comet', name: 'Comet', animate: { position: keys({ t: 0, v: [150, 560], easing: 'easeInOutCubic' }, { t: 2.6, v: [1130, 180] }) } }),
      h(ParticleWorld, { id: 'trail', preset: 'energyTrail', emitter: { follow: 'comet' } }),
    );
    const [pw] = fx(byId(r, 'trail'));
    for (const [axis, idx] of [['X', 0], ['Y', 1]] as const) {
      const e = param(pw, `Position ${axis}`);
      expect(e.v).toBe(0);
      expect(e.expr).toContain('var t = thisComp.layer("Comet");');
      expect(e.expr).toContain(`(w[${idx}] - thisComp.${axis === 'X' ? 'width' : 'height'} / 2) / thisLayer.width`);
      expect(e.expr).not.toContain('__AEC_LAYER');
    }
    expect(param(pw, 'Position Z').expr).toContain('(w.length > 2 ? w[2] : 0) / thisLayer.width');
  });
  it('emitter.follow to an unknown id or to a non-unique layer name throws', () => {
    expect(() => build({}, h(ParticleWorld, { id: 'trail', emitter: { follow: 'ghost' } }))).toThrow(/unknown layer id "ghost"/);
    expect(() => build({}, h(Null, { id: 'a', name: 'Twin' }), h(Null, { id: 'b', name: 'Twin' }), h(ParticleWorld, { id: 't', emitter: { follow: 'a' } }))).toThrow(/layer name "Twin" \(id a\) is not unique/);
  });
  it('an element texture becomes a hidden precomp used as Texture Layer (textured particle type)', () => {
    const r = build({}, h(ParticleWorld, { id: 'logo', preset: 'magicSparkle', texture: h(Text, {}, '★'), textureSize: [128, 128] }));
    const tex = byId(r, 'logo.texture');
    expect(tex).toMatchObject({ type: 'precomp', enabled: false, name: 'Magic Sparkle Texture' });
    expect(r.ir.comps.find((c: any) => c.id.endsWith('~logo.texture'))).toMatchObject({ w: 128, h: 128, part: true });
    const [pw] = fx(byId(r, 'logo'));
    expect(param(pw, 'Texture Layer')).toEqual({ p: 'Texture Layer', v: { layer: 'logo.texture' } });
    expect(param(pw, 'Particle Type').v).toBe(14);
  });
  it('other systems: Rainfall on an adjustment layer, Particle Systems II seeded, PixelPolly on its child', () => {
    const r = build({},
      h(Rainfall, { id: 'rain', params: { Drops: 2000 } }),
      h(ParticleSystemsII, { id: 'ps', seed: 3 }),
      h(PixelPolly, { params: { Force: 120 } }, h(Text, { id: 'title' }, 'BREAK IT')),
    );
    const rain = byId(r, 'rain');
    expect(rain).toMatchObject({ type: 'adjustment', name: 'Rainfall' });
    expect(fx(rain)[0].mn).toBe('CSRainfall');
    expect(param(fx(rain)[0], 'Random Seed').v).toBe(seedFrom('rain'));
    expect(param(fx(rain)[0], 'Drops').v).toBe(2000);
    expect(param(fx(byId(r, 'ps'))[0], 'Random Seed').v).toBe(3);
    const title = byId(r, 'title');
    expect(title.type).toBe('text');
    expect(fx(title)[0].mn).toBe('CC Pixel Polly');
    expect(param(fx(title)[0], 'Force').v).toBe(120);
  });
});
