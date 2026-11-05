// Procedural backgrounds (P4) → IR, no AE: effects and repeaters, one rig effect each, palette from brand tokens,
// and the generated expressions run in Node against a small mock of AE's expression scope.
import { describe, expect, it } from 'vitest';
import { jsx } from '../../src/dsl/jsx-runtime.ts';
import { scene, Composition, brand } from '../../src/dsl/index.ts';
import { compileScene } from '../../src/compile/compile.ts';
import { GradientField, MeshGradient, FilmGrain, LightSweep, BokehField, DotGrid, LineGrid, bgPalette } from '../../src/dsl/backgrounds.ts';

const build = (kids: any[]) => compileScene(scene({ name: 'BG', duration: 6 } as any, () => jsx(Composition, { children: kids })));
const main = (r: any) => r.ir.comps.find((c: any) => c.id === r.ir.main);
const layer = (r: any, id: string) => { const L = main(r).layers.find((l: any) => l.id === id); if (!L) throw new Error(`no layer ${id}`); return L; };
const fx = (L: any) => (L.groups ?? []).find((g: any) => g.at === 'ADBE Effect Parade')?.items ?? [];
const exprOf = (L: any, path: string) => (L.props ?? []).filter((s: any) => s.p === path && s.expr).pop()?.expr as string;
const run = (code: string, scope: Record<string, any>) => new Function('scope', 'code', 'with (scope) { return eval(code); }')({ Math, ...scope }, code);
const rigScope = (vals: Record<string, any>, extra: Record<string, any> = {}) => ({ effect: () => (p: string) => ({ value: vals[p] }), width: 1920, height: 1080, thisComp: { width: 1920, height: 1080, layer: () => ({ effect: () => (p: string) => ({ value: vals[p] }) }) }, ...extra });

describe('palettes', () => {
  it('explicit, else brand colors, else the preset; cycled to the size needed', () => {
    const B = brand({ colors: { ink: '#0b0d12', accent: '#4683c4' }, live: ['accent'] });
    expect(bgPalette({ palette: ['#111111'] }, ['#ffffff'], 2)).toEqual(['#111111', '#111111']);
    const fromBrand = bgPalette({ brand: B }, ['#ffffff'], 3);
    expect(fromBrand[0]).toBe('#0b0d12');
    expect((fromBrand[1] as any).$control).toBe(true);
    expect(bgPalette({}, ['#abcdef'], 1)).toEqual(['#abcdef']);
  });
});

describe('backgrounds', () => {
  it('GradientField: Gradient Ramp whose axis turns at Speed; colors from the rig; tagged bg', () => {
    const B = brand({ colors: { ink: '#0b0d12', accent: '#4683c4' }, live: ['accent'] });
    const r = build([jsx(GradientField, { id: 'g', brand: B, speed: 2 })]);
    const L = layer(r, 'g');
    expect(L.type).toBe('solid');
    expect(L.tags).toContain('bg');
    const [ramp, rig] = fx(L);
    expect(ramp).toMatchObject({ mn: 'ADBE Ramp', name: 'Gradient' });
    expect(rig.mn).toMatch(/^Pseudo\/aec Gradient Fiel [0-9a-f]{6}$/); // matchNames fit 31 bytes (D84)
    expect(JSON.stringify(rig.props)).toContain('Accent Color'); // the live brand color drives Color 2
    const start = exprOf(L, 'ADBE Effect Parade/Gradient/ADBE Ramp-0001');
    const end = exprOf(L, 'ADBE Effect Parade/Gradient/ADBE Ramp-0003');
    const vals = { Angle: 0, Speed: 1, Spread: 100 };
    const r0 = Math.sqrt(1920 ** 2 + 1080 ** 2) / 2;
    expect(run(start, { ...rigScope(vals), time: 0 })).toEqual([960 - r0, 540]);
    expect(run(end, { ...rigScope(vals), time: 0 })[0]).toBeCloseTo(960 + r0, 6);
    const later = run(start, { ...rigScope(vals), time: 15 }); // 90° after 15 s at Speed 1
    expect(later[0]).toBeCloseTo(960, 6);
    expect(exprOf(L, 'ADBE Effect Parade/Gradient/ADBE Ramp-0004')).toContain('("Color 2")');
  });
  it('MeshGradient: 4-Color Gradient points drift inside the frame; Turbulent Displace evolves; optional Kaleida', () => {
    const r = build([jsx(MeshGradient, { id: 'm', seed: 4, kaleido: true })]);
    const L = layer(r, 'm');
    expect(fx(L).map((f: any) => f.mn)).toEqual(['ADBE 4ColorGradient', 'ADBE Turbulent Displace', 'CC Kaleida', expect.stringMatching(/^Pseudo\/aec Mesh Gradient /)]);
    const warp = fx(L)[1];
    expect(warp.props.find((p: any) => p.p === 'Pinning').v).toBe(3); // Pin All
    const p1 = exprOf(L, 'ADBE Effect Parade/Mesh/ADBE 4ColorGradient-0001');
    expect(p1).toMatch(/^function aecLib\(\)/m);
    for (const t of [0, 1.3, 4.7]) {
      const [x, y] = run(p1, { ...rigScope({ Speed: 1, Drift: 18, Seed: 4 }), time: t });
      expect(x).toBeGreaterThan(0); expect(x).toBeLessThan(1920 * 0.5);
      expect(y).toBeGreaterThan(0); expect(y).toBeLessThan(1080 * 0.5);
    }
    expect(run(exprOf(L, 'ADBE Effect Parade/Warp/ADBE Turbulent Displace-0006'), { ...rigScope({ Speed: 2 }), time: 3 })).toBe(144);
  });
  it('FilmGrain: Noise (default) or Add Grain in Final Output, on an adjustment layer', () => {
    const r = build([jsx(FilmGrain, { id: 'n', amount: 8 }), jsx(FilmGrain, { id: 'f', mode: 'film', palette: ['#ffe9c8'] })]);
    const n = layer(r, 'n'), f = layer(r, 'f');
    expect(n.type).toBe('adjustment');
    expect(fx(n)[0]).toMatchObject({ mn: 'ADBE Noise2', name: 'Grain' });
    expect(fx(f)[0].mn).toBe('VISINF Grain Implant');
    expect(fx(f)[0].props.find((p: any) => p.p === 'Viewing Mode').v).toBe(3);
    expect(exprOf(f, 'ADBE Effect Parade/Grain/VISINF Grain Implant-0010')).toContain('("Tint")');
  });
  it('LightSweep: the sweep crosses the frame once from Start, or repeats every Interval', () => {
    const r = build([jsx(LightSweep, { id: 'ls', at: 1, sweep: 2, every: 3 })]);
    const L = layer(r, 'ls');
    expect(fx(L)[0].mn).toBe('CC Light Sweep');
    const c = exprOf(L, 'ADBE Effect Parade/Sweep/CC Light Sweep-0001');
    const at = (time: number) => run(c, { ...rigScope({ Start: 1, Duration: 2, Interval: 3, Speed: 1 }), time, inPoint: 0 })[0];
    expect(at(0.5)).toBeCloseTo(-0.35 * 1920, 6);
    expect(Math.abs(at(2) - 960)).toBeLessThan(30); // mid-sweep near the centre
    expect(at(3.5)).toBeCloseTo(1.35 * 1920, 6);
    expect(at(7)).toBeCloseTo(at(2), 6); // next pass: 1 + 5 + 1
  });
  it('BokehField: two depth layers of editable circles (screen, blurred) sharing one Bokeh rig; or CC Particle World', () => {
    const r = build([jsx(BokehField, { id: 'bk', count: 12, seed: 3 })]);
    const far = layer(r, 'bk'), near = layer(r, 'bk.near');
    expect(far.blend).toBe('SCREEN');
    const ids = main(r).layers.map((l: any) => l.id);
    expect(ids.indexOf('bk.near')).toBeLessThan(ids.indexOf('bk')); // near on top
    const circles = (L: any) => L.groups.find((g: any) => g.at === 'ADBE Root Vectors Group').items.length;
    expect(circles(far) + circles(near)).toBe(12);
    expect(fx(far).map((f: any) => f.name)).toEqual(['Defocus', 'Bokeh']);
    expect(fx(near).map((f: any) => f.name)).toEqual(['Defocus']);
    expect(exprOf(near, 'ADBE Effect Parade/Defocus/ADBE Gaussian Blur 2-0001')).toContain('thisComp.layer("Bokeh").effect("Bokeh")');
    const p = build([jsx(BokehField, { id: 'bp', mode: 'particles', palette: ['#ff0000', '#00ff00'] })]);
    const pw = fx(layer(p, 'bp'))[0];
    expect(pw.mn).toBe('CC Particle World');
  });
  it('DotGrid: one dot, two Repeaters covering the frame; scrolling wraps seamlessly every Gap', () => {
    const r = build([jsx(DotGrid, { id: 'dg', gap: 40, dot: 5 })]);
    const L = layer(r, 'dg');
    const root = L.groups.find((g: any) => g.at === 'ADBE Root Vectors Group').items;
    expect(root.map((i: any) => i.mn)).toEqual(['ADBE Vector Group', 'ADBE Vector Filter - Repeater']);
    const row = root[0].kids[0].items;
    expect(row.map((i: any) => i.mn)).toEqual(['ADBE Vector Shape - Ellipse', 'ADBE Vector Graphic - Fill', 'ADBE Vector Filter - Repeater']);
    const vals = { Gap: 40, Speed: 12, Angle: 0 };
    const cols = run(row[2].props.find((p: any) => p.p === 'ADBE Vector Repeater Copies').expr, rigScope(vals));
    expect(cols * 40).toBeGreaterThan(1920 + 80);
    const pos = row[0].props.find((p: any) => p.p === 'ADBE Vector Ellipse Position').expr;
    const a = run(pos, { ...rigScope(vals), time: 1 }), b = run(pos, { ...rigScope(vals), time: 1 + 40 / 12 });
    expect(a[0]).toBeCloseTo(b[0], 6);
  });
  it('LineGrid: vertical and horizontal rules, or one axis', () => {
    const r = build([jsx(LineGrid, { id: 'lg' }), jsx(LineGrid, { id: 'lx', axis: 'x' })]);
    const names = (id: string) => layer(r, id).groups.find((g: any) => g.at === 'ADBE Root Vectors Group').items.map((i: any) => i.name);
    expect(names('lg')).toEqual(['Verticals', 'Horizontals']);
    expect(names('lx')).toEqual(['Verticals']);
    expect(fx(layer(r, 'lg'))[0].mn).toMatch(/^Pseudo\/aec Line Grid /);
  });
});
