// 3D layout helpers (computed in Node; no measurement needed). Units: 1 = 1 px at z = 0; +z is away from
// the default camera. Children must be layers; each gets threeD and a position (added to its own x/y/z).
import { Fragment, childrenOf, isElement, jsx } from './jsx-runtime.ts';
import type { AecElement } from './jsx-runtime.ts';

type V3 = [number, number, number];

function place(el: AecElement, pos: V3, extra: Record<string, any> = {}): AecElement {
  const p = el.props;
  const base: V3 = Array.isArray(p.position) ? [p.position[0], p.position[1], p.position[2] ?? 0] : [typeof p.x === 'number' ? p.x : 0, typeof p.y === 'number' ? p.y : 0, typeof p.z === 'number' ? p.z : 0];
  const { x: _x, y: _y, z: _z, depth: _d, ...rest } = p;
  return { ...el, props: { ...rest, ...extra, threeD: true, position: [base[0] + pos[0], base[1] + pos[1], base[2] + pos[2]] } };
}

const layers = (children: any) => childrenOf(children).filter(isElement) as AecElement[];
/** Components return one element (a fragment) so they type-check as JSX. */
const group = (els: AecElement[]): AecElement => jsx(Fragment, { children: els });

/** Stacks children in depth: child i at origin + i·spacing along z (default 400 px). */
export function ZStack(p: { origin?: V3; spacing?: number; children?: any }) {
  const o = p.origin ?? [960, 540, 0];
  return group(layers(p.children).map((c, i) => place(c, [o[0], o[1], o[2] + i * (p.spacing ?? 400)])));
}

/** Grid on a plane (XY by default) at depth z, optionally tilted by giving `plane: 'xz'` (floor). */
export function Grid3D(p: { origin?: V3; columns?: number; spacing?: [number, number]; plane?: 'xy' | 'xz'; children?: any }) {
  const o = p.origin ?? [960, 540, 0];
  const kids = layers(p.children);
  const cols = p.columns ?? Math.ceil(Math.sqrt(kids.length));
  const rows = Math.ceil(kids.length / cols);
  const [sx, sy] = p.spacing ?? [420, 300];
  return group(kids.map((c, i) => {
    const gx = (i % cols - (cols - 1) / 2) * sx, gy = (Math.floor(i / cols) - (rows - 1) / 2) * sy;
    return place(c, p.plane === 'xz' ? [o[0] + gx, o[1], o[2] + gy] : [o[0] + gx, o[1] + gy, o[2]]);
  }));
}

/** Arranges children on a circle/arc around `center` in the XZ plane, each turned to face the centre (or outward). */
export function Circle3D(p: { center?: V3; radius?: number; startAngle?: number; arc?: number; face?: 'center' | 'out' | 'camera'; children?: any }) {
  const c = p.center ?? [960, 540, 0];
  const kids = layers(p.children);
  const arc = p.arc ?? 360, r = p.radius ?? 800, a0 = p.startAngle ?? 0;
  const step = kids.length > 1 ? arc / (arc >= 360 ? kids.length : kids.length - 1) : 0;
  return group(kids.map((k, i) => {
    const a = ((a0 + i * step) * Math.PI) / 180;
    const pos: V3 = [c[0] + Math.sin(a) * r, c[1], c[2] - Math.cos(a) * r];
    const face = p.face ?? 'out';
    const extra = face === 'camera' ? { autoOrient: 'camera' } : { rotationY: face === 'center' ? -((a * 180) / Math.PI) + 180 : -((a * 180) / Math.PI) };
    return place(k, pos, extra);
  }));
}

/** Parallax helper: each child's `depth` prop (any number, e.g. 0 front … 5 far) becomes z = depth · factor (use with a moving camera). */
export function Parallax(p: { factor?: number; children?: any }) {
  return group(layers(p.children).map((c) => place(c, [0, 0, (c.props.depth ?? 0) * (p.factor ?? 1)])));
}
