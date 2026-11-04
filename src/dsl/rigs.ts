// Camera rigs built from parented nulls + expressions (all speeds/angles can be live controls).
import { jsx } from './jsx-runtime.ts';
import { Camera, Null } from './primitives.ts';
import type { CameraProps } from './primitives.ts';
import { expr } from './anim.ts';
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
  const target = p.target ?? [960, 540, 0];
  const rot = `${num(p.startAngle, 0)} + Math.max(0, time - ${p.delay ?? 0}) * ${num(p.speed, 15)}`;
  const refs = [p.speed, p.startAngle].filter(isControl) as ControlRef[];
  const { target: _t, radius, speed: _s, startAngle: _a, height, delay: _d, ...cam } = p;
  return [
    jsx(Null, { id: rig, name: `${p.name ?? 'Camera'} Rig`, threeD: true, position: target, rotationY: expr(rot, refs) }),
    jsx(Camera, { ...cam, id, name: p.name ?? 'Camera', parent: rig, position: [0, -(height ?? 0), -(radius ?? 1400)], pointOfInterest: [0, 0, 0] }),
  ];
}
