import { describe, expect, it } from 'vitest';
import { foldTextReveals, motionReport, tagFromIr } from '../../src/api/motion.ts';
import type { MotionData } from '../../src/motion/types.ts';
import type { LintData } from '../../src/lint/index.ts';

const times = Array.from({ length: 60 }, (_, i) => i / 15);
const still = (x: number, y: number) => times.map(() => [x, y, 100, 100, 0, 100]);
const base = (): MotionData => ({ comp: 'T', w: 1920, h: 1080, fps: 30, dur: 4, step: 1 / 15, times, scenes: [], layers: [
  { name: 'BG', kind: 'solid', in: 0, out: 4, s: still(960, 540) },
  { name: 'HELLO WORLD', id: 'title', kind: 'text', in: 0, out: 4, s: still(960, 540) },
] });

describe('motion report helpers (A1/A2/A5)', () => {
  it('folds per-unit text reveals into the text layer opacity', () => {
    const lint: LintData = { ok: true, comp: 'T', w: 1920, h: 1080, fps: 30, dur: 4, step: 0.1, times: [], linear: [], texts: [
      { path: 'HELLO WORLD', name: 'HELLO WORLD', in: 0, out: 4, lin: 0, lout: 4, s: [], units: { char: 11, charNoSpaces: 10, word: 2, line: 1, firstWord: 5 },
        anims: [{ by: 'word', dir: 'in', anchor: 'start', order: 'start', off: 0, each: 0.2, dur: 0.5, delay: 1, bezier: [0.33, 1, 0.68, 1] }] },
    ] };
    const d = foldTextReveals(base(), lint);
    const op = (t: number) => d.layers[1].s[times.findIndex((x) => x >= t)]![5];
    expect(op(0.5)).toBe(0);
    expect(op(1.3)).toBeGreaterThan(0);
    expect(op(1.3)).toBeLessThan(100);
    expect(op(3)).toBeCloseTo(100, 0);
    expect(d.layers[1].tags).toContain('text-reveal');
  });
  it('adds IR tags by layer id', () => {
    const d = tagFromIr(base(), { comps: [{ layers: [{ id: 'title', tags: ['hero'] }] }] });
    expect(d.layers[1].tags).toEqual(['hero']);
  });
  it('flags cuts just off the beat grid (off-beat) and not cuts on it', async () => {
    const d = base();
    d.beats = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0];
    d.layers.push({ name: 'Late', kind: 'shape', in: 1.08, out: 4, s: times.map((t) => (t >= 1.08 ? [500, 500, 100, 100, 0, 100] : null)) });
    d.layers.push({ name: 'OnBeat', kind: 'shape', in: 2.0, out: 4, s: times.map((t) => (t >= 2 ? [700, 500, 100, 100, 0, 100] : null)) });
    const r = await motionReport({ ...d, ok: true }, { graph: false });
    const off = r.style.filter((i) => i.rule === 'off-beat');
    expect(off.map((i) => i.layer)).toEqual(['"Late" enters']);
    expect(off[0].message).toMatch(/80 ms after the beat at 1.00s/);
    const quiet = await motionReport({ ...d, ok: true }, { graph: false, style: { ignore: ['off-beat'] } });
    expect(quiet.style.some((i) => i.rule === 'off-beat')).toBe(false);
  });
});
