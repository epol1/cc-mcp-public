// Spec for src/inspect/outline.ts: ease names inferred back from AE eases, and the compact agent outline.
import { describe, expect, it } from 'vitest';
import { nameSegment, outlineComp, outlineProject } from '../../src/inspect/outline.ts';
import { curveKnots, knotsToKeys } from '../../src/compile/keys.ts';
import type { PropKind } from '../../src/compile/keys.ts';
import { resolveEasing } from '../../src/shared/easing.ts';
import type { EasingSpec } from '../../src/shared/easing.ts';

/** Two AE keys for `easing` from → to over dt seconds (what the compiler writes and the inspector reads back). */
const seg = (easing: EasingSpec, from: number[], to: number[], kind: PropKind, dt = 0.8, start = 1) =>
  knotsToKeys(curveKnots(resolveEasing(easing), dt, 30, 0.001), from, to, start, kind);
const name = (ks: any[]) => nameSegment(ks[0], ks[1]);

describe('nameSegment', () => {
  for (const preset of ['easeOutCubic', 'easeInOutQuart', 'snappy']) {
    it(`recognises ${preset} on 1-D, multi-dimensional, spatial and color properties`, () => {
      expect(name(seg(preset, [0], [500], 'oneD'))).toBe(preset);
      expect(name(seg(preset, [500], [-20], 'oneD', 0.3))).toBe(preset); // decreasing values
      expect(name(seg(preset, [0, 0, 100], [100, -40, 100], 'multi'))).toBe(preset); // uses the dimension that moves most
      expect(name(seg(preset, [100, 100], [400, 500], 'spatial', 2))).toBe(preset);
      expect(name(seg(preset, [1, 0, 0, 1], [0, 0.5, 1, 1], 'color'))).toBe(preset);
    });
  }
  it('other presets round-trip by name too', () => {
    for (const preset of ['easeInCubic', 'easeOutExpo', 'easeOutBack', 'easyEase', 'smooth', 'anticipate']) expect(name(seg(preset, [0], [1], 'oneD')), preset).toBe(preset);
  });
  it('AE-rounded eases still match (influence/speed with a few digits)', () => {
    const ks = seg('easeOutCubic', [0], [500], 'oneD');
    const round = (e: any) => ({ speed: Math.round(e.speed * 100) / 100, influence: Math.round(e.influence * 1000) / 1000 });
    expect(nameSegment({ ...ks[0], oe: ks[0].oe!.map(round) }, { ...ks[1], ie: ks[1].ie!.map(round) })).toBe('easeOutCubic');
  });
  it('near a preset → "name≈"; far from every preset → cubic-bezier(...)', () => {
    expect(name(seg([0.4, 1, 0.6, 1], [0], [100], 'oneD'))).toBe('easeOutCubic≈');
    expect(name(seg([0.9, 0.1, 0.1, 0.9], [0], [100], 'oneD'))).toBe('cubic-bezier(0.9, 0.1, 0.1, 0.9)');
  });
  it('linear: from interpolation flags, or from a linear bezier (minimum influences)', () => {
    expect(nameSegment({ t: 0, v: 0, o: 'linear' }, { t: 1, v: 5, i: 'linear' })).toBe('linear');
    expect(name(seg('linear', [0], [100], 'oneD'))).toBe('linear');
  });
  it('hold, hold-in-place, bulge, and non-numeric values', () => {
    expect(nameSegment({ t: 0, v: 3, o: 'hold' }, { t: 1, v: 9 })).toBe('hold');
    expect(nameSegment({ t: 0, v: 5, oe: [{ speed: 0, influence: 33 }] }, { t: 1, v: 5, ie: [{ speed: 0, influence: 33 }] })).toBe('hold-in-place');
    expect(nameSegment({ t: 0, v: 5, oe: [{ speed: 40, influence: 33 }] }, { t: 1, v: 5, ie: [{ speed: -40, influence: 33 }] })).toBe('bulge');
    expect(nameSegment({ t: 0, v: { v: [[0, 0]], c: false } }, { t: 1, v: { v: [[1, 1]], c: false } })).toBe('bezier');
    expect(nameSegment({ t: 0, v: 0 }, { t: 1, v: 1 })).toBe('bezier'); // no eases read
  });
});

describe('outlineComp', () => {
  const opacity = seg('easeOutCubic', [0], [100], 'oneD', 0.8, 0.5);
  // a spring-like overshooting curve (keys as AE reports them)
  const springy = [
    { t: 0, v: 620, ie: [{ speed: 0, influence: 16.7 }], oe: [{ speed: 0, influence: 30 }] },
    { t: 0.3, v: 528, ie: [{ speed: 0, influence: 40 }], oe: [{ speed: 0, influence: 40 }] },
    { t: 0.6, v: 543, ie: [{ speed: 0, influence: 40 }], oe: [{ speed: 0, influence: 40 }] },
    { t: 0.93, v: 540, ie: [{ speed: 0, influence: 40 }], oe: [{ speed: 0, influence: 16.7 }] },
  ];
  const inspect = {
    ok: true,
    comp: { name: 'Promo_v001', itemId: 42, id: 'promo', w: 1920, h: 1080, fps: 29.97, dur: 6, numLayers: 3, renderer: 'ADBE Calder', motionBlur: true, mgt: 'Promo' },
    layers: [
      {
        index: 1, name: 'Controls', type: 'null', id: 'promo.controls', in: 0, out: 6, enabled: false,
        props: [{ m: 'ADBE Effect Parade', n: 'Effects', c: [{ m: 'ADBE Slider Control', n: 'Fade', c: [{ m: 'ADBE Slider Control-0001', n: 'Slider', v: 50 }] }] }],
      },
      {
        index: 2, name: 'Title', type: 'text', id: 'promo.text0', in: 0.5, out: 6, threeD: true, motionBlur: true, parent: { name: 'Controls' }, source: { name: 'ignored for text' },
        props: [
          { m: 'ADBE Text Properties', n: 'Text', c: [{ m: 'ADBE Text Document', n: 'Source Text', v: { text: 'Hello world' } }] },
          {
            m: 'ADBE Transform Group', n: 'Transform', c: [
              { m: 'ADBE Position', n: 'Position', v: [960, 540.25] },
              { m: 'ADBE Position_0', n: 'X Position', v: 960 },
              { m: 'ADBE Position_1', n: 'Y Position', v: 540, keys: springy },
              { m: 'ADBE Opacity', n: 'Opacity', v: 100, keys: opacity },
              { m: 'ADBE Rotate Z', n: 'Rotation', v: 0, expr: 'function f() { return 1; }\n\nwiggle(2, 30);', exprErr: 'Error: bad' },
              { m: 'ADBE Scale', n: 'Scale', v: [100, 100, 100], expr: 'value', exprOff: true },
            ],
          },
        ],
      },
      {
        index: 3, name: 'Clip', type: 'footage', in: 0, out: 6, blend: 'SCREEN', locked: true, matte: { layer: 'Title' }, source: { name: 'hero.mov', w: 3840, h: 2160 },
        props: [
          { m: 'ADBE Effect Parade', n: 'Effects', c: [
            { m: 'ADBE Ramp', n: 'Gradient Ramp', c: [{ m: 'ADBE Ramp-0002', n: 'Start Color', v: [1, 0.5, 0, 1] }] },
            { m: 'ADBE Vector Graphic - G-Fill', n: 'G', skipped: 'gradient (read via .aepx)' },
          ] },
          { m: 'ADBE Mask Parade', n: 'Masks', indexed: true, c: [{ m: 'ADBE Mask Atom', n: 'Mask 1', c: [{ m: 'ADBE Mask Shape', n: 'Mask Path', v: { v: [[0, 0], [1, 0], [1, 1]], i: [], o: [], c: true } }] }] },
        ],
      },
    ],
  };

  it('formats a comp header, one line per layer, and indented property lines', () => {
    const lines = outlineComp(inspect).split('\n');
    expect(lines[0]).toBe('Comp "Promo_v001" (item 42, aec:promo) 1920×1080 29.97fps 6s, 3 layers, renderer Advanced 3D, motion blur, EG "Promo"');
    expect(lines).toContain('1. [null] "Controls" aec:promo.controls 0–6s (hidden)');
    expect(lines).toContain('    Effects › Fade › Slider: 50');
    expect(lines).toContain('2. [text] "Title" aec:promo.text0 0.5–6s (3D, mb, parent "Controls")');
    expect(lines).toContain('    Text › Source Text: "Hello world"');
    expect(lines).toContain('    Transform › Position: [960, 540.3]');
    expect(lines).toContain('    Transform › Opacity: 0 → 100, 0.5–1.3s easeOutCubic');
    expect(lines).toContain('    Transform › Rotation: 0 ⟵ expr: wiggle(2, 30);  ⚠ Error: bad');
    expect(lines).toContain('    Transform › Scale: [100, 100, 100] ⟵ expr (disabled): value');
    expect(lines).toContain('3. [footage] "Clip" 0–6s (locked, blend SCREEN, matte←"Title") src "hero.mov" 3840×2160');
    expect(lines).toContain('    Effects › Gradient Ramp › Start Color: #ff8000');
    expect(lines).toContain('    Effects › G: (gradient (read via .aepx))');
    expect(lines).toContain('    Masks › Mask 1 › Mask Path: path(3 pts, closed)');
  });
  it('summarises multi-key animations and flags overshoot; hides static separated dimensions', () => {
    const out = outlineComp(inspect);
    expect(out).toMatch(/^ {4}Transform › Y Position: 4 keys 620 → 540, 0–0\.93s \[[^\]]+\], overshoots \(spring\/bounce\)$/m);
    expect(out).not.toContain('X Position');
    const order = outlineComp(inspect).split('\n').map((l) => l.trim().split(':')[0]);
    expect(order.indexOf('Transform › Y Position')).toBeLessThan(order.indexOf('Transform › Opacity'));
  });
  it('renderer names, missing optional fields, and errors', () => {
    const base = { ok: true, comp: { name: 'C', itemId: 1, w: 100, h: 100, fps: 24, dur: 1.5, numLayers: 0, renderer: 'ADBE Advanced 3d' }, layers: [] };
    expect(outlineComp(base)).toBe('Comp "C" (item 1) 100×100 24fps 1.5s, 0 layers, renderer Classic 3D');
    expect(outlineComp({ ...base, comp: { ...base.comp, renderer: 'ADBE Ernst' } })).toContain('renderer Cinema 4D');
    expect(outlineComp({ ok: false, error: 'comp not found: X' })).toBe('error: comp not found: X');
  });
});

describe('outlineProject', () => {
  it('lists comps and footage (not folders) with their folder', () => {
    const out = outlineProject({
      ok: true, file: 'E:/work/promo.aep', numItems: 3, bpc: 16, active: 'Promo_v001',
      items: [
        { type: 'Folder', id: 1, name: 'ae-compose' },
        { type: 'Composition', id: 5, name: 'Promo_v001', w: 1920, h: 1080, fps: 30, dur: 6, layers: 3, aec: 'promo', folder: 'Promo' },
        { type: 'Footage', id: 7, name: 'hero.mov', w: 3840, h: 2160, dur: 12.5, missing: true },
      ],
    });
    expect(out.split('\n')).toEqual([
      'Project E:/work/promo.aep — 3 items, 16 bpc, active: Promo_v001',
      '  comp "Promo_v001" #5 1920×1080 30fps 6s 3 layers aec:promo [Promo]',
      '  footage "hero.mov" #7 3840×2160 12.5s MISSING',
    ]);
    expect(outlineProject({ ok: true, file: null, numItems: 0, bpc: 8, active: null, items: [] })).toBe('Project (unsaved) — 0 items, 8 bpc, active: none');
  });
});
