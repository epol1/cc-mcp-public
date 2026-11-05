// Path tools (P3): FollowPath (a layer rides any SVG path, progress keyed or live, auto-orient), Trail / Echo
// (time-offset copies with an opacity ramp), DrawOn (Trim Paths draw-on with taper and a round cap) and Morph (one
// path keyed from SVG A to SVG B, vertex counts and correspondence matched by src/shared/morph.ts). Everything is
// native: guide shape layers, rig effects ("aec Follow Path", "aec Trail") read by short expressions, Trim keys and
// path keys.
import { Fragment, jsx } from './jsx-runtime.ts';
import type { AecElement } from './jsx-runtime.ts';
import { Fill, Path, RigEffect, Shape, Stroke, Trim } from './primitives.ts';
import type { ShapeProps } from './primitives.ts';
import { expr, tween } from './anim.ts';
import type { Anim } from './anim.ts';
import type { ControlRef } from './control.ts';
import { dslWarn } from './warn.ts';
import type { PseudoEffectDef } from '../compile/ffx/pseudo.ts';
import { parseSvgPath } from '../shared/svgpath.ts';
import { matchSequence, reverseShape, toPathPoints } from '../shared/morph.ts';
import type { EasingSpec } from '../shared/easing.ts';
import { parseTime } from '@ae-mcp/core/units.ts';
import type { ColorSpec, Time } from '@ae-mcp/core/units.ts';
import { expand, isLayerEl, kindOf, withProps } from './transitions/core.ts';

const TG = 'ADBE Transform Group';
const fpsOf = () => ((globalThis as any).__AEC_COMP__?.fps as number | undefined) ?? 30;
const sec = (t: Time | undefined, d = 0) => (t === undefined ? d : parseTime(t, fpsOf()));
type Num = number | Anim | ControlRef;

/** The one layer element of a component's output with this id (or the only/last layer). */
function findLayer(els: AecElement[], id: string | undefined, who: string): AecElement {
  const layers = els.filter(isLayerEl);
  const hit = id ? layers.find((l) => l.props.id === id) : layers[layers.length - 1];
  if (!hit) throw new Error(`${who}: ${id ? `no layer with id "${id}" in its child` : 'its child has no layer'}`);
  return hit;
}

// ---------- FollowPath ----------
const FOLLOW: PseudoEffectDef = { name: 'aec Follow Path', params: [
  { kind: 'slider', name: 'Progress', default: 0, min: 0, max: 100, precision: 2, display: 'percent' },
  { kind: 'checkbox', name: 'Orient', default: true },
  { kind: 'angle', name: 'Rotation Offset', default: 0 },
] };

export interface FollowPathProps {
  /** Id of the follower layer (the guide path gets `<id>.path`). */
  id: string;
  /** The path, SVG `d` in comp pixels (first subpath). */
  d: string;
  closed?: boolean;
  /** Progress along the path, 0–100 %: a number, keys (tween/keys/spring), expr() or a control. Default: duration/delay/easing. */
  progress?: Num;
  /** Without `progress`: one eased run 0 → 100 % (default 2 s, easeInOutCubic). Controls retime it live. */
  duration?: Time | ControlRef;
  delay?: Time | ControlRef;
  easing?: EasingSpec;
  /** Turn the follower along the path (default true). */
  orient?: boolean;
  /** Added to the path angle, degrees (e.g. 90 for art drawn pointing up). */
  rotationOffset?: number;
  /** Draw the path (a visible stroke) instead of keeping it as a hidden guide. */
  show?: boolean | { color?: ColorSpec | ControlRef; width?: number; dash?: number[] };
  /** The follower: one layer element (its own x/y/position are replaced by the path). */
  children?: any;
}

/**
 * A layer rides any SVG path: a guide shape layer holds the path, and the follower's position (and rotation, with
 * orient) read it through L.onPath / L.pathAngle at the "Follow Path" effect's Progress, so a designer reshapes the
 * path or retimes Progress in AE.
 */
export function FollowPath(p: FollowPathProps): AecElement {
  if (!p.id) throw new Error('<FollowPath> needs an id');
  const kids = expand(p.children);
  const el = kids.find(isLayerEl);
  if (!el || kids.filter(isLayerEl).length !== 1) throw new Error(`<FollowPath id="${p.id}">: give exactly one layer element as its child (the follower)`);
  const shapes = parseSvgPath(p.d);
  if (!shapes.length) throw new Error(`<FollowPath id="${p.id}">: d has no path`);
  if (shapes.length > 1) dslWarn(`<FollowPath id="${p.id}">: d has ${shapes.length} subpaths; the follower uses the first`);
  const pathId = `${p.id}.path`, closed = p.closed ?? shapes[0].c;
  const show = p.show ? (p.show === true ? {} : p.show) : null;
  const guide = jsx(Shape, {
    id: pathId, name: `${p.id} Path`, space: 'comp', ...(show ? {} : { guide: true, hidden: true }),
    children: [jsx(Path, { name: 'Follow Path', points: toPathPoints(shapes[0]), closed }), ...(show ? [jsx(Stroke, { color: show.color ?? '#ffffff', width: show.width ?? 3, dash: show.dash, cap: 'round' })] : [])],
  });
  const progress = p.progress ?? tween({ from: 0, to: 100, duration: p.duration ?? 2, delay: p.delay, easing: p.easing ?? 'easeInOutCubic' });
  const ref = `__AEC_LAYER(${pathId})__`;
  const pathExpr = `${ref}.content("Follow Path").path`;
  const pos = [
    `// ae-compose follow path: position on "${p.id} Path" at Progress (Follow Path effect)`,
    `var e = effect("Follow Path"), q = ${ref}.toComp(L.onPath(${pathExpr}, e("Progress").value / 100, ${closed}));`,
    'hasParent ? parent.fromComp(q) : q;',
  ].join('\n');
  const rot = [
    `// ae-compose follow path: turns along "${p.id} Path" when Orient is on (Follow Path effect)`,
    'var e = effect("Follow Path");',
    `value + (e("Orient").value ? L.pathAngle(${pathExpr}, e("Progress").value / 100, ${closed}) + e("Rotation Offset").value : 0);`,
  ].join('\n');
  const { x, y, position: _p, ...rest } = el.props;
  const anim = { ...(rest.animate ?? {}) };
  if (x !== undefined || y !== undefined || anim.x || anim.y || anim.position) dslWarn(`<FollowPath id="${p.id}">: the follower's own x/y/position are replaced by the path`);
  delete anim.x; delete anim.y; delete anim.position;
  if (el.props.expressions?.[`${TG}/ADBE Rotate Z`]) throw new Error(`<FollowPath id="${p.id}">: the follower already has a rotation expression`);
  const follower = withProps({ ...el, props: rest }, {
    id: p.id, animate: anim, position: expr(pos),
    expressions: { ...(rest.expressions ?? {}), [`${TG}/ADBE Rotate Z`]: rot },
    effects: [...(rest.effects ?? []), jsx(RigEffect, { def: FOLLOW, name: 'Follow Path', values: { Progress: progress, Orient: p.orient !== false, 'Rotation Offset': p.rotationOffset ?? 0 } })],
  });
  if (el.props.id && el.props.id !== p.id) dslWarn(`<FollowPath id="${p.id}">: the follower's id "${el.props.id}" is replaced by "${p.id}"`);
  return jsx(Fragment, { children: [guide, follower] });
}

// ---------- Trail / Echo ----------
const TRAIL: PseudoEffectDef = { name: 'aec Trail', params: [
  { kind: 'slider', name: 'Lag', default: 0.03, min: 0, max: 1, validMin: 0, precision: 3 },
  { kind: 'slider', name: 'Start Opacity', default: 60, min: 0, max: 100, display: 'percent' },
  { kind: 'slider', name: 'End Opacity', default: 0, min: 0, max: 100, display: 'percent' },
  { kind: 'slider', name: 'End Scale', default: 100, min: 0, max: 200, display: 'percent' },
] };

export interface TrailProps {
  /** Prefixes the copies' ids (`<id>.echo1`…); also the leader's id when its element has none. */
  id: string;
  /** Leader layer name (default: its own, else the id). Must be unique (the copies read it). */
  name?: string;
  /** Copies behind the leader (rebuild to change; default 8). */
  count?: number;
  /** Seconds between copies (live; default 0.03). */
  lag?: number;
  /** Opacity of the first and last copy, % of the leader's (live; default [60, 0]). */
  opacity?: [number, number];
  /** Scale of the last copy, % (live; default 100). */
  endScale?: number;
  /** Id of the layer to echo when the child is a component (default: the child's id, or its last layer). */
  leader?: string;
  /** The leader: one layer element, or a component (FollowPath…) containing it. */
  children?: any;
}

/**
 * Time-offset copies of a moving layer: copy k shows the leader's position, rotation, scale and opacity at
 * time − k·Lag, fading along an opacity ramp. Lag, the ramp and the end scale are live on the leader's "Trail" effect;
 * edit the leader's animation and the copies follow.
 */
export function Trail(p: TrailProps): AecElement {
  if (!p.id) throw new Error('<Trail> needs an id');
  const n = Math.max(1, Math.round(p.count ?? 8));
  const kids = expand(p.children);
  const target = findLayer(kids, p.leader ?? (kids.length === 1 ? kids[0].props.id : undefined), `<Trail id="${p.id}">`);
  const leaderId = target.props.id ?? p.id;
  const leaderName = target.props.name ?? p.name ?? p.id;
  const op = p.opacity ?? [60, 0];
  const leader = withProps(target, {
    id: leaderId, name: leaderName,
    effects: [...(target.props.effects ?? []), jsx(RigEffect, { def: TRAIL, name: 'Trail', values: { Lag: p.lag ?? 0.03, 'Start Opacity': op[0], 'End Opacity': op[1], 'End Scale': p.endScale ?? 100 } })],
  });
  const threeD = !!target.props.threeD;
  const T = `__AEC_LAYER(${leaderId})__`;
  const head = (k: number, what: string) => `// ae-compose trail: echo ${k} of ${n} of "${leaderName}" (${what}; Trail effect on the leader)\nvar T = ${T}, e = T.effect("Trail"), t = time - ${k} * e("Lag").value;`;
  const copies: AecElement[] = [];
  for (let k = n; k >= 1; k--) {
    const f = n > 1 ? (k - 1) / (n - 1) : 0;
    const { id: _i, name: _n, animate, effects, expressions, markers: _m, x: _x, y: _y, z: _z, position: _p, scale: _s, rotation: _r, opacity: _o, tags: _t, eg: _g, ...rest } = target.props;
    const keepAnim: Record<string, any> = {};
    for (const [key, v] of Object.entries(animate ?? {})) if (!['x', 'y', 'z', 'position', 'scale', 'rotation', 'opacity'].includes(key)) keepAnim[key] = v;
    const keepFx = (effects ?? []).filter((e: any) => kindOf(e) !== 'rigEffect');
    const keepExpr: Record<string, string> = {};
    for (const [path, code] of Object.entries(expressions ?? {})) if (!path.startsWith(TG)) keepExpr[path] = code as string;
    copies.push({ ...target, props: {
      ...rest, id: `${p.id}.echo${k}`, name: `${leaderName} Echo ${k}`, animate: keepAnim, effects: keepFx.length ? keepFx : undefined,
      expressions: keepExpr,
      position: expr(`${head(k, 'position')}\nT.transform.position.valueAtTime(t);`),
      rotation: expr(`${head(k, 'rotation')}\nT.transform.rotation.valueAtTime(t);`),
      scale: expr(`${head(k, 'scale')}\nvar s = T.transform.scale.valueAtTime(t), f = L.lerp(100, e("End Scale").value, ${k / n}) / 100;\n[s[0] * f, s[1] * f${threeD ? ', s[2] * f' : ''}];`),
      opacity: expr(`${head(k, 'opacity ramp')}\nT.transform.opacity.valueAtTime(t) * L.lerp(e("Start Opacity").value, e("End Opacity").value, ${+f.toFixed(4)}) / 100;`),
    } });
  }
  const others = kids.filter((c) => c !== target);
  return jsx(Fragment, { children: [...others, ...copies, leader] });
}

/** Echo: a few distinct ghost copies further apart in time (Trail with count 3, lag 0.12 s, opacity [45, 15]). */
export function Echo(p: TrailProps): AecElement {
  return Trail({ count: 3, lag: 0.12, opacity: [45, 15], ...p });
}

// ---------- DrawOn ----------
export interface DrawOnProps extends Omit<ShapeProps, 'children'> {
  /** SVG path data (several subpaths draw together; Z closes). Comp pixels by default (space: 'comp'). */
  d: string;
  color?: ColorSpec | ControlRef;
  width?: number | Anim | ControlRef;
  /** Draw-on timing (default 1.2 s, easeInOutCubic). */
  duration?: Time;
  delay?: Time;
  easing?: EasingSpec;
  /** Trim End directly (0–100 %): keys, expr() or a control; replaces duration/delay/easing. */
  progress?: Num;
  /** Taper as % of the visible length: number (end only: the drawing head) or [start, end]. */
  taper?: number | [number, number];
  cap?: 'round' | 'butt' | 'square';
  /** The tail follows the head this many seconds later (a travelling stroke that draws on and off). */
  tail?: Time;
  /** Draw from the path's end. */
  reverse?: boolean;
  /** Fill inside the path (static). */
  fill?: ColorSpec;
  /** Trim several subpaths one after another instead of together. */
  sequential?: boolean;
}

/** A path that draws itself: Trim Paths keys (and a following tail), a round cap and an optional taper. */
export function DrawOn(p: DrawOnProps): AecElement {
  const { d, color, width, duration, delay, easing, progress, taper, cap, tail, reverse, fill, sequential, ...layer } = p;
  const dur = duration ?? 1.2, ease = easing ?? 'easeInOutCubic';
  const head = progress ?? tween({ from: 0, to: 100, duration: dur, delay, easing: ease });
  const tailAnim = tail !== undefined ? tween({ from: 0, to: 100, duration: dur, delay: sec(delay) + sec(tail), easing: ease }) : undefined;
  if (tail !== undefined && progress !== undefined) dslWarn('<DrawOn>: tail follows duration/delay; with progress set, animate Trim Start yourself');
  // Reverse: the path itself is reversed, so the same Trim keys draw it from its end.
  const subs = parseSvgPath(d);
  if (!subs.length) throw new Error('<DrawOn>: d has no path');
  const paths = reverse
    ? subs.map((s, k) => jsx(Path, { name: subs.length > 1 ? `Draw Path ${k + 1}` : 'Draw Path', points: toPathPoints(reverseShape(s)), closed: s.c }))
    : [jsx(Path, { name: 'Draw Path', d })];
  const tp = taper === undefined ? undefined : typeof taper === 'number' ? [0, taper] : taper;
  return jsx(Shape, {
    space: 'comp', ...layer,
    children: [
      ...paths, jsx(Trim, { end: head, start: tailAnim, individually: sequential }),
      jsx(Stroke, { color: color ?? '#ffffff', width: width ?? 6, cap: cap ?? 'round', join: 'round', taperStart: tp?.[0], taperEnd: tp?.[1] }),
      ...(fill ? [jsx(Fill, { color: fill })] : []),
    ],
  });
}

// ---------- Morph ----------
export interface MorphProps extends Omit<ShapeProps, 'children'> {
  /** Start shape (SVG `d`, first subpath). */
  from?: string;
  /** End shape. */
  to?: string;
  /** Or a chain: A → B → C … (overrides from/to). */
  shapes?: string[];
  /** Length of each morph (default 0.8 s). */
  duration?: Time;
  /** Before the first morph. */
  delay?: Time;
  /** Hold between morphs of a chain (default 0.4 s). */
  hold?: Time;
  easing?: EasingSpec;
  /** Fill (default white unless `stroke` or children are given). */
  fill?: ColorSpec | ControlRef;
  stroke?: { color?: ColorSpec | ControlRef; width?: number };
  /** Your own paints/operators after the path (replace fill/stroke). */
  children?: any;
}

/**
 * Shape morph: one Path keyed from SVG A to SVG B (or a chain). Vertex counts are matched by subdividing the shape
 * with fewer points, and the start vertex / direction are picked for the least travel, so the morph doesn't twist.
 */
export function Morph(p: MorphProps): AecElement {
  const { from, to, shapes, duration, delay, hold, easing, fill, stroke, children, ...layer } = p;
  const ds = shapes ?? [from, to].filter((x): x is string => typeof x === 'string');
  if (ds.length < 2) throw new Error('<Morph> needs from and to (SVG path data), or shapes={[a, b, …]}');
  const parsed = ds.map((d, k) => {
    const s = parseSvgPath(d);
    if (!s.length) throw new Error(`<Morph>: shape ${k + 1} has no path`);
    if (s.length > 1) dslWarn(`<Morph>: shape ${k + 1} has ${s.length} subpaths; only the first morphs`);
    return s[0];
  });
  const matched = matchSequence(parsed);
  const dur = sec(duration, 0.8), h = sec(hold, 0.4), t0 = sec(delay, 0);
  const keys: { t: number; points: any[]; easing?: EasingSpec }[] = [];
  // Shape k arrives at t0 + k·duration + (k − 1)·hold; in a chain it holds, then the hold key eases into the next morph.
  matched.forEach((s, k) => {
    const pts = toPathPoints(s);
    const at = k === 0 ? t0 : t0 + k * dur + (k - 1) * h;
    if (k > 0 && h > 0 && k < matched.length - 1) { keys.push({ t: at, points: pts, easing: 'linear' }); keys.push({ t: at + h, points: pts, easing: easing ?? 'easeInOutCubic' }); }
    else keys.push({ t: at, points: pts, easing: easing ?? 'easeInOutCubic' });
  });
  const paints = children !== undefined ? expand(children) : [
    ...(stroke ? [jsx(Stroke, { color: stroke.color ?? '#ffffff', width: stroke.width ?? 4, join: 'round', cap: 'round' })] : []),
    ...(fill !== undefined || !stroke ? [jsx(Fill, { color: fill ?? '#ffffff' })] : []),
  ];
  return jsx(Shape, { ...layer, children: [jsx(Path, { name: 'Morph Path', closed: matched[0].c, points: keys[0].points, morph: keys }), ...paints] });
}
