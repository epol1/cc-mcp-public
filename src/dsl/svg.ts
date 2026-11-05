// <Svg src="logo.svg" /> → a Shape layer with one group per drawn element (path, rect with rx/ry, circle, ellipse,
// line, polygon, polyline, and <use> of any of them), centred and scaled. The SVG is walked as a tree: <g> and
// element transforms (matrix/translate/scale/rotate/skew) are baked into the points, and paint is inherited the SVG
// way (fill, stroke, stroke-width, opacity, fill-opacity, stroke-opacity, fill-rule; default fill black). Linear
// and radial gradients become native Gradient Fills. <defs>, <clipPath>, <mask> and <symbol> contents are not drawn.
// Read at compile time in Node; every path stays an editable AE shape path (pen tool), with optional draw-on.
import fs from 'node:fs';
import path from 'node:path';
import { jsx } from './jsx-runtime.ts';
import { Fill, GradientFill, Group, Path, Shape, Stroke, Trim } from './primitives.ts';
import type { ShapeProps } from './primitives.ts';
import type { Anim } from './anim.ts';
import { parseSvgPath, shapeBounds } from '../shared/svgpath.ts';
import type { AeShape } from '../shared/svgpath.ts';

export interface SvgProps extends Omit<ShapeProps, 'children'> {
  /** Path to the .svg (absolute, or relative to the current working directory / scene folder). */
  src: string;
  /** Target width in px (keeps aspect). Default: the SVG's own size. */
  width?: number;
  /** Override every fill color (e.g. brand color or a control). */
  color?: any;
  /** Add a stroke of this color/width to every element (for draw-on reveals); otherwise the SVG's own strokes are used. */
  stroke?: { color: any; width?: number };
  /** Draw-on animation: a Trim Paths "end" animation (0→100), e.g. tween({ from: 0, to: 100, duration: '1.2s' }). */
  draw?: Anim;
  /** Fill opacity animation (0→100), e.g. to fade the fill in after the draw-on. */
  fillOpacity?: any;
  /** Only include elements whose id/class matches. */
  select?: RegExp;
  /** Extra layer children (e.g. <Effect>, <Mask>), placed after the SVG's groups. */
  children?: any;
}

type M = [number, number, number, number, number, number]; // a b c d e f (SVG matrix)
const ID: M = [1, 0, 0, 1, 0, 0];
const mul = (m: M, n: M): M => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const apply = (m: M, p: number[]): [number, number] => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
const applyVec = (m: M, p: number[]): [number, number] => [m[0] * p[0] + m[2] * p[1], m[1] * p[0] + m[3] * p[1]];

/** SVG transform attribute → matrix. */
export function parseTransform(s: string | undefined): M {
  let m: M = ID;
  for (const t of (s ?? '').matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const a = t[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let n: M = ID;
    if (t[1] === 'matrix' && a.length >= 6) n = [a[0], a[1], a[2], a[3], a[4], a[5]];
    else if (t[1] === 'translate') n = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
    else if (t[1] === 'scale') n = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
    else if (t[1] === 'rotate') {
      const r = ((a[0] ?? 0) * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
      n = [cos, sin, -sin, cos, 0, 0];
      if (a.length >= 3) n = mul(mul([1, 0, 0, 1, a[1], a[2]], n), [1, 0, 0, 1, -a[1], -a[2]]);
    } else if (t[1] === 'skewX') n = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
    else if (t[1] === 'skewY') n = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
    m = mul(m, n);
  }
  return m;
}

interface Node { name: string; attrs: Record<string, string>; kids: Node[] }

/** A small XML tree (tags and attributes; text, comments and doctypes ignored). */
function parseXml(src: string): Node {
  const root: Node = { name: '#root', attrs: {}, kids: [] };
  const stack = [root];
  const clean = src.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!DOCTYPE[\s\S]*?>/gi, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  for (const t of clean.matchAll(/<(\/?)([\w:-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g)) {
    if (t[1]) { if (stack.length > 1) stack.pop(); continue; }
    const attrs: Record<string, string> = {};
    for (const a of t[3].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = a[2] ?? a[3];
    const node: Node = { name: t[2].replace(/^svg:/, ''), attrs, kids: [] };
    stack[stack.length - 1].kids.push(node);
    if (!t[4]) stack.push(node);
  }
  return root;
}

function styleMap(svg: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  const css = /<style[^>]*>([\s\S]*?)<\/style>/i.exec(svg)?.[1] ?? '';
  for (const m of css.matchAll(/\.([\w-]+)\s*\{([^}]*)\}/g)) {
    const props: Record<string, string> = {};
    for (const kv of m[2].split(';')) { const [k, v] = kv.split(':').map((s) => s?.trim()); if (k && v) props[k] = v; }
    out[m[1]] = props;
  }
  return out;
}

const PAINT = ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'fill-rule', 'display', 'visibility', 'stroke-linecap', 'stroke-linejoin'] as const;
type Paint = Partial<Record<(typeof PAINT)[number], string>>;

/** Presentation attributes < class rules < inline style (CSS precedence); inheritable ones flow to children. */
function paintOf(n: Node, classes: Record<string, Record<string, string>>, inherited: Paint): Paint {
  const own: Paint = {};
  for (const k of PAINT) if (n.attrs[k] !== undefined) own[k] = n.attrs[k];
  for (const c of (n.attrs.class ?? '').split(/\s+/)) for (const k of PAINT) if (classes[c]?.[k] !== undefined) own[k] = classes[c][k];
  for (const kv of (n.attrs.style ?? '').split(';')) { const [k, v] = kv.split(':').map((x) => x?.trim()); if (k && v && (PAINT as readonly string[]).includes(k)) own[k as keyof Paint] = v; }
  // opacity multiplies down the tree; the rest is inherited unless set.
  const out: Paint = { ...inherited, ...own };
  if (own.opacity !== undefined || inherited.opacity !== undefined) out.opacity = String((parseFloat(inherited.opacity ?? '1')) * (parseFloat(own.opacity ?? '1')));
  return out;
}

export interface SvgGradient { type: 'linear' | 'radial'; stops: { offset: number; color: string; opacity?: number }[]; units: 'bbox' | 'user'; m: M; x1: number; y1: number; x2: number; y2: number }
export interface SvgEl { d: string; m: M; paint: Paint; id?: string }

function gradients(root: Node): Record<string, SvgGradient> {
  const out: Record<string, SvgGradient> = {};
  const raw: Record<string, Node> = {};
  const walk = (n: Node) => { if ((n.name === 'linearGradient' || n.name === 'radialGradient') && n.attrs.id) raw[n.attrs.id] = n; n.kids.forEach(walk); };
  walk(root);
  const num = (v: string | undefined, d: number) => (v === undefined ? d : /%$/.test(v) ? parseFloat(v) / 100 : parseFloat(v));
  const resolve = (id: string, depth = 0): SvgGradient | undefined => {
    const n = raw[id];
    if (!n) return undefined;
    const href = (n.attrs.href ?? n.attrs['xlink:href'])?.replace(/^#/, '');
    const parent = href && depth < 4 ? resolve(href, depth + 1) : undefined;
    let stops: SvgGradient['stops'] = n.kids.filter((k) => k.name === 'stop').map((s) => {
      const st: Record<string, string> = {};
      for (const kv of (s.attrs.style ?? '').split(';')) { const [k, v] = kv.split(':').map((x) => x?.trim()); if (k && v) st[k] = v; }
      return { offset: Math.max(0, Math.min(1, num(s.attrs.offset, 0))), color: st['stop-color'] ?? s.attrs['stop-color'] ?? '#000000', opacity: parseFloat(st['stop-opacity'] ?? s.attrs['stop-opacity'] ?? '1') };
    });
    if (!stops.length && parent) stops = parent.stops;
    const radial = n.name === 'radialGradient';
    const units = (n.attrs.gradientUnits ?? (parent?.units === 'user' ? 'userSpaceOnUse' : 'objectBoundingBox')) === 'userSpaceOnUse' ? 'user' : 'bbox';
    const g: SvgGradient = radial
      ? { type: 'radial', stops, units, m: parseTransform(n.attrs.gradientTransform), x1: num(n.attrs.cx, 0.5), y1: num(n.attrs.cy, 0.5), x2: num(n.attrs.cx, 0.5) + num(n.attrs.r, 0.5), y2: num(n.attrs.cy, 0.5) }
      : { type: 'linear', stops, units, m: parseTransform(n.attrs.gradientTransform), x1: num(n.attrs.x1, 0), y1: num(n.attrs.y1, 0), x2: num(n.attrs.x2, 1), y2: num(n.attrs.y2, 0) };
    return g;
  };
  for (const id of Object.keys(raw)) { const g = resolve(id); if (g) out[id] = g; }
  return out;
}

/** Path data of a basic shape element (in its own user space). */
function shapeD(n: Node): string {
  const a = n.attrs;
  const f = (k: string, d = 0) => (a[k] === undefined ? d : parseFloat(a[k]));
  switch (n.name) {
    case 'path': return a.d ?? '';
    case 'rect': {
      const x = f('x'), y = f('y'), w = f('width'), h = f('height');
      let rx = a.rx !== undefined ? f('rx') : a.ry !== undefined ? f('ry') : 0, ry = a.ry !== undefined ? f('ry') : rx;
      rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
      if (!rx || !ry) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
      return `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
    }
    case 'circle': case 'ellipse': {
      const cx = f('cx'), cy = f('cy'), rx = n.name === 'circle' ? f('r') : f('rx'), ry = n.name === 'circle' ? f('r') : f('ry');
      return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
    }
    case 'line': return `M${f('x1')} ${f('y1')}L${f('x2')} ${f('y2')}`;
    case 'polygon': case 'polyline': {
      const pts = (a.points ?? '').trim().split(/[\s,]+/).filter(Boolean).map(Number);
      return pts.length >= 2 ? 'M' + pts.join(' ') + (n.name === 'polygon' ? 'Z' : '') : '';
    }
  }
  return '';
}

const DRAWN = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polygon', 'polyline']);
const HIDDEN = new Set(['defs', 'clipPath', 'mask', 'symbol', 'marker', 'pattern', 'title', 'desc', 'metadata', 'style', 'linearGradient', 'radialGradient', 'filter']);

export function readSvg(file: string): { els: SvgEl[]; viewBox: number[]; gradients: Record<string, SvgGradient> } {
  const svg = fs.readFileSync(file, 'utf8');
  const classes = styleMap(svg);
  const root = parseXml(svg);
  const svgNode = root.kids.find((k) => k.name === 'svg') ?? root;
  const vb = (svgNode.attrs.viewBox ?? `0 0 ${parseFloat(svgNode.attrs.width ?? '100')} ${parseFloat(svgNode.attrs.height ?? '100')}`).split(/[\s,]+/).map(Number);
  const byId: Record<string, Node> = {};
  const index = (n: Node) => { if (n.attrs.id) byId[n.attrs.id] = n; n.kids.forEach(index); };
  index(root);
  const els: SvgEl[] = [];
  const walk = (n: Node, m: M, paint: Paint, depth: number) => {
    if (HIDDEN.has(n.name) || depth > 32) return;
    const p = paintOf(n, classes, paint);
    if (p.display === 'none' || p.visibility === 'hidden') return;
    let mm = mul(m, parseTransform(n.attrs.transform));
    if (n.name === 'use') {
      const ref = byId[(n.attrs.href ?? n.attrs['xlink:href'] ?? '').replace(/^#/, '')];
      if (!ref) return;
      mm = mul(mm, [1, 0, 0, 1, parseFloat(n.attrs.x ?? '0'), parseFloat(n.attrs.y ?? '0')]);
      // A referenced <symbol> draws its children.
      const target = ref.name === 'symbol' ? { ...ref, name: 'g' } : ref;
      walk(target, mm, p, depth + 1);
      return;
    }
    if (DRAWN.has(n.name)) {
      const d = shapeD(n);
      if (d) els.push({ d, m: mm, paint: p, id: n.attrs.id ?? n.attrs.class });
      return;
    }
    for (const k of n.kids) walk(k, mm, p, depth + 1);
  };
  for (const k of svgNode.kids) walk(k, ID, {}, 0);
  return { els, viewBox: vb, gradients: gradients(root) };
}

/** Bakes a matrix into AE shape vertices and tangents. */
function transformShape(s: AeShape, m: M): AeShape {
  return { v: s.v.map((p) => apply(m, p)), i: s.i.map((t) => applyVec(m, t)), o: s.o.map((t) => applyVec(m, t)), c: s.c };
}

const isNone = (v?: string) => !v || v === 'none' || v === 'transparent';
const urlId = (v?: string) => /^url\(\s*#([^)\s]+)\s*\)/.exec(v ?? '')?.[1];

export function Svg(p: SvgProps) {
  const dir = (globalThis as any).__AEC_SCENE_DIR__ ?? process.cwd();
  const file = path.isAbsolute(p.src) ? p.src : path.resolve(dir, p.src);
  const { els, viewBox, gradients: grads } = readSvg(file);
  const all = els.filter((e) => !p.select || p.select.test(e.id ?? ''));
  const placed = all.map((e) => ({ e, shapes: parseSvgPath(e.d).map((s) => transformShape(s, e.m)) }));
  const flat = placed.flatMap((x) => x.shapes);
  const b = shapeBounds(flat.length ? flat : [{ v: [[viewBox[0], viewBox[1]], [viewBox[0] + viewBox[2], viewBox[1] + viewBox[3]]], i: [], o: [], c: false }]);
  const scale = p.width ? p.width / b.w : 1;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const toLayer = (q: number[]): [number, number] => [(q[0] - cx) * scale, (q[1] - cy) * scale];
  const groups = placed.map(({ e, shapes }, i) => {
    const sub = shapes.map((s) => ({ v: s.v.map(toLayer), i: s.i.map((t) => [t[0] * scale, t[1] * scale] as [number, number]), o: s.o.map((t) => [t[0] * scale, t[1] * scale] as [number, number]), c: s.c }));
    const kids: any[] = sub.map((s, k) => jsx(Path, { name: `Path ${k + 1}`, points: s.v.map((v, j) => ({ p: v, in: s.i[j], out: s.o[j] })), closed: s.c }));
    const op = parseFloat(e.paint.opacity ?? '1');
    const rule = e.paint['fill-rule'] === 'evenodd' ? 'evenOdd' : 'nonZero';
    if (p.draw) kids.push(jsx(Trim, { end: p.draw }));
    // Stroke: the prop overrides; otherwise the SVG's own (width scaled with the drawing).
    if (p.stroke) kids.push(jsx(Stroke, { color: p.stroke.color, width: p.stroke.width ?? 3 }));
    else if (!isNone(e.paint.stroke) && !urlId(e.paint.stroke)) {
      const lin = Math.sqrt(Math.abs(e.m[0] * e.m[3] - e.m[1] * e.m[2])) || 1;
      kids.push(jsx(Stroke, {
        color: e.paint.stroke, width: parseFloat(e.paint['stroke-width'] ?? '1') * lin * scale,
        opacity: Math.round(100 * op * parseFloat(e.paint['stroke-opacity'] ?? '1')),
        cap: ({ round: 'round', square: 'square' } as any)[e.paint['stroke-linecap'] ?? ''] ?? 'butt',
        join: ({ round: 'round', bevel: 'bevel' } as any)[e.paint['stroke-linejoin'] ?? ''] ?? 'miter',
      }));
    }
    // Fill: the color prop overrides; a gradient becomes a native Gradient Fill; SVG's default fill is black.
    const fillOpacity = p.fillOpacity ?? Math.round(100 * op * parseFloat(e.paint['fill-opacity'] ?? '1'));
    const gid = urlId(e.paint.fill);
    if (p.color !== undefined) kids.push(jsx(Fill, { color: p.color, opacity: p.fillOpacity, rule }));
    else if (gid && grads[gid]?.stops.length) {
      const g = grads[gid];
      const eb = shapeBounds(shapes);
      // Gradient points in SVG user space (objectBoundingBox units map onto the element's bounds), then layer space.
      const pt = (x: number, y: number) => {
        const u = g.units === 'bbox' ? [eb.x + x * eb.w, eb.y + y * eb.h] : apply(e.m, [x, y]);
        return toLayer(apply(g.m, u));
      };
      kids.push(jsx(GradientFill, { type: g.type, stops: g.stops.map((s) => ({ offset: s.offset, color: s.color, opacity: s.opacity })), start: pt(g.x1, g.y1), end: pt(g.x2, g.y2), opacity: typeof fillOpacity === 'number' ? fillOpacity : undefined }));
    } else if (!isNone(e.paint.fill) || e.paint.fill === undefined) {
      kids.push(jsx(Fill, { color: e.paint.fill && !gid ? e.paint.fill : '#000000', opacity: fillOpacity, rule }));
    }
    return jsx(Group, { name: e.id ? `${e.id} ${i + 1}` : `Path ${i + 1}`, children: kids });
  });
  const { src: _s, width: _w, color: _c, stroke: _st, draw: _d, fillOpacity: _f, select: _sel, children: _ch, ...layer } = p as any;
  const extra = p.children === undefined ? [] : Array.isArray(p.children) ? p.children : [p.children];
  return jsx(Shape, { name: p.name ?? path.basename(file, '.svg'), ...layer, children: [...groups, ...extra] });
}
