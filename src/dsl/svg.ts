// <Svg src="logo.svg" /> → a Shape layer with one group per <path>/<rect>/<circle>/<ellipse>/<polygon>,
// fills/strokes from the SVG (attributes, inline style or <style> classes), centred and scaled. Read at
// compile time in Node; every path stays an editable AE shape path (pen tool), with optional draw-on.
import fs from 'node:fs';
import path from 'node:path';
import { jsx } from './jsx-runtime.ts';
import { Fill, Group, Path, Shape, Stroke, Trim } from './primitives.ts';
import type { ShapeProps } from './primitives.ts';
import type { Anim } from './anim.ts';
import { parseSvgPath, shapeBounds } from '../shared/svgpath.ts';

export interface SvgProps extends Omit<ShapeProps, 'children'> {
  /** Path to the .svg (absolute, or relative to the current working directory / scene folder). */
  src: string;
  /** Target width in px (keeps aspect). Default: the SVG's own size. */
  width?: number;
  /** Override every fill color (e.g. brand color or a control). */
  color?: any;
  /** Add a stroke of this color/width (for draw-on reveals). */
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

interface El { d: string; fill?: string; stroke?: string; id?: string }

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? (m[2] ?? m[3]) : undefined;
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

function paint(tag: string, classes: Record<string, Record<string, string>>, key: 'fill' | 'stroke'): string | undefined {
  const inline = attr(tag, 'style')?.split(';').map((s) => s.split(':').map((x) => x.trim())).find(([k]) => k === key)?.[1];
  const cls = (attr(tag, 'class') ?? '').split(/\s+/).map((c) => classes[c]?.[key]).find(Boolean);
  return attr(tag, key) ?? inline ?? cls;
}

export function readSvg(file: string): { els: El[]; viewBox: number[] } {
  const svg = fs.readFileSync(file, 'utf8');
  const classes = styleMap(svg);
  const vb = (attr(/<svg[^>]*>/i.exec(svg)?.[0] ?? '', 'viewBox') ?? '0 0 100 100').split(/[\s,]+/).map(Number);
  const els: El[] = [];
  for (const m of svg.matchAll(/<(path|rect|circle|ellipse|polygon|polyline)\b[^>]*\/?>/gi)) {
    const tag = m[0], kind = m[1].toLowerCase();
    let d = '';
    const n = (a: string, def = 0) => parseFloat(attr(tag, a) ?? String(def));
    if (kind === 'path') d = attr(tag, 'd') ?? '';
    else if (kind === 'rect') { const x = n('x'), y = n('y'), w = n('width'), h = n('height'); d = `M${x} ${y}H${x + w}V${y + h}H${x}Z`; }
    else if (kind === 'circle' || kind === 'ellipse') { const cx = n('cx'), cy = n('cy'), rx = kind === 'circle' ? n('r') : n('rx'), ry = kind === 'circle' ? n('r') : n('ry'); d = `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`; }
    else { const pts = (attr(tag, 'points') ?? '').trim().split(/[\s,]+/).map(Number); d = 'M' + pts.join(' ') + (kind === 'polygon' ? 'Z' : ''); }
    if (d) els.push({ d, fill: paint(tag, classes, 'fill'), stroke: paint(tag, classes, 'stroke'), id: attr(tag, 'id') ?? attr(tag, 'class') });
  }
  return { els, viewBox: vb };
}

export function Svg(p: SvgProps) {
  const dir = (globalThis as any).__AEC_SCENE_DIR__ ?? process.cwd();
  const file = path.isAbsolute(p.src) ? p.src : path.resolve(dir, p.src);
  const { els, viewBox } = readSvg(file);
  const all = els.filter((e) => !p.select || p.select.test(e.id ?? ''));
  const shapes = all.flatMap((e) => parseSvgPath(e.d));
  const b = shapeBounds(shapes.length ? shapes : [{ v: [[viewBox[0], viewBox[1]], [viewBox[0] + viewBox[2], viewBox[1] + viewBox[3]]], i: [], o: [], c: false }]);
  const scale = p.width ? p.width / b.w : 1;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const groups = all.map((e, i) => {
    const sub = parseSvgPath(e.d, { offset: [-cx, -cy], scale });
    const fill = p.color ?? (e.fill && e.fill !== 'none' ? e.fill : undefined);
    const kids: any[] = sub.map((s, k) => jsx(Path, { name: `Path ${k + 1}`, points: s.v.map((v, j) => ({ p: v as [number, number], in: s.i[j] as [number, number], out: s.o[j] as [number, number] })), closed: s.c }));
    if (p.draw) kids.push(jsx(Trim, { end: p.draw }));
    if (p.stroke) kids.push(jsx(Stroke, { color: p.stroke.color, width: p.stroke.width ?? 3 }));
    if (fill) kids.push(jsx(Fill, { color: fill, opacity: p.fillOpacity, rule: 'nonZero' }));
    return jsx(Group, { name: e.id ? `${e.id} ${i + 1}` : `Path ${i + 1}`, children: kids });
  });
  const { src: _s, width: _w, color: _c, stroke: _st, draw: _d, fillOpacity: _f, select: _sel, children: _ch, ...layer } = p as any;
  const extra = p.children === undefined ? [] : Array.isArray(p.children) ? p.children : [p.children];
  return jsx(Shape, { name: p.name ?? path.basename(file, '.svg'), ...layer, children: [...groups, ...extra] });
}
