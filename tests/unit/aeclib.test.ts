import { describe, expect, it } from 'vitest';
import { parse } from 'acorn';
import { inlineTail, libFunctionNames, libObject, libVersion, stripLibTail, usedFunctions, withLib } from '../../src/aeclib/index.ts';
import { springUnit } from '../../src/shared/spring.ts';
import { cssBezier } from '../../src/shared/bezier.ts';

const L = libObject();
const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

/** Runs an expression the way AE does (last expression statement is the value), with a few expression globals. */
function runExpr(code: string, globals: Record<string, any> = {}): any {
  const names = Object.keys(globals);
  const lines = code.split('\n');
  const last = lines.pop()!;
  return new Function(...names, `${lines.join('\n')}\nreturn (${last.replace(/;\s*$/, '')});`)(...names.map((n) => globals[n]));
}

describe('aec-lib: loading', () => {
  it('parses, has a version and resolves every this.* dependency', () => {
    expect(libVersion()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(libFunctionNames().length).toBeGreaterThan(40);
    for (const n of libFunctionNames()) expect(typeof L[n]).toBe('function');
  });
  it('finds the functions an expression uses, with their dependencies', () => {
    expect(usedFunctions('var p = L.spring(t, 30, 10, 100, 1);')).toEqual(['spring']);
    expect(usedFunctions('L.radial(p, c, 200, 50)')).toEqual(['clamp', 'smooth', 'falloff', 'radial']);
    expect(() => usedFunctions('L.nope(1)')).toThrow(/not in aec-lib/);
    expect(usedFunctions('thisLayer.L.x(1); var a = 1;')).toEqual([]);
    expect(usedFunctions('L.toHsl(L.shade(c, 1, 0, 0))')).toEqual(['clamp', 'hsl', 'toHsl', 'shade']);
  });
  it('inlines a one-line definition under the header that parses as ES5 and behaves like the library', () => {
    const code = withLib('// ae-compose test\nvar p = L.bezier(0.33, 1, 0.68, 1, time / 2);\np * 100;');
    const lines = code.split('\n');
    expect(lines[0]).toBe('// ae-compose test');
    expect(lines[1]).toMatch(/^function aecLib\(\) \{ return \{ "bezier": function.*\} \/\/ aec-lib \d+\.\d+\.\d+ \(inlined: bezier\)$/);
    expect(lines[2]).toBe('var L = aecLib();');
    expect(() => parse(code, { ecmaVersion: 5 })).not.toThrow();
    close(runExpr(code, { time: 1 }), L.bezier(0.33, 1, 0.68, 1, 0.5) * 100);
    expect(stripLibTail(code)).not.toMatch(/aecLib\(\) \{/);
  });
  it('footage mode binds L to the shared item and adds no tail', () => {
    const code = withLib('L.hash(1, 2);', 'footage');
    expect(code).toBe('var L = footage("aec-lib.jsx").sourceData;\nL.hash(1, 2);');
  });
  it('leaves expressions that do not call the library unchanged', () => {
    expect(withLib('wiggle(2, 10);')).toBe('wiggle(2, 10);');
  });
  it('every function survives inlining (whitespace collapsed) as valid ES5', () => {
    expect(() => parse(inlineTail(libFunctionNames()), { ecmaVersion: 5 })).not.toThrow();
  });
});

describe('aec-lib: easing and physics', () => {
  it('spring matches the Remotion-exact spring used by the compiler', () => {
    for (const [c, k, m] of [[10, 100, 1], [14, 190, 1], [26, 120, 2]]) for (let f = 0; f < 60; f += 3.5) close(L.spring(f / 30, 30, c, k, m), springUnit(f, 30, c, k, m), 1e-9);
  });
  it('bezier matches the CSS cubic-bezier solver', () => {
    for (const b of [[0.33, 1, 0.68, 1], [0.65, 0, 0.35, 1], [0.12, 0, 0.39, 0]] as const) for (let x = 0; x <= 1; x += 0.05) close(L.bezier(...b, x), cssBezier(b, x), 2e-4);
  });
  it('tween interpolates numbers and arrays with an easing', () => {
    close(L.tween(1, 0, 2, 0, 100), 50);
    expect(L.tween(2, 0, 2, [0, 0], [10, 20], [0.33, 1, 0.68, 1])).toEqual([10, 20]);
  });
  it('overshoot and inertia decay to rest', () => {
    expect(Math.abs(L.overshoot(5, 20, 2, 4))).toBeLessThan(0.01);
    expect(L.overshoot(0, 20, 2, 4)).toBe(0);
    expect(Math.abs(L.inertia(800, 3, 2, 5))).toBeLessThan(0.1);
  });
  it('bounce falls, bounces lower each time, and rests at 0', () => {
    expect(L.bounce(0, 300)).toBe(300);
    const peaks: number[] = []; let prev = 0, up = false;
    for (let t = 0.001; t < 3; t += 0.002) { const h = L.bounce(t, 300); if (h < prev && up) peaks.push(prev); up = h > prev; prev = h; }
    expect(peaks.length).toBeGreaterThan(1);
    for (let i = 1; i < peaks.length; i++) expect(peaks[i]).toBeLessThan(peaks[i - 1]);
    expect(L.bounce(10, 300)).toBe(0);
  });
});

describe('aec-lib: random and noise', () => {
  it('hash is deterministic, in [0, 1) and well spread', () => {
    const v = Array.from({ length: 1000 }, (_, i) => L.hash(i, 3));
    expect(v.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(L.hash(5, 2)).toBe(L.hash(5, 2));
    const mean = v.reduce((a, b) => a + b) / v.length;
    close(mean, 0.5, 0.05);
  });
  it('noise is smooth and bounded', () => {
    for (let x = 0; x < 10; x += 0.1) { expect(Math.abs(L.noise1(x, 3))).toBeLessThanOrEqual(1); expect(Math.abs(L.noise2(x, x * 0.7, 3))).toBeLessThanOrEqual(1); }
    expect(Math.abs(L.noise1(2.5, 1) - L.noise1(2.51, 1))).toBeLessThan(0.05);
  });
  it('pick returns members', () => { const list = ['a', 'b', 'c']; for (let i = 0; i < 20; i++) expect(list).toContain(L.pick(list, i, 4)); });
});

describe('aec-lib: distributions', () => {
  it('line is centred and spaced', () => {
    { const a = L.line(0, 3, 100); close(a[0], -100); close(a[1], 0); }
    expect(L.line(2, 3, 100)[0]).toBeCloseTo(100);
    expect(L.line(1, 3, 100, 90)[1]).toBeCloseTo(0);
    expect(L.line(2, 3, 100, 0, false)[0]).toBe(200);
  });
  it('grid fills rows of `cols`, centred', () => {
    const pts = Array.from({ length: 6 }, (_, i) => L.grid(i, 6, 3, 100, 50));
    expect(pts[0]).toEqual([-100, -25]);
    expect(pts[5]).toEqual([100, 25]);
  });
  it('circle and arc place points on the radius, starting at the top', () => {
    for (let i = 0; i < 8; i++) { const p = L.circle(i, 8, 300); close(Math.hypot(p[0], p[1]), 300, 1e-9); }
    const top = L.circle(0, 8, 300); close(top[0], 0, 1e-9); close(top[1], -300, 1e-9);
    const arcEnd = L.circle(4, 5, 100, 0, 180); close(arcEnd[1], 100, 1e-9);
  });
  it('scatter stays in the area with no two points piled up', () => {
    const n = 100, pts = Array.from({ length: n }, (_, i) => L.scatter(i, n, 1600, 900, 7));
    for (const p of pts) { expect(Math.abs(p[0])).toBeLessThanOrEqual(800); expect(Math.abs(p[1])).toBeLessThanOrEqual(450); }
    let minD = Infinity; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) minD = Math.min(minD, Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]));
    expect(minD).toBeGreaterThan(15);
    expect(new Set(pts.map((p) => `${Math.round(p[0])},${Math.round(p[1])}`)).size).toBe(n);
  });
  it('sphere and helix are 3D', () => {
    for (let i = 0; i < 20; i++) { const p = L.sphere(i, 20, 500); close(Math.hypot(...p), 500, 1e-6); }
    expect(L.helix(0, 10, 200, 400, 2)[1]).toBe(-200);
  });
});

describe('aec-lib: falloffs, color, text', () => {
  it('falloffs go from 1 inside to 0 outside', () => {
    close(L.radial([0, 0], [0, 0], 200, 50), 1); close(L.radial([400, 0], [0, 0], 200, 50), 0);
    expect(L.radial([200, 0], [0, 0], 200, 50)).toBeCloseTo(0.5);
    close(L.box([10, 10], [0, 0], [100, 100], 20), 1); close(L.box([300, 0], [0, 0], [100, 100], 20), 0);
    expect(L.linear([-100, 0], [0, 0], 0, 100)).toBe(1); expect(L.linear([100, 0], [0, 0], 0, 100)).toBe(0);
  });
  it('hsl ↔ rgb round-trips; hex and palette', () => {
    const c = [0.27, 0.51, 0.77, 1];
    const back = L.hsl(...L.toHsl(c).slice(0, 3)); for (let i = 0; i < 3; i++) close(back[i], c[i], 1e-9);
    expect(L.hex('#ff8000')).toEqual([1, 128 / 255, 0, 1]);
    expect(L.palette(['a', 'b'], 3)).toBe('b');
    expect(L.gradient([[0, 0, 0], [1, 1, 1]], 0.25)).toEqual([0.25, 0.25, 0.25]);
  });
  it('number formatting, padding, typing and decoding', () => {
    expect(L.num(1234567.891, 2)).toBe('1,234,567.89');
    expect(L.num(-1500, 0, '.')).toBe('-1.500');
    expect(L.pad(7, 3)).toBe('007');
    expect(L.typed('HELLO', 0.4, '|', 0, 0)).toBe('HE|');
    const s = L.scramble('HELLO WORLD', 0.5, 3, 1);
    expect(s.slice(0, 5)).toBe('HELLO'); expect(s.length).toBe(11); expect(s.charAt(5)).toBe(' ');
    expect(L.scramble('HELLO', 1, 3, 1)).toBe('HELLO');
  });
  it('markers: pulse and since', () => {
    expect(L.pulse(1.05, [1, 2], 0.1)).toBe(1); expect(L.pulse(1.2, [1, 2], 0.1)).toBe(0);
    close(L.since(2.5, [1, 2]), 0.5); expect(L.since(0.5, [1, 2])).toBe(-1);
  });
});
