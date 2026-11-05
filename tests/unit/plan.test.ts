// Storyboard first (A3): beat sheet → timeline, every plan rule (positive and negative), the style rules on the
// planned timing, and the scaffold compiling with the real compiler.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildTimeline, checkPlan, planScene, planStyleIssues, validateSheet, verifyScaffold, TRANSITION_KINDS } from '../../src/plan/index.ts';
import type { Beat, BeatSheet, PlanIssue } from '../../src/plan/index.ts';
import { planSceneTool } from '../../src/plan/tool.ts';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aec-plan-'));
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

const good = (): BeatSheet => ({
  name: 'Launch', message: 'Controllers you design yourself.',
  beats: [
    { name: 'Hook', purpose: 'stop the scroll with a bold claim', duration: 3.0, text: 'MAKE IT YOURS' },
    { name: 'Problem', purpose: 'every controller is the same', duration: 4.6, text: ['SAME PAD FOR ALL', 'Nobody plays the same way'], visual: 'a wall of identical controllers', transitionIn: 'shape-wipe' },
    { name: 'Payoff', purpose: 'you pick every part', duration: 3.8, text: ['PICK EVERY PART', 'Shells, buttons, sticks'], transitionIn: 'zoom-through' },
  ],
  end: { text: 'Design yours today', transitionIn: 'hand-off' },
});
const plan = (s: BeatSheet) => buildTimeline(s).timeline;
const issues = (s: BeatSheet): PlanIssue[] => checkPlan(s, plan(s));
const rules = (s: BeatSheet) => issues(s).map((i) => i.rule);
const withBeat = (patch: Partial<Beat>, i = 1) => { const s = good(); s.beats[i] = { ...s.beats[i], ...patch }; return s; };

describe('timeline', () => {
  it('beats overlap by 0.3 s by default, cuts by 0, and the end card is sized to its hold', () => {
    const t = plan(good());
    expect(t.beats.map((b) => b.name)).toEqual(['Hook', 'Problem', 'Payoff', 'End Card']);
    expect(t.beats[1].start).toBeCloseTo(2.7);
    expect(t.beats[1].overlap).toBe(0.3);
    const end = t.beats[3];
    const landed = Math.max(...end.elements.map((e) => e.arrive[1]));
    expect(end.end - landed).toBeGreaterThanOrEqual(2.5 - 1e-6);
    expect(t.duration).toBeCloseTo(end.end);
    const cut = plan(withBeat({ transitionIn: 'cut' }));
    expect(cut.beats[1].overlap).toBe(0);
    expect(cut.beats[0].exits).toBe(false); // a hard cut needs no exit
  });
  it('exits are anchored before the beat end; the final beat and holdTo:end hold', () => {
    const t = plan(good());
    const title = t.beats[1].elements.find((e) => e.role === 'title')!;
    expect(title.leave![0]).toBeCloseTo(t.beats[1].end - t.exitLead);
    expect(t.beats[3].exits).toBe(false);
    expect(plan(withBeat({ holdTo: 'end' })).beats[1].exits).toBe(false);
  });
  it('a visual leads and the title follows; sublines come in as the title settles', () => {
    const els = plan(good()).beats[1].elements;
    const [v, ti, sub] = ['visual', 'title', 'sub'].map((r) => els.find((e) => e.role === r)!);
    expect(ti.arrive[0]).toBeGreaterThan(v.arrive[0]);
    expect(sub.arrive[0]).toBeGreaterThan(ti.arrive[0]);
    expect(sub.arrive[0]).toBeLessThan(ti.arrive[1]);
  });
  it('format shorthand sets the canvas and the type scale', () => {
    const v = plan({ ...good(), format: '9:16' });
    expect([v.width, v.height]).toEqual([1080, 1920]);
    const sq = plan({ ...good(), format: '1:1' });
    expect([sq.width, sq.height]).toEqual([1080, 1080]);
    const t16 = plan(good()).beats[0].elements[0].size!, t1 = sq.beats[0].elements[0].size!;
    expect(t1).toBeLessThan(t16);
  });
  it('rejects malformed sheets with every problem listed', () => {
    expect(() => validateSheet({ name: '', message: 'x', beats: [{ name: 'A', purpose: 'p', duration: -1 }] } as any)).toThrow(/name: a scene name[\s\S]*duration: seconds > 0/);
    expect(() => validateSheet({ name: 'X', message: 'x', beats: [] } as any)).toThrow(/at least one beat/);
  });
});

describe('plan rules', () => {
  it('a well-formed plan is clean (warnings)', () => {
    const r = planScene(good());
    expect(r.issues.filter((i) => i.severity === 'warn')).toEqual([]);
  });
  it('purpose', () => {
    expect(rules(withBeat({ purpose: '' }))).toContain('purpose');
    expect(rules(good())).not.toContain('purpose');
  });
  it('empty-beat', () => {
    expect(rules(withBeat({ text: undefined, visual: undefined }))).toContain('empty-beat');
    expect(rules(withBeat({ text: undefined }))).not.toContain('empty-beat');
  });
  it('duplicate-beat', () => {
    expect(rules(withBeat({ name: 'hook' }))).toContain('duplicate-beat');
    expect(rules(good())).not.toContain('duplicate-beat');
  });
  it('hook: nothing in the first second, a long opening line', () => {
    const empty = withBeat({ text: undefined, visual: undefined }, 0);
    expect(issues(empty).find((i) => i.rule === 'hook')?.severity).toBe('warn');
    const long = withBeat({ text: 'WE BUILT A CONTROLLER THAT YOU CAN DESIGN YOURSELF', duration: 6 }, 0);
    expect(issues(long).find((i) => i.rule === 'hook')?.severity).toBe('info');
    expect(rules(good())).not.toContain('hook');
  });
  it('reading-time: a beat too short for its copy, with the length it needs', () => {
    const r = issues(withBeat({ duration: 2.4 }));
    const rt = r.filter((i) => i.rule === 'reading-time');
    expect(rt.length).toBeGreaterThan(0);
    expect(rt[0].beat).toBe('Problem');
    expect(rt[0].message).toMatch(/make the beat at least \d+\.\d s/);
    expect(rules(good())).not.toContain('reading-time');
  });
  it('reading-time fix is exact: applying the suggested length clears it', () => {
    const s = withBeat({ duration: 2.4 });
    const need = Math.max(...issues(s).filter((i) => i.rule === 'reading-time' && i.beat === 'Problem').map((i) => +/at least (\d+\.\d) s/.exec(i.message)![1]));
    expect(issues(withBeat({ duration: need })).filter((i) => i.rule === 'reading-time' && i.beat === 'Problem')).toEqual([]);
  });
  it('hold: a requested hold that does not fit, or is shorter than the reading time', () => {
    expect(rules(withBeat({ hold: 4 }))).toContain('hold');
    expect(issues(withBeat({ hold: 0.5 })).some((i) => i.rule === 'hold' && /shorter than/.test(i.message))).toBe(true);
    expect(rules(withBeat({ hold: 2 }))).not.toContain('hold');
  });
  it('final-hold: last beat or end card shorter than 2 s', () => {
    const noEnd = good(); delete noEnd.end; noEnd.beats[2].duration = 2.6;
    expect(rules(noEnd)).toContain('final-hold');
    noEnd.beats[2].duration = 4.5;
    expect(rules(noEnd)).not.toContain('final-hold');
    const shortEnd = good(); shortEnd.end!.hold = 1.2;
    expect(rules(shortEnd)).toContain('final-hold');
    expect(rules(good())).not.toContain('final-hold');
  });
  it('transition-repeat: the same kind twice in a row', () => {
    const s = withBeat({ transitionIn: 'shape-wipe' }, 2);
    const r = issues(s).find((i) => i.rule === 'transition-repeat');
    expect(r?.severity).toBe('warn');
    expect(r?.beat).toBe('Payoff');
    expect(rules(good())).not.toContain('transition-repeat');
  });
  it('transition-kind: unknown kinds and missing transitions are notes', () => {
    expect(issues(withBeat({ transitionIn: 'star-wipe' })).some((i) => i.rule === 'transition-kind' && /not a known kind/.test(i.message))).toBe(true);
    expect(issues(withBeat({ transitionIn: undefined })).some((i) => i.rule === 'transition-kind' && /no transitionIn/.test(i.message))).toBe(true);
    expect(rules(good())).not.toContain('transition-kind');
  });
  it('overlap: outside 0.2–0.4 s, gaps, and hard cuts', () => {
    expect(rules(withBeat({ overlap: 0.6 }))).toContain('overlap');
    expect(rules(withBeat({ overlap: 0.05 }))).toContain('overlap');
    expect(issues(withBeat({ overlap: -0.5 })).find((i) => i.rule === 'overlap')?.message).toMatch(/dead air/);
    expect(rules(withBeat({ transitionIn: 'cut' }))).not.toContain('overlap');
    expect(issues(withBeat({ transitionIn: 'cut', overlap: 0.3 })).find((i) => i.rule === 'overlap')?.severity).toBe('info');
    expect(rules(good())).not.toContain('overlap');
  });
  it('one-idea: too many lines or a paragraph headline', () => {
    expect(rules(withBeat({ text: ['ONE', 'two', 'three'] }))).toContain('one-idea');
    expect(rules(withBeat({ text: 'this headline has far too many words to be one single idea on screen', duration: 9 }))).toContain('one-idea');
    expect(rules(good())).not.toContain('one-idea');
  });
  it('slide-furniture: page numbers, section labels, the beat name as text', () => {
    expect(rules(withBeat({ text: ['01 / 04', 'Nobody plays the same way'] }))).toContain('slide-furniture');
    expect(rules(withBeat({ text: 'Chapter 2' }))).toContain('slide-furniture');
    expect(rules(withBeat({ text: 'Problem' }))).toContain('slide-furniture');
    const end = good(); end.end!.text = 'Thank you';
    expect(rules(end)).toContain('slide-furniture');
    expect(rules(good())).not.toContain('slide-furniture');
  });
  it('pacing: every beat the same length', () => {
    const s = good(); s.beats.forEach((b) => (b.duration = 4));
    expect(rules(s)).toContain('pacing');
    expect(rules(good())).not.toContain('pacing');
  });
  it('style rules on the planned timing: dead air from a gap, none on a clean plan', () => {
    expect(planStyleIssues(plan(good()))).toEqual([]);
    const gap = withBeat({ overlap: -1.2 });
    expect(planStyleIssues(plan(gap)).map((i) => i.rule)).toContain('dead-air');
    // planScene reports the gap once (the overlap rule), not twice
    const r = planScene(gap).issues;
    expect(r.filter((i) => i.rule === 'overlap' && /dead air/.test(i.message))).toHaveLength(1);
    expect(r.filter((i) => i.rule === 'dead-air')).toHaveLength(0);
  });
  it('style rules: a visual that leaves right after it lands (short-hold)', () => {
    const s = withBeat({ text: undefined, visual: 'a flash of the product', duration: 1.5 });
    expect(planStyleIssues(plan(s)).map((i) => i.rule)).toContain('short-hold');
  });
  it('missing files are warnings, not failures', () => {
    const s = good(); s.brand = 'nope/brand.ts'; s.end!.logo = 'nope/logo.svg'; s.music = 'nope/track.mp3';
    expect(planScene(s).issues.filter((i) => i.rule === 'missing-file')).toHaveLength(3);
  });
});

describe('scaffold', () => {
  it('compiles: named beats become scene markers, placeholders, controls, transition tags', async () => {
    const file = path.join(TMP, 'launch.tsx');
    const r = planScene(good(), { file });
    expect(r.file).toBe(file);
    expect(fs.readFileSync(file, 'utf8')).toBe(r.tsx);
    expect(r.tsx).toMatch(/<Series\.Sequence name="Problem" duration=\{T\.problem\} offset=\{-O\.problem\}>/);
    expect(r.tsx).toMatch(/Purpose: every controller is the same/);
    expect(r.tsx).toMatch(/TODO visual: a wall of identical controllers/);
    expect(r.tsx).toMatch(/function ShapeWipe/);
    expect(r.tsx).toMatch(/anchor: 'end', direction: 'out'/);
    const c = await verifyScaffold({ file });
    expect(c.error).toBeUndefined();
    expect(c.ok).toBe(true);
    expect(c.scenes).toEqual(['Hook', 'Problem', 'Payoff', 'End Card']);
    const { loadScene } = await import('../../src/scene/load.ts');
    const { compileScene } = await import('../../src/compile/compile.ts');
    const { def } = await loadScene({ file });
    const ir = compileScene(def, { sceneFile: file }).ir;
    const main = ir.comps.find((x: any) => x.id === ir.main);
    expect(main.dur).toBeCloseTo(r.timeline.duration, 1);
    const ids = main.layers.map((L: any) => L.id);
    for (const id of ['hook-title', 'problem-title', 'problem-sub', 'problem-visual', 'payoff-title', 'end-logo', 'end-cta']) expect(ids.some((x: string) => x.endsWith(id))).toBe(true);
    const controls = main.layers.find((L: any) => /\.controls$/.test(L.id)).groups[0].items.map((x: any) => x.name);
    expect(controls).toEqual(expect.arrayContaining(['Accent Color', 'Title Delay', 'Word Stagger', 'Exit Lead']));
    expect(main.layers.filter((L: any) => (L.tags ?? []).some((t: string) => t.startsWith('transition:'))).length).toBeGreaterThanOrEqual(3);
  }, 30_000);
  it('refuses to overwrite unless asked', () => {
    const file = path.join(TMP, 'twice.tsx');
    planScene(good(), { file });
    expect(() => planScene(good(), { file })).toThrow(/exists/);
    expect(() => planScene(good(), { file, overwrite: true })).not.toThrow();
  });
  it('every transition kind (and an unknown one) builds', async () => {
    const kinds = [...TRANSITION_KINDS, 'star-wipe'];
    const s: BeatSheet = { name: 'Kinds', message: 'all transitions', beats: kinds.map((k, i) => ({ name: `Beat ${i + 1}`, purpose: `shows ${k}`, duration: 3, text: `WORD ${i + 1}`, transitionIn: i ? k : undefined })) };
    s.beats.push({ name: 'Last', purpose: 'closes', duration: 3, text: 'DONE', transitionIn: 'shape-wipe' });
    const file = path.join(TMP, 'kinds.tsx');
    planScene(s, { file });
    const c = await verifyScaffold({ file });
    expect(c.error).toBeUndefined();
    expect(c.scenes).toHaveLength(s.beats.length);
  }, 30_000);
  it('brand tokens, a real logo and a vertical canvas', async () => {
    const s = good();
    s.width = 1080; s.height = 1920; s.brand = 'examples/brand.ts'; s.end!.logo = 'recipes/logo-reveal/assets/mark.svg';
    const file = path.join(TMP, 'vertical', 'launch.tsx');
    const r = planScene(s, { file, cwd: process.cwd() });
    expect(r.tsx).toMatch(/import \{ BRAND \} from '.*examples\/brand\.ts'/);
    expect(r.tsx).toMatch(/BRAND\.value\('ink'\)/);
    expect(r.tsx).toMatch(/<SafeArea kind="title">/);
    expect(r.tsx).toMatch(/<Svg id="end-logo"/);
    const c = await verifyScaffold({ file });
    expect(c.error).toBeUndefined();
  }, 30_000);
  it('the plan_scene tool handler returns the report and the TSX inline', async () => {
    const out = await planSceneTool({ ...good() } as any);
    expect(out).toMatch(/plan "Launch": 4 beats/);
    expect(out).toMatch(/scaffold compiles/);
    expect(out).toMatch(/```tsx/);
  }, 30_000);
});
