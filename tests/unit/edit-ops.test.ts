// Spec for src/edit/ops.ts (compileEditOps): agent ops → runtime ops. Only ops that compile without
// After Effects are exercised (a non-bezier 'ease' reads keys from AE and is never called here).
import { describe, expect, it } from 'vitest';
import { compileEditOps, PROP_ALIASES } from '../../src/edit/ops.ts';
import { resolveEasing } from '../../src/shared/easing.ts';
import { parseColor } from '../../src/shared/units.ts';
import { parseSvgPath } from '../../src/shared/svgpath.ts';

const run = (...ops: any[]) => compileEditOps({ comp: 'Promo_v001', ops });
const TG = 'ADBE Transform Group';

describe('ease', () => {
  it('a preset name becomes setEasing with its exact bezier', async () => {
    expect(await run({ op: 'ease', layer: 'promo.text0', prop: 'opacity', easing: 'easeOutCubic' })).toEqual([
      { op: 'setEasing', layer: 'promo.text0', path: `${TG}/ADBE Opacity`, bezier: [...resolveEasing('easeOutCubic').bezier!], keys: undefined },
    ]);
  });
  it('key selection, bezier tuples and cubic-bezier() strings', async () => {
    const [a, b, c] = await run(
      { op: 'ease', layer: 3, prop: 'position', easing: 'snappy', keys: [2, 3] },
      { op: 'ease', layer: 'Title', prop: 'scale', easing: [0.2, 0.8, 0.4, 1] },
      { op: 'ease', layer: 'Title', prop: 'rotation', easing: 'cubic-bezier(0.1, 0.2, 0.3, 0.4)' },
    );
    expect(a).toEqual({ op: 'setEasing', layer: 3, path: `${TG}/ADBE Position`, bezier: [0.2, 0.9, 0.1, 1], keys: [2, 3] });
    expect(b.bezier).toEqual([0.2, 0.8, 0.4, 1]);
    expect(b.path).toBe(`${TG}/ADBE Scale`);
    expect(c.bezier).toEqual([0.1, 0.2, 0.3, 0.4]);
  });
  it('unknown easing names fail with suggestions', async () => {
    await expect(run({ op: 'ease', layer: 1, prop: 'opacity', easing: 'easeOutCubik' })).rejects.toThrow(/unknown easing "easeOutCubik"\. Did you mean: .*easeOutCubic/);
  });
});

describe('property names', () => {
  it('friendly names map to AE matchName paths', async () => {
    expect(PROP_ALIASES.position).toBe('ADBE Transform Group/ADBE Position');
    const names = ['position', 'x', 'y', 'z', 'scale', 'rotation', 'rotationX', 'rotationY', 'orientation', 'opacity', 'anchor', 'sourceText'];
    const out = await run(...names.map((prop) => ({ op: 'set', layer: 1, prop, value: 0 })));
    expect(out.map((o) => o.path)).toEqual([
      `${TG}/ADBE Position`, `${TG}/ADBE Position_0`, `${TG}/ADBE Position_1`, `${TG}/ADBE Position_2`, `${TG}/ADBE Scale`, `${TG}/ADBE Rotate Z`,
      `${TG}/ADBE Rotate X`, `${TG}/ADBE Rotate Y`, `${TG}/ADBE Orientation`, `${TG}/ADBE Opacity`, `${TG}/ADBE Anchor Point`, 'ADBE Text Properties/ADBE Text Document',
    ]);
  });
  it('Effects/, Contents/ and Masks/ prefixes map to the parade groups; AE paths pass through', async () => {
    const out = await run(
      { op: 'set', layer: 1, prop: 'Effects/Glow/Glow Radius', value: 20 },
      { op: 'set', layer: 1, prop: 'Contents/Card/Contents/Fill 1/Color', value: '#ff0000' },
      { op: 'set', layer: 1, prop: 'Masks/Mask 1/Mask Feather', value: [5, 5] },
      { op: 'set', layer: 1, prop: 'ADBE Transform Group/ADBE Position', value: [1, 2] },
    );
    expect(out.map((o) => o.path)).toEqual([
      'ADBE Effect Parade/Glow/Glow Radius', 'ADBE Root Vectors Group/Card/Contents/Fill 1/Color', 'ADBE Mask Parade/Mask 1/Mask Feather', 'ADBE Transform Group/ADBE Position',
    ]);
  });
});

describe('set', () => {
  it('static values (colors parsed), expressions and expression removal', async () => {
    const [a, b, c] = await run(
      { op: 'set', layer: 'bar', prop: 'position', value: [100, 200] },
      { op: 'set', layer: 'bar', prop: 'Contents/Fill 1/Color', value: 'rgb(255, 0, 0)' },
      { op: 'set', layer: 'bar', prop: 'rotation', expr: 'time * 90', removeExpr: false },
    );
    expect(a).toEqual({ op: 'setProperty', layer: 'bar', path: `${TG}/ADBE Position`, removeExpr: undefined, value: [100, 200] });
    expect(b.value).toEqual([1, 0, 0, 1]);
    expect(c).toEqual({ op: 'setProperty', layer: 'bar', path: `${TG}/ADBE Rotate Z`, removeExpr: false, expr: 'time * 90' });
  });
  it('keys: exact bezier eases per segment, times as strings, holds', async () => {
    const [o] = await run({ op: 'set', layer: 1, prop: 'opacity', keys: [{ t: 0, v: 0, easing: 'easeOutCubic' }, { t: '1s', v: 100, hold: true }, { t: '45f', v: 20 }] });
    expect(o.keys.map((k: any) => [k.t, k.v, k.o])).toEqual([[0, 0, undefined], [1, 100, 'hold'], [1.5, 20, undefined]]);
    expect(o.keys[0].oe[0].influence).toBeCloseTo(100 / 3, 9);
    expect(o.keys[0].oe[0].speed).toBeCloseTo(300, 9); // 3 × 100 / 1 s
    expect(o.keys[1].ie[0].speed).toBe(0);
    const [single] = await run({ op: 'set', layer: 1, prop: 'opacity', keys: [{ t: 2, v: 50 }] });
    expect(single.keys).toEqual([{ t: 2, v: 50 }]);
    const [multi] = await run({ op: 'set', layer: 1, prop: 'position', keys: [{ t: 0, v: [0, 0] }, { t: 1, v: [100, 50] }] });
    expect(multi.keys[0].oe).toHaveLength(2); // default easeInOutCubic, one ease per dimension
    expect(multi.keys[0].oe[0].influence).toBeCloseTo(65, 9);
  });
});

describe('other ops', () => {
  it('easeKey, interpolation, retime, layerTiming', async () => {
    const out = await run(
      { op: 'easeKey', layer: 1, prop: 'y', key: 2, influence: 80, speed: 0 },
      { op: 'interpolation', layer: 1, prop: 'opacity', type: 'hold', keys: [1] },
      { op: 'retime', layer: 1, scale: 1.5, pivot: 0.5 },
      { op: 'layerTiming', layer: 1, in: 0.5, out: 3 },
    );
    expect(out[0]).toEqual({ op: 'setEasing', layer: 1, path: `${TG}/ADBE Position_1`, keys: [2], side: 'both', ease: { speed: 0, influence: 80 } });
    expect(out[1]).toEqual({ op: 'setEasing', layer: 1, path: `${TG}/ADBE Opacity`, keys: [1], interpolation: 'hold' });
    expect(out[2].op).toBe('retimeKeys');
    expect(out[2].paths).toEqual(['position', 'x', 'y', 'z', 'scale', 'rotation', 'opacity'].map((p) => PROP_ALIASES[p]));
    expect(out[2]).toMatchObject({ scale: 1.5, pivot: 0.5, skipStatic: true });
    expect(out[3]).toEqual({ op: 'setLayer', layer: 1, attrs: { in: 0.5, out: 3, start: undefined, stretch: undefined } });
  });
  it('addEffect resolves friendly names and converts params; setEffect/removeEffect/moveEffect address effects by name or index', async () => {
    const out = await run(
      { op: 'addEffect', layer: 'bg', effect: 'Glow', label: 'Soft', params: { 'Glow Radius': 20, 'Color A': '#ff0000', 'Layer': { layer: 'logo' } }, index: 1 },
      { op: 'addEffect', layer: 'bg', effect: 'gaussian blur' },
      { op: 'setEffect', layer: 'bg', effect: 'Soft', params: { 'Glow Radius': 40 }, enabled: false },
      { op: 'setEffect', layer: 'bg', effect: 2, params: {} },
      { op: 'removeEffect', layer: 'bg', effect: 'Soft' },
      { op: 'moveEffect', layer: 'bg', effect: 3, to: 1 },
    );
    expect(out[0]).toEqual({ op: 'addEffect', layer: 'bg', effect: { mn: 'ADBE Glo2', name: 'Soft', props: [{ p: 'Glow Radius', v: 20 }, { p: 'Color A', v: [1, 0, 0, 1] }, { p: 'Layer', v: { layer: 'logo' } }] }, index: 1 });
    expect(out[1].effect.mn).toBe('ADBE Gaussian Blur 2');
    expect(out[2]).toEqual({ op: 'setProps', layer: 'bg', owner: 'ADBE Effect Parade/Soft', props: [{ p: 'Glow Radius', v: 40 }] });
    expect(out[3]).toEqual({ op: 'setEnabled', layer: 'bg', path: 'ADBE Effect Parade/Soft', enabled: false });
    expect(out[4]).toEqual({ op: 'setProps', layer: 'bg', owner: 'ADBE Effect Parade/#2', props: [] });
    expect(out[5]).toEqual({ op: 'removeProperty', layer: 'bg', path: 'ADBE Effect Parade/Soft' });
    expect(out[6]).toEqual({ op: 'moveProperty', layer: 'bg', path: 'ADBE Effect Parade/#3', to: 1 });
  });
  it('text, path, layer, comp and structural ops', async () => {
    const out = await run(
      { op: 'text', layer: 't', text: 'New', size: 90, color: '#00ff00', leading: 'auto' },
      { op: 'path', layer: 's', prop: 'Contents/Logo/Contents/Path 1/Path', d: 'M0 0 L10 0 L10 10 Z' },
      { op: 'path', layer: 's', prop: 'Masks/Mask 1/Mask Path', points: [{ p: [0, 0] }, { p: [5, 5], in: [-1, 0] }], closed: false, t: 1.5 },
      { op: 'layer', layer: 't', set: { name: 'Title', parent: null, matte: { layer: 'm' } } },
      { op: 'comp', set: { renderer: 'advanced3d', bg: '#000000', width: 1280, duration: 8 } },
      { op: 'precompose', layers: ['a', 2], name: 'Group' },
      { op: 'duplicateComp', name: 'Promo_v002' },
      { op: 'addControls', layer: 't', prop: 'y', delay: 'Title Delay' },
      { op: 'removeLayer', layer: 'old' },
      { op: 'duplicateLayer', layer: 't', name: 'Copy' },
      { op: 'addLayer', spec: { type: 'null', name: 'N' }, index: 1 },
      { op: 'raw', runtime: { op: 'custom', x: 1 } },
    );
    expect(out[0]).toEqual({ op: 'setText', layer: 't', text: { text: 'New', font: undefined, size: 90, fill: [0, 1, 0, 1], tracking: undefined, leading: 'auto' } });
    expect(out[1]).toEqual({ op: 'setProperty', layer: 's', path: 'ADBE Root Vectors Group/Logo/Contents/Path 1/Path', value: parseSvgPath('M0 0 L10 0 L10 10 Z')[0] });
    expect(out[2]).toEqual({ op: 'setProperty', layer: 's', path: 'ADBE Mask Parade/Mask 1/Mask Path', keys: [{ t: 1.5, v: { v: [[0, 0], [5, 5]], i: [[0, 0], [-1, 0]], o: [[0, 0], [0, 0]], c: false } }] });
    expect(out[3]).toEqual({ op: 'setLayer', layer: 't', attrs: { name: 'Title', parent: null, matte: { layer: 'm', type: 'alpha' } } });
    expect(out[4]).toMatchObject({ op: 'setComp', attrs: { renderer: 'ADBE Calder', bg: [0, 0, 0, 1], w: 1280, dur: 8 } });
    expect(out[5]).toEqual({ op: 'precompose', layers: ['a', 2], name: 'Group' });
    expect(out[6]).toEqual({ op: 'duplicateComp', name: 'Promo_v002' });
    expect(out[7]).toEqual({ op: 'rigTiming', layer: 't', path: `${TG}/ADBE Position_1`, delayName: 'Title Delay', speedName: undefined });
    expect(out.slice(8)).toEqual([
      { op: 'removeLayer', layer: 'old' },
      { op: 'duplicateLayer', layer: 't', name: 'Copy' },
      { op: 'addLayer', spec: { type: 'null', name: 'N' }, index: 1 },
      { op: 'custom', x: 1 },
    ]);
    expect(parseColor('#000000')).toEqual([0, 0, 0, 1]);
  });
  it('a path op without d or points fails', async () => {
    await expect(run({ op: 'path', layer: 1, prop: 'Masks/Mask 1/Mask Path' })).rejects.toThrow(/path op needs d or points/);
  });
});

describe('validation', () => {
  it('schema errors name the op index, the op and the bad field', async () => {
    await expect(run({ op: 'set', prop: 'x', value: 1 })).rejects.toThrow(/^op #1 \(set\): layer: /);
    await expect(run({ op: 'ease', layer: 1, prop: 'x', easing: 'linear' }, { op: 'nope', layer: 1 })).rejects.toThrow(/^op #2 \(nope\): op: .*Expected 'set' \| 'ease'/);
    await expect(run({ op: 'easeKey', layer: 1, prop: 'x', key: 1, influence: 150 })).rejects.toThrow(/^op #1 \(easeKey\): influence: /);
    await expect(run({ op: 'easeKey', layer: 1, prop: 'x', key: 0 })).rejects.toThrow(/^op #1 \(easeKey\): key: /);
    await expect(run({ op: 'set', layer: -1, prop: 'x' })).rejects.toThrow(/^op #1 \(set\): layer: /);
    await expect(run({ op: 'layer', layer: 1, set: { matte: { layer: 'm', type: 'stencil' } } })).rejects.toThrow(/^op #1 \(layer\): set\.matte/);
  });
  it('the whole batch is validated before anything is compiled', async () => {
    await expect(run({ op: 'addEffect', layer: 1, effect: 'Glowz' }, { op: 'bogus' })).rejects.toThrow(/^op #2 \(bogus\)/);
  });
  it('unknown effects fail with suggestions', async () => {
    await expect(run({ op: 'addEffect', layer: 1, effect: 'Glowz' })).rejects.toThrow(/unknown effect "Glowz"\. Did you mean: "Glow" \(ADBE Glo2\)/);
  });
  // Regression (was a bug, fixed): semantic errors raised while compiling an op (unknown effect, unknown easing, path without d/points) are not
  // attributed to the op (src/edit/ops.ts compileEditOps: only the zod pass adds "op #N"; the compile loop does not): in a batch the agent can't tell which op failed.
  it('a semantic error names the op index like schema errors do', async () => {
    await expect(run({ op: 'set', layer: 1, prop: 'x', value: 1 }, { op: 'addEffect', layer: 1, effect: 'Glowz' })).rejects.toThrow(/op #2/);
  });
});
