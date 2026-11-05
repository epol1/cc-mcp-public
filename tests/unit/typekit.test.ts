// Typography kit (K3) → IR, no AE: captions (plan, cues, karaoke, boxes, underline), emphasis (measuring copies,
// mark, word pop), decode, typewriter, split-flap, font-weight steps and auto-fit. Generated expressions are also
// run in Node against a small mock of AE's expression scope, to check their logic.
import { describe, expect, it } from 'vitest';
import { jsx } from '../../src/dsl/jsx-runtime.ts';
import { scene, Composition, Text, Stack, brand } from '../../src/dsl/index.ts';
import { compileScene } from '../../src/compile/compile.ts';
import { Captions, captionPlan, Emphasis, emphasize, Decode, Typewriter, SplitFlap, VariableFont, AutoFit, autoFitLines, typingProgress } from '../../src/dsl/type/index.ts';

const build = (kids: any[], cfg: Record<string, any> = {}) => compileScene(scene({ name: 'T', duration: 6, ...cfg } as any, () => jsx(Composition, { children: kids })));
const main = (r: any) => r.ir.comps.find((c: any) => c.id === r.ir.main);
const layer = (r: any, id: string) => { const L = main(r).layers.find((l: any) => l.id === id); if (!L) throw new Error(`no layer ${id}`); return L; };
const has = (r: any, id: string) => main(r).layers.some((l: any) => l.id === id);
/** The expression finally set on a path (layer-level props win over the animator's generated one). */
const exprOf = (L: any, path: string) => { const all = (L.props ?? []).filter((s: any) => s.p === path && s.expr); return all[all.length - 1]?.expr as string | undefined; };
const fxGroup = (L: any) => (L.groups ?? []).find((g: any) => g.at === 'ADBE Effect Parade')?.items ?? [];
const animators = (L: any) => (L.groups ?? []).filter((g: any) => g.at === 'ADBE Text Properties/ADBE Text Animators').flatMap((g: any) => g.items);
const SRC = 'ADBE Text Properties/ADBE Text Document';
const amount = (name: string) => `ADBE Text Properties/ADBE Text Animators/${name}/ADBE Text Selectors/#1/ADBE Text Expressible Amount`;

/** Runs an AE expression (as compiled: library inlined, layer refs resolved) against a mock scope. */
function run(code: string, scope: Record<string, any>): any {
  const f = new Function('scope', 'code', 'with (scope) { return eval(code); }');
  return f({ Math, ...scope }, code);
}
/** A mock layer whose effects return fixed param values: effect("X")("P").value. */
const fxLayer = (vals: Record<string, any>, extra: Record<string, any> = {}) => ({ effect: () => (p: string) => ({ value: vals[p] }), ...extra });

const WORDS = [
  { text: 'Make', start: 0.2, end: 0.5 }, { text: 'motion', start: 0.5, end: 0.9 }, { text: 'that', start: 1.0, end: 1.2 }, { text: 'reads.', start: 1.2, end: 1.9 },
  { text: 'Every', start: 2.6, end: 2.9 }, { text: 'single', start: 2.9, end: 3.3 }, { text: 'word.', start: 3.3, end: 4.0 },
];

describe('captionPlan', () => {
  it('groups timed words into cues and re-flows them to the title-safe width', () => {
    const plan = captionPlan({ id: 'c', words: WORDS });
    expect(plan.cues.map((c) => c.text)).toEqual(['Make motion that reads.', 'Every single word.']);
    expect(plan.area).toBe('title');
    expect(plan.maxWidth).toBe(Math.round(1920 * 0.8 * 0.92));
    expect(plan.estimated).toBe(false);
    expect(plan.cues[0].words.map((w) => w.start)).toEqual([0.2, 0.5, 1.0, 1.2]);
  });
  it('breaks long cues into balanced lines and splits what needs more than maxLines', () => {
    const long = 'This caption is long enough that it has to be broken into two balanced lines for the viewer';
    const plan = captionPlan({ id: 'c', cues: [{ start: 0, end: 6, text: long }], size: 64, maxWidth: 900 });
    for (const c of plan.cues) {
      expect(c.lines.length).toBeLessThanOrEqual(2);
      expect(c.lines.join(' ')).toBe(c.text);
    }
    expect(plan.cues.map((c) => c.text).join(' ')).toBe(long);
  });
  it('vertical frames keep out of the platform UI zones', () => {
    const plan = captionPlan({ id: 'c', cues: [{ start: 0, end: 2, text: 'Hello there' }], frame: [1080, 1920] });
    expect(plan.area).toEqual([250, 120, 400, 60]);
    expect(plan.maxWidth).toBe(Math.round(900 * 0.92));
    expect(plan.size).toBe(52);
  });
  it('flags reading issues; reading: "error" throws', () => {
    const fast = [{ start: 0, end: 0.6, text: 'Far too many words to read in well under a second' }];
    expect(captionPlan({ id: 'c', cues: fast }).issues.map((i) => i.rule)).toEqual(expect.arrayContaining(['too-short', 'too-fast']));
    const r = build([jsx(Captions, { id: 'c', cues: fast })]);
    expect(r.warnings.some((w) => /Captions "c": cue 1 .* too-fast/.test(w))).toBe(true);
    expect(() => build([jsx(Captions, { id: 'c', cues: fast, reading: 'error' })])).toThrow(/reading issues/);
    expect(build([jsx(Captions, { id: 'c', cues: fast, reading: 'off' })]).warnings.some((w) => /too-fast/.test(w))).toBe(false);
  });
  it('reads SRT text given as src, and applies offset', () => {
    const srt = '1\n00:00:01,000 --> 00:00:03,000\nHello <i>there</i>\n\n2\n00:00:03,000 --> 00:00:05,500\nGeneral Kenobi\n';
    const plan = captionPlan({ id: 'c', src: srt, offset: 0.5 });
    expect(plan.cues.map((c) => [c.start, c.end, c.text])).toEqual([[1.5, 3.5, 'Hello there'], [3.5, 6, 'General Kenobi']]);
    expect(plan.estimated).toBe(true);
  });
  it('needs exactly one source', () => {
    expect(() => captionPlan({ id: 'c' })).toThrow(/exactly one of src/);
    expect(() => captionPlan({ id: 'c', words: WORDS, cues: [] })).toThrow(/exactly one of src/);
  });
});

describe('<Captions>', () => {
  it('one text layer per cue, in the safe-area layout, with a controller rig and fades next to gaps', () => {
    const r = build([jsx(Captions, { id: 'subs', cues: [{ start: 0.5, end: 2, text: 'First line' }, { start: 2, end: 3.5, text: 'Back to back' }, { start: 4, end: 5.5, text: 'After a gap' }] })]);
    const m = main(r);
    const c1 = layer(r, 'subs.cue1'), c2 = layer(r, 'subs.cue2'), c3 = layer(r, 'subs.cue3');
    expect([c1.name, c2.name, c3.name]).toEqual(['Caption 01', 'Caption 02', 'Caption 03']);
    expect([c1.in, c1.out, c2.in, c2.out]).toEqual([0.5, 2, 2, 3.5]);
    expect(c1.text).toMatchObject({ text: 'First line', font: 'Inter-SemiBold', size: 54, justify: 'center' });
    expect(c1.layoutLeaf).toBe(true);
    const lay = m.layouts.find((l: any) => JSON.stringify(l).includes('subs.cue1'));
    expect(lay.root).toMatchObject({ kind: 'align', at: 'bottom' });
    expect(lay.area).toEqual({ x: 192, y: 108, w: 1536, h: 864 });
    const ctl = layer(r, 'subs.ctl');
    expect(ctl.type).toBe('null');
    expect(fxGroup(ctl)[0]).toMatchObject({ name: 'Captions' });
    expect(fxGroup(ctl)[0].mn).toMatch(/^Pseudo\/aec Captions /);
    // Fades: in and out next to gaps, cut between back-to-back cues.
    const op = (L: any) => exprOf(L, 'ADBE Transform Group/ADBE Opacity')!;
    expect(op(c1)).toMatch(/Math\.min\(L\.clamp\(\(time - inPoint\) \/ f, 0, 1\), 1\);/);
    expect(op(c2)).toMatch(/Math\.min\(1, L\.clamp\(\(outPoint - time\) \/ f, 0, 1\)\);/);
    expect(run(op(c3), { time: 4.03, inPoint: 4, outPoint: 5.5, thisComp: { layer: () => fxLayer({ Fade: 0.12 }) } })).toBeCloseTo(25, 5);
    // Live text color: a style expression, so the text stays editable.
    expect(exprOf(c1, SRC)).toContain('style.setFillColor');
    expect(fxGroup(c1).some((f: any) => f.mn === 'ADBE Drop Shadow')).toBe(true);
  });
  it('karaoke: a per-word animator whose selector reads the word times; live highlight and pop scale', () => {
    const r = build([jsx(Captions, { id: 'k', words: WORDS, style: 'boldPop' })]);
    const c1 = layer(r, 'k.cue1');
    expect(c1.text).toMatchObject({ font: 'Inter-Black', size: 72, caps: 'all', strokeWidth: 10 });
    expect(animators(c1).map((a: any) => a.name)).toEqual(['Karaoke']);
    const a = exprOf(c1, amount('Karaoke'))!;
    expect(a).toContain('var e = thisComp.layer("Captions").effect("Captions"), W = [0, 0.3, 0.8, 1];');
    expect(a).toMatch(/^function aecLib\(\)/m);
    const scope = (time: number, textIndex: number) => ({ time, inPoint: 0.2, outPoint: 1.9, textIndex, textTotal: 4, thisComp: { layer: () => fxLayer({ 'Sync Offset': 0, Ramp: 0.06 }) } });
    // 'current' mode: word 2 ("motion", 0.5–1.0 s) is lit at 0.8 s, word 1 is not.
    expect(run(a, scope(0.8, 2))[0]).toBeCloseTo(100, 5);
    expect(run(a, scope(0.8, 1))[0]).toBeCloseTo(0, 5);
    expect(run(a, scope(0.8, 3))[0]).toBeCloseTo(0, 5);
    expect(exprOf(c1, 'ADBE Text Properties/ADBE Text Animators/Karaoke/ADBE Text Animator Properties/ADBE Text Scale 3D')).toContain('"Pop Scale"');
    expect(exprOf(c1, 'ADBE Text Properties/ADBE Text Animators/Karaoke/ADBE Text Animator Properties/ADBE Text Fill Color')).toContain('"Highlight"');
    // 'past' mode keeps spoken words lit.
    const p = build([jsx(Captions, { id: 'k', words: WORDS, style: 'karaoke' })]);
    const pa = exprOf(layer(p, 'k.cue1'), amount('Karaoke'))!;
    expect(run(pa, scope(0.8, 1))[0]).toBeCloseTo(100, 5);
    // A word count that no longer matches (the designer retyped the cue) falls back to an even spread.
    expect(run(pa, { ...scope(1.0, 1), textTotal: 2 })[0]).toBeCloseTo(100, 5);
  });
  it('estimated word times warn', () => {
    const r = build([jsx(Captions, { id: 'k', cues: [{ start: 0, end: 3, text: 'No word timing here' }], style: 'karaoke' })]);
    expect(r.warnings.some((w) => /estimated from characters/.test(w))).toBe(true);
  });
  it('boxed: a box per cue, parented to it and sized from its live bounds, below the text', () => {
    const r = build([jsx(Captions, { id: 'b', style: 'boxed', cues: [{ start: 0, end: 2, text: 'In a box' }] })]);
    const box = layer(r, 'b.box1');
    expect(box.parent).toBe('b.cue1');
    const ids = main(r).layers.map((l: any) => l.id);
    expect(ids.indexOf('b.box1')).toBeGreaterThan(ids.indexOf('b.cue1'));
    const rect = box.groups[0].items[0];
    const size = rect.props.find((s: any) => s.p === 'ADBE Vector Rect Size').expr;
    expect(size).toContain('var T = thisComp.layer("Caption 01"), r = T.sourceRectAtTime(T.inPoint, false)');
    const T = { inPoint: 0, sourceRectAtTime: () => ({ left: -100, top: -40, width: 200, height: 50 }) };
    expect(run(size, { time: 1, thisComp: { layer: (n: string) => (n === 'Caption 01' ? T : fxLayer({ 'Box Pad X': 22, 'Box Pad Y': 12 })) } })).toEqual([244, 74]);
  });
  it('karaoke underline: three measuring copies and a bar that follows the current word of the active cue', () => {
    const r = build([jsx(Captions, { id: 'u', words: WORDS, karaoke: { underline: true } })]);
    for (const part of ['line', 'pre', 'word']) {
      const h = layer(r, `u.uline.measure-${part}`);
      expect(h).toMatchObject({ type: 'text', enabled: false, guide: true });
    }
    const ul = layer(r, 'u.uline');
    expect(ul.in).toBe(0.2);
    expect(ul.out).toBeCloseTo(4, 6);
    expect(fxGroup(layer(r, 'u.ctl'))[0]).toBeDefined();
  });
  it('brand colors link live', () => {
    const B = brand({ colors: { white: '#f5f5f5', accent: '#4683c4' }, live: ['accent'] });
    const r = build([jsx(Captions, { id: 'k', words: WORDS, style: 'karaoke', karaoke: { color: B.colors.accent } })]);
    const fx = fxGroup(layer(r, 'k.ctl'))[0];
    expect(JSON.stringify(fx.props)).toContain('Accent Color');
  });
});

describe('<Emphasis>', () => {
  const title = (extra: Record<string, any> = {}) => jsx(Text, { id: 'title', font: 'Inter-Black', size: 120, children: 'MAKE MOTION', ...extra });
  it('a mark parented to the text, three measuring copies, and one Emphasis rig with the resolved word', () => {
    const r = build([jsx(Emphasis, { id: 'em', word: 'motion', kind: 'bar', at: 0.8, color: '#ffd23f', children: title() })]);
    const ids = main(r).layers.map((l: any) => l.id);
    // A bar goes behind the text.
    expect(ids.indexOf('em')).toBeGreaterThan(ids.indexOf('title'));
    const mark = layer(r, 'em');
    expect(mark).toMatchObject({ type: 'shape', parent: 'title', name: 'MAKE MOTION Emphasis' });
    const rig = fxGroup(mark)[0];
    expect(rig.name).toBe('Emphasis');
    expect(rig.mn).toMatch(/^Pseudo\/aec Emphasis /);
    expect(rig.props[0].v).toBe(1); // Word
    for (const part of ['line', 'pre', 'word']) expect(layer(r, `em.measure-${part}`)).toMatchObject({ enabled: false, guide: true, shy: true });
    expect(layer(r, 'em.measure-pre').text).toMatchObject({ font: 'Inter-Black', size: 120, justify: 'center' }); // aligned like the target
  });
  it('the measuring copies pick the target line, the line up to the word, and the word', () => {
    const r = build([jsx(Emphasis, { id: 'em', word: 3, children: title({ children: 'MAKE IT\rMOVE NOW' }) })]);
    const T = { text: { sourceText: { value: 'MAKE IT\rMOVE NOW', style: { setText: (s: string) => ({ styled: s }) } } } };
    const scope = { time: 0, thisComp: { layer: (n: string) => (n === 'MAKE IT MOVE NOW' ? T : fxLayer({ Word: 3 })) } };
    const out = (part: string) => run(exprOf(layer(r, `em.measure-${part}`), SRC)!, scope).styled;
    expect([out('line'), out('pre'), out('word')]).toEqual(['MOVE NOW', 'MOVE NOW', 'NOW']);
    scope.thisComp.layer = (n: string) => (n === 'MAKE IT MOVE NOW' ? T : fxLayer({ Word: 2 }));
    expect([out('line'), out('pre'), out('word')]).toEqual(['MOVE NOW', 'MOVE', 'MOVE']);
  });
  it('the bar spans the measured word (centred text) and draws on from the left', () => {
    const r = build([jsx(Emphasis, { id: 'em', word: 'motion', children: title() })]);
    const rect = layer(r, 'em').groups[0].items[0];
    const sizeX = rect.props.find((s: any) => s.p === 'ADBE Vector Rect Size').expr;
    const posX = rect.props.find((s: any) => s.p === 'ADBE Vector Rect Position').expr;
    // 10 px per character, ink top −80, height 90; the copies are centred like the target.
    const rectOf = (s: string) => ({ left: -s.length * 5, top: -80, width: s.length * 10, height: 90 });
    const parts: Record<string, string> = { 'MAKE MOTION Emphasis measure line': 'MAKE MOTION', 'MAKE MOTION Emphasis measure pre': 'MAKE MOTION', 'MAKE MOTION Emphasis measure word': 'MOTION' };
    const T = { inPoint: 0, outPoint: 6, text: { sourceText: { value: 'MAKE MOTION', style: { fontSize: 120 } } } };
    const vals = { Word: 1, Start: 0.6, Draw: 0.45, Out: 0, 'Pad X': 14, 'Pad Y': 6 };
    const scope = (time: number) => ({ time, effect: () => (p: string) => ({ value: (vals as any)[p] }), thisComp: { layer: (n: string) => (n === 'MAKE MOTION' ? T : parts[n] !== undefined ? { sourceRectAtTime: () => rectOf(parts[n]) } : fxLayer(vals)) } });
    // Line 110 px centred → starts at −55; the word "MOTION" (60 px) ends at +55: x0 = −5, x1 = 55.
    expect(run(sizeX, scope(3))).toEqual([88, 102]);
    expect(run(posX, scope(3))).toEqual([25, -35]);
    expect(run(sizeX, scope(0.5))[0]).toBe(0); // before Start
  });
  it('a word pop: color and scale punch on the chosen word only', () => {
    const r = build([jsx(Emphasis, { id: 'em', word: 'MOTION', kind: 'underline', wordColor: '#ff3366', scale: 106, children: title() })]);
    const t = layer(r, 'title');
    expect(animators(t).map((a: any) => a.name)).toEqual(['Emphasis']);
    const a = exprOf(t, amount('Emphasis'))!;
    const scope = (textIndex: number, time: number) => ({ time, inPoint: 0, outPoint: 6, textIndex, thisComp: { layer: () => fxLayer({ Word: 1, Start: 0.6, Pop: 0.18, Out: 0 }) } });
    expect(run(a, scope(2, 2))[0]).toBeCloseTo(100, 5);
    expect(run(a, scope(1, 2))[0]).toBe(0);
    expect(run(a, scope(2, 0.5))[0]).toBe(0);
    const s = exprOf(t, 'ADBE Text Properties/ADBE Text Animators/Emphasis/ADBE Text Animator Properties/ADBE Text Scale 3D')!;
    expect(run(s, { time: 5, inPoint: 0, thisComp: { layer: () => fxLayer({ Start: 0.6, Scale: 106, Punch: 118 }), frameDuration: 1 / 30 } })[0]).toBeCloseTo(106, 1);
    // underline/box/circle marks sit above the text
    const ids = main(r).layers.map((l: any) => l.id);
    expect(ids.indexOf('em')).toBeLessThan(ids.indexOf('title'));
  });
  it('emphasize() keeps the text a single layout leaf', () => {
    const e = emphasize(title(), { id: 'em', word: 0, kind: 'circle' });
    const r = build([e.marks, jsx(Stack, { children: [e.text, jsx(Text, { id: 'sub', children: 'sub' })] })]);
    const lay = main(r).layouts[0].root;
    expect(lay.children.map((c: any) => c.id)).toEqual(['title', 'sub']);
    expect(layer(r, 'em').parent).toBe('title');
  });
  it('errors say what to change', () => {
    expect(() => build([jsx(Emphasis, { id: 'em', word: 'nope', children: title() })])).toThrow(/no word "nope".*words: MAKE, MOTION/);
    expect(() => build([jsx(Emphasis, { id: 'em', word: 5, children: title() })])).toThrow(/out of range/);
    expect(() => build([jsx(Emphasis, { id: 'em', word: 0, children: jsx(Text, { children: 'x' }) })])).toThrow(/needs an id/);
    expect(() => build([jsx(Emphasis, { id: 'em', word: 0, children: title({ box: { width: 400 } }) })])).toThrow(/box \(paragraph\) text/);
  });
});

describe('text effects', () => {
  it('Decode: keyed Progress on the Decode rig; the scramble keeps line breaks and resolves left to right', () => {
    const r = build([jsx(Decode, { id: 'd', font: 'Inter-Bold', size: 90, duration: 1, delay: 0.5, children: 'AB\rCD' })]);
    const L = layer(r, 'd');
    const rig = fxGroup(L)[0];
    expect(rig.name).toBe('Decode');
    const prog = rig.props[0];
    expect(prog.keys[0]).toMatchObject({ t: 0.5, v: 0 });
    expect(prog.keys[prog.keys.length - 1]).toMatchObject({ t: 1.5, v: 100 });
    const code = exprOf(L, SRC)!;
    expect(code).toContain('L.scramble(');
    const at = (progress: number) => run(code, { time: 1, value: 'AB\rCD', effect: () => (p: string) => ({ value: ({ Progress: progress, Rate: 20, Seed: 1 } as any)[p] }) });
    expect(at(100)).toBe('AB\rCD');
    const half = at(50).split('\r');
    expect(half[0]).toBe('AB');
    expect(half[1]).toHaveLength(2);
    expect(half[1]).not.toBe('CD');
  });
  it('Typewriter: humanized hold keys (or even), L.typed with a caret', () => {
    const r = build([jsx(Typewriter, { id: 't', cps: 10, children: 'Hello, world.' })]);
    const L = layer(r, 't');
    expect(L.text.justify).toBe('left');
    const prog = fxGroup(L)[0].props[0];
    expect(prog.keys).toHaveLength(14);
    expect(prog.keys[prog.keys.length - 1].v).toBe(100);
    const code = exprOf(L, SRC)!;
    const at = (p: number, time = 0) => run(code, { time, value: 'Hello', effect: () => (q: string) => ({ value: ({ Progress: p, Blink: 2, 'Show Caret': 1 } as any)[q] }) });
    expect(at(40)).toBe('He|');
    expect(at(100, 0)).toBe('Hello|');
    expect(at(100, 0.3)).toBe('Hello');
    const even = typingProgress('abcdef', { cps: 6, humanize: 0 });
    expect(even).toMatchObject({ $anim: 'tween', from: 0, to: 100, duration: 1 });
  });
  it('SplitFlap: roll and flip animators on characters excluding spaces, per-character 3D, live Split Flap rig', () => {
    const r = build([jsx(SplitFlap, { id: 's', flips: 6, children: 'GATE 12' })]);
    const L = layer(r, 's');
    expect(L.threeDPerChar).toBe(true);
    const an = animators(L);
    expect(an.map((a: any) => a.name)).toEqual(['Flap Roll', 'Flap Flip']);
    const based = an[0].kids.find((k: any) => k.at === 'ADBE Text Selectors').items[0].props.find((p: any) => p.p === 'ADBE Text Range Type2');
    expect(based.v).toBe(2);
    const roll = exprOf(L, amount('Flap Roll'))!, flip = exprOf(L, amount('Flap Flip'))!;
    const scope = (time: number) => ({ time, inPoint: 0, textIndex: 1, effect: () => (p: string) => ({ value: ({ Flips: 6, Each: 0.05, Duration: 1, Delay: 0 } as any)[p] }) });
    const steps = [0, 0.2, 0.5, 0.99, 1.2].map((t) => Math.round(run(roll, scope(t))[0] * 6 / 100));
    expect(steps[0]).toBe(6);
    expect(steps[4]).toBe(0);
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeLessThanOrEqual(steps[i - 1]);
    expect(run(flip, scope(1.2))[0]).toBe(0);
    expect(exprOf(L, 'ADBE Text Properties/ADBE Text Animators/Flap Roll/ADBE Text Animator Properties/ADBE Text Character Offset')).toContain('"Flips"');
  });
  it('VariableFont: the Weight slider steps through the PostScript names', () => {
    const fonts = ['Inter-Regular', 'Inter-Medium', 'Inter-SemiBold', 'Inter-Bold', 'Inter-Black'];
    const r = build([jsx(VariableFont, { id: 'v', fonts, duration: 2, children: 'WEIGHT' })]);
    const L = layer(r, 'v');
    expect(L.text.font).toBe('Inter-Regular');
    const code = exprOf(L, SRC)!;
    const pick = (w: number) => { let got = ''; run(code, { effect: () => () => ({ value: w }), style: { setFont: (f: string) => (got = f) } }); return got; };
    expect([pick(0), pick(50), pick(100)]).toEqual(['Inter-Regular', 'Inter-SemiBold', 'Inter-Black']);
    const w = fxGroup(L)[0].props[0];
    expect(w.keys[w.keys.length - 1]).toMatchObject({ t: 2, v: 100 });
    expect(() => build([jsx(VariableFont, { id: 'v', fonts: [], children: 'x' })])).toThrow(/fonts/);
  });
  it('AutoFit: balanced lines at the largest size that fits, plus a live shrink-to-box scale', () => {
    const text = 'Native motion graphics written in code and fully editable';
    const fit = autoFitLines(text, { width: 800, height: 320, size: 120, font: 'Inter-Black' });
    expect(fit.fits).toBe(true);
    expect(fit.size).toBeLessThan(120);
    expect(fit.lines.join(' ')).toBe(text);
    const widths = fit.lines.map((l) => l.length);
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(14); // balanced
    const r = build([jsx(AutoFit, { id: 'a', font: 'Inter-Black', size: 120, fit: { width: 800, height: 320 }, children: text })]);
    const L = layer(r, 'a');
    expect(L.text.text).toBe(fit.lines.join('\r'));
    expect(L.text.size).toBe(fit.size);
    const sc = exprOf(L, 'ADBE Transform Group/ADBE Scale')!;
    const k = run(sc, { value: [100, 100], inPoint: 0, outPoint: 4, effect: () => (p: string) => ({ value: ({ Width: 800, Height: 320, 'Max Scale': 100, 'Measure At': -1 } as any)[p] }), sourceRectAtTime: () => ({ width: 1000, height: 200 }) });
    expect(k).toEqual([80, 80]);
    const tiny = build([jsx(AutoFit, { id: 'a', size: 120, minSize: 100, fit: { width: 200, height: 100 }, children: text })]);
    expect(tiny.warnings.some((w) => /doesn't fit/.test(w))).toBe(true);
  });
});
