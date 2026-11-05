// Shape morph maths (P3), pure: match two AE shapes so one Path can key A → B cleanly. Vertex counts are equalized
// by subdividing the longest segments of the shape with fewer vertices (de Casteljau splits, so its outline is
// unchanged), then the correspondence is picked: closed paths try every start vertex (both directions when the
// windings can't be compared) and keep the one with the least total travel, judged with the two shapes' centres
// aligned; open paths try forward and reversed. Also: bezier sampling helpers for geometry (outlines, lengths).
import type { AeShape } from './svgpath.ts';

export type Pt = [number, number];
type Cubic = [Pt, Pt, Pt, Pt];

const add = (a: number[], b: number[]): Pt => [a[0] + b[0], a[1] + b[1]];
const sub = (a: number[], b: number[]): Pt => [a[0] - b[0], a[1] - b[1]];
const lerp = (a: number[], b: number[], t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Number of bezier segments (closed paths have one more, back to the first vertex). */
export function segmentCount(s: AeShape): number {
  return s.v.length < 2 ? 0 : s.c ? s.v.length : s.v.length - 1;
}

/** Segment k as absolute control points. */
export function segment(s: AeShape, k: number): Cubic {
  const n = s.v.length, j = (k + 1) % n;
  return [[s.v[k][0], s.v[k][1]], add(s.v[k], s.o[k]), add(s.v[j], s.i[j]), [s.v[j][0], s.v[j][1]]];
}

export function cubicPoint(c: Cubic, t: number): Pt {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
  return [a * c[0][0] + b * c[1][0] + d * c[2][0] + e * c[3][0], a * c[0][1] + b * c[1][1] + d * c[2][1] + e * c[3][1]];
}

/** Arc length of a cubic (polyline approximation). */
export function cubicLength(c: Cubic, steps = 24): number {
  let len = 0, prev = c[0];
  for (let i = 1; i <= steps; i++) { const p = cubicPoint(c, i / steps); len += dist(prev, p); prev = p; }
  return len;
}

/** De Casteljau split at t: [left, right]. */
export function splitCubic(c: Cubic, t: number): [Cubic, Cubic] {
  const p01 = lerp(c[0], c[1], t), p12 = lerp(c[1], c[2], t), p23 = lerp(c[2], c[3], t);
  const p012 = lerp(p01, p12, t), p123 = lerp(p12, p23, t), m = lerp(p012, p123, t);
  return [[c[0], p01, p012, m], [m, p123, p23, c[3]]];
}

export function shapeLength(s: AeShape): number {
  let len = 0;
  for (let k = 0; k < segmentCount(s); k++) len += cubicLength(segment(s, k));
  return len;
}

/** The outline as a polyline (`perSegment` points per bezier segment; closed shapes don't repeat the first point). */
export function flatten(s: AeShape, perSegment = 16): Pt[] {
  const out: Pt[] = [];
  const n = segmentCount(s);
  if (!n) return s.v.length ? [[s.v[0][0], s.v[0][1]]] : [];
  for (let k = 0; k < n; k++) {
    const c = segment(s, k);
    const straight = dist(c[0], c[1]) < 1e-9 && dist(c[2], c[3]) < 1e-9;
    const steps = straight ? 1 : perSegment;
    for (let i = 0; i < steps; i++) out.push(cubicPoint(c, i / steps));
  }
  if (!s.c) out.push([s.v[s.v.length - 1][0], s.v[s.v.length - 1][1]]);
  return out;
}

export function cloneShape(s: AeShape): AeShape {
  const cp = (a: number[][]) => a.map((p) => [p[0], p[1]]);
  return { v: cp(s.v), i: cp(s.i), o: cp(s.o), c: s.c };
}

/** Splits segment k at t, inserting a vertex; the outline is unchanged. */
export function splitSegment(s: AeShape, k: number, t = 0.5): AeShape {
  const r = cloneShape(s);
  const n = r.v.length, j = (k + 1) % n;
  const [a, b] = splitCubic(segment(s, k), t);
  r.o[k] = sub(a[1], a[0]);
  r.i[j] = sub(b[2], b[3]);
  const at = k + 1; // the new vertex follows vertex k (for a closed shape's last segment, it is appended)
  r.v.splice(at, 0, a[3]);
  r.i.splice(at, 0, sub(a[2], a[3]));
  r.o.splice(at, 0, sub(b[1], b[0]));
  return r;
}

/** Adds vertices (splitting the currently longest segment each time) until the shape has `count`. */
export function resample(s: AeShape, count: number): AeShape {
  let r = cloneShape(s);
  if (r.v.length < 2 && count > r.v.length) throw new Error('resample: a shape needs at least 2 vertices');
  while (r.v.length < count) {
    let best = 0, bestLen = -1;
    for (let k = 0; k < segmentCount(r); k++) { const L = cubicLength(segment(r, k)); if (L > bestLen + 1e-9) { bestLen = L; best = k; } }
    r = splitSegment(r, best, 0.5);
  }
  return r;
}

/** Same outline, opposite direction (vertex order reversed, in/out tangents swapped). Closed: keeps vertex 0 first. */
export function reverseShape(s: AeShape): AeShape {
  const n = s.v.length;
  const order: number[] = [];
  if (s.c) { order.push(0); for (let k = n - 1; k >= 1; k--) order.push(k); } else for (let k = n - 1; k >= 0; k--) order.push(k);
  return { v: order.map((k) => [s.v[k][0], s.v[k][1]]), i: order.map((k) => [s.o[k][0], s.o[k][1]]), o: order.map((k) => [s.i[k][0], s.i[k][1]]), c: s.c };
}

/** Closed shape starting at vertex r. */
export function rotateShape(s: AeShape, r: number): AeShape {
  const n = s.v.length, idx = (k: number) => (k + r) % n;
  const pick = (a: number[][]) => a.map((_, k) => [a[idx(k)][0], a[idx(k)][1]]);
  return { v: pick(s.v), i: pick(s.i), o: pick(s.o), c: s.c };
}

/** Signed area of the flattened outline (> 0: clockwise in AE's y-down space). */
export function signedArea(s: AeShape): number {
  const p = flatten(s, 8);
  let a = 0;
  for (let k = 0; k < p.length; k++) { const q = p[(k + 1) % p.length]; a += p[k][0] * q[1] - q[0] * p[k][1]; }
  return a / 2;
}

export function bboxOf(pts: number[][]): { x: number; y: number; w: number; h: number; cx: number; cy: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

/** Total vertex travel from a to b with both centred (sum of distances). */
export function travel(a: AeShape, b: AeShape): number {
  const ca = bboxOf(flatten(a, 8)), cb = bboxOf(flatten(b, 8));
  let t = 0;
  for (let k = 0; k < a.v.length; k++) t += Math.hypot((b.v[k][0] - cb.cx) - (a.v[k][0] - ca.cx), (b.v[k][1] - cb.cy) - (a.v[k][1] - ca.cy));
  return t;
}

export interface MatchResult {
  /** A and B with equal vertex counts, B re-ordered to match A vertex for vertex. */
  a: AeShape;
  b: AeShape;
  /** Start vertex of B (closed shapes, after any reversal). */
  rotation: number;
  /** B was reversed. */
  reversed: boolean;
  /** Total centred vertex travel of the chosen correspondence. */
  cost: number;
}

/**
 * Matches B to A: equal vertex counts (the shape with fewer vertices is subdivided) and the cheapest correspondence.
 * Both must be closed, or both open.
 */
export function matchShapes(a: AeShape, b: AeShape): MatchResult {
  if (a.c !== b.c) throw new Error(`morph: can't morph a ${a.c ? 'closed' : 'open'} path into an ${b.c ? 'closed' : 'open'} one; close both (end the SVG path with Z) or leave both open`);
  if (a.v.length < 2 || b.v.length < 2) throw new Error('morph: each shape needs at least 2 vertices');
  const n = Math.max(a.v.length, b.v.length);
  const A = a.v.length < n ? resample(a, n) : cloneShape(a);
  const B = b.v.length < n ? resample(b, n) : cloneShape(b);
  const cands: { s: AeShape; r: number; rev: boolean }[] = [];
  const dirs: { s: AeShape; rev: boolean }[] = [];
  if (A.c) {
    const wa = signedArea(A), wb = signedArea(B);
    const comparable = Math.abs(wa) > 1e-6 && Math.abs(wb) > 1e-6;
    // Same winding keeps the morph from turning inside out; when it can't be judged, try both directions.
    if (!comparable) { dirs.push({ s: B, rev: false }, { s: reverseShape(B), rev: true }); }
    else if (Math.sign(wa) === Math.sign(wb)) dirs.push({ s: B, rev: false });
    else dirs.push({ s: reverseShape(B), rev: true });
    for (const d of dirs) for (let r = 0; r < n; r++) cands.push({ s: rotateShape(d.s, r), r, rev: d.rev });
  } else {
    cands.push({ s: B, r: 0, rev: false }, { s: reverseShape(B), r: 0, rev: true });
  }
  let best = cands[0], bestCost = Infinity;
  for (const c of cands) { const t = travel(A, c.s); if (t < bestCost - 1e-9) { bestCost = t; best = c; } }
  return { a: A, b: best.s, rotation: best.r, reversed: best.rev, cost: bestCost };
}

/** A chain of shapes (A → B → C …) with one vertex count, each matched to the one before it. */
export function matchSequence(shapes: AeShape[]): AeShape[] {
  if (shapes.length < 2) return shapes.map(cloneShape);
  const n = Math.max(...shapes.map((s) => s.v.length));
  const out: AeShape[] = [shapes[0].v.length < n ? resample(shapes[0], n) : cloneShape(shapes[0])];
  for (let k = 1; k < shapes.length; k++) out.push(matchShapes(out[k - 1], shapes[k]).b);
  return out;
}

/** AE shape → pen points (`<Path points>`). */
export function toPathPoints(s: AeShape): { p: [number, number]; in: [number, number]; out: [number, number] }[] {
  const r = (x: number) => Math.round(x * 1000) / 1000;
  return s.v.map((v, k) => ({ p: [r(v[0]), r(v[1])], in: [r(s.i[k][0]), r(s.i[k][1])], out: [r(s.o[k][0]), r(s.o[k][1])] }));
}
