import { describe, expect, it } from 'vitest';
import { compileScene, REFRAMES } from '../../src/compile/compile.ts';
import { scene } from '../../src/dsl/scene.ts';
import { jsx } from '../../src/dsl/jsx-runtime.ts';
import { Composition, Solid, Shape, Rect, Fill, Text } from '../../src/dsl/primitives.ts';
import { Stack } from '../../src/dsl/layout.ts';

const TG = 'ADBE Transform Group';
const def = scene({ name: 'R', duration: '2s' }, () => jsx(Composition, { children: [
  jsx(Solid, { id: 'bg', color: '#000' }),
  jsx(Shape, { id: 'glow', children: [jsx(Rect, { size: [1920, 1080] }), jsx(Fill, { color: '#123' })] }),
  jsx(Text, { id: 'corner', size: 40, position: [1760, 100], children: 'Hi' }),
  jsx(Text, { id: 'mid', size: 150, children: 'CENTER' }),
  jsx(Stack, { children: [jsx(Text, { id: 'st', size: 100, children: 'in a stack' })] }),
] }));
const main = (r: any) => r.ir.comps.find((c: any) => c.id === r.ir.main);
const L = (r: any, id: string) => main(r).layers.find((l: any) => l.id === id);
const pos = (l: any) => l.props.find((p: any) => p.p === `${TG}/ADBE Position`).v;

describe('responsive reframe (A4)', () => {
  it('names the comp after the target and uses its size', () => {
    const r = compileScene(def, { reframe: REFRAMES['9:16'] });
    expect(main(r).name).toBe('R_v001_9x16');
    expect(r.ir.main).toBe('r-9x16');
    expect([main(r).w, main(r).h]).toEqual([1080, 1920]);
  });
  it('scales type and asks AE to shrink lines wider than the safe width', () => {
    const r = compileScene(def, { reframe: REFRAMES['9:16'] });
    expect(L(r, 'mid').text.size).toBe(120);
    expect(L(r, 'mid').text.fitWidth).toBe(Math.round(900 * 0.95));
    expect(compileScene(def, { reframe: REFRAMES['1:1'] }).ir.comps[0].layers.find((l: any) => l.id === 'mid').text.fitWidth).toBe(972);
  });
  it('maps given positions into the usable zone and centres the rest there; frame fillers stay on the frame centre', () => {
    const r = compileScene(def, { reframe: REFRAMES['9:16'] });
    const zone = { x0: 60, y0: 250, x1: 960, y1: 1520 };
    const cx = (zone.x0 + zone.x1) / 2, cy = (zone.y0 + zone.y1) / 2;
    expect(pos(L(r, 'mid'))).toEqual([cx, cy]);
    const c = pos(L(r, 'corner'));
    expect(c[0]).toBeCloseTo(cx + (1760 - 960) * (900 / 1920));
    expect(c[1]).toBeCloseTo(cy + (100 - 540) * (1270 / 1080));
    expect(pos(L(r, 'bg'))).toEqual([540, 960]);
    expect(pos(L(r, 'glow'))).toEqual([540, 960]);
    expect(JSON.stringify(L(r, 'glow').groups)).toContain('[1080,1920]');
  });
  it('lays top-level containers out in the platform zone', () => {
    const r = compileScene(def, { reframe: REFRAMES['9:16'] });
    expect(main(r).layouts[0].area).toEqual({ x: 60, y: 250, w: 900, h: 1270 });
    const sq = compileScene(def, { reframe: REFRAMES['1:1'] });
    expect(main(sq).layouts[0].area).toEqual({ x: 0, y: 0, w: 1080, h: 1080 });
  });
  it('leaves the scene untouched without a reframe', () => {
    const r = compileScene(def);
    expect(L(r, 'mid').text.fitWidth).toBeUndefined();
    expect(pos(L(r, 'corner'))).toEqual([1760, 100]);
  });
});
