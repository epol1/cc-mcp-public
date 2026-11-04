// Spec for src/shared/svgpath.ts: SVG path data → AE shapes (vertices + tangents relative to each vertex).
import { describe, expect, it } from 'vitest';
import { parseSvgPath, shapeBounds } from '../../src/shared/svgpath.ts';
import type { AeShape } from '../../src/shared/svgpath.ts';

const near = (a: number[][], b: number[][], digits = 9) => {
  expect(a.length, `${JSON.stringify(a)} vs ${JSON.stringify(b)}`).toBe(b.length);
  a.forEach((p, i) => p.forEach((x, d) => expect(x, `[${i}][${d}]`).toBeCloseTo(b[i][d], digits)));
};
const one = (d: string): AeShape => {
  const s = parseSvgPath(d);
  expect(s).toHaveLength(1);
  return s[0];
};
const Z2 = (n: number) => Array.from({ length: n }, () => [0, 0]);

/** Absolute control points of the cubic from vertex k to vertex k+1. */
const seg = (s: AeShape, k: number) => {
  const n = s.v.length, k1 = (k + 1) % n;
  return [s.v[k], [s.v[k][0] + s.o[k][0], s.v[k][1] + s.o[k][1]], [s.v[k1][0] + s.i[k1][0], s.v[k1][1] + s.i[k1][1]], s.v[k1]];
};
const bez = (p: number[][], u: number) => [0, 1].map((d) => (1 - u) ** 3 * p[0][d] + 3 * (1 - u) ** 2 * u * p[1][d] + 3 * (1 - u) * u * u * p[2][d] + u ** 3 * p[3][d]);

describe('lines: M/L/H/V absolute and relative', () => {
  it('M L H V (absolute) give corner vertices with zero tangents', () => {
    const s = one('M10 20 L110 20 H200 V80');
    near(s.v, [[10, 20], [110, 20], [200, 20], [200, 80]]);
    near(s.i, Z2(4));
    near(s.o, Z2(4));
    expect(s.c).toBe(false);
  });
  it('relative m l h v match their absolute equivalents', () => {
    expect(parseSvgPath('m10 20 l100 0 h90 v60')).toEqual(parseSvgPath('M10 20 L110 20 H200 V80'));
  });
  it('implicit lineto after M (absolute) and m (relative)', () => {
    near(one('M0 0 10 0 10 10').v, [[0, 0], [10, 0], [10, 10]]);
    near(one('m5 5 10 0 0 10').v, [[5, 5], [15, 5], [15, 15]]);
  });
  it('compact number syntax: signs and leading dots separate numbers, exponents', () => {
    near(one('M0,0L10-5l.5.5L1e2,2E1').v, [[0, 0], [10, -5], [10.5, -4.5], [100, 20]]);
  });
  it('scale and offset options apply to vertices and tangents', () => {
    const s = one('M0 0 C 10 0 20 10 20 20');
    const t = parseSvgPath('M0 0 C 10 0 20 10 20 20', { scale: 2, offset: [5, 5] })[0];
    near(t.v, [[10, 10], [50, 50]]);
    near(t.o, s.o.map((p) => p.map((x) => x * 2)));
    near(t.i, s.i.map((p) => p.map((x) => x * 2)));
  });
  it('unsupported commands throw', () => {
    expect(() => parseSvgPath('M0 0 X 10 10')).toThrow(/unsupported SVG path command "X"/);
  });
});

describe('curves: C/S/Q/T', () => {
  it('C: out tangent on the start vertex, in tangent on the end vertex, both relative to their vertex', () => {
    const s = one('M10 10 C 20 0 40 0 50 10');
    near(s.v, [[10, 10], [50, 10]]);
    near(s.o, [[10, -10], [0, 0]]);
    near(s.i, [[0, 0], [-10, -10]]);
  });
  it('c (relative) is relative to the current point', () => {
    expect(parseSvgPath('M10 10 c 10 -10 30 -10 40 0')).toEqual(parseSvgPath('M10 10 C 20 0 40 0 50 10'));
  });
  it('S reflects the previous C control point; without a previous C it uses the current point', () => {
    const s = one('M0 0 C 0 50 50 50 50 0 S 100 -50 100 0');
    near(s.v, [[0, 0], [50, 0], [100, 0]]);
    near(s.o, [[0, 50], [0, -50], [0, 0]]); // reflected (50,50) about (50,0) → (50,-50)
    near(s.i, [[0, 0], [0, 50], [0, -50]]);
    const t = one('M0 0 S 50 50 100 0');
    near(t.o, [[0, 0], [0, 0]]);
    near(t.i, [[0, 0], [-50, 50]]);
    expect(parseSvgPath('M0 0 C 0 50 50 50 50 0 s 50 -50 50 0')).toEqual(parseSvgPath('M0 0 C 0 50 50 50 50 0 S 100 -50 100 0'));
  });
  it('Q is raised to the exact cubic (2/3 rule); T reflects the previous Q control point', () => {
    const s = one('M0 0 Q 50 100 100 0 T 200 0');
    near(s.v, [[0, 0], [100, 0], [200, 0]]);
    near(s.o, [[100 / 3, 200 / 3], [100 / 3, -200 / 3], [0, 0]]);
    near(s.i, [[0, 0], [-100 / 3, 200 / 3], [-100 / 3, -200 / 3]]);
    // the cubic passes through the quadratic's midpoint B(0.5) = (50, 50)
    near([bez(seg(s, 0), 0.5)], [[50, 50]]);
    expect(parseSvgPath('M0 0 q 50 100 100 0 t 100 0')).toEqual(parseSvgPath('M0 0 Q 50 100 100 0 T 200 0'));
  });
});

describe('arcs: A', () => {
  it('a half circle is split into ≤90° cubics that stay on the circle', () => {
    const s = one('M0 0 A 50 50 0 0 1 100 0');
    expect(s.v.length).toBe(3); // 180° → 2 segments
    near([s.v[0], s.v[2]], [[0, 0], [100, 0]]);
    for (let k = 0; k < s.v.length - 1; k++) {
      for (const u of [0, 0.25, 0.5, 0.75, 1]) {
        const [x, y] = bez(seg(s, k), u);
        expect(Math.hypot(x - 50, y - 0)).toBeCloseTo(50, 1); // cubic arc approximation error ≪ 0.1 px
      }
    }
    // sweep flag 1 in SVG's y-down space goes through negative y (above the chord)
    expect(s.v[1][1]).toBeCloseTo(-50, 6);
    expect(one('M0 0 A 50 50 0 0 0 100 0').v[1][1]).toBeCloseTo(50, 6);
  });
  it('relative a, and radii too small are scaled up to reach the end point', () => {
    expect(parseSvgPath('M10 10 a 50 50 0 0 1 100 0')).toEqual(parseSvgPath('M10 10 A 50 50 0 0 1 110 10'));
    const s = one('M0 0 A 1 1 0 0 1 100 0');
    near([s.v[s.v.length - 1]], [[100, 0]], 6);
  });
  it('zero radius degenerates to a straight segment', () => {
    const s = one('M0 0 A 0 10 0 0 1 100 0');
    near(s.v, [[0, 0], [100, 0]]);
    near(s.o, Z2(2));
    near(s.i, Z2(2));
  });
  // Regression (was a bug, fixed): arc flags written without separators (valid SVG, emitted by minifiers such as SVGO: "a10 10 0 0110 10")
  // are tokenised as one number "0110" (src/shared/svgpath.ts:39), so the arc silently disappears.
  it('compact arc flags ("a10 10 0 0110 10") parse like the spaced form', () => {
    expect(parseSvgPath('M0 0 a10 10 0 0110 10')).toEqual(parseSvgPath('M0 0 a10 10 0 0 1 10 10'));
  });
});

describe('closing and subpaths', () => {
  it('Z closes; an explicit segment back to the start is folded into the first vertex', () => {
    const s = one('M0 0 L100 0 L100 100 L0 0 Z');
    expect(s.c).toBe(true);
    near(s.v, [[0, 0], [100, 0], [100, 100]]);
  });
  it('a closing curve keeps its in-tangent on the (shared) first vertex', () => {
    const s = one('M0 0 C10 -10 90 -10 100 0 C 90 10 10 10 0 0 Z');
    expect(s.c).toBe(true);
    near(s.v, [[0, 0], [100, 0]]);
    near(s.o, [[10, -10], [-10, 10]]);
    near(s.i, [[10, 10], [-10, -10]]);
  });
  it('Z without a closing segment keeps every vertex', () => {
    const s = one('M0 0 L100 0 L100 100 Z');
    expect(s.c).toBe(true);
    expect(s.v).toHaveLength(3);
  });
  it('multiple subpaths become multiple shapes; m after z is relative to the subpath start', () => {
    const s = parseSvgPath('M0 0 h10 v10 z m20 0 l5 5 M100 100 L110 100');
    expect(s).toHaveLength(3);
    expect(s.map((x) => x.c)).toEqual([true, false, false]);
    near(s[0].v, [[0, 0], [10, 0], [10, 10]]);
    near(s[1].v, [[20, 0], [25, 5]]);
    near(s[2].v, [[100, 100], [110, 100]]);
  });
  it('drawing after z without a moveto restarts at the subpath start', () => {
    const s = parseSvgPath('M5 5 L10 5 Z L5 10');
    expect(s).toHaveLength(2);
    near(s[1].v, [[5, 5], [5, 10]]);
  });
  it('every shape has matching v/i/o lengths', () => {
    for (const d of ['M0 0 Q 50 100 100 0 T 200 0 Z', 'M0 0 A 30 20 45 1 0 80 40 z M1 1 l1 1', 'M0 0 C 1 1 2 2 3 3 S 5 5 6 6']) {
      for (const s of parseSvgPath(d)) {
        expect(s.i.length).toBe(s.v.length);
        expect(s.o.length).toBe(s.v.length);
      }
    }
  });
});

describe('shapeBounds', () => {
  it('bounds of all vertices across shapes', () => {
    expect(shapeBounds(parseSvgPath('M10 20 L110 20 L110 70 Z M-5 0 L0 0'))).toEqual({ x: -5, y: 0, w: 115, h: 70 });
  });
  it('a single point has zero size', () => {
    expect(shapeBounds([{ v: [[3, 4]], i: [[0, 0]], o: [[0, 0]], c: false }])).toEqual({ x: 3, y: 4, w: 0, h: 0 });
  });
});
