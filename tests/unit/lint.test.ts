import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { formatIssues, lintRules } from '../../src/lint/index.ts';
import type { LintData, LintText } from '../../src/lint/index.ts';
import { blankFrames } from '../../src/lint/frames.ts';
import { lintSettings } from '../../src/api/lint.ts';

// 6 s at a 0.1 s step. A text is described by a function of time → [opacity, x0, y0, x1, y1] or null.
const STEP = 0.1;
const TIMES = Array.from({ length: 60 }, (_, i) => Math.round(i * STEP * 10) / 10);
type Shape = (t: number) => [number, number, number, number, number] | null;
const quad = (op: number, x0: number, y0: number, x1: number, y1: number) => [op, x0, y0, x1, y0, x1, y1, x0, y1];
function text(path: string, words: number, shape: Shape, extra: Partial<LintText> = {}): LintText {
  return { path, name: path, text: path, words, in: 0, out: 6, s: TIMES.map((t) => { const v = shape(t); return v ? quad(...v) : null; }), ...extra };
}
const data = (texts: LintText[], linear: LintData['linear'] = []): LintData => ({ ok: true, comp: 'Test', w: 1920, h: 1080, fps: 30, dur: 6, step: STEP, times: TIMES, texts, linear });
/** On screen and still from a to b (seconds), at a box. */
const still = (a: number, b: number, box: [number, number, number, number], op = 100): Shape => (t) => (t >= a - 1e-9 && t < b - 1e-9 ? [op, ...box] : null);
const CENTER: [number, number, number, number] = [700, 480, 1220, 600];
const rules = (d: LintData, o = {}) => lintRules(d, o).map((i) => i.rule);

describe('lint: reading time', () => {
  it('warns when a text is not on screen long enough for its words', () => {
    const issues = lintRules(data([text('Real layers. Eased keyframes. Live controls.', 6, still(2, 2.6, CENTER))]));
    const r = issues.find((i) => i.rule === 'reading-time')!;
    expect(r).toBeDefined();
    expect(r.message).toMatch(/readable for 0\.6 s/);
    expect(r.message).toMatch(/6 words need about 2\.2 s/);
    expect(r.t).toEqual([2, 2.5]);
  });
  it('passes a text that holds long enough', () => {
    expect(rules(data([text('Hold', 6, still(1, 4, CENTER))]))).not.toContain('reading-time');
  });
  it('does not count the fast entrance as reading time', () => {
    // Slides in from the left at 2400 px/s for 0.5 s, then holds 0.7 s: 2 words need 1.07 s.
    const shape: Shape = (t) => (t < 1 ? null : t < 1.5 ? [100, 700 - (1.5 - t) * 2400, 480, 1220 - (1.5 - t) * 2400, 600] : t < 2.2 ? [100, ...CENTER] : null);
    const r = lintRules(data([text('MAKE IT', 2, shape)])).find((i) => i.rule === 'reading-time');
    expect(r?.message).toMatch(/readable for 0\.7 s/);
  });
  it('uses the reading rate option', () => {
    const t = text('x', 6, still(2, 3.5, CENTER));
    expect(rules(data([t]))).toContain('reading-time');
    expect(rules(data([t]), { readingRate: 10 })).not.toContain('reading-time');
  });
});

describe('lint: frame edges and safe area', () => {
  it('flags text cut off by the frame at rest', () => {
    const r = lintRules(data([text('WIDE', 1, still(0, 3, [1500, 400, 2000, 600]))])).find((i) => i.rule === 'off-frame')!;
    expect(r.message).toMatch(/right by 80 px/);
  });
  it('ignores entrances from off-screen', () => {
    const shape: Shape = (t) => (t < 0.5 ? [100, 2000 - t * 2400, 480, 2500 - t * 2400, 600] : [100, 800, 480, 1300, 600]);
    expect(rules(data([text('IN', 1, shape)]))).not.toContain('off-frame');
  });
  it('flags text outside action-safe, or title-safe when asked', () => {
    const t = text('EDGE', 1, still(0, 3, [60, 480, 600, 600]));
    expect(lintRules(data([t])).find((i) => i.rule === 'safe-area')?.message).toMatch(/action-safe area \(left by 36 px\)/);
    const t2 = text('EDGE', 1, still(0, 3, [130, 480, 600, 600]));
    expect(rules(data([t2]))).not.toContain('safe-area');
    expect(lintRules(data([t2]), { safe: 'title' }).find((i) => i.rule === 'safe-area')?.message).toMatch(/title-safe area \(left by 62 px\)/);
  });
});

describe('lint: overlaps, overflow, fonts, motion', () => {
  it('flags two texts on top of each other for a while, not a brief crossing', () => {
    const a = text('A', 1, still(0, 3, CENTER)), b = text('B', 1, still(1, 2, [900, 500, 1400, 620]));
    const r = lintRules(data([a, b])).find((i) => i.rule === 'overlap')!;
    expect(r.layers).toEqual(['A', 'B']);
    expect(r.t).toEqual([1, 1.9]);
    const c = text('C', 1, still(2.8, 3.0, [900, 500, 1400, 620]));
    expect(rules(data([a, c]))).not.toContain('overlap');
  });
  it('reports box overflow and groups missing fonts', () => {
    const t1 = text('Body', 3, still(0, 3, CENTER), { box: true, overflow: true, substitute: true, font: 'Fancy-Bold' });
    const t2 = text('Title', 1, still(0, 3, [700, 100, 1200, 200]), { substitute: true, font: 'Fancy-Bold' });
    const issues = lintRules(data([t1, t2]));
    expect(issues.filter((i) => i.rule === 'overflow')).toHaveLength(1);
    const f = issues.filter((i) => i.rule === 'missing-font');
    expect(f).toHaveLength(1);
    expect(f[0].layers).toEqual(['Body', 'Title']);
  });
  it('notes linear-only moves and honours ignore', () => {
    const d = data([], [{ layer: 'Logo', prop: 'Position', segments: 2, t: [0, 2] }]);
    expect(lintRules(d)[0]).toMatchObject({ rule: 'linear-motion', severity: 'info' });
    expect(lintRules(d, { ignore: ['linear-motion'] })).toHaveLength(0);
  });
  it('formats warnings before notes', () => {
    const d = data([text('Real layers. Eased keyframes.', 4, still(2, 2.4, CENTER))], [{ layer: 'Logo', prop: 'Position', segments: 1, t: [0, 1] }]);
    const lines = formatIssues(lintRules(d));
    expect(lines[0]).toMatch(/^warn \[reading-time\]/);
    expect(lines[lines.length - 1]).toMatch(/^note \[linear-motion\]/);
  });
});

describe('lint settings', () => {
  it('merges scene and call options, and false disables', () => {
    expect(lintSettings({ safe: 'title', ignore: ['overlap'] }, { ignore: ['reading-time'] })).toEqual({ safe: 'title', ignore: ['overlap', 'reading-time'] });
    expect(lintSettings({ safe: 'title' }, false)).toBe(false);
    expect(lintSettings(undefined, true)).toEqual({});
    expect(() => lintSettings({ ignore: ['nope' as any] })).toThrow(/unknown lint rule "nope"/);
  });
});

describe('lint: blank frames', () => {
  it('flags empty frames in the middle, not at the ends', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aec-lint-'));
    const flat = async (name: string) => { const f = path.join(dir, name); await sharp({ create: { width: 640, height: 360, channels: 3, background: '#101318' } }).png().toFile(f); return f; };
    const withText = async (name: string) => {
      const f = path.join(dir, name);
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#101318"/><text x="200" y="190" font-size="48" font-family="Arial" fill="#ffffff">TITLE</text></svg>');
      await sharp(svg).png().toFile(f);
      return f;
    };
    const frames = [
      { t: 0, file: await flat('a.png') }, { t: 1, file: await withText('b.png') }, { t: 2, file: await flat('c.png') },
      { t: 3, file: await flat('d.png') }, { t: 4, file: await withText('e.png') }, { t: 5, file: await flat('f.png') },
    ];
    const issues = await blankFrames(frames, 8);
    expect(issues).toHaveLength(1);
    expect(issues[0].t).toEqual([2, 3]);
    expect(issues[0].message).toMatch(/from 2\.0s to 3\.0s/);
  });
});
