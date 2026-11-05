// Text features → IR: Range Selector animators, text on a path, automatic per-character 3D.
import { describe, expect, it } from 'vitest';
import { jsx } from '../../src/dsl/jsx-runtime.ts';
import { scene, Composition, Text, control, perWord, perChar, textPresets, tween } from '../../src/dsl/index.ts';
import { compileScene } from '../../src/compile/compile.ts';
import { unitCount } from '../../src/compile/text.ts';

const h = (type: any, props: Record<string, any> | null = {}, ...children: any[]) =>
  jsx(type, children.length ? { ...(props ?? {}), children: children.length === 1 ? children[0] : children } : { ...(props ?? {}) });
const build = (body: () => any) => compileScene(scene({ name: 'T', duration: 4 } as any, body));
const layer = (r: { ir: any }, id: string) => r.ir.comps[0].layers.find((L: any) => L.id === id);
const selectorOf = (L: any, k = 0) => L.groups.find((g: any) => g.at === 'ADBE Text Properties/ADBE Text Animators').items[k].kids.find((x: any) => x.at === 'ADBE Text Selectors').items[0];
const sp = (sel: any, p: string) => sel.props.find((x: any) => x.p === p);

describe('range selector animators', () => {
  it('reveal: Ramp Up window swept by keyed Offset from −W to 100 %', () => {
    // 4 words, each 0.3 s, dur 0.5 s → W = 100·0.5 / (3·0.3) = 55.6 %, sweep (n−1)·each + dur = 1.4 s.
    const r = build(() => h(Composition, {}, h(Text, { id: 't', animate: { text: perWord({ from: { opacity: 0 }, each: 0.3, duration: 0.5, delay: 0.2, selector: 'range' }) } }, 'one two three four')));
    const sel = selectorOf(layer(r, 't'));
    expect(sel.mn).toBe('ADBE Text Selector');
    expect(sp(sel, 'ADBE Text Range Advanced/ADBE Text Range Shape').v).toBe(2);
    expect(sp(sel, 'ADBE Text Range Advanced/ADBE Text Range Type2').v).toBe(3);
    const W = sp(sel, 'ADBE Text Percent End').v;
    expect(W).toBeCloseTo(55.56, 1);
    const k = sp(sel, 'ADBE Text Percent Offset').keys;
    expect(k[0].t).toBeCloseTo(0.2, 6);
    expect(k[0].v).toBeCloseTo(-W, 4);
    expect(k[k.length - 1].t).toBeCloseTo(1.6, 6);
    expect(k[k.length - 1].v).toBe(100);
  });
  it('exit from the start is Ramp Down; order "end" mirrors the sweep; anchor end counts back from the out point', () => {
    const r = build(() => h(Composition, {},
      h(Text, { id: 'a', animate: { text: perChar({ from: { opacity: 0 }, each: 0.05, duration: 0.2, delay: 0.5, anchor: 'end', direction: 'out', selector: 'range' }) } }, 'ABCDE'),
      h(Text, { id: 'b', animate: { text: perChar({ from: { opacity: 0 }, each: 0.05, duration: 0.2, order: 'end', selector: 'range' }) } }, 'ABCDE')));
    const a = selectorOf(layer(r, 'a')), b = selectorOf(layer(r, 'b'));
    expect(sp(a, 'ADBE Text Range Advanced/ADBE Text Range Shape').v).toBe(3);
    expect(sp(a, 'ADBE Text Percent Offset').keys[0].t).toBeCloseTo(4 - 0.5, 6);
    expect(sp(b, 'ADBE Text Range Advanced/ADBE Text Range Shape').v).toBe(3);
    expect(sp(b, 'ADBE Text Percent Offset').keys[0].v).toBe(100);
  });
  it('no stagger: keyed Amount on a Square selector', () => {
    const r = build(() => h(Composition, {}, h(Text, { id: 't', animate: { text: perChar({ from: { opacity: 0 }, each: 0, duration: 0.6, selector: 'range' }) } }, 'HELLO')));
    const sel = selectorOf(layer(r, 't'));
    const amt = sp(sel, 'ADBE Text Range Advanced/ADBE Text Selector Max Amount').keys;
    expect(amt[0].v).toBe(100);
    expect(amt[amt.length - 1].v).toBe(0);
    expect(amt[amt.length - 1].t).toBeCloseTo(0.6, 6);
  });
  it('a stagger too loose for a 100 % window is stretched, with a warning', () => {
    const r = build(() => h(Composition, {}, h(Text, { id: 't', animate: { text: perWord({ from: { opacity: 0 }, each: 0.1, duration: 0.5, selector: 'range' }) } }, 'a b c')));
    expect(sp(selectorOf(layer(r, 't')), 'ADBE Text Percent End').v).toBe(100);
    expect(r.warnings.join('\n')).toMatch(/stagger is stretched/);
  });
  it('rejects live controls, springs and center/edges orders', () => {
    const c = control('Stagger', 0.1);
    expect(() => build(() => h(Composition, {}, h(Text, { animate: { text: perWord({ from: { opacity: 0 }, each: c, selector: 'range' }) } }, 'a b')))).toThrow(/fixed each/);
    expect(() => build(() => h(Composition, {}, h(Text, { animate: { text: perWord({ from: { opacity: 0 }, spring: { damping: 10 }, selector: 'range' }) } }, 'a b')))).toThrow(/not a spring/);
    expect(() => build(() => h(Composition, {}, h(Text, { animate: { text: perWord({ from: { opacity: 0 }, order: 'center', selector: 'range' }) } }, 'a b')))).toThrow(/order/);
  });
  it('counts units the way AE does', () => {
    expect(unitCount('ab c', 'char')).toBe(4);
    expect(unitCount('ab c', 'charNoSpaces')).toBe(3);
    expect(unitCount(' one  two ', 'word')).toBe(2);
    expect(unitCount('a\rb\rc', 'line')).toBe(3);
  });
});

describe('text on a path', () => {
  it('adds a None mask as the path, points Path Options at it, animates the margin, rests at 0,0', () => {
    const r = build(() => h(Composition, {}, h(Text, { id: 't', path: 'M0 0 C 100 -100 200 -100 300 0', pathOptions: { firstMargin: tween({ from: -200, to: 0, duration: 1 }), reverse: true } }, 'ARC')));
    const L = layer(r, 't');
    const masks = L.groups.find((g: any) => g.at === 'ADBE Mask Parade');
    expect(masks.items[0].attrs.maskMode).toBe('NONE');
    const PO = 'ADBE Text Properties/ADBE Text Path Options/';
    expect(L.props.find((x: any) => x.p === PO + 'ADBE Text Path').v).toBe(1);
    expect(L.props.find((x: any) => x.p === PO + 'ADBE Text Reverse Path').v).toBe(1);
    expect(L.props.find((x: any) => x.p === PO + 'ADBE Text First Margin').keys.length).toBeGreaterThanOrEqual(2);
    expect(L.props.filter((x: any) => x.p === 'ADBE Transform Group/ADBE Position').map((x: any) => x.v)).toEqual([[0, 0]]);
    expect(L.anchorBox).toBeUndefined();
  });
});

describe('per-character 3D', () => {
  it('turns on by itself for rotationX/rotationY/z unit animators', () => {
    const r = build(() => h(Composition, {},
      h(Text, { id: 'flip', animate: { text: textPresets.flipIn() } }, 'FLIP'),
      h(Text, { id: 'flat', animate: { text: perChar({ from: { opacity: 0 } }) } }, 'FLAT')));
    expect(layer(r, 'flip').threeDPerChar).toBe(true);
    expect(layer(r, 'flip').threeD).toBe(true);
    expect(layer(r, 'flat').threeDPerChar).toBeUndefined();
  });
});
