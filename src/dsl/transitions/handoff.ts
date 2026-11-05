// HandOff (match cut): one element spans both beats and travels on a planned path from its pose in the outgoing beat
// to its pose in the incoming one. The element is parented to a carrier null whose rig ("aec Hand-off") holds the
// keyed Progress, the From/To points (static, or read live from layers, e.g. hidden placeholders inside a layout),
// the arc, and the scale/rotation at each end; the element keeps its own animation (entrance, exit) on top.
import { jsx } from '../jsx-runtime.ts';
import { Path, Shape } from '../primitives.ts';
import { expr } from '../anim.ts';
import type { PseudoParam } from '../../compile/ffx/pseudo.ts';
import type { Time } from '@cc-mcp/core/units.ts';
import { controller, ctlName, defineTransition, head, isLayerEl, r3, slider, withProps } from './core.ts';
import type { El, TransitionBase, TransitionDef, TransitionIO } from './core.ts';

/** A pose: a comp point (x/y or position) or a layer (by id) whose anchor is read live; plus scale and rotation. */
export interface Pose {
  x?: number;
  y?: number;
  position?: [number, number];
  /** Layer id: the pose follows that layer's anchor in comp space (x/y become offsets). */
  layer?: string;
  /** Percent; number or [x, y]. */
  scale?: number | [number, number];
  rotation?: number;
}

export interface HandOffProps extends TransitionBase {
  /** The element that travels (one layer element: Shape, Text, Solid, Precomp…). Not rendered anywhere else. */
  element: El;
  /** Pose in the outgoing beat (a Pose, or a layer id). */
  from: Pose | string;
  /** Pose in the incoming beat (a Pose, or a layer id). */
  to: Pose | string;
  /** Bow of the straight path, px: positive bows to the left of the direction of travel (up when moving right). */
  arc?: number;
  /** Planned path instead (SVG `d`, comp px): the element follows it from start to end; From/To are ignored. */
  path?: string;
  /** With `path`: turn the element along it. */
  orient?: boolean;
  /** 'size': the element is scaled at each end to the size of the `layer` it comes from / goes to. */
  match?: 'position' | 'size';
  /** Standalone: when the element appears (default 0 = the enclosing start) and leaves (default the enclosing end). */
  start?: Time;
  end?: Time;
}

const LABEL = 'Hand-off';
const asPose = (x: Pose | string): Pose => (typeof x === 'string' ? { layer: x } : x);
const pair = (s: number | [number, number] | undefined): [number, number] => (s === undefined ? [100, 100] : typeof s === 'number' ? [s, s] : [s[0], s[1]]);

function poseValue(pose: Pose, end: 'from' | 'to', io: TransitionIO, id: string): any {
  const base: [number, number] = pose.position ?? [pose.x ?? io.w / 2, pose.y ?? io.h / 2];
  if (!pose.layer) return [r3(base[0]), r3(base[1])];
  const dx = pose.position ? pose.position[0] : pose.x ?? 0, dy = pose.position ? pose.position[1] : pose.y ?? 0;
  const t = end === 'from' ? 'k.numKeys ? k.key(1).time : time' : 'k.numKeys ? k.key(k.numKeys).time : time';
  return expr([
    `// ae-compose handoff "${id}": ${end === 'from' ? 'From' : 'To'} follows the layer's anchor (at the ${end === 'from' ? 'start' : 'end'} of the hand-off)`,
    `var A = __AEC_LAYER(${pose.layer})__, k = effect("${LABEL}")("Progress"), t = ${t};`,
    'var q = A.toComp(A.transform.anchorPoint.valueAtTime(t), t);',
    `[q[0] + ${dx}, q[1] + ${dy}];`,
  ].join('\n'));
}

function sizeValue(pose: Pose, end: 'from' | 'to', axis: 0 | 1, elId: string, id: string): any {
  const t = end === 'from' ? 'k.numKeys ? k.key(1).time : time' : 'k.numKeys ? k.key(k.numKeys).time : time';
  const dim = axis ? 'height' : 'width';
  return expr([
    `// ae-compose handoff "${id}": scale ${axis ? 'Y' : 'X'} so the element matches the ${dim} of its ${end === 'from' ? 'source' : 'target'} layer`,
    `var A = __AEC_LAYER(${pose.layer})__, E = __AEC_LAYER(${elId})__, k = effect("${LABEL}")("Progress"), t = ${t};`,
    'var ra = A.sourceRectAtTime(t, false), re = E.sourceRectAtTime(t, false), sa = A.transform.scale.valueAtTime(t), se = E.transform.scale.valueAtTime(t);',
    `100 * ra.${dim} * sa[${axis}] / Math.max(re.${dim} * se[${axis}], 0.000001);`,
  ].join('\n'));
}

const HAND_OFF: TransitionDef<HandOffProps> = {
  kind: 'handoff', label: LABEL, defaultDuration: 0.8,
  build(p, io) {
    const el = p.element;
    if (!isLayerEl(el)) throw new Error(`<HandOff id="${p.id}">: element= must be one layer element (<Shape>, <Text>, <Solid>, <Precomp>…)`);
    const a = asPose(p.from), b = asPose(p.to);
    const elId = el.props.id ?? `${p.id}.element`;
    const size = p.match === 'size';
    if (size && !(a.layer && b.layer)) throw new Error(`<HandOff id="${p.id}">: match: 'size' needs from and to to be layers`);
    const sa = pair(a.scale), sb = pair(b.scale);
    const params: PseudoParam[] = [
      { kind: 'point', name: 'From', default: [io.w / 2, io.h / 2] }, { kind: 'point', name: 'To', default: [io.w / 2, io.h / 2] },
      slider('Arc', 0, -2000, 2000, { display: 'pixel' }),
      { kind: 'group', name: 'Scale', params: [slider('Scale From X', 100, 0, 1000, { display: 'percent' }), slider('Scale From Y', 100, 0, 1000, { display: 'percent' }), slider('Scale To X', 100, 0, 1000, { display: 'percent' }), slider('Scale To Y', 100, 0, 1000, { display: 'percent' })] },
      { kind: 'angle', name: 'Rotation From', default: 0 }, { kind: 'angle', name: 'Rotation To', default: 0 },
    ];
    const values: Record<string, any> = {
      From: poseValue(a, 'from', io, p.id), To: poseValue(b, 'to', io, p.id), Arc: p.arc ?? 0,
      'Scale From X': size ? sizeValue(a, 'from', 0, elId, p.id) : sa[0], 'Scale From Y': size ? sizeValue(a, 'from', 1, elId, p.id) : sa[1],
      'Scale To X': size ? sizeValue(b, 'to', 0, elId, p.id) : sb[0], 'Scale To Y': size ? sizeValue(b, 'to', 1, elId, p.id) : sb[1],
      'Rotation From': a.rotation ?? 0, 'Rotation To': b.rotation ?? 0,
    };
    const pathId = `${p.id}.path`;
    const pathRef = `__AEC_LAYER(${pathId})__.content("Hand-off Path").path`;
    const pos = p.path
      ? `${head(HAND_OFF, p, 'carries the element along the planned path', true)}\nvar S = __AEC_LAYER(${pathId})__;\nS.toComp(L.onPath(${pathRef}, P, false));`
      : `${head(HAND_OFF, p, 'carries the element From → To along an arc', true)}\nvar a = e("From").value, b = e("To").value, d = sub(b, a), n = length(d), u = n > 0 ? [d[1] / n, -d[0] / n] : [0, 0];\nadd(add(a, mul(d, P)), mul(u, e("Arc").value * 4 * P * (1 - P)));`;
    const rot = `${head(HAND_OFF, p, 'rotation From → To', true)}\nL.lerp(e("Rotation From").value, e("Rotation To").value, P)${p.path && p.orient ? ` + L.pathAngle(${pathRef}, P, false)` : ''};`;
    const scl = `${head(HAND_OFF, p, 'scale From → To', true)}\n[L.lerp(e("Scale From X").value, e("Scale To X").value, P), L.lerp(e("Scale From Y").value, e("Scale To Y").value, P)];`;
    const carrier = controller(HAND_OFF, p, io, params, values, { extra: { anchor: [0, 0], position: expr(pos), rotation: expr(rot), scale: expr(scl) } });
    // The element: parented at the carrier's origin, alive from the outgoing beat's start to the incoming beat's end.
    const { x: _x, y: _y, position: _p, ...rest } = el.props;
    const anim = { ...(rest.animate ?? {}) };
    delete anim.position;
    const from = -io.before + (typeof el.props.from === 'number' ? el.props.from : 0);
    const element = withProps({ ...el, props: rest }, {
      id: elId, name: el.props.name ?? (size ? `${ctlName(HAND_OFF, p)} Element` : undefined), parent: p.id, x: 0, y: 0, animate: anim,
      from, duration: el.props.duration ?? (io.after !== undefined ? io.after - from : undefined),
    });
    const under: El[] = [carrier];
    if (p.path) under.push(jsx(Shape, { id: pathId, name: `${ctlName(HAND_OFF, p)} Path`, space: 'comp', guide: true, hidden: true, children: jsx(Path, { name: 'Hand-off Path', d: p.path, closed: false }) }));
    return { outgoing: io.outgoing, incoming: io.incoming, under, over: [element] };
  },
};
/**
 * Hand-off / match cut: an element spans both beats and travels from its pose in the outgoing beat to its pose in
 * the incoming one (an arc, or a planned path), so the move across the cut is one continuous motion.
 */
export const HandOff = defineTransition(HAND_OFF);
