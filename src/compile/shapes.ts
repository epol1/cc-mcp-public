// Shape layer contents → GroupSpecs. Children follow AE Contents order (first = frontmost; Fill/Stroke
// paint the paths above them). Property paths are relative to each added item.
import type { AecElement } from '../dsl/jsx-runtime.ts';
import { childrenOf } from '../dsl/jsx-runtime.ts';
import { parseColor, parseTime } from '@cc-mcp/core/units.ts';
import { resolveEasing } from '../shared/easing.ts';
import { parseSvgPath } from '../shared/svgpath.ts';
import type { PathPoint } from '../dsl/primitives.ts';
import type { PropSpec, PropTarget, ValueCtx } from './values.ts';
import { lowerValue, TOL } from './values.ts';
import { buildGradient } from './gradients.ts';

const V = 'ADBE Vector ';

function prop(out: PropSpec[], value: any, t: Omit<PropTarget, 'tol'> & { tol?: number }, ctx: ValueCtx): void {
  if (value === undefined) return;
  const s = lowerValue(value, { tol: TOL.generic, ...t } as PropTarget, ctx);
  if (s) out.push(s);
}

const vec2 = (v: any) => (typeof v === 'number' ? [v, v] : [v[0], v[1] ?? v[0]]);
const colorConv = (c: any) => parseColor(c);

export function pointsToShape(points: PathPoint[], closed: boolean): any {
  return { v: points.map((p) => p.p), i: points.map((p) => p.in ?? [0, 0]), o: points.map((p) => p.out ?? [0, 0]), c: closed };
}

function pathItems(el: AecElement, ctx: ValueCtx): any[] {
  const p = el.props;
  if (p.morph && p.morph.length) {
    const shapes = p.morph.map((m: any) => (m.d ? parseSvgPath(m.d)[0] : pointsToShape(m.points, p.closed !== false)));
    const keys = p.morph.map((m: any, i: number) => {
      const k: any = { t: ctx.t0 + parseTime(m.t, ctx.fps), v: shapes[i] };
      const c = resolveEasing(m.easing ?? 'easeInOutCubic');
      if (c.bezier) {
        k.oe = [{ speed: 0, influence: Math.max(c.bezier[0], 0.001) * 100 }];
        k.ie = [{ speed: 0, influence: Math.max(1 - (i > 0 ? resolveEasing(p.morph[i - 1].easing ?? 'easeInOutCubic').bezier![2] : 1 - 1 / 3), 0.001) * 100 }];
      }
      return k;
    });
    return [{ mn: `${V}Shape - Group`, name: p.name, props: [{ p: `${V}Shape`, keys }] }];
  }
  const shapes = p.d ? parseSvgPath(p.d) : p.points ? [pointsToShape(p.points, p.closed !== false)] : [];
  if (!shapes.length) throw new Error('<Path> needs `d` (SVG path data) or `points`');
  return shapes.map((s, i) => ({ mn: `${V}Shape - Group`, name: shapes.length > 1 ? `${p.name ?? 'Path'} ${i + 1}` : p.name, props: [{ p: `${V}Shape`, v: s }] }));
}

export function shapeItems(children: any, ctx: ValueCtx, warnings: string[]): any[] {
  const items: any[] = [];
  for (const c of childrenOf(children)) {
    if (typeof c === 'string') { if (c.trim()) throw new Error(`text "${c.trim()}" inside <Shape>; use <Text> for text`); continue; }
    const kind = c.type?.aec;
    if (kind === 'effect' || kind === 'rigEffect' || kind === 'mask') continue; // layer-level, collected by the compiler
    if (!kind && typeof c.type === 'function') { items.push(...shapeItems(c.type(c.props), ctx, warnings)); continue; }
    const p = c.props;
    const props: PropSpec[] = [];
    switch (kind) {
      case 'group': {
        const tg = `${V}Transform Group`;
        prop(props, p.position, { path: `${tg}/${V}Position`, rest: [0, 0], dims: 2, conv: vec2 }, ctx);
        prop(props, p.anchor, { path: `${tg}/${V}Anchor`, rest: [0, 0], dims: 2, conv: vec2 }, ctx);
        prop(props, p.scale, { path: `${tg}/${V}Scale`, rest: [100, 100], dims: 2, conv: vec2 }, ctx);
        prop(props, p.rotation, { path: `${tg}/${V}Rotation`, rest: [0], dims: 1 }, ctx);
        prop(props, p.opacity, { path: `${tg}/${V}Group Opacity`, rest: [100], dims: 1 }, ctx);
        prop(props, p.skew, { path: `${tg}/${V}Skew`, rest: [0], dims: 1 }, ctx);
        items.push({ mn: `${V}Group`, name: p.name, kids: [{ at: 'ADBE Vectors Group', items: shapeItems(p.children, ctx, warnings) }], props });
        break;
      }
      case 'rect':
        prop(props, p.size ?? [100, 100], { path: `${V}Rect Size`, rest: [100, 100], dims: 2, conv: vec2 }, ctx);
        prop(props, p.position, { path: `${V}Rect Position`, rest: [0, 0], dims: 2, conv: vec2 }, ctx);
        prop(props, p.roundness, { path: `${V}Rect Roundness`, rest: [0], dims: 1 }, ctx);
        items.push({ mn: `${V}Shape - Rect`, name: p.name, props });
        break;
      case 'ellipse':
        prop(props, p.size ?? [100, 100], { path: `${V}Ellipse Size`, rest: [100, 100], dims: 2, conv: vec2 }, ctx);
        prop(props, p.position, { path: `${V}Ellipse Position`, rest: [0, 0], dims: 2, conv: vec2 }, ctx);
        items.push({ mn: `${V}Shape - Ellipse`, name: p.name, props });
        break;
      case 'star':
        props.push({ p: `${V}Star Type`, v: p.type === 'polygon' ? 2 : 1 });
        prop(props, p.points, { path: `${V}Star Points`, rest: [5], dims: 1 }, ctx);
        prop(props, p.outerRadius, { path: `${V}Star Outer Radius`, rest: [100], dims: 1 }, ctx);
        if (p.type !== 'polygon') prop(props, p.innerRadius, { path: `${V}Star Inner Radius`, rest: [50], dims: 1 }, ctx);
        prop(props, p.outerRoundness, { path: `${V}Star Outer Roundess`, rest: [0], dims: 1 }, ctx);
        if (p.type !== 'polygon') prop(props, p.innerRoundness, { path: `${V}Star Inner Roundess`, rest: [0], dims: 1 }, ctx);
        prop(props, p.rotation, { path: `${V}Star Rotation`, rest: [0], dims: 1 }, ctx);
        prop(props, p.position, { path: `${V}Star Position`, rest: [0, 0], dims: 2, conv: vec2 }, ctx);
        items.push({ mn: `${V}Shape - Star`, name: p.name, props });
        break;
      case 'path':
        items.push(...pathItems(c, ctx));
        break;
      case 'fill':
        prop(props, p.color ?? '#ffffff', { path: `${V}Fill Color`, rest: [1, 1, 1, 1], dims: 4, conv: colorConv, tol: TOL.color }, ctx);
        prop(props, p.opacity, { path: `${V}Fill Opacity`, rest: [100], dims: 1 }, ctx);
        if (p.rule) props.push({ p: `${V}Fill Rule`, v: p.rule === 'evenOdd' ? 2 : 1 });
        items.push({ mn: `${V}Graphic - Fill`, name: p.name, props });
        break;
      case 'stroke': {
        prop(props, p.color ?? '#ffffff', { path: `${V}Stroke Color`, rest: [1, 1, 1, 1], dims: 4, conv: colorConv, tol: TOL.color }, ctx);
        prop(props, p.width ?? 4, { path: `${V}Stroke Width`, rest: [4], dims: 1 }, ctx);
        prop(props, p.opacity, { path: `${V}Stroke Opacity`, rest: [100], dims: 1 }, ctx);
        if (p.cap) props.push({ p: `${V}Stroke Line Cap`, v: { butt: 1, round: 2, square: 3 }[p.cap as string] });
        if (p.join) props.push({ p: `${V}Stroke Line Join`, v: { miter: 1, round: 2, bevel: 3 }[p.join as string] });
        if (p.taperStart !== undefined) props.push({ p: `${V}Stroke Taper/${V}Taper Start Length`, v: p.taperStart });
        if (p.taperEnd !== undefined) props.push({ p: `${V}Stroke Taper/${V}Taper End Length`, v: p.taperEnd });
        const kids: any[] = [];
        if (p.dash && p.dash.length) {
          const dashItems: any[] = [];
          p.dash.slice(0, 6).forEach((len: number, i: number) => dashItems.push({ mn: `${V}Stroke ${i % 2 ? 'Gap' : 'Dash'} ${Math.floor(i / 2) + 1}`, set: { v: len } }));
          const off = p.dashOffset !== undefined ? lowerValue(p.dashOffset, { path: '#1', rest: [0], dims: 1, tol: TOL.generic }, ctx) : null;
          dashItems.push({ mn: `${V}Stroke Offset`, set: off ? { v: off.v, keys: off.keys, expr: off.expr } : { v: 0 } });
          kids.push({ at: `${V}Stroke Dashes`, items: dashItems });
        }
        items.push({ mn: `${V}Graphic - Stroke`, name: p.name, props, kids: kids.length ? kids : undefined });
        break;
      }
      case 'gfill':
      case 'gstroke':
        items.push(buildGradient(kind, p, ctx, warnings));
        break;
      case 'trim':
        prop(props, p.start, { path: `${V}Trim Start`, rest: [0], dims: 1 }, ctx);
        prop(props, p.end, { path: `${V}Trim End`, rest: [100], dims: 1 }, ctx);
        prop(props, p.offset, { path: `${V}Trim Offset`, rest: [0], dims: 1 }, ctx);
        if (p.individually) props.push({ p: `${V}Trim Type`, v: 2 });
        items.push({ mn: `${V}Filter - Trim`, name: p.name, props });
        break;
      case 'repeater': {
        const rt = `${V}Repeater Transform`;
        prop(props, p.copies ?? 3, { path: `${V}Repeater Copies`, rest: [3], dims: 1 }, ctx);
        prop(props, p.offset, { path: `${V}Repeater Offset`, rest: [0], dims: 1 }, ctx);
        if (p.order) props.push({ p: `${V}Repeater Order`, v: p.order === 'above' ? 2 : 1 });
        prop(props, p.position ?? [100, 0], { path: `${rt}/${V}Repeater Position`, rest: [100, 0], dims: 2, conv: vec2 }, ctx);
        prop(props, p.anchor, { path: `${rt}/${V}Repeater Anchor`, rest: [0, 0], dims: 2, conv: vec2 }, ctx);
        prop(props, p.scale, { path: `${rt}/${V}Repeater Scale`, rest: [100, 100], dims: 2, conv: vec2 }, ctx);
        prop(props, p.rotation, { path: `${rt}/${V}Repeater Rotation`, rest: [0], dims: 1 }, ctx);
        prop(props, p.startOpacity, { path: `${rt}/${V}Repeater Opacity 1`, rest: [100], dims: 1 }, ctx);
        prop(props, p.endOpacity, { path: `${rt}/${V}Repeater Opacity 2`, rest: [100], dims: 1 }, ctx);
        items.push({ mn: `${V}Filter - Repeater`, name: p.name, props });
        break;
      }
      case 'merge':
        props.push({ p: `${V}Merge Type`, v: { merge: 1, add: 2, subtract: 3, intersect: 4, exclude: 5 }[(p.mode ?? 'merge') as string] });
        items.push({ mn: `${V}Filter - Merge`, name: p.name, props });
        break;
      case 'offset':
        prop(props, p.amount, { path: `${V}Offset Amount`, rest: [10], dims: 1 }, ctx);
        if (p.copies) props.push({ p: `${V}Offset Copies`, v: p.copies });
        prop(props, p.copyOffset, { path: `${V}Offset Copy Offset`, rest: [1], dims: 1 }, ctx);
        items.push({ mn: `${V}Filter - Offset`, name: p.name, props });
        break;
      case 'roundCorners':
        prop(props, p.radius, { path: `${V}RoundCorner Radius`, rest: [10], dims: 1 }, ctx);
        items.push({ mn: `${V}Filter - RC`, name: p.name, props });
        break;
      case 'twist':
        prop(props, p.angle, { path: `${V}Twist Angle`, rest: [10], dims: 1 }, ctx);
        prop(props, p.center, { path: `${V}Twist Center`, rest: [0, 0], dims: 2, conv: vec2 }, ctx);
        items.push({ mn: `${V}Filter - Twist`, name: p.name, props });
        break;
      case 'puckerBloat':
        prop(props, p.amount, { path: `${V}PuckerBloat Amount`, rest: [10], dims: 1 }, ctx);
        items.push({ mn: `${V}Filter - PB`, name: p.name, props });
        break;
      case 'wigglePaths':
        prop(props, p.size, { path: `${V}Roughen Size`, rest: [10], dims: 1 }, ctx);
        prop(props, p.detail, { path: `${V}Roughen Detail`, rest: [10], dims: 1 }, ctx);
        if (p.points) props.push({ p: `${V}Roughen Points`, v: p.points === 'smooth' ? 2 : 1 });
        prop(props, p.wigglesPerSecond, { path: `${V}Temporal Freq`, rest: [2], dims: 1 }, ctx);
        props.push({ p: `${V}Random Seed`, v: p.seed ?? ctx.seed });
        items.push({ mn: `${V}Filter - Roughen`, name: p.name, props });
        break;
      case 'zigzag':
        prop(props, p.size, { path: `${V}Zigzag Size`, rest: [5], dims: 1 }, ctx);
        prop(props, p.ridges, { path: `${V}Zigzag Detail`, rest: [10], dims: 1 }, ctx);
        if (p.points) props.push({ p: `${V}Zigzag Points`, v: p.points === 'smooth' ? 2 : 1 });
        items.push({ mn: `${V}Filter - Zigzag`, name: p.name, props });
        break;
      default:
        throw new Error(`<${c.type?.displayName ?? kind}> is not valid inside <Shape>. Use Rect, Ellipse, Star, Path, Group, Fill, Stroke, GradientFill, GradientStroke, Trim, Repeater, Merge, OffsetPaths, RoundCorners, Twist, PuckerBloat, WigglePaths, ZigZag.`);
    }
  }
  return items;
}
