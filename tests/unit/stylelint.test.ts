import { describe, expect, it } from 'vitest';
import { resolveEasing } from '../../src/shared/easing.ts';
import { analyzeMotion, formatStyleIssues, STYLE_RULES, styleLint } from '../../src/motion/index.ts';
import type { MotionData, MotionLayer, StyleOptions } from '../../src/motion/index.ts';

// Synthetic samples at 30 fps: a layer is a function of time → [x, y, scaleX, scaleY, rotation, opacity] or null.
type Pose = [number, number, number, number, number, number];
const STEP = 1 / 30;
const timesFor = (dur: number) => Array.from({ length: Math.round(dur / STEP) }, (_, i) => Math.round(i * STEP * 1e6) / 1e6);
const fn = (name: string) => resolveEasing(name).fn;
const tw = (t: number, t0: number, t1: number, a: number, b: number, f: (u: number) => number = fn('easeOutExpo')) =>
  t <= t0 ? a : t >= t1 ? b : a + (b - a) * f((t - t0) / (t1 - t0));

let DUR = 6;
function data(layers: MotionLayer[], extra: Partial<MotionData> = {}): MotionData {
  return { comp: 'Style', w: 1920, h: 1080, fps: 30, dur: DUR, step: STEP, times: timesFor(DUR), layers, scenes: [], ...extra };
}
function layer(name: string, pose: (t: number) => Pose | null, extra: Partial<MotionLayer> = {}, size: [number, number] = [300, 120]): MotionLayer {
  const s = timesFor(DUR).map(pose);
  const b = s.map((v) => (v ? [v[0] - (size[0] / 2) * (v[2] / 100), v[1] - (size[1] / 2) * (v[3] / 100), v[0] + (size[0] / 2) * (v[2] / 100), v[1] + (size[1] / 2) * (v[3] / 100)] : null));
  return { name, kind: 'shape', in: 0, out: DUR, s, b, ...extra };
}
/** Slides in by dx (fading in) from t0 over `arrive`, holds, then slides out from `leaveAt` over `leave` (or stays to the end). */
function card(name: string, o: { t0: number; arrive?: number; leaveAt?: number; leave?: number; x?: number; y?: number; dx?: number; inEase?: string; outEase?: string }, extra: Partial<MotionLayer> = {}, size?: [number, number]): MotionLayer {
  const x = o.x ?? 960, y = o.y ?? 540, dx = o.dx ?? 500, arrive = o.arrive ?? 0.6, leave = o.leave ?? 0.35;
  const leaveAt = o.leaveAt ?? Infinity, end = leaveAt + leave;
  const fi = fn(o.inEase ?? 'easeOutExpo'), fo = fn(o.outEase ?? 'easeInCubic');
  return layer(name, (t) => {
    if (t < o.t0 - 1e-9 || t >= end - 1e-9) return null;
    const px = t < leaveAt ? tw(t, o.t0, o.t0 + arrive, x - dx, x, fi) : tw(t, leaveAt, end, x, x + dx, fo);
    const op = t < leaveAt ? tw(t, o.t0, o.t0 + arrive / 2, 0, 100, fn('linear')) : tw(t, leaveAt + leave / 2, end, 100, 0, fn('linear'));
    return [px, y, 100, 100, 0, op];
  }, extra, size);
}
const still = (name: string, x: number, y: number, from = 0, to = Infinity, extra: Partial<MotionLayer> = {}, size?: [number, number]) =>
  layer(name, (t) => (t >= from - 1e-9 && t < to - 1e-9 ? [x, y, 100, 100, 0, 100] : null), extra, size);
const bg = () => layer('BG', () => [960, 540, 100, 100, 0, 100], { kind: 'solid', tags: ['bg'] }, [1920, 1080]);

const lint = (d: MotionData, o: StyleOptions = {}) => styleLint(d, analyzeMotion(d), o);
const rules = (d: MotionData, o: StyleOptions = {}) => lint(d, o).map((i) => i.rule);
const only = (d: MotionData, rule: string, o: StyleOptions = {}) => lint(d, o).filter((i) => i.rule === rule);

describe('style lint: transition-repeat', () => {
  it('flags the same transition twice in a row', () => {
    const d = data([bg()], { transitions: [{ kind: 'push', t: 2, dur: 0.4, layer: 'Push A' }, { kind: 'push', t: 4, dur: 0.4, layer: 'Push B' }] });
    const [i] = only(d, 'transition-repeat');
    expect(i.message).toMatch(/the "push" transition is used twice in a row \(2\.0s, 4\.0s\)/);
    expect(i.layers).toEqual(['Push A', 'Push B']);
    expect(i.t).toEqual([2, 4.4]);
  });
  it('passes alternating transitions', () => {
    const d = data([bg()], { transitions: [{ kind: 'push', t: 1, dur: 0.4 }, { kind: 'shape-wipe', t: 3, dur: 0.4 }, { kind: 'push', t: 5, dur: 0.4 }] });
    expect(rules(d)).not.toContain('transition-repeat');
  });
  it('reads transitions from layer tags when the data has none', () => {
    const d = data([bg(), still('W1', 960, 540, 2, 2.5, { tags: ['transition:slide'], in: 2, out: 2.5 }), still('W2', 960, 540, 4, 4.5, { tags: ['transition:slide'], in: 4, out: 4.5 })]);
    expect(only(d, 'transition-repeat')[0].message).toMatch(/"slide" transition is used twice/);
  });
});

describe('style lint: crowded-entrance', () => {
  it('flags more than three elements arriving inside 0.2 s', () => {
    const d = data([bg(), ...[0, 0.03, 0.06, 0.1, 0.15].map((dt, i) => card(`Card ${i + 1}`, { t0: 1 + dt, y: 150 + i * 190 }))]);
    const [i] = only(d, 'crowded-entrance');
    expect(i.message).toMatch(/^5 elements start arriving within 0\.2 s at 1\.0s–1\.2s \("Card 1", "Card 2", "Card 3" and 2 more\): lead with the main one/);
    expect(i.layers).toHaveLength(5);
  });
  it('passes a stagger, and counts cloner instances as one element', () => {
    expect(rules(data([...[0, 1, 2, 3, 4].map((k) => card(`Item ${k}`, { t0: 1 + k * 0.15, y: 150 + k * 190 }))]))).not.toContain('crowded-entrance');
    const clones = [0, 1, 2, 3, 4, 5].map((k) => card(`Clone ${k}`, { t0: 1 + k * 0.02, x: 300 + k * 250 }, { tags: ['cloner'] }));
    expect(rules(data([...clones, card('Title', { t0: 1, y: 900 })]))).not.toContain('crowded-entrance');
    expect(rules(data([...clones, card('Title', { t0: 1, y: 900 })]), { maxEntrances: 1 })).toContain('crowded-entrance');
  });
});

describe('style lint: short-hold', () => {
  it('flags a non-text element that leaves soon after it lands', () => {
    const d = data([bg(), card('Badge', { t0: 1, arrive: 0.4, leaveAt: 1.7, leave: 0.3 }), card('Title', { t0: 0.5, y: 300 }, { kind: 'text' })]);
    const [i] = only(d, 'short-hold');
    expect(i.layer).toBe('Badge');
    expect(i.message).toMatch(/^"Badge" lands at 1\.\ds and starts leaving at 1\.7s: it holds only 0\.\d s; hold it at least 0\.8 s/);
  });
  it('passes texts (judged by reading time) and elements that hold long enough', () => {
    expect(rules(data([card('Caption', { t0: 1, arrive: 0.4, leaveAt: 1.7 }, { kind: 'text' })]))).not.toContain('short-hold');
    expect(rules(data([card('Badge', { t0: 1, arrive: 0.4, leaveAt: 2.6 })]))).not.toContain('short-hold');
    expect(rules(data([card('Badge', { t0: 1, arrive: 0.4, leaveAt: 2.6 })]), { minHold: 1.5 })).toContain('short-hold');
  });
});

describe('style lint: easing-monotony and linear-move', () => {
  it('notes when every move has the same easing', () => {
    const d = data([0, 1].map((k) => card(`Card ${k}`, { t0: 0.5 + k * 0.3, leaveAt: 3 + k * 0.3, outEase: 'easeOutExpo', y: 300 + k * 400 })));
    const [i] = only(d, 'easing-monotony');
    expect(i.severity).toBe('info');
    expect(i.message).toMatch(/^all 4 moves use the same easing \(ease-out\)/);
  });
  it('passes varied easing, and fewer than 4 moves', () => {
    expect(rules(data([0, 1].map((k) => card(`Card ${k}`, { t0: 0.5 + k * 0.3, leaveAt: 3 + k * 0.3, y: 300 + k * 400 }))))).not.toContain('easing-monotony');
    expect(rules(data([card('A', { t0: 0.5, leaveAt: 3, outEase: 'easeOutExpo' })]))).not.toContain('easing-monotony');
  });
  it('flags a linear arrival and says how to ease it', () => {
    const d = data([card('Card', { t0: 1, arrive: 0.5, inEase: 'linear' }, { segments: [{ prop: 'Position', t0: 1, t1: 1.5, ease: 'linear' }] })]);
    const [i] = only(d, 'linear-move');
    expect(i.layer).toBe('Card');
    expect(i.message).toMatch(/^"Card" moves at constant speed \(linear\) at 1\.0s–1\.5s: ease it \(easeOutExpo or easeOutQuint for an arrival\)/);
  });
  it('passes linear fades', () => {
    expect(rules(data([layer('Fade', (t) => [960, 540, 100, 100, 0, tw(t, 1, 1.5, 0, 100, fn('linear'))])]))).not.toContain('linear-move');
  });
  it('passes constant drifts: a ticker and a loop that run for the whole layer', () => {
    const ticker = layer('Ticker', (t) => [2400 - t * 300, 1000, 100, 100, 0, 100], { kind: 'text' }, [1200, 40]);
    const ring = layer('Ring', (t) => [960, 540, 100, 100, t * 45, 100], {}, [400, 400]);
    expect(rules(data([ticker, ring]))).not.toContain('linear-move');
  });
});

describe('style lint: slide-furniture', () => {
  const scenes = [{ name: 'A', t: 0, dur: 2 }, { name: 'B', t: 2, dur: 2 }, { name: 'C', t: 4, dur: 2 }];
  it('flags a small label parked in a corner across scenes', () => {
    const d = data([bg(), still('01 / 03', 1800, 60, 0, Infinity, { kind: 'text' }, [140, 40]), card('Title', { t0: 0.3, leaveAt: 1.8 }, { kind: 'text' })], { scenes });
    const [i] = only(d, 'slide-furniture');
    expect(i.layer).toBe('01 / 03');
    expect(i.message).toMatch(/^"01 \/ 03" sits still near the top-right corner for 6\.0 s across 3 scenes at 0\.0s–6\.0s: it reads as slide furniture/);
  });
  it('flags a header bar held for most of a piece without scenes', () => {
    expect(only(data([still('Header', 960, 40, 0.5, 6, {}, [1920, 80])]), 'slide-furniture')[0].message).toMatch(/near the top edge .*\(92 % of the piece\)/);
  });
  it('passes persistent elements, centered elements and labels that leave with their beat', () => {
    expect(rules(data([still('Logo bug', 1800, 60, 0, Infinity, { tags: ['persistent'] }, [140, 40])], { scenes }))).not.toContain('slide-furniture');
    expect(rules(data([still('Title', 960, 540, 0, Infinity, { kind: 'text' }, [600, 120])], { scenes }))).not.toContain('slide-furniture');
    expect(rules(data([still('Beat label', 1800, 60, 2, 3.8, { kind: 'text' }, [140, 40])], { scenes }))).not.toContain('slide-furniture');
  });
});

describe('style lint: short-end-hold', () => {
  it('flags an end state that holds less than 2 s', () => {
    const [i] = only(data([bg(), card('Logo', { t0: 5, arrive: 0.7 })]), 'short-end-hold');
    expect(i.layer).toBe('Logo');
    expect(i.message).toMatch(/^the final state holds 0\.\d s \("Logo" settles at 5\.\ds, the comp ends at 6\.0s\): hold the end frame/);
  });
  it('measures up to where everything leaves when the piece ends empty', () => {
    const [i] = only(data([card('Logo', { t0: 1, arrive: 0.7, leaveAt: 2.5, leave: 0.4 })]), 'short-end-hold');
    expect(i.message).toMatch(/everything starts leaving at 2\.5s/);
  });
  it('passes a long final hold, and ignores background drift', () => {
    const drift = layer('BG', (t) => [960, 540, 100 + t * 2, 100 + t * 2, 0, 100], { kind: 'solid', tags: ['bg'] }, [1920, 1080]);
    expect(rules(data([drift, card('Logo', { t0: 2, arrive: 0.7 })]))).not.toContain('short-end-hold');
  });
});

describe('style lint: everything-moves', () => {
  const mover = (name: string, y: number, t0: number) => layer(name, (t) => [tw(t, t0, t0 + 1.6, 300, 1500, fn('easeInOutCubic')), y, 100, 100, 0, 100]);
  it('flags most visible elements moving at once for a second', () => {
    const d = data([bg(), mover('A', 200, 1), mover('B', 400, 1), mover('C', 600, 1.05), mover('D', 800, 1.1)]);
    const [i] = only(d, 'everything-moves');
    expect(i.message).toMatch(/^4 of 4 visible elements move at once for 1\.\d s at 1\.\ds–2\.\ds: there is no focal point/);
    expect(i.layers).toEqual(['A', 'B', 'C', 'D']);
  });
  it('passes one lead move over still elements, and a camera move', () => {
    expect(rules(data([mover('A', 200, 1), still('B', 960, 400), still('C', 960, 600), still('D', 960, 800)]))).not.toContain('everything-moves');
    const cam = layer('Camera', (t) => [tw(t, 1, 3, 0, 300, fn('easeInOutSine')), 0, 100, 100, 0, 100], { kind: 'camera' });
    expect(rules(data([cam, mover('A', 200, 1), mover('B', 400, 1), mover('C', 600, 1)]))).not.toContain('everything-moves');
  });
  it('passes everything moving inside a transition', () => {
    const d = data([mover('A', 200, 1), mover('B', 400, 1), mover('C', 600, 1)], { transitions: [{ kind: 'push', t: 0.9, dur: 1.8 }] });
    expect(rules(d)).not.toContain('everything-moves');
  });
});

describe('style lint: transition layers', () => {
  it('does not judge wipe shapes as crowded entrances or short holds', () => {
    const wipes = [0, 1, 2, 3, 4].map((k) => card(`Wipe ${k}`, { t0: 2 + k * 0.02, arrive: 0.3, leaveAt: 2.5, leave: 0.3, y: 100 + k * 220 }, { tags: ['transition:slices'] }));
    const r = rules(data([bg(), ...wipes]));
    expect(r).not.toContain('crowded-entrance');
    expect(r).not.toContain('short-hold');
  });
});

describe('style lint: dead-air', () => {
  it('flags a gap with only the background on screen', () => {
    const [i] = only(data([bg(), card('Beat 1', { t0: 0.2, leaveAt: 1.8, leave: 0.3 }), card('Beat 2', { t0: 3, leaveAt: 5 })]), 'dead-air');
    expect(i.message).toMatch(/^nothing but the background is on screen for 0\.\d s at 2\.\ds–3\.0s: overlap the beats by 0\.2–0\.4 s/);
  });
  it('passes overlapping beats and the empty frames before the first and after the last element', () => {
    expect(rules(data([bg(), card('Beat 1', { t0: 0.8, leaveAt: 2, leave: 0.3 }), card('Beat 2', { t0: 2.1, leaveAt: 4.5, leave: 0.3 })]))).not.toContain('dead-air');
  });
});

describe('style lint: options and formatting', () => {
  it('lists every rule, honours ignore, and formats warnings first', () => {
    expect(STYLE_RULES).toHaveLength(10); // + off-beat (A5, judged in src/api/motion.ts)
    const d = data([0, 1].map((k) => card(`Card ${k}`, { t0: 0.5, leaveAt: 3, outEase: 'easeOutExpo', y: 300 + k * 400 })), { transitions: [{ kind: 'push', t: 2, dur: 0.4 }, { kind: 'push', t: 4, dur: 0.4 }] });
    expect(rules(d)).toEqual(expect.arrayContaining(['transition-repeat', 'easing-monotony']));
    expect(rules(d, { ignore: ['transition-repeat'] })).not.toContain('transition-repeat');
    const lines = formatStyleIssues(lint(d));
    expect(lines[0]).toMatch(/^warn \[/);
    expect(lines[lines.length - 1]).toMatch(/^note \[easing-monotony\]/);
  });
  it('is quiet on a well-directed piece', () => {
    DUR = 9;
    const scenes = [{ name: 'Hook', t: 0, dur: 3.4 }, { name: 'Payoff', t: 3.1, dur: 5.9 }];
    const d = data([
      bg(),
      card('MAKE IT MOVE', { t0: 0.2, arrive: 0.7, leaveAt: 3, leave: 0.4, dx: 700 }, { kind: 'text' }),
      card('subhead', { t0: 0.7, arrive: 0.5, leaveAt: 2.9, leave: 0.35, y: 660, dx: 200, inEase: 'easeOutCubic' }, { kind: 'text' }),
      card('Logo', { t0: 3.3, arrive: 0.8, y: 480, dx: 80, inEase: 'easeOutBack' }, {}, [420, 160]),
      card('CTA', { t0: 4.3, arrive: 0.5, y: 700, dx: 120, inEase: 'easeInOutCubic' }, { kind: 'text' }),
    ], { scenes, transitions: [{ kind: 'hand-off', t: 3, dur: 0.4 }] });
    DUR = 6;
    expect(lint(d)).toEqual([]);
  });
});
