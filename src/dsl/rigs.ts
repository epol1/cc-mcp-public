// Camera rigs built from parented nulls + expressions (all speeds/angles can be live controls).
import { Fragment, jsx } from './jsx-runtime.ts';
import { Camera, Light, Null } from './primitives.ts';
import type { CameraProps } from './primitives.ts';
import { expr, tween } from './anim.ts';
import type { EasingSpec } from '../shared/easing.ts';
import type { Time } from '../shared/units.ts';
import type { ControlRef } from './control.ts';
import { isControl } from './control.ts';

const num = (v: number | ControlRef | undefined, d: number) => (v === undefined ? String(d) : isControl(v) ? `__AEC_CONTROL(${v.name})__` : String(v));

export interface OrbitCameraProps extends Omit<CameraProps, 'position' | 'pointOfInterest' | 'parent'> {
  id?: string;
  /** World point to orbit around (default comp centre at z=0). */
  target?: [number, number, number];
  radius?: number;
  /** Degrees per second (may be a control). */
  speed?: number | ControlRef;
  startAngle?: number | ControlRef;
  /** Camera height above the target (negative y is up in AE). */
  height?: number;
  /** Seconds before the orbit starts moving. */
  delay?: number;
}

/**
 * Orbiting two-node camera: a 3D null at `target` turns around Y; the camera is parented to it and looks at it.
 * Expose `speed` as control("Orbit Speed", 20) to tweak live.
 */
export function OrbitCamera(p: OrbitCameraProps) {
  const id = p.id ?? 'orbitCam';
  const rig = `${id}.rig`;
  const target = p.target;
  const rot = `${num(p.startAngle, 0)} + Math.max(0, time - ${p.delay ?? 0}) * ${num(p.speed, 15)}`;
  const refs = [p.speed, p.startAngle].filter(isControl) as ControlRef[];
  const { target: _t, radius, speed: _s, startAngle: _a, height, delay: _d, ...cam } = p;
  // No target: the comp centre (read in AE, so any comp size works).
  const rigPos = target ?? expr('[thisComp.width / 2, thisComp.height / 2, 0]');
  return jsx(Fragment, { children: [
    jsx(Null, { id: rig, name: `${p.name ?? 'Camera'} Rig`, threeD: true, position: rigPos, rotationY: expr(rot, refs) }),
    jsx(Camera, { ...cam, id, name: p.name ?? 'Camera', parent: rig, position: [0, -(height ?? 0), -(radius ?? 1400)], pointOfInterest: [0, 0, 0] }),
  ] });
}

export interface CameraMoveProps extends Omit<CameraProps, 'position' | 'pointOfInterest' | 'parent' | 'oneNode'> {
  id?: string;
  /** World point the shot frames (default comp centre at z = 0). */
  target?: [number, number, number];
  /** Camera distance from the target in px (default: AE's 1:1 framing distance for the lens, i.e. the zoom). */
  distance?: number;
  /** How far the camera travels [x, y, z] in px (+z = toward the target, −y = up). */
  move: [number, number, number];
  /** "fixed": keep looking at the target while moving (crane, arc); "follow": the aim travels with the camera (truck, pedestal, push-in). */
  aim?: 'fixed' | 'follow';
  /** Keyframed move of this length; without it the move spans the whole layer (follows Sequence length and ripple edits). */
  duration?: Time;
  delay?: Time;
  easing?: EasingSpec;
  /** Handheld feel: wiggle of `amount` px at `freq` Hz on position (and a third of it on the aim). */
  shake?: { amount?: number | ControlRef; freq?: number | ControlRef; seed?: number };
}

/**
 * A camera move as a rig: a target null, a "move" null that travels, and the camera parented to it at the framing
 * distance. With `duration` the move is ordinary keys on the move null (editable in the graph editor); without it an
 * eased expression spans the layer. PushIn, PullOut, Truck, Crane and Pedestal are presets of this.
 */
export function CameraMove(p: CameraMoveProps) {
  const id = p.id ?? 'moveCam';
  const T = `${id}.target`, M = `${id}.move`;
  const { target, distance, move, aim, duration, delay, easing, shake, ...cam } = p;
  const name = p.name ?? 'Camera';
  const to: [number, number, number] = [move[0], move[1], move[2]];
  const moveAnim = duration !== undefined
    ? tween({ from: [0, 0, 0], to, duration, delay: delay ?? 0, easing: easing ?? 'easeInOutSine' })
    : expr(`// ae-compose rig: camera move over the layer\nvar d = ${typeof delay === 'number' ? delay : 0};\nease(time, inPoint + d, outPoint, [0, 0, 0], [${to.join(', ')}]);`);
  const dist = distance !== undefined ? `${-distance}` : '-cameraOption.zoom';
  const refs = [shake?.amount, shake?.freq].filter(isControl) as ControlRef[];
  const amt = num(shake?.amount, 6), fq = num(shake?.freq, 1.2), seed = shake?.seed ?? 7;
  const camPos = shake
    ? expr(`// ae-compose rig: handheld shake\nseedRandom(${seed}, true);\n[0, 0, ${dist}] + (wiggle(${fq}, ${amt}) - value);`, refs)
    : expr(`[0, 0, ${dist}];`);
  // Two-node camera: its point of interest is in the parent's (move null's) space.
  const fixedAim = `var m = thisComp.layer("${name} Move");\nm.fromWorld(thisComp.layer("${name} Target").toWorld([0, 0, 0]))`;
  const poi = (aim ?? 'follow') === 'fixed'
    ? expr(`${fixedAim}${shake ? ` + (seedRandom(${seed + 1}, true), wiggle(${fq}, ${amt} / 3) - value)` : ''};`, refs)
    : shake ? expr(`seedRandom(${seed + 1}, true);\n[0, 0, 0] + (wiggle(${fq}, ${amt} / 3) - value);`, refs) : [0, 0, 0];
  return jsx(Fragment, { children: [
    jsx(Null, { id: T, name: `${name} Target`, threeD: true, position: target ?? expr('[thisComp.width / 2, thisComp.height / 2, 0]') }),
    jsx(Null, { id: M, name: `${name} Move`, threeD: true, parent: T, position: moveAnim }),
    jsx(Camera, { ...cam, id, name, parent: M, position: camPos, pointOfInterest: poi }),
  ] });
}

type MovePreset = Omit<CameraMoveProps, 'move' | 'aim'>;
/** Camera travels `distance` px toward the target (default 400). */
export const PushIn = (p: MovePreset & { travel?: number }) => CameraMove({ ...p, move: [0, 0, p.travel ?? 400], aim: 'follow' });
/** Camera backs away `travel` px from the target (default 400). */
export const PullOut = (p: MovePreset & { travel?: number }) => CameraMove({ ...p, move: [0, 0, -(p.travel ?? 400)], aim: 'follow' });
/** Sideways move, aim travels along (+ = right, default 500). */
export const Truck = (p: MovePreset & { travel?: number }) => CameraMove({ ...p, move: [p.travel ?? 500, 0, 0], aim: 'follow' });
/** Vertical move, aim travels along (+ = up, default 300). */
export const Pedestal = (p: MovePreset & { travel?: number }) => CameraMove({ ...p, move: [0, -(p.travel ?? 300), 0], aim: 'follow' });
/** Rises `travel` px (default 400) while still looking at the target: the view tilts down onto the subject. */
export const Crane = (p: MovePreset & { travel?: number }) => CameraMove({ ...p, move: [0, -(p.travel ?? 400), 0], aim: 'fixed' });

export interface ThreePointLightsProps {
  id?: string;
  /** Subject position the lights aim at (default comp centre at z = 0). */
  target?: [number, number, number];
  /** Key light intensity (fill 45 %, rim 70 % of it). */
  intensity?: number | ControlRef;
  color?: string;
  /** Distance of the lights from the target (default 1200). */
  distance?: number;
  castsShadows?: boolean;
}
/** Classic key / fill / rim: key spot high front-left (shadows), soft fill front-right, rim behind and above. */
export function ThreePointLights(p: ThreePointLightsProps = {}) {
  const id = p.id ?? 'lights';
  const tgt = p.target ?? [960, 540, 0];
  const d = p.distance ?? 1200;
  const I = typeof p.intensity === 'number' || p.intensity === undefined ? (p.intensity ?? 100) : p.intensity;
  const scale = (k: number) => (typeof I === 'number' ? I * k : expr(`__AEC_CONTROL(${(I as ControlRef).name})__ * ${k}`, [I as ControlRef]));
  const at = (dx: number, dy: number, dz: number): [number, number, number] => [tgt[0] + dx * d, tgt[1] + dy * d, tgt[2] + dz * d];
  return jsx(Fragment, { children: [
    jsx(Light, { id: `${id}.key`, name: 'Key Light', kind: 'spot', intensity: scale(1), color: p.color ?? '#fff4e6', coneAngle: 70, coneFeather: 60, castsShadows: p.castsShadows ?? true, shadowDiffusion: 40, position: at(-0.7, -0.6, -0.7), pointOfInterest: tgt }),
    jsx(Light, { id: `${id}.fill`, name: 'Fill Light', kind: 'spot', intensity: scale(0.45), color: '#e6f0ff', coneAngle: 90, coneFeather: 100, position: at(0.8, -0.1, -0.6), pointOfInterest: tgt }),
    jsx(Light, { id: `${id}.rim`, name: 'Rim Light', kind: 'spot', intensity: scale(0.7), color: p.color ?? '#ffffff', coneAngle: 60, coneFeather: 50, position: at(0.3, -0.8, 0.9), pointOfInterest: tgt }),
  ] });
}
