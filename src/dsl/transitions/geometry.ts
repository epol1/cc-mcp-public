// Geometry of shapes taken from a scene (for shape-from-scene wipes and zoom-throughs): the filled silhouette of a
// <Shape> element as polygons in its layer space, where that sits in the comp, and the scale at which it covers the
// frame (computed in Node from static props; animated props use their rest/`to` value).
import { jsx } from '../jsx-runtime.ts';
import type { AecElement } from '../jsx-runtime.ts';
import { Fill, Group } from '../primitives.ts';
import { isAnim } from '../anim.ts';
import { parseSvgPath } from '../../shared/svgpath.ts';
import type { AeShape } from '../../shared/svgpath.ts';
import { bboxOf, flatten } from '../../shared/morph.ts';
import type { Pt } from '../../shared/morph.ts';
import { expand, kindOf } from './core.ts';

/** Static value of a prop (numbers/arrays as is, an animation's `to`, else the default). */
function rest(v: any, d: number[]): number[] {
  if (typeof v === 'number') return d.length === 1 ? [v] : [v, v];
  if (Array.isArray(v)) return [v[0], v[1] ?? v[0]];
  if (isAnim(v) && (v as any).to !== undefined) return rest((v as any).to, d);
  return d;
}
const one = (v: any, d: number) => rest(v, [d])[0];

const rot = (p: number[], deg: number): Pt => { const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return [p[0] * c - p[1] * s, p[0] * s + p[1] * c]; };

/** Group / layer transform: position + R(rotation)·(scale ⊙ (p − anchor)). */
function apply(pts: Pt[], pos: number[], anchor: number[], scale: number[], deg: number): Pt[] {
  return pts.map((p) => { const q = rot([(p[0] - anchor[0]) * scale[0] / 100, (p[1] - anchor[1]) * scale[1] / 100], deg); return [pos[0] + q[0], pos[1] + q[1]]; });
}

function roundedRect(w: number, h: number, r: number): Pt[] {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (rr < 1e-6) return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
  const out: Pt[] = [];
  const corners: [number, number, number][] = [[w / 2 - rr, -h / 2 + rr, -90], [w / 2 - rr, h / 2 - rr, 0], [-w / 2 + rr, h / 2 - rr, 90], [-w / 2 + rr, -h / 2 + rr, 180]];
  for (const [cx, cy, a0] of corners) for (let k = 0; k <= 6; k++) { const a = ((a0 + (k * 90) / 6) * Math.PI) / 180; out.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]); }
  return out;
}

function shapeFromPoints(points: any[], closed: boolean): AeShape {
  return { v: points.map((q) => q.p), i: points.map((q) => q.in ?? [0, 0]), o: points.map((q) => q.out ?? [0, 0]), c: closed };
}

/** Filled outlines of a shape layer's contents, in layer space. */
export function polygonsOf(children: any): Pt[][] {
  const out: Pt[][] = [];
  for (const c of expand(children)) {
    const k = kindOf(c), p = c.props;
    const at = (pts: Pt[], pos: any) => { const o = rest(pos, [0, 0]); return pts.map((q): Pt => [q[0] + o[0], q[1] + o[1]]); };
    switch (k) {
      case 'rect': { const s = rest(p.size, [100, 100]); out.push(at(roundedRect(s[0], s[1], one(p.roundness, 0)), p.position)); break; }
      case 'ellipse': { const s = rest(p.size, [100, 100]); const pts: Pt[] = []; for (let i = 0; i < 48; i++) { const a = (i / 48) * 2 * Math.PI; pts.push([(s[0] / 2) * Math.cos(a), (s[1] / 2) * Math.sin(a)]); } out.push(at(pts, p.position)); break; }
      case 'star': {
        const n = Math.max(3, Math.round(one(p.points, 5))), R = one(p.outerRadius, 100), r = one(p.innerRadius, 50), a0 = one(p.rotation, 0), poly = p.type === 'polygon';
        const pts: Pt[] = [];
        for (let i = 0; i < (poly ? n : 2 * n); i++) { const rad = poly || i % 2 === 0 ? R : r; const a = ((a0 - 90 + (i * 360) / (poly ? n : 2 * n)) * Math.PI) / 180; pts.push([rad * Math.cos(a), rad * Math.sin(a)]); }
        out.push(at(pts, p.position));
        break;
      }
      case 'path': {
        const shapes: AeShape[] = p.morph?.length ? [p.morph[0].d ? parseSvgPath(p.morph[0].d)[0] : shapeFromPoints(p.morph[0].points, p.closed !== false)] : p.d ? parseSvgPath(p.d) : p.points ? [shapeFromPoints(p.points, p.closed !== false)] : [];
        for (const s of shapes) if (s && s.v.length > 1) out.push(flatten(s, 12));
        break;
      }
      case 'group': {
        const inner = polygonsOf(p.children);
        for (const poly of inner) out.push(apply(poly, rest(p.position, [0, 0]), rest(p.anchor, [0, 0]), rest(p.scale, [100, 100]), one(p.rotation, 0)));
        break;
      }
      default: break;
    }
  }
  return out;
}

const GEOMETRY = new Set(['rect', 'ellipse', 'star', 'path', 'merge', 'offset', 'roundCorners', 'twist', 'puckerBloat', 'wigglePaths', 'zigzag', 'repeater']);

/**
 * The shape's contents with every paint, Trim, effect and mask removed (geometry and path operators only); each
 * group gets its own Fill so nested paths are painted whatever the parent's paints do.
 */
export function geometryOnly(children: any, color: any): AecElement[] {
  const out: AecElement[] = [];
  for (const c of expand(children)) {
    const k = kindOf(c);
    if (k === 'group') out.push({ ...c, props: { ...c.props, opacity: undefined, children: [...geometryOnly(c.props.children, color), jsx(Fill, { color })] } });
    else if (k && GEOMETRY.has(k)) out.push(c);
  }
  return out;
}

/** The first paint color in a shape (Fill, then Stroke), for a visible silhouette. */
export function paintColor(children: any): any {
  let stroke: any;
  for (const c of expand(children)) {
    const k = kindOf(c);
    if (k === 'fill' && c.props.color !== undefined && !isAnim(c.props.color)) return c.props.color;
    if (k === 'stroke' && stroke === undefined && c.props.color !== undefined && !isAnim(c.props.color)) stroke = c.props.color;
    if (k === 'group') { const g = paintColor(c.props.children); if (g !== undefined) return g; }
  }
  return stroke;
}

const BOX: Record<string, [number, number]> = { center: [0.5, 0.5], top: [0.5, 0], bottom: [0.5, 1], left: [0, 0.5], right: [1, 0.5], topLeft: [0, 0], topRight: [1, 0], bottomLeft: [0, 1], bottomRight: [1, 1] };

export interface Silhouette {
  polys: Pt[][];
  /** Centre of the outline's bounding box, in layer space. */
  center: Pt;
  /** Where that centre sits in the comp. */
  pos: Pt;
  scale: Pt;
  rotation: number;
  space: 'layer' | 'comp';
  bbox: { w: number; h: number };
}

/** A <Shape> element's silhouette and pose (static props; positioned layers only, not layout-solved ones). */
export function silhouetteOf(el: AecElement, w: number, h: number): Silhouette {
  if (kindOf(el) !== 'shape') throw new Error(`transitions: expected a <Shape> element to take the shape from, got <${el?.type?.displayName ?? kindOf(el) ?? typeof el}>`);
  const p = el.props;
  const polys = polygonsOf(p.children);
  if (!polys.length) throw new Error(`transitions: shape ${p.id ?? p.name ?? ''} has no Rect/Ellipse/Star/Path to take the outline from`);
  const bb = bboxOf(polys.flat());
  const space: 'layer' | 'comp' = p.space === 'comp' ? 'comp' : 'layer';
  const pos = space === 'comp' ? [0, 0] : [w / 2, h / 2];
  if (typeof p.x === 'number') pos[0] = p.x;
  if (typeof p.y === 'number') pos[1] = p.y;
  if (Array.isArray(p.position)) { pos[0] = p.position[0]; pos[1] = p.position[1]; }
  const anchor = Array.isArray(p.anchor) ? [p.anchor[0], p.anchor[1]] : typeof p.anchor === 'string' ? [bb.x + bb.w * BOX[p.anchor][0], bb.y + bb.h * BOX[p.anchor][1]] : [0, 0];
  const scale = rest(p.scale, [100, 100]) as Pt;
  const rotation = one(p.rotation, 0);
  const center: Pt = [bb.cx, bb.cy];
  const c = apply([center], pos, anchor, scale, rotation)[0];
  return { polys, center, pos: c, scale, rotation, space, bbox: { w: bb.w, h: bb.h } };
}

function inside(poly: Pt[], q: Pt): boolean {
  let inn = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > q[1]) !== (b[1] > q[1]) && q[0] < ((b[0] - a[0]) * (q[1] - a[1])) / (b[1] - a[1] || 1e-12) + a[0]) inn = !inn;
  }
  return inn;
}

/** Distance from `c` to where a ray in direction `u` leaves the polygons that contain `c` (0 if none does). */
export function rayExit(polys: Pt[][], c: Pt, u: Pt): number {
  let best = 0;
  for (const poly of polys) {
    if (!inside(poly, c)) continue;
    let tMin = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ex = b[0] - a[0], ey = b[1] - a[1];
      const den = u[0] * ey - u[1] * ex;
      if (Math.abs(den) < 1e-12) continue;
      const ax = a[0] - c[0], ay = a[1] - c[1];
      const t = (ax * ey - ay * ex) / den, s = (ax * u[1] - ay * u[0]) / den;
      if (t > 1e-9 && s >= -1e-9 && s <= 1 + 1e-9 && t < tMin) tMin = t;
    }
    if (tMin < Infinity && tMin > best) best = tMin;
  }
  return best;
}

/**
 * Scale (absolute %, [x, y]) at which the silhouette, scaled about `about` (layer space; default its centre), covers
 * the whole frame. 'uniform' keeps the aspect; 'fit' stretches each axis in proportion to the frame's extent in it
 * (a bar becomes a full panel). Returns null when the outline doesn't contain the scaling centre.
 */
export function coverScale(s: Silhouette, w: number, h: number, mode: 'uniform' | 'fit', about?: { local: Pt; comp: Pt }, margin = 1.04): [number, number] | null {
  const cl = about?.local ?? s.center, cc = about?.comp ?? s.pos;
  const corners: Pt[] = [[0, 0], [w, 0], [w, h], [0, h]];
  const local = corners.map((q): Pt => { const d = rot([q[0] - cc[0], q[1] - cc[1]], -s.rotation); return [d[0] / (s.scale[0] / 100 || 1e-9), d[1] / (s.scale[1] / 100 || 1e-9)]; });
  let base: Pt = [1, 1];
  if (mode === 'fit') {
    const hx = Math.max(...local.map((q) => Math.abs(q[0]))), hy = Math.max(...local.map((q) => Math.abs(q[1])));
    base = [s.bbox.w > 1e-6 ? hx / (s.bbox.w / 2) : 1, s.bbox.h > 1e-6 ? hy / (s.bbox.h / 2) : 1];
  }
  let k = 0;
  for (const q of local) {
    const n: Pt = [q[0] / base[0], q[1] / base[1]], len = Math.hypot(n[0], n[1]);
    if (len < 1e-9) continue;
    const rho = rayExit(s.polys, cl, [n[0] / len, n[1] / len]);
    if (rho <= 1e-9) return null;
    k = Math.max(k, len / rho);
  }
  return [s.scale[0] * base[0] * k * margin + 0.5, s.scale[1] * base[1] * k * margin + 0.5];
}

/** A filled silhouette layer's contents: geometry, then one Fill. */
export function silhouetteContents(children: any, color: any): AecElement[] {
  const c = color ?? '#ffffff';
  return [jsx(Group, { name: 'Silhouette', children: [...geometryOnly(children, c), jsx(Fill, { name: 'Silhouette Fill', color: c })] })];
}
