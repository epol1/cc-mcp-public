import { describe, expect, it } from 'vitest';
import { compileScene } from '../../src/compile/compile.ts';
import { scene } from '../../src/dsl/scene.ts';
import { jsx } from '../../src/dsl/jsx-runtime.ts';
import { Composition, Shape, Rect, Ellipse, Fill, Text } from '../../src/dsl/primitives.ts';
import { Cloner, line, grid, circle, onPath, scatter, sphere, noise, falloff, stagger, follow, step, colorize, csv } from '../../src/dsl/cloner.ts';
import { field } from '../../src/dsl/field.ts';
import { libObject } from '../../src/aeclib/index.ts';

const card = () => [jsx(Shape, { children: [jsx(Rect, { size: [100, 60] }), jsx(Fill, { color: field('Card Color', '#4683c4') })] }), jsx(Text, { eg: 'Label', children: 'x' })];
function build(cloner: any) {
  const def = scene({ name: 'T', duration: '3s' }, () => jsx(Composition, { children: [cloner] }));
  return compileScene(def);
}
const main = (r: any) => r.ir.comps.find((c: any) => c.id === r.ir.main);
const layer = (r: any, id: string) => main(r).layers.find((l: any) => l.id === id);
const expr = (L: any, p: string) => L.props.find((s: any) => s.p.endsWith(p))?.expr as string;

describe('cloner (P1/P2)', () => {
  it('builds a master precomp with fields, a controller with the Cloner rig, and instance 1 to duplicate', () => {
    const r = build(Cloner({ id: 'cards', name: 'Cards', count: 30, size: [120, 80], distribute: line({ spacing: 90 }), of: card() }));
    const master = r.ir.comps.find((c: any) => c.name === 'Cards Master');
    expect(master.part).toBe(true);
    expect(master.mgt.props.map((p: any) => p.name)).toContain('Label');
    expect(JSON.stringify(master.layers)).toContain('"eg":"Card Color"');
    const m = main(r);
    expect(m.layers.map((l: any) => l.id)).toEqual(['cards.ctl', 'cards.inst']); // controller directly above the instances
    const ctl = layer(r, 'cards.ctl');
    const fx = ctl.groups[0].items[0];
    expect(fx.name).toBe('Cloner');
    expect(fx.mn).toMatch(/^Pseudo\/aec Cloner /);
    const inst = layer(r, 'cards.inst');
    expect(inst.instances).toMatchObject({ count: 30, prefix: 'Cards' });
    expect(inst.parent).toBe('cards.ctl');
    const pos = expr(inst, 'ADBE Position');
    expect(pos).toContain('i = n - (index - C.index)');
    expect(pos).toContain('L.line(i, n, e("Spacing").value');
    expect(pos).toContain('thisComp.layer("Cards")'); // __AEC_LAYER resolved
    expect(pos).toMatch(/^function aecLib\(\)/m); // library inlined
  });
  it('maps every distribution to its library call', () => {
    const calls: [any, string][] = [[grid({ columns: 4 }), 'L.grid('], [circle({ radius: 200 }), 'L.circle('], [scatter({}), 'L.scatter('], [sphere({}), 'L.sphere('], [onPath({ d: 'M0 0 L100 0' }), 'L.onPath(']];
    for (const [d, call] of calls) {
      const r = build(Cloner({ id: 'c', count: 5, size: [50, 50], distribute: d, of: card() }));
      expect(expr(layer(r, 'c.inst'), 'ADBE Position')).toContain(call);
    }
    const sp = build(Cloner({ id: 'c', count: 5, size: [50, 50], distribute: sphere({}), of: card() }));
    expect(layer(sp, 'c.inst').threeD).toBe(true);
    const pa = build(Cloner({ id: 'c', count: 5, size: [50, 50], distribute: onPath({ d: 'M0 0 L100 0' }), of: card() }));
    expect(main(pa).layers.some((l: any) => l.id === 'c.path')).toBe(true);
  });
  it('effectors add their groups to the rig and their lines to the expressions', () => {
    const r = build(Cloner({ id: 'c', count: 8, size: [50, 50], motion: { speed: 100, wrap: 2000 }, effectors: [noise({ position: 10 }), falloff({ scale: [80, 120] }), stagger({ each: 0.1 }), step({ position: 20 }), colorize({ field: 'Card Color', palette: ['#ff0000', '#00ff00'] })], of: card() }));
    const inst = layer(r, 'c.inst');
    expect(expr(inst, 'ADBE Position')).toContain('L.wrap(u, -fw / 2, fw / 2)');
    expect(expr(inst, 'ADBE Position')).toContain('L.noise1(');
    expect(expr(inst, 'ADBE Position')).toContain('L.step(');
    expect(expr(inst, 'ADBE Scale')).toContain('L.radial(');
    expect(expr(inst, 'ADBE Time Remapping')).toContain('L.stagger(');
    expect(inst.instances.timeRemap).toBe(true);
    expect(expr(inst, 'ADBE Layer Overrides/Card Color')).toContain('L.palette(P, i)');
    expect(main(r).layers.some((l: any) => l.id === 'c.field')).toBe(true);
    const f = build(Cloner({ id: 'c', count: 4, size: [50, 50], effectors: [follow({ lag: 0.1 })], of: card() }));
    expect(expr(layer(f, 'c.inst'), 'ADBE Position')).toContain('C.toComp(a, time - i * e("Lag").value)');
  });
  it('data: fields become one expression each; transform channels become arrays', () => {
    const rows = [{ Label: 'one', x: 5 }, { Label: 'two', rotation: 10 }, { Label: '#003' }];
    const r = build(Cloner({ id: 'c', size: [50, 50], data: rows, of: card() }));
    const inst = layer(r, 'c.inst');
    expect(inst.instances.count).toBe(3);
    expect(expr(inst, 'ADBE Layer Overrides/Label')).toContain('var D = ["one", "two", "#003"];');
    expect(expr(inst, 'ADBE Position')).toContain('var Dx = [5, 0, 0];');
    expect(expr(inst, 'ADBE Rotate Z')).toContain('var Drotation = [0, 10, 0];');
    const o = build(Cloner({ id: 'c', size: [50, 50], data: rows, dataMode: 'overrides', of: card() }));
    expect(layer(o, 'c.inst').instances.overrides[2]).toEqual({ Label: '#003' });
  });
  it('csv() parses quoted cells and numbers', () => {
    expect(csv('a,b,c\n1,"x, y",2.5\n')).toEqual([{ a: 1, b: 'x, y', c: 2.5 }]);
  });
  it('rejects bad input with messages that say what to change', () => {
    expect(() => Cloner({ id: 'c', count: 3, of: card() } as any)).toThrow(/size=\{\[w, h\]\}/);
    expect(() => Cloner({ id: 'c', count: 3, size: [50, 50], distribute: circle({}), effectors: [falloff({})], of: card() })).toThrow(/linear/);
    expect(() => Cloner({ id: 'c', count: 3, size: [50, 50], data: [{ 'Card Color': '#fff' }], effectors: [colorize({ field: 'Card Color', palette: ['#000'] })], of: card() })).toThrow(/both data and colorize/);
  });
  it('warns about expensive configurations', () => {
    const r = build(jsx(Cloner, { id: 'c', size: [50, 50], data: Array.from({ length: 60 }, (_, i) => ({ Label: `L${i}` })), of: card() }));
    expect(r.warnings.join('\n')).toMatch(/renders the master separately/);
  });
  it('repeater mode: one shape layer with native repeaters, no precomp', () => {
    const r = build(Cloner({ id: 'g', mode: 'repeater', count: 200, distribute: grid({ columns: 20, gap: 30 }), of: [jsx(Shape, { children: [jsx(Ellipse, { size: [10, 10] }), jsx(Fill, { color: '#fff' })] })] } as any));
    expect(r.ir.comps.length).toBe(1);
    const L = layer(r, 'g');
    expect(L.type).toBe('shape');
    expect(JSON.stringify(L.groups).match(/Filter - Repeater/g)?.length).toBe(2);
    expect(() => build(Cloner({ id: 'g', mode: 'repeater', count: 5, effectors: [noise({})], of: [jsx(Shape, { children: [] })] } as any))).toThrow(/effectors need mode "layers"/);
  });
  it('library maths used by the expressions agrees with the test expectations', () => {
    const L = libObject();
    expect(L.line(0, 3, 100)[0]).toBeCloseTo(-100);
  });
});
