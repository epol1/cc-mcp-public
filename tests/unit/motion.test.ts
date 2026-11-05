import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { resolveEasing } from '../../src/shared/easing.ts';
import { springProgress } from '../../src/shared/spring.ts';
import { analyzeMotion, classifyProgress, gif, motionStrip, motionSummary, realtimeFps, speedGraph, speedGraphSvg } from '@cc-mcp/core/motion/index.ts';
import type { MotionData, MotionLayer } from '@cc-mcp/core/motion/index.ts';

// Synthetic samples: a layer is a function of time → [x, y, scaleX, scaleY, rotation, opacity] or null (inactive).
type Pose = [number, number, number, number, number, number];
const timesFor = (dur: number, step: number) => Array.from({ length: Math.round(dur / step) }, (_, i) => Math.round(i * step * 1e6) / 1e6);
const fn = (name: string) => resolveEasing(name).fn;
/** Value at t of a tween from a to b over [t0, t1]. */
const tw = (t: number, t0: number, t1: number, a: number, b: number, f: (u: number) => number = fn('easeOutExpo')) =>
  t <= t0 ? a : t >= t1 ? b : a + (b - a) * f((t - t0) / (t1 - t0));

function data(layers: MotionLayer[], o: { dur?: number; step?: number; scenes?: MotionData['scenes'] } = {}): MotionData {
  const dur = o.dur ?? 6, step = o.step ?? 1 / 30;
  return { comp: 'Test', w: 1920, h: 1080, fps: 30, dur, step, times: timesFor(dur, step), layers, scenes: o.scenes ?? [] };
}
function layer(name: string, times: number[], pose: (t: number) => Pose | null, extra: Partial<MotionLayer> = {}, size?: [number, number]): MotionLayer {
  const s = times.map(pose);
  const b = size ? s.map((v) => (v ? [v[0] - (size[0] / 2) * (v[2] / 100), v[1] - (size[1] / 2) * (v[3] / 100), v[0] + (size[0] / 2) * (v[2] / 100), v[1] + (size[1] / 2) * (v[3] / 100)] : null)) : undefined;
  return { name, kind: 'shape', in: 0, out: times[times.length - 1] + (times[1] - times[0]), s, b, ...extra };
}
/** Slides in from the left by `dx` (and fades in), holds, slides out to the right (and fades out). */
function card(name: string, times: number[], o: { t0: number; arrive: number; hold: number; leave: number; x?: number; y?: number; dx?: number; inEase?: string; outEase?: string }, extra: Partial<MotionLayer> = {}): MotionLayer {
  const x = o.x ?? 960, y = o.y ?? 540, dx = o.dx ?? 600, tIn = o.t0 + o.arrive, tOut = o.hold, end = o.hold + o.leave;
  const fi = fn(o.inEase ?? 'easeOutExpo'), fo = fn(o.outEase ?? 'easeInCubic');
  return layer(name, times, (t) => {
    if (t < o.t0 - 1e-9 || t >= end + 1e-9) return null;
    const px = t < tOut ? tw(t, o.t0, tIn, x - dx, x, fi) : tw(t, tOut, end, x, x + dx, fo);
    const op = t < tOut ? tw(t, o.t0, o.t0 + o.arrive / 2, 0, 100, fn('linear')) : tw(t, tOut + o.leave / 2, end, 100, 0, fn('linear'));
    return [px, y, 100, 100, 0, op];
  }, extra, [300, 120]);
}

describe('motion: easing classes', () => {
  const cases: [string, string][] = [
    ['easeOutExpo', 'ease-out'], ['easeOutCubic', 'ease-out'], ['easeOutQuint', 'ease-out'], ['easeInCubic', 'ease-in'], ['easeInQuart', 'ease-in'],
    ['easeInOutCubic', 'ease-in-out'], ['easeInOutSine', 'ease-in-out'], ['easyEase', 'ease-in-out'], ['linear', 'linear'], ['easeOutBack', 'overshoot'], ['easeInBack', 'anticipate'],
  ];
  for (const step of [1 / 30, 0.1]) {
    it(`classifies sampled presets at a ${step.toFixed(3)} s step`, () => {
      const times = timesFor(3, step);
      const layers = cases.map(([e]) => layer(e, times, (t) => [tw(t, 0.5, 1.2, 200, 1200, fn(e)), 540, 100, 100, 0, 100]));
      const a = analyzeMotion(data(layers, { dur: 3, step }));
      expect(a.layers.map((L) => [L.name, L.moves.map((m) => m.ease)])).toEqual(cases.map(([e, c]) => [e, [c]]));
    });
  }
  it('measures where the peak speed is', () => {
    const times = timesFor(3, 1 / 30);
    const a = analyzeMotion(data([layer('out', times, (t) => [tw(t, 0.5, 1.2, 200, 1200), 540, 100, 100, 0, 100]), layer('in', times, (t) => [tw(t, 0.5, 1.2, 200, 1200, fn('easeInCubic')), 540, 100, 100, 0, 100])], { dur: 3 }));
    expect(a.layers[0].moves[0].peakRatio).toBeLessThan(0.15);
    expect(a.layers[1].moves[0].peakRatio).toBeGreaterThan(0.85);
  });
  it('tells springs that oscillate from one overshoot and from no bounce', () => {
    const times = timesFor(4, 1 / 30);
    const spring = (damping: number, stiffness: number) => { const p = springProgress({ damping, stiffness }, 30); return (t: number) => (t < 0.5 ? 0 : p.fn(t - 0.5)); };
    const mk = (name: string, f: (t: number) => number, extra: Partial<MotionLayer> = {}) => layer(name, times, (t) => [200 + 800 * f(t), 540, 100, 100, 0, 100], extra);
    const a = analyzeMotion(data([
      mk('lively', spring(10, 100)), mk('controlled', spring(18, 170)), mk('stiff', spring(30, 170)),
      mk('hinted', spring(18, 170), { segments: [{ prop: 'Position', t0: 0.5, t1: 1.5, ease: 'spring' }] }),
    ], { dur: 4 }));
    const [lively, controlled, stiff, hinted] = a.layers.map((L) => L.moves);
    expect(lively).toHaveLength(1);
    expect(lively[0].ease).toBe('spring-like');
    expect(lively[0].overshoot).toBeCloseTo(0.16, 1);
    expect(controlled.map((m) => m.ease)).toEqual(['overshoot']);
    expect(stiff.map((m) => m.ease)).toEqual(['ease-out']);
    expect(hinted.map((m) => [m.ease, m.built])).toEqual([['spring-like', 'spring']]);
  });
  it('calls a move too short to judge a step, and judges a pulse by its travel', () => {
    expect(classifyProgress([0, 0.1, 0.2], [0, 50, 100]).ease).toBe('step');
    const ts = timesFor(1.01, 0.05), pulse = ts.map((t) => Math.sin(Math.PI * t) * 20);
    expect(classifyProgress(ts, pulse).ease).toBe('ease-in-out');
  });
});

describe('motion: moves, holds, arrivals, exits', () => {
  const times = timesFor(6, 1 / 30);
  it('finds the arrival, the hold and the exit of a card', () => {
    const a = analyzeMotion(data([card('Title', times, { t0: 0.2, arrive: 0.65, hold: 3.25, leave: 0.35 })]));
    const L = a.layers[0];
    expect(L.arrival).not.toBeNull();
    expect(L.arrival!.t0).toBeCloseTo(0.2, 1);
    // easeOutExpo has landed (under 8 px/s) a few frames before its last key at 0.85 s.
    expect(L.arrival!.t1).toBeGreaterThan(0.7);
    expect(L.arrival!.t1).toBeLessThanOrEqual(0.85 + 1e-6);
    expect(L.arrival!.ease).toBe('ease-out');
    expect(L.arrival!.channels).toEqual(['position', 'opacity']);
    expect(L.arrival!.peak).toBeGreaterThan(1000);
    expect(L.exit!.ease).toBe('ease-in');
    expect(L.exit!.t0).toBeCloseTo(3.25, 1);
    expect(L.holds).toHaveLength(1);
    expect(L.holds[0].dur).toBeGreaterThan(2.4);
    expect(L.holds[0].dur).toBeLessThan(2.6);
    expect(L.appear).toBeCloseTo(0.2, 1);
    expect(L.vanish).toBeCloseTo(3.6, 1);
  });
  it('keeps a slow drift during the hold as part of the hold', () => {
    const L = layer('Logo', times, (t) => (t < 0.2 ? null : [t < 0.8 ? tw(t, 0.2, 0.8, 360, 960) : 960 + (t - 0.8) * 15, 540, 100, 100, 0, 100]), {}, [400, 200]);
    const m = analyzeMotion(data([L])).layers[0];
    expect(m.moves).toHaveLength(1);
    expect(m.holds).toHaveLength(1);
    expect(m.holds[0].drift).toBe(true);
    expect(m.holds[0].dur).toBeGreaterThan(5);
    expect(m.arrival?.t1).toBeLessThan(1);
  });
  it('treats a fade as a move on opacity', () => {
    const m = analyzeMotion(data([layer('Sub', times, (t) => [960, 700, 100, 100, 0, tw(t, 1, 1.5, 0, 100, fn('easeOutCubic'))], {}, [600, 60])])).layers[0];
    expect(m.arrival?.dominant).toBe('opacity');
    expect(m.arrival?.channels).toEqual(['opacity']);
    expect(m.arrival?.ease).toBe('ease-out');
  });
  it('counts a scale pop as speed at the corners', () => {
    const m = analyzeMotion(data([layer('Badge', times, (t) => { const s = tw(t, 1, 1.4, 0, 100, fn('easeOutBack')); return [960, 540, s, s, 0, 100]; }, {}, [200, 200])])).layers[0];
    expect(m.radius).toBeCloseTo(141.4, 0);
    expect(m.arrival?.dominant).toBe('scale');
    expect(m.arrival?.ease).toBe('overshoot');
    expect(m.peak).toBeGreaterThan(300);
  });
  it('has no arrival for a layer that cuts in and holds before moving, nor for a pass-by', () => {
    const a = analyzeMotion(data([
      layer('Cut', times, (t) => [tw(t, 2, 2.6, 500, 900, fn('easeInOutCubic')), 540, 100, 100, 0, 100]),
      layer('Pass', times, (t) => (t < 1 || t > 2.5 ? null : [tw(t, 1, 2.5, -200, 2200, fn('easeInOutSine')), 540, 100, 100, 0, 100]), {}, [200, 100]),
    ]));
    expect(a.layers[0].moves).toHaveLength(1);
    expect(a.layers[0].arrival).toBeNull();
    expect(a.layers[1].moves).toHaveLength(1);
    expect(a.layers[1].arrival).toBeNull();
    expect(a.layers[1].exit).toBeNull();
  });
  it('counts elements moving at once, cloner instances as one', () => {
    const cards = [0, 1, 2, 3].map((i) => card(`C${i}`, times, { t0: 1, arrive: 0.6, hold: 4, leave: 0.4, y: 200 + i * 200 }));
    const clones = [0, 1, 2].map((i) => card(`Clone ${i}`, times, { t0: 1.1, arrive: 0.6, hold: 4, leave: 0.4, x: 400 + 100 * i }, { tags: ['cloner'] }));
    const bg = layer('BG', times, (t) => [960, 540, 100 + t, 100 + t, 0, 100], { kind: 'solid' });
    const a = analyzeMotion(data([...cards, ...clones, bg]));
    expect(a.activity.peak).toBe(5);
    expect(a.activity.peakAt).toBeGreaterThan(1);
    expect(a.activity.peakAt).toBeLessThan(1.7);
    expect(Math.max(...a.activity.visible)).toBe(5);
    expect(a.layers[7].content).toBe(false);
  });
  it('summarizes in a few lines', () => {
    const a = analyzeMotion(data([card('Title', times, { t0: 0.2, arrive: 0.65, hold: 3.25, leave: 0.35 }), card('Sub', times, { t0: 0.6, arrive: 0.5, hold: 3.3, leave: 0.3, y: 700 })]));
    const lines = motionSummary(a);
    expect(lines[0]).toMatch(/"Test" 6\.0 s: 2 elements, 2 animated, 4 moves \(2 ease-out, 2 ease-in\)/);
    expect(lines[1]).toMatch(/^"Title" arrives 0\.20–0\.\d\d s \(ease-out, peak \d+ px\/s\), holds 2\.\d s, exits 3\.2\d–3\.6\d s \(ease-in/);
    expect(lines.join('\n')).toMatch(/most at once: 2 of 2 visible elements move at 0\.\d s/);
    expect(lines.join('\n')).toMatch(/final state: "Sub" settles at/);
  });
});

/** A small showcase-like piece: three scenes, a hero title, staggered list items, a spring badge, a ticker, a corner label. */
function showcase(): MotionData {
  const times = timesFor(9, 1 / 30);
  const L: MotionLayer[] = [
    layer('Background', times, (t) => [960, 540, 100 + t * 0.5, 100 + t * 0.5, 0, 100], { kind: 'solid', tags: ['bg'] }),
    card('MAKE IT MOVE', times, { t0: 0.2, arrive: 0.7, hold: 2.6, leave: 0.4, y: 480, dx: 800 }, { kind: 'text', text: 'MAKE IT MOVE' }),
    card('subhead', times, { t0: 0.6, arrive: 0.5, hold: 2.7, leave: 0.3, y: 620, dx: 200, inEase: 'easeOutCubic' }, { kind: 'text' }),
    ...[0, 1, 2, 3].map((i) => card(`Item ${i + 1}`, times, { t0: 3.2 + i * 0.15, arrive: 0.5, hold: 5.6, leave: 0.35, y: 300 + i * 140, dx: 300, inEase: 'easeOutQuint' }, { kind: 'text' })),
    layer('Badge', times, (t) => { if (t < 4.5 || t > 5.9) return null; const s = 100 * springProgress({ damping: 11, stiffness: 160 }, 30).fn(t - 4.5); return [1500, 300, s, s, 0, 100]; }, { segments: [{ prop: 'Scale', t0: 4.5, t1: 5.5, ease: 'spring' }] }, [180, 180]),
    layer('Ticker', times, (t) => (t < 6 ? null : [2000 - (t - 6) * 240, 1000, 100, 100, 0, 100]), { kind: 'text' }, [900, 40]),
    layer('Ring', times, (t) => (t < 6 ? null : [960, 520, 100, 100, (t - 6) * 40, 100]), {}, [500, 500]),
    layer('Logo', times, (t) => (t < 6.2 ? null : [960, 520, tw(t, 6.2, 6.9, 60, 100, fn('easeOutExpo')), tw(t, 6.2, 6.9, 60, 100, fn('easeOutExpo')), 0, tw(t, 6.2, 6.6, 0, 100, fn('linear'))]), {}, [420, 160]),
    layer('01 / 03', times, () => [1800, 60, 100, 100, 0, 100], { kind: 'text' }, [120, 36]),
    layer('Controls', times, () => [0, 0, 100, 100, 0, 100], { kind: 'null', tags: ['controls'] }),
  ];
  return { ...data(L, { dur: 9 }), scenes: [{ name: 'Hook', t: 0, dur: 3.4 }, { name: 'List', t: 3.1, dur: 3.2 }, { name: 'Payoff', t: 6, dur: 3 }], transitions: [{ kind: 'push', t: 3.1, dur: 0.4 }, { kind: 'shape-wipe', t: 5.9, dur: 0.5 }] };
}

const tmp = (name: string) => path.join(os.tmpdir(), name);

describe('motion: speed graph', () => {
  it('renders a readable PNG with one row per animated layer and the activity row', async () => {
    const d = showcase(), a = analyzeMotion(d);
    const file = tmp('aec-motion-graph.png');
    const r = await speedGraph(d, a, file);
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.statSync(file).size).toBeGreaterThan(20_000);
    const meta = await sharp(file).metadata();
    expect(meta.width).toBe(1600);
    expect(meta.height).toBe(r.height);
    expect(r.rows).toContain('MAKE IT MOVE');
    expect(r.rows).not.toContain('Controls');
    expect(r.rows).not.toContain('01 / 03');
    expect(r.omitted).toEqual([]);
  });
  it('caps the rows, keeps the most active and says how many were omitted', () => {
    const d = showcase(), a = analyzeMotion(d);
    const g = speedGraphSvg(d, a, { maxRows: 3 });
    expect(g.rows).toHaveLength(3);
    expect(g.omitted.length).toBeGreaterThan(3);
    expect(g.svg).toMatch(new RegExp(`${g.omitted.length} more animated layers not shown`));
    expect(g.svg).toContain('spring-like');
  });
});

describe('motion: frame strips and GIFs', () => {
  async function frames(n: number, depth: 8 | 16): Promise<{ t: number; file: string }[]> {
    const dir = fs.mkdtempSync(tmp('aec-motion-frames-'));
    const out: { t: number; file: string }[] = [];
    for (let i = 0; i < n; i++) {
      const file = path.join(dir, `f${i}.png`);
      const x = 40 + i * 30;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#203040"/><rect x="${x}" y="140" width="80" height="80" fill="#ffcc00"/></svg>`;
      let img = sharp(Buffer.from(svg)).png();
      if (depth === 16) img = sharp(Buffer.from(svg)).toColourspace('rgb16').png();
      await img.toFile(file);
      out.push({ t: 1 + (i * 2) / 30, file });
    }
    return out;
  }
  it('writes a strip of small labeled frames, normalizing 16-bit captures', async () => {
    const fr = await frames(12, 16);
    expect((await sharp(fr[0].file).metadata()).depth).toBe('ushort');
    const file = await motionStrip(fr, tmp('aec-motion-strip.png'), { fps: 30, cols: 6, cellWidth: 200, title: 'Title arrival' });
    const meta = await sharp(file).metadata();
    expect(meta.width).toBe(6 * 200 + 7 * 4);
    expect(meta.height).toBeGreaterThan(2 * 112);
    expect(fs.statSync(file).size).toBeGreaterThan(5_000);
  });
  const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
  it.skipIf(!hasFfmpeg)('writes a looping GIF at real-time speed', async () => {
    const fr = await frames(10, 8);
    expect(realtimeFps(fr)).toBe(15);
    const file = await gif(fr, tmp('aec-motion.gif'), { width: 320 });
    const head = fs.readFileSync(file).subarray(0, 6).toString('latin1');
    expect(head).toBe('GIF89a');
    expect(fs.statSync(file).size).toBeGreaterThan(1_000);
    const meta = await sharp(file, { animated: true }).metadata();
    expect(meta.pages).toBe(10);
    expect(meta.width).toBe(320);
  });
});
