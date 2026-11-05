// Gradient stops from a saved .aep (tests/fixtures/gradient-test.aep, saved by AE 26.5 from known gradients:
// scratch/gradient-test-scene.tsx plus a hand-made layer whose stops were set and whose name tag was removed).
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { attachGradients, readAepGradients, stopsFromName } from '../../src/inspect/aep.ts';

const FIX = path.resolve('tests/fixtures/gradient-test.aep');
const hex = (c: number[]) => '#' + c.map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
const byLayer = (name: string) => readAepGradients(FIX).filter((g) => g.layer === name);

describe('readAepGradients', () => {
  it('finds every shape gradient with its comp, layer and path', () => {
    const all = readAepGradients(FIX);
    expect(all).toHaveLength(6);
    expect(all.map((g) => `${g.comp}/${g.layerIndex}/${g.layer}`).sort()).toEqual(['GradTest_v001/1/G5 Default', 'GradTest_v001/3/G3', 'GradTest_v001/4/G2', 'GradTest_v001/4/G2', 'GradTest_v001/5/G1', 'Pre/1/G4']);
  });
  it('reads color stops, midpoints and opacity stops', () => {
    const [g1] = byLayer('G1');
    expect(g1.colors.map((s) => `${hex(s.color)}@${s.offset}`)).toEqual(['#ff0000@0', '#00ff00@0.5', '#0000ff@1']);
    expect(g1.alphas.map((a) => a.opacity)).toEqual([1, 0.5, 1]);
    expect(g1.colors.every((s) => s.midpoint === 0.5)).toBe(true);
    expect(g1.path).toBe('ADBE Root Vectors Group[1]/ADBE Vector Graphic - G-Fill[1]');
  });
  it('tells fills from strokes, and follows nested groups', () => {
    const g2 = byLayer('G2');
    expect(g2.map((g) => g.kind).sort()).toEqual(['fill', 'stroke']);
    const [g3] = byLayer('G3');
    expect(g3.path).toBe('ADBE Root Vectors Group[1]/ADBE Vector Group[1]/ADBE Vectors Group[1]/ADBE Vector Group[1]/ADBE Vectors Group[1]/ADBE Vector Graphic - G-Fill[1]');
    expect(g3.names).toEqual(['ADBE Root Vectors Group', 'Outer', 'ADBE Vectors Group', 'Inner', 'ADBE Vectors Group', 'Four [#112233@0 #445566@0.25 #778899@0.75 #aabbcc@1]']);
  });
  it('reports AE default gradients, which the file stores without a Colors property', () => {
    const radial = byLayer('G2').find((g) => g.kind === 'fill')!;
    expect(radial.default).toBe(true);
    expect(radial.colors.map((s) => hex(s.color))).toEqual(['#ffffff', '#000000']);
  });
  it('reads a gradient whose name carries no stop tag (as a hand-built one)', () => {
    const [g5] = byLayer('G5 Default');
    expect(g5.names[g5.names.length - 1]).toBe('Hand Gradient');
    expect(g5.colors.map((s) => `${hex(s.color)}@${+s.offset.toFixed(3)}`)).toEqual(['#123456@0', '#abcdef@0.4', '#fedcba@1']);
    expect(g5.alphas.map((a) => +a.opacity.toFixed(3))).toEqual([1, 0.25, 1]);
  });
  it('rejects files that are not binary .aep', () => {
    expect(() => readAepGradients(path.resolve('package.json'))).toThrow(/not a binary .aep/);
  });
});

describe('attachGradients', () => {
  const inspectJson = (dirty: boolean) => ({
    ok: true, projectFile: FIX, dirty, comp: { name: 'GradTest_v001' },
    layers: [
      { index: 5, name: 'G1', props: [{ m: 'ADBE Root Vectors Group', c: [{ m: 'ADBE Vector Graphic - G-Fill', n: 'Linear3 [x]', gradient: true, gp: 'ADBE Root Vectors Group[1]/ADBE Vector Graphic - G-Fill[1]' }] }] },
      { index: 9, name: 'Elsewhere', props: [{ m: 'ADBE Vector Graphic - G-Fill', n: 'Gradient Fill [#ff0000@0 #0000ff@1]', gradient: true, gp: 'nope' }] },
      { index: 10, name: 'Unknown', props: [{ m: 'ADBE Vector Graphic - G-Fill', n: 'Gradient Fill 1', gradient: true, gp: 'nope' }] },
    ],
  });
  it('fills stops from the saved file, falls back to the name tag, and notes the rest', () => {
    const j: any = inspectJson(false);
    attachGradients(j);
    const g1 = j.layers[0].props[0].c[0];
    expect(g1.stopsFrom).toBe('saved file');
    expect(g1.stops.map((s: any) => s.color)).toEqual(['#ff0000', '#00ff00', '#0000ff']);
    expect(g1.alphaStops.map((a: any) => a.opacity)).toEqual([1, 0.5, 1]);
    expect(j.layers[1].props[0]).toMatchObject({ stopsFrom: 'name tag', stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }] });
    expect(j.layers[2].props[0].stops).toBeUndefined();
    expect(j.gradientNote).toMatch(/1 gradient\(s\) without readable stops/);
  });
  it('warns that unsaved changes are not in the file', () => {
    const j: any = { ...inspectJson(true), layers: [inspectJson(true).layers[0]] };
    attachGradients(j);
    expect(j.gradientNote).toMatch(/changes since the last save are not included/);
  });
  it('parses the ae-compose stop tag', () => {
    expect(stopsFromName('Gradient Fill [#ff8800@0 #0088ff@0.3]')).toEqual([{ offset: 0, color: '#ff8800' }, { offset: 0.3, color: '#0088ff' }]);
    expect(stopsFromName('Gradient Fill 1')).toBeNull();
  });
});
