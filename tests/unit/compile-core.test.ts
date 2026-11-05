// DSL → IR (compileScene): layer order, ids, timing, text, controls, variants.
import { describe, expect, it } from 'vitest';
import { jsx } from '../../src/dsl/jsx-runtime.ts';
import {
  scene, Composition, Sequence, Series, Precomp, Solid, Null, Text, Shape, Rect, Fill,
  control, tween, spring, keys, seq, loop, wiggle, expr, perWord, perChar, perLine, textPresets,
} from '../../src/dsl/index.ts';
import { compileScene } from '../../src/compile/compile.ts';
import type { CompileOpts } from '../../src/compile/compile.ts';
import { parseColor } from '@cc-mcp/core/units.ts';

/** jsx() with children as rest args (what the TSX compiler emits). */
const h = (type: any, props: Record<string, any> | null = {}, ...children: any[]) =>
  jsx(type, children.length ? { ...(props ?? {}), children: children.length === 1 ? children[0] : children } : { ...(props ?? {}) });
const build = (cfg: Record<string, any>, body: (p: any) => any, opts?: CompileOpts) => compileScene(scene({ name: 'T', duration: 4, ...cfg } as any, body), opts);
const comp = (r: { ir: any }, i = 0) => r.ir.comps[i];
const layer = (r: { ir: any }, id: string) => {
  for (const c of r.ir.comps) for (const L of c.layers) if (L.id === id) return L;
  throw new Error(`no layer ${id}`);
};
const prop = (L: any, p: string) => (L.props ?? []).find((s: any) => s.p === p);
const group = (L: any, at: string) => (L.groups ?? []).find((g: any) => g.at === at);
const TG = 'ADBE Transform Group';

describe('comp settings', () => {
  it('name, version tag, size, fps, duration, bg and ids', () => {
    const r = build({ name: 'Kinetic Type!', width: 1280, height: 720, fps: 24, duration: '00:00:02:12', bg: '#0b0d12', version: 7 }, () => h(Composition, {}));
    const c = comp(r);
    expect(r.ir.irVersion).toBe(1);
    expect(r.ir.scene).toBe('Kinetic Type!');
    expect(r.ir.main).toBe('kinetic-type');
    expect(c).toMatchObject({ id: 'kinetic-type', name: 'Kinetic Type!_v007', w: 1280, h: 720, fps: 24, dur: 2.5 });
    expect(c.bg).toEqual(parseColor('#0b0d12').slice(0, 3));
    expect(c.layers).toEqual([]);
    expect(build({ name: 'A' }, () => h(Composition, {}), { version: 12 }).ir.comps[0].name).toBe('A_v012');
  });
  it('defaults: 1920×1080 @ 30 fps, v001', () => {
    expect(comp(build({ duration: '6s' }, () => h(Composition, {})))).toMatchObject({ name: 'T_v001', w: 1920, h: 1080, fps: 30, dur: 6 });
  });
  it('scene() validates name and duration', () => {
    expect(() => scene({ duration: 1 } as any, () => h(Composition, {}))).toThrow(/name is required/);
    expect(() => scene({ name: 'X' } as any, () => h(Composition, {}))).toThrow(/duration is required/);
  });
  it('<Composition> props override the comp bg / renderer / motion blur', () => {
    const c = comp(build({}, () => h(Composition, { bg: '#ff0000', motionBlur: { shutterAngle: 270, samples: 32 } })));
    expect(c.bg).toEqual([1, 0, 0]);
    expect(c).toMatchObject({ motionBlur: true, shutterAngle: 270, samples: 32 });
  });
});

describe('layer order and ids', () => {
  it('later JSX siblings are on top: first in comp.layers', () => {
    const r = build({}, () => h(Composition, {}, h(Solid, { id: 'bg' }), h(Text, { id: 'title' }, 'Hi'), h(Shape, { id: 'bar' }, h(Rect, {}), h(Fill, {}))));
    expect(comp(r).layers.map((L: any) => L.id)).toEqual(['bar', 'title', 'bg']);
    expect(comp(r).layers.map((L: any) => L.type)).toEqual(['shape', 'text', 'solid']);
  });
  it('the Controls null goes on top of everything', () => {
    const r = build({}, () => h(Composition, {}, h(Solid, { id: 'bg', opacity: control('BG Opacity', 80) }), h(Text, { id: 'title' }, 'Hi')));
    expect(comp(r).layers.map((L: any) => L.id)).toEqual(['t.controls', 'title', 'bg']);
  });
  it('components (plain functions) and fragments are flattened in order', () => {
    const Pair = (p: { a: string; b: string }) => [h(Solid, { id: p.a }), h(Solid, { id: p.b })];
    const r = build({}, () => h(Composition, {}, h(Pair, { a: 'one', b: 'two' }), [h(Null, { id: 'three' }), null, false], h(Solid, { id: 'four' })));
    expect(comp(r).layers.map((L: any) => L.id)).toEqual(['four', 'three', 'two', 'one']);
  });
  it('explicit ids are kept; defaults derive from scene + (named) Sequence path + kind counter', () => {
    const r = build({ name: 'Promo' }, () => h(Composition, {},
      h(Solid, {}),
      h(Solid, {}),
      h(Sequence, { name: 'Intro Part', from: 1 }, h(Text, {}, 'A')),
      h(Text, { id: 'hero' }, 'B'),
      h(Text, {}, 'C'),
    ));
    expect(comp(r).layers.map((L: any) => L.id).reverse()).toEqual(['promo.solid0', 'promo.solid1', 'promo.intro-part.text0', 'hero', 'promo.text1']);
  });
  it('ids are deterministic: compiling twice gives identical IR', () => {
    const def = scene({ name: 'Det', duration: 3 }, () => h(Composition, {},
      h(Solid, {}), h(Text, { animate: { y: spring({ from: 60 }), opacity: tween({ from: 0, duration: 0.5 }) } }, 'Hello')));
    expect(compileScene(def).ir).toEqual(compileScene(def).ir);
  });
  it('a duplicate explicit id throws', () => {
    expect(() => build({}, () => h(Composition, {}, h(Solid, { id: 'x' }), h(Text, { id: 'x' }, 'dup')))).toThrow(/duplicate id "x"/);
  });
  it('default layer names', () => {
    const long = 'A very long headline that goes on and on';
    const r = build({}, () => h(Composition, {}, h(Text, { id: 'a' }, '  Two\n words  '), h(Text, { id: 'b', text: long }), h(Text, { id: 'c' }), h(Solid, { id: 'd', name: 'BG' }), h(Null, {})));
    expect(layer(r, 'a').name).toBe('Two words');
    expect(layer(r, 'b').name).toBe(long.slice(0, 27) + '…');
    expect(layer(r, 'c').name).toBe('Text');
    expect(layer(r, 'd').name).toBe('BG');
    expect(layer(r, 't.null0').name).toBe('Null 0');
    expect(r.warnings.some((w) => /\[c\] <Text> has no text/.test(w))).toBe(true);
  });
  it('misplaced elements fail with a pointed message', () => {
    expect(() => build({}, () => h(Composition, {}, h(Fill, {})))).toThrow(/<fill> is not a layer/);
    expect(() => build({}, () => h(Composition, {}, h(Solid, {}, h(Rect, {}))))).toThrow(/<rect> can't be a child of <solid>/);
    expect(() => build({}, () => h(Composition, {}, h(Series.Sequence, { duration: 1 })))).toThrow(/direct child of <Series>/);
    expect(() => build({}, () => h(Composition, {}, h(Series, {}, h(Solid, {}))))).toThrow(/<Series> children must be <Series.Sequence/);
    expect(() => build({}, () => h(Composition, {}, h(Text, { animate: { y: 5 } }, 'x')))).toThrow(/animate.y must be an animation/);
  });
  it('stray text outside <Text> is reported as a warning', () => {
    const r = build({}, () => h(Composition, {}, 'oops', h(Solid, {})));
    expect(r.warnings.some((w) => /stray text "oops"/.test(w))).toBe(true);
  });
});

describe('timing: Sequence, Series, layer from/duration', () => {
  it('Sequence from/duration → layer in/out; animation keys shift with it', () => {
    const r = build({ duration: 6 }, () => h(Composition, {},
      h(Solid, { id: 'full' }),
      h(Sequence, { from: 1, duration: 2 }, h(Text, { id: 'seq', animate: { opacity: tween({ from: 0, to: 100, duration: 0.5, delay: 0.25 }) } }, 'x')),
      h(Sequence, { from: '15f' }, h(Null, { id: 'open' })),
    ));
    expect(layer(r, 'full')).toMatchObject({ in: 0, out: 6 });
    expect(layer(r, 'seq')).toMatchObject({ in: 1, out: 3 });
    expect(prop(layer(r, 'seq'), `${TG}/ADBE Opacity`).keys.map((k: any) => k.t)).toEqual([1.25, 1.75]);
    expect(layer(r, 'open')).toMatchObject({ in: 0.5, out: 6 }); // open-ended: until the parent ends
  });
  it('nested Sequences add their offsets', () => {
    const r = build({ duration: 6 }, () => h(Composition, {}, h(Sequence, { from: 1 }, h(Sequence, { from: 0.5, duration: 1 }, h(Solid, { id: 's' })))));
    expect(layer(r, 's')).toMatchObject({ in: 1.5, out: 2.5 });
  });
  // Regression (was a bug, fixed): a nested Sequence is not clipped to its parent (src/compile/compile.ts:167, case 'sequence': the clamp
  // `Math.min(end, Math.max(end, start))` is a no-op). Remotion semantics end the child with the parent.
  it('a nested Sequence ends no later than its parent Sequence', () => {
    const r = build({ duration: 6 }, () => h(Composition, {}, h(Sequence, { from: 1, duration: 1 }, h(Sequence, { from: 0.5, duration: 5 }, h(Null, { id: 'inner' })))));
    expect(layer(r, 'inner').out).toBeLessThanOrEqual(2); // actual: 6.5 (past the parent's end at 2 and the comp's end at 6)
  });
  it('Series plays its steps back to back; offset overlaps or gaps', () => {
    const r = build({ duration: 10 }, () => h(Composition, {}, h(Series, {},
      h(Series.Sequence, { duration: 1 }, h(Solid, { id: 'a' })),
      h(Series.Sequence, { duration: '2s', offset: -0.5 }, h(Solid, { id: 'b' })),
      h(Series.Sequence, { duration: '500ms', offset: '15f' }, h(Solid, { id: 'c', animate: { opacity: tween({ from: 0, duration: 0.2 }) } })),
    )));
    expect(layer(r, 'a')).toMatchObject({ in: 0, out: 1 });
    expect(layer(r, 'b')).toMatchObject({ in: 0.5, out: 2.5 });
    expect(layer(r, 'c')).toMatchObject({ in: 3, out: 3.5 });
    expect(prop(layer(r, 'c'), `${TG}/ADBE Opacity`).keys[0].t).toBe(3);
  });
  it('layer from/duration are relative to the enclosing Sequence; markers are relative to the layer', () => {
    const r = build({ duration: 6 }, () => h(Composition, {}, h(Sequence, { from: 2 }, h(Solid, { id: 's', from: 0.5, duration: 1, markers: [{ t: 0.25, comment: 'hit', duration: '6f' }] }))));
    expect(layer(r, 's')).toMatchObject({ in: 2.5, out: 3.5 });
    expect(layer(r, 's').markers).toEqual([{ t: 2.75, comment: 'hit', dur: 0.2 }]);
  });
  it('layer switches: hidden, shy, guide, label, parent, blend, matte, 3D', () => {
    const r = build({}, () => h(Composition, {},
      h(Null, { id: 'p' }),
      h(Solid, { id: 'm', hidden: true }),
      h(Solid, { id: 's', shy: true, guide: true, label: 9, parent: 'p', blend: 'SCREEN', matte: { layer: 'm' }, threeD: true }),
    ));
    expect(layer(r, 'm').enabled).toBe(false);
    expect(layer(r, 's')).toMatchObject({ shy: true, guide: true, label: 9, parent: 'p', blend: 'SCREEN', matte: { layer: 'm', type: 'alpha' }, threeD: true });
    expect(prop(layer(r, 's'), `${TG}/ADBE Position`).v).toEqual([960, 540, 0]);
    expect(comp(r).renderer).toBe('ADBE Advanced 3d'); // plain 3D layers → Classic 3D
  });
});

describe('transform', () => {
  it('static x/y/position/scale/rotation/opacity/anchor', () => {
    const r = build({}, () => h(Composition, {},
      h(Solid, { id: 'a', x: 100, y: 200, scale: 50, rotation: 45, opacity: 70, anchor: [10, 20] }),
      h(Solid, { id: 'b', position: [300, 400], scale: [80, 90] }),
    ));
    const a = layer(r, 'a'), b = layer(r, 'b');
    expect(prop(a, `${TG}/ADBE Position`).v).toEqual([100, 200]);
    expect(prop(a, `${TG}/ADBE Scale`).v).toEqual([50, 50, 100]);
    expect(prop(a, `${TG}/ADBE Rotate Z`).v).toBe(45);
    expect(prop(a, `${TG}/ADBE Opacity`).v).toBe(70);
    expect(prop(a, `${TG}/ADBE Anchor Point`).v).toEqual([10, 20]);
    expect(prop(b, `${TG}/ADBE Position`).v).toEqual([300, 400]);
    expect(prop(b, `${TG}/ADBE Scale`).v).toEqual([80, 90, 100]);
  });
  it('`from` alone on y is an offset from the rest value; on opacity it is absolute', () => {
    const r = build({}, () => h(Composition, {}, h(Solid, { id: 'a', y: 300, animate: { y: tween({ from: 80, duration: 1 }), opacity: tween({ from: 0, duration: 1 }) } })));
    const a = layer(r, 'a');
    expect(prop(a, `${TG}/ADBE Position`)).toEqual({ p: `${TG}/ADBE Position`, sep: true });
    expect(prop(a, `${TG}/ADBE Position_0`).v).toBe(960);
    expect(prop(a, `${TG}/ADBE Position_1`).keys.map((k: any) => k.v)).toEqual([380, 300]);
    expect(prop(a, `${TG}/ADBE Opacity`).keys.map((k: any) => k.v)).toEqual([0, 100]);
  });
  it('raw props and expressions by AE path', () => {
    const r = build({}, () => h(Composition, {}, h(Solid, { id: 'a', props: { 'ADBE Transform Group/ADBE Opacity': 50 }, expressions: { 'ADBE Transform Group/ADBE Rotate Z': 'time * 90' } })));
    const a = layer(r, 'a');
    expect(a.props).toContainEqual({ p: 'ADBE Transform Group/ADBE Opacity', v: 50 });
    expect(a.props).toContainEqual({ p: 'ADBE Transform Group/ADBE Rotate Z', expr: 'time * 90' });
  });
});

describe('text', () => {
  it('every TextDocument field is explicit, with defaults', () => {
    const r = build({}, () => h(Composition, {},
      h(Text, { id: 'd' }, 'Default'),
      h(Text, { id: 'x', font: 'Montserrat-SemiBold', size: 48, color: '#ff8000', stroke: '#000', strokeWidth: 3, strokeOverFill: true, tracking: -20, leading: 60, align: 'right', caps: 'all', fauxBold: true, fauxItalic: true, box: { width: 800 }, runs: [{ start: 0, end: 4, color: '#00ff00', font: 'Inter-Black', size: 60, tracking: 10, baselineShift: 2 }] }, 'Styled text'),
      h(Text, { id: 'j', align: 'justify', text: 'prop text wins', box: { width: 400, height: 100 } }, 'ignored child'),
    ));
    expect(layer(r, 'd').text).toEqual({ text: 'Default', font: 'Inter-Bold', size: 72, fill: [1, 1, 1], tracking: 0, leading: 'auto', justify: 'center' });
    expect(layer(r, 'd').anchorBox).toEqual([0.5, 0.5]);
    const x = layer(r, 'x').text;
    expect(x).toMatchObject({ text: 'Styled text', font: 'Montserrat-SemiBold', size: 48, stroke: [0, 0, 0], strokeWidth: 3, strokeOverFill: true, tracking: -20, leading: 60, justify: 'right', caps: 'all', fauxBold: true, fauxItalic: true, box: { w: 800, h: 288 } });
    expect(x.fill).toEqual(parseColor('#ff8000').slice(0, 3));
    expect(x.runs).toEqual([{ start: 0, end: 4, font: 'Inter-Black', size: 60, fill: [0, 1, 0], tracking: 10, baselineShift: 2 }]);
    expect(layer(r, 'j').text).toMatchObject({ text: 'prop text wins', justify: 'justifyLeft', box: { w: 400, h: 100 } });
  });
  it('per-word reveal → native animator with an Expression Selector (Based On = 3) and an amount expression', () => {
    const r = build({}, () => h(Composition, {}, h(Text, { id: 't', animate: { text: perWord({ from: { y: 120, opacity: 0 }, easing: 'easeOutCubic', each: '80ms', duration: 0.6, delay: 0.3 }) } }, 'MAKE IT MOVE')));
    const g = group(layer(r, 't'), 'ADBE Text Properties/ADBE Text Animators');
    expect(g.items).toHaveLength(1);
    const anim = g.items[0];
    expect(anim).toMatchObject({ mn: 'ADBE Text Animator', name: 'Reveal (words)' });
    const props = anim.kids.find((k: any) => k.at === 'ADBE Text Animator Properties').items;
    expect(props).toEqual([{ mn: 'ADBE Text Position 3D', set: { v: [0, 120, 0] } }, { mn: 'ADBE Text Opacity', set: { v: 0 } }]);
    const sel = anim.kids.find((k: any) => k.at === 'ADBE Text Selectors').items;
    expect(sel).toHaveLength(1);
    expect(sel[0].mn).toBe('ADBE Text Expressible Selector');
    expect(sel[0].props[0]).toEqual({ p: 'ADBE Text Range Type2', v: 3 });
    const amount = sel[0].props[1];
    expect(amount.p).toBe('ADBE Text Expressible Amount');
    expect(amount.expr).toContain('var each = 0.08, dur = Math.max(0.6, 0.0001), delay = 0.3;');
    expect(amount.expr).toContain('var i = textIndex - 1;');
    expect(amount.expr).toContain('time - inPoint');
    // The easing is a library call (D73), with the bezier helper inlined under the header.
    expect(amount.expr).toContain(`L.bezier(${[1 / 3, 1, 2 / 3, 1].join(', ')}, t / dur)`);
    expect(amount.expr).toMatch(/^function aecLib\(\) \{ return \{ "bezier": /m);
    expect(amount.expr.trim().endsWith('[a, a, a];')).toBe(true);
    // the amount expression is valid JavaScript
    expect(() => new Function(amount.expr)).not.toThrow();
  });
  it('the amount expression evaluates the easing per unit: 100 before the unit starts, 0 once it has finished', () => {
    const r = build({}, () => h(Composition, {}, h(Text, { id: 't', animate: { text: perWord({ from: { opacity: 0 }, easing: 'easeOutCubic', each: 0.1, duration: 0.5 }) } }, 'a b c')));
    const expr = group(layer(r, 't'), 'ADBE Text Properties/ADBE Text Animators').items[0].kids[1].items[0].props[1].expr as string;
    const run = (time: number, textIndex: number) => new Function('time', 'inPoint', 'textIndex', 'textTotal', 'thisComp', `${expr.replace(/\[a, a, a\];\s*$/, 'return a;')}`)(time, 0, textIndex, 3, { frameDuration: 1 / 30 });
    expect(run(0, 1)).toBe(100);
    expect(run(0.05, 2)).toBe(100); // word 2 starts at 0.1
    expect(run(0.35, 1)).toBeGreaterThan(0);
    expect(run(0.35, 1)).toBeLessThan(10); // easeOutCubic is ~96 % done at 70 %
    expect(run(0.6, 1)).toBe(0);
    expect(run(0.7, 3)).toBe(0);
  });
  it('Based On per unit kind; spring units embed the closed-form spring; non-bezier easing is rejected', () => {
    const basedOn = (a: any) => group(layer(build({}, () => h(Composition, {}, h(Text, { id: 't', animate: { text: a } }, 'ab cd'))), 't'), 'ADBE Text Properties/ADBE Text Animators').items[0].kids[1].items[0].props;
    expect(basedOn(perChar({ from: { opacity: 0 } }))[0].v).toBe(1);
    expect(basedOn(perLine({ from: { opacity: 0 } }))[0].v).toBe(4);
    expect(basedOn(perWord({ from: { opacity: 0 } }))[0].v).toBe(3);
    const sp = basedOn(textPresets.popIn('char'))[1].expr;
    expect(sp).toMatch(/"spring": function \(t, fps, c, k, m\)/);
    expect(sp).toContain('L.spring(t, 1 / thisComp.frameDuration, 11, 220, 1)');
    expect(() => basedOn(perWord({ from: { opacity: 0 }, easing: 'bounce' }))).toThrow(/not a cubic bezier/);
    expect(() => basedOn(perWord({ from: {} }))).toThrow(/needs at least one "from" property/);
  });
  it('scale/rotation units set the anchor-point grouping; exit direction inverts the amount', () => {
    const L = layer(build({}, () => h(Composition, {}, h(Text, { id: 't', animate: { text: [perWord({ from: { scale: 0 } }), perWord({ from: { opacity: 0 }, direction: 'out', delay: 2, name: 'Out' })] } }, 'ab cd'))), 't');
    const groups = L.groups.filter((x: any) => x.at === 'ADBE Text Properties/ADBE Text Animators');
    expect(groups.map((x: any) => x.items[0].name)).toEqual(['Reveal (words)', 'Out']);
    expect(groups[0].items[0].kids[0].items).toEqual([{ mn: 'ADBE Text Scale 3D', set: { v: [0, 0, 100] } }]);
    expect(prop(L, 'ADBE Text Properties/ADBE Text More Options/ADBE Text Anchor Point Option').v).toBe(2);
    expect(groups[1].items[0].kids[1].items[0].props[1].expr).toContain('var a = p * 100;');
  });
});

describe('controls', () => {
  it('a Controls null carries one expression control per control(), with the right matchName', () => {
    const r = build({}, () => h(Composition, {},
      h(Solid, {
        id: 's',
        position: control('Pos', [100, 200]),
        rotation: control('Spin', 15, { kind: 'angle' }),
        opacity: control('Opacity Amount', 80, { min: 0, max: 100 }),
        props: { 'X/P3': control('P3', [10, 20, 30]), 'X/Menu': control('Mode', { items: ['A', 'B', 'C'], default: 'B' }) },
      }),
      h(Shape, { id: 'sh', animate: { opacity: expr('__AEC_CONTROL(Enabled)__ * 100', [control('Enabled', true)]) } }, h(Rect, {}), h(Fill, { color: control('Tint', '#ff0000') })),
    ));
    const ctl = comp(r).layers[0];
    expect(ctl).toMatchObject({ id: 't.controls', type: 'null', name: 'Controls', enabled: false });
    const fx = group(ctl, 'ADBE Effect Parade').items;
    // registry order = order of first use (layers in JSX order; per layer: contents, then transform, then raw props)
    expect(fx.map((e: any) => [e.name, e.mn])).toEqual([
      ['Pos', 'ADBE Point Control'],
      ['Spin', 'ADBE Angle Control'],
      ['Opacity Amount', 'ADBE Slider Control'],
      ['P3', 'ADBE Point3D Control'],
      ['Mode', 'ADBE Dropdown Control'],
      ['Tint', 'ADBE Color Control'],
      ['Enabled', 'ADBE Checkbox Control'],
    ]);
    expect(fx.map((e: any) => e.props[0])).toEqual([[100, 200], 15, 80, [10, 20, 30], 2, [1, 0, 0, 1], 1].map((v) => ({ p: '#1', v })));
    expect(fx[4].menu).toEqual(['A', 'B', 'C']);
    expect(prop(layer(r, 'sh'), `${TG}/ADBE Opacity`).expr).toBe('((thisComp.layer("Controls").effect("Enabled")(1).value ? 1 : 0)) * 100');
  });
  // Regression (was a bug, fixed): a checkbox control used as a property value throws "expected a number or array, got true"
  // (src/compile/values.ts:252 converts the boolean default with toArr), although ControlRegistry.ref
  // already emits a 0/1 expression for checkboxes. Same for effect params.
  it('a checkbox control can drive a numeric property (static 0/1 + expression)', () => {
    const r = build({}, () => h(Composition, {}, h(Solid, { id: 's', opacity: control('Visible', true) })));
    expect(prop(layer(r, 's'), `${TG}/ADBE Opacity`)).toEqual({ p: `${TG}/ADBE Opacity`, v: 100, expr: '((thisComp.layer("Controls").effect("Visible")(1).value ? 1 : 0)) * 100' });
  });
  // Regression (was a bug, fixed): a 2D point control on a 3D layer's position pads z with the y value (src/compile/values.ts:39-41,252):
  // control('Pos', [100, 200]) on a threeD layer gives v = [100, 200, 200], and the expression keeps value[2] = 200.
  it('a 2D point control on a 3D position keeps the rest z (0)', () => {
    const r = build({}, () => h(Composition, {}, h(Solid, { id: 's', threeD: true, position: control('Pos', [100, 200]) })));
    const pos = prop(layer(r, 's'), `${TG}/ADBE Position`);
    expect(pos.expr).toBe('var p = thisComp.layer("Controls").effect("Pos")(1); [p[0], p[1], value[2]];');
    expect(pos.v).toEqual([100, 200, 0]);
  });
  it('properties link to the control by expression; sliders with a range are clamped; a slider on scale drives x and y', () => {
    const r = build({}, () => h(Composition, {}, h(Solid, { id: 's', opacity: control('Fade', 50, { min: 0, max: 100 }), rotation: control('Spin', 10), scale: control('Size', 80), props: { 'X/Low': control('Low', 3, { min: 1 }) } })));
    const s = layer(r, 's');
    const ref = (n: string) => `thisComp.layer("Controls").effect("${n}")(1)`;
    expect(prop(s, `${TG}/ADBE Opacity`)).toEqual({ p: `${TG}/ADBE Opacity`, v: 50, expr: `clamp(${ref('Fade')}, 0, 100)` });
    expect(prop(s, `${TG}/ADBE Rotate Z`)).toEqual({ p: `${TG}/ADBE Rotate Z`, v: 10, expr: ref('Spin') });
    expect(prop(s, `${TG}/ADBE Scale`)).toEqual({ p: `${TG}/ADBE Scale`, v: [80, 80, 100], expr: `var s = ${ref('Size')}; [s, s, 100];` });
    expect(prop(s, 'X/Low').expr).toBe(`clamp(${ref('Low')}, 1, 1000000000)`);
  });
  it('static control on a color: the fill keeps the default value and reads the Color Control', () => {
    const accent = control('Accent Color', '#4683c4');
    const r = build({}, () => h(Composition, {}, h(Shape, { id: 'bar' }, h(Rect, {}), h(Fill, { color: accent })), h(Shape, { id: 'bar2' }, h(Rect, {}), h(Fill, { color: accent }))));
    const fill = (id: string) => group(layer(r, id), 'ADBE Root Vectors Group').items[1].props[0];
    expect(fill('bar')).toEqual({ p: 'ADBE Vector Fill Color', v: parseColor('#4683c4'), expr: 'thisComp.layer("Controls").effect("Accent Color")(1)' });
    expect(fill('bar2').expr).toBe(fill('bar').expr);
    const fx = group(comp(r).layers[0], 'ADBE Effect Parade').items;
    expect(fx).toEqual([{ mn: 'ADBE Color Control', name: 'Accent Color', props: [{ p: '#1', v: parseColor('#4683c4') }] }]); // used twice, created once
  });
  it('a control on a <Text> color drives the fill through the Source Text expression', () => {
    const r = build({}, () => h(Composition, {}, h(Text, { id: 't', color: control('Title Color', '#00ff00') }, 'Hi')));
    expect(layer(r, 't').text.fill).toEqual([0, 1, 0]);
    expect(prop(layer(r, 't'), 'ADBE Text Properties/ADBE Text Document').expr).toBe('var c = thisComp.layer("Controls").effect("Title Color")(1); style.setFillColor([c[0], c[1], c[2]]);');
  });
  it('controls are exposed as Essential Graphics props (unless eg: false)', () => {
    const r = build({ name: 'Promo' }, () => h(Composition, {}, h(Solid, { opacity: control('Fade', 50), rotation: control('Hidden Spin', 0, { eg: false }) })));
    expect(comp(r).mgt).toEqual({ name: 'Promo', props: [{ layer: 'promo.controls', p: 'ADBE Effect Parade/Fade/#1', name: 'Fade' }] });
    expect(comp(build({}, () => h(Composition, {}, h(Solid, {})))).mgt).toBeUndefined();
  });
  it('control() infers kinds', () => {
    expect(control('a', 1).kind).toBe('slider');
    expect(control('b', true).kind).toBe('checkbox');
    expect(control('c', '#fff').kind).toBe('color');
    expect(control('d', [1, 2]).kind).toBe('point');
    expect(control('e', [10, 20, 30]).kind).toBe('point3d');
    expect(control('f', [0.2, 0.4, 0.6]).kind).toBe('color');
    expect(control('g', { items: ['x', 'y'], default: 'y' })).toMatchObject({ kind: 'dropdown', default: 2, items: ['x', 'y'] });
    expect(control('h', 5, { kind: 'angle', eg: false })).toMatchObject({ kind: 'angle', eg: false });
  });
  it('one name used as two kinds throws', () => {
    expect(() => build({}, () => h(Composition, {}, h(Solid, { opacity: control('X', 1), props: { 'A/B': control('X', true) } })))).toThrow(/control "X" is used as both slider and checkbox/);
  });
  it('controls on tween timing/distance keep the keys (authored at the defaults) and add a retiming rig expression', () => {
    const r = build({}, () => h(Composition, {}, h(Text, { id: 't', y: 360, animate: { y: tween({ from: control('Rise', 80), duration: control('Rise Duration', 0.6), delay: control('Rise Delay', 0.2), easing: 'easeOutCubic' }) } }, 'LIVE')));
    const y = prop(layer(r, 't'), `${TG}/ADBE Position_1`);
    expect(y.keys.map((k: any) => [k.t, k.v])).toEqual([[0.2, 440], [0.8, 360]].map(([t, v]) => [expect.closeTo(t, 9), v]));
    expect(y.expr).toContain('var t0 = 0.200000;');
    expect(y.expr).toContain('var d = (thisComp.layer("Controls").effect("Rise Delay")(1)) - 0.2;');
    expect(y.expr).toContain('var s = Math.max((thisComp.layer("Controls").effect("Rise Duration")(1)) / 0.6, 0.0001);');
    expect(y.expr).toContain('v = 360 + (v - 360) * ((thisComp.layer("Controls").effect("Rise")(1)) / 80);');
    expect(y.expr).toContain('valueAtTime(t0 + (time - t0 - d) / s)');
    expect(() => new Function('valueAtTime', 'time', 'thisComp', y.expr)).not.toThrow();
  });
  it('a control cannot drive the `to` of a tween', () => {
    expect(() => build({}, () => h(Composition, {}, h(Solid, { animate: { opacity: tween({ from: 0, to: control('Max', 100) }) } })))).toThrow(/can't drive `to`/);
  });
  // Regression (was a bug, fixed): controls used inside a <Precomp> compile to `thisComp.layer("Controls")`, but the Controls null
  // only exists in the main comp (src/compile/controls.ts:25-26 ControlRegistry.ref; compile.ts:280-281 says precomps should use
  // comp("<main>").layer("Controls")). The expression breaks in AE.
  it('a control used inside a Precomp reaches the main comp\'s Controls null', () => {
    const r = build({ name: 'Pre' }, () => h(Composition, {}, h(Precomp, { id: 'pc' }, h(Solid, { id: 'inner', opacity: control('Fade', 50) }))));
    const pre = r.ir.comps.find((c: any) => c.id === 'pre~pc');
    const hasControls = pre.layers.some((L: any) => L.name === 'Controls');
    const expr = prop(layer(r, 'inner'), `${TG}/ADBE Opacity`).expr;
    expect(hasControls || expr.includes('comp("Pre_v001").layer("Controls")')).toBe(true);
  });
});

describe('precomps', () => {
  it('children become a part comp listed before the main comp; the layer points at it', () => {
    const r = build({ name: 'Main', duration: 5 }, () => h(Composition, {}, h(Sequence, { from: 1 }, h(Precomp, { id: 'card', width: 400, height: 300, bg: '#111111' }, h(Solid, { id: 'cs' })))));
    expect(r.ir.comps.map((c: any) => c.id)).toEqual(['main~card', 'main']) // explicit part ids are namespaced with the main comp's id;
    expect(r.ir.main).toBe('main');
    expect(r.ir.comps[0]).toMatchObject({ name: 'Main_card', w: 400, h: 300, dur: 4, part: true });
    expect(layer(r, 'card')).toMatchObject({ type: 'precomp', precomp: { comp: 'main~card' }, in: 1, out: 5, start: 1 }); // start = in: the nested comp's frame 0 plays at the Sequence start (was 0 → AE clamped the layer)
    expect(layer(r, 'cs')).toMatchObject({ in: 0, out: 4 });
    expect(prop(layer(r, 'cs'), `${TG}/ADBE Position`).v).toEqual([200, 150]);
  });
});

describe('variants', () => {
  const def = scene({
    name: 'TestVariants', duration: 3,
    params: { accent: '#4683c4', damping: 12, headline: 'SAY IT LOUD' },
    variants: { A: { accent: '#4683c4', damping: 8 }, B: { accent: '#ee4266', damping: 14, headline: 'SAY IT CLEAR' } },
  }, (p: any) => h(Composition, {},
    h(Text, { id: 'title', animate: { y: spring({ from: 100, damping: p.damping }) } }, p.headline),
    h(Shape, { id: 'bar' }, h(Rect, {}), h(Fill, { color: p.accent })),
    h(Solid, { id: 'seeded', props: { 'X/Seed': p.seed } }),
  ));
  const run = (k: 'A' | 'B') => compileScene(def, { variant: k, params: def.config.variants![k] });
  it('variant params override the defaults and produce different IR', () => {
    const a = run('A'), b = run('B'), base = compileScene(def);
    expect(base.ir.comps[0]).toMatchObject({ id: 'testvariants', name: 'TestVariants_v001' });
    expect(a.ir.comps[0]).toMatchObject({ id: 'testvariants-a', name: 'TestVariants_v001_A' });
    expect(b.ir.comps[0]).toMatchObject({ id: 'testvariants-b', name: 'TestVariants_v001_B' });
    expect(a.ir.main).toBe('testvariants-a');
    expect(layer(a, 'title').text.text).toBe('SAY IT LOUD');
    expect(layer(b, 'title').text.text).toBe('SAY IT CLEAR');
    const fill = (r: any) => group(layer(r, 'bar'), 'ADBE Root Vectors Group').items[1].props[0].v;
    expect(fill(a)).toEqual(parseColor('#4683c4'));
    expect(fill(b)).toEqual(parseColor('#ee4266'));
    const y = (r: any) => prop(layer(r, 'title'), `${TG}/ADBE Position_1`).keys;
    expect(y(a)).not.toEqual(y(b)); // damping 8 vs 14
    expect(y(a).length).toBeGreaterThan(y(b).length); // less damping → more oscillation keys
    expect(a.ir).not.toEqual(b.ir);
  });
  it('seed defaults to 1 and is overridable as a param', () => {
    expect(prop(layer(compileScene(def), 'seeded'), 'X/Seed').v).toBe(1);
    expect(prop(layer(compileScene(def, { params: { seed: 42 } }), 'seeded'), 'X/Seed').v).toBe(42);
  });
});

describe('animation descriptors', () => {
  it('keys() with holds; seq() chains parts; loop() and wiggle() add expressions', () => {
    const r = build({ params: { seed: 7 } }, () => h(Composition, {}, h(Solid, {
      id: 's',
      animate: {
        opacity: keys({ t: 0, v: 0, hold: true }, { t: 1, v: 100, easing: 'linear' }, { t: '2s', v: 50 }),
        rotation: loop(tween({ from: 0, to: 360, duration: 1, easing: 'linear' })),
        scale: seq(tween({ from: 0, to: 120, duration: 0.5 }), tween({ to: 100, duration: 0.25 })),
        x: wiggle(2, 30),
      },
    })));
    const s = layer(r, 's');
    const op = prop(s, `${TG}/ADBE Opacity`).keys;
    expect(op.map((k: any) => [k.t, k.v, k.o ?? null])).toEqual([[0, 0, 'hold'], [1, 100, null], [2, 50, null]]);
    expect(op[1].oe[0].influence).toBeCloseTo(0.1, 9); // 'linear' bezier: minimum influence on both sides
    expect(op[2].ie[0].influence).toBeCloseTo(0.1, 9);
    const rot = prop(s, `${TG}/ADBE Rotate Z`);
    expect(rot.keys).toHaveLength(2);
    expect(rot.expr).toBe('loopOut("cycle");');
    const sc = prop(s, `${TG}/ADBE Scale`).keys;
    expect(sc.map((k: any) => [k.t, k.v])).toEqual([[0, [0, 0, 100]], [0.5, [120, 120, 100]], [0.75, [100, 100, 100]]]);
    expect(prop(s, `${TG}/ADBE Position_0`).expr).toBe('seedRandom(7, true);\nwiggle(2, 30, 1, 0.5);');
  });
});
