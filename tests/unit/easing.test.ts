import { describe, expect, it } from 'vitest';
import { spring as remotionSpring, measureSpring as remotionMeasure } from 'remotion';
import { spring, measureSpring, springProgress } from '../../src/shared/spring.ts';
import { aeSegmentValue, bezierToEase, cssBezier } from '../../src/shared/bezier.ts';
import { Easing, resolveEasing } from '../../src/shared/easing.ts';
import { bake, bakeError } from '../../src/shared/bake.ts';

describe('spring matches remotion@4.0.540', () => {
  const configs = [{}, { damping: 12, stiffness: 200 }, { mass: 2 }, { damping: 20 }, { damping: 4, overshootClamping: true }];
  for (const fps of [24, 30, 60]) for (const cfg of configs) {
    it(`fps ${fps} ${JSON.stringify(cfg)}`, () => {
      let maxErr = 0;
      for (let f = 0; f <= 90; f += 0.5) {
        const a = spring({ frame: f, fps, ...cfg, from: 0, to: 1, delay: 3 });
        const b = remotionSpring({ frame: f, fps, config: cfg, from: 0, to: 1, delay: 3 });
        maxErr = Math.max(maxErr, Math.abs(a - b));
      }
      expect(maxErr).toBeLessThan(1e-9);
      expect(measureSpring(fps, cfg)).toBe(remotionMeasure({ fps, config: cfg }));
    });
  }
  it('durationInFrames and reverse', () => {
    for (let f = 0; f <= 40; f++) {
      expect(spring({ frame: f, fps: 30, durationInFrames: 20 })).toBeCloseTo(remotionSpring({ frame: f, fps: 30, durationInFrames: 20 }), 9);
      expect(spring({ frame: f, fps: 30, reverse: true })).toBeCloseTo(remotionSpring({ frame: f, fps: 30, reverse: true }), 9);
    }
  });
});

describe('bezier ↔ AE ease', () => {
  it('a CSS bezier mapped to AE eases reproduces the same curve', () => {
    for (const name of ['easeOutCubic', 'easeInOutQuart', 'easeOutBack', 'snappy', 'easeInExpo']) {
      const c = resolveEasing(name);
      const dv = 500, dt = 0.8;
      const e = bezierToEase(c.bezier!, dv, dt);
      for (let i = 1; i < 40; i++) {
        const t = (i / 40) * dt;
        const ae = aeSegmentValue(0, dt, 0, dv, e.out.speed, e.out.influence / 100, e.in.speed, e.in.influence / 100, t);
        expect(Math.abs(ae - dv * cssBezier(c.bezier!, t / dt))).toBeLessThan(1e-6);
      }
    }
  });
  it('exact polynomial easings equal their bezier forms', () => {
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      expect(cssBezier([1 / 3, 0, 2 / 3, 1 / 3], t)).toBeCloseTo(Easing.quad(t), 9);
      expect(cssBezier([1 / 3, 0, 2 / 3, 0], t)).toBeCloseTo(Easing.cubic(t), 9);
    }
  });
  it('unknown easing names suggest alternatives', () => {
    expect(() => resolveEasing('easeOutCubik')).toThrow(/Did you mean: .*easeOutCubic/);
  });
});

describe('baking', () => {
  it('default spring bakes to few keys within 0.1 px over 500 px', () => {
    const { fn, settleSec } = springProgress({}, 30);
    const tol = 0.1 / 500;
    const knots = bake(fn, settleSec, { fps: 30, tol });
    expect(bakeError(fn, knots, 30)).toBeLessThanOrEqual(tol);
    expect(knots.length).toBeLessThanOrEqual(12);
  });
  it('elastic and bounce bake within tolerance', () => {
    const el = resolveEasing('elastic');
    const kn = bake((t) => el.fn(t / 1.2), 1.2, { fps: 30, tol: 0.001 });
    expect(bakeError((t) => el.fn(t / 1.2), kn, 30)).toBeLessThanOrEqual(0.001);
    const b = resolveEasing('bounce');
    const seed = b.knots!.map((k) => ({ t: k.t, p: k.p, dl: k.dl, dr: k.dr }));
    const kb = bake(b.fn, 1, { fps: 30, tol: 0.001, seed, frameSnap: false });
    expect(bakeError(b.fn, kb, 30)).toBeLessThanOrEqual(0.001);
  });
});
