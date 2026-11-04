// Layer transform props → PropSpecs. Position uses separated dimensions when x/y/z animate independently
// or when an animation can overshoot (springs, back/elastic): spatial eases can't overshoot along the path.
import type { Anim } from '../dsl/anim.ts';
import { isAnim } from '../dsl/anim.ts';
import type { LayerProps } from '../dsl/primitives.ts';
import { resolveEasing } from '../shared/easing.ts';
import type { PropSpec, ValueCtx } from './values.ts';
import { lowerValue, TOL } from './values.ts';

const TG = 'ADBE Transform Group';

function overshoots(a: any): boolean {
  if (!isAnim(a)) return false;
  if (a.$anim === 'spring' || a.$anim === 'fn' || a.$anim === 'wiggle' || a.$anim === 'expr') return true;
  if (a.$anim === 'tween') { const c = resolveEasing(a.easing); return !c.bezier || c.bezier[1] < 0 || c.bezier[1] > 1 || c.bezier[3] < 0 || c.bezier[3] > 1; }
  if (a.$anim === 'seq') return a.parts.some(overshoots);
  return true;
}

export interface TransformInput { props: LayerProps & Record<string, any>; anim: Record<string, Anim>; rest: { x: number; y: number; z: number }; threeD: boolean }

export function lowerTransform(inp: TransformInput, ctx: ValueCtx): PropSpec[] {
  const { props: p, anim } = inp;
  const get = (k: string) => (anim[k] !== undefined ? anim[k] : p[k]);
  const out: PropSpec[] = [];
  const push = (s: PropSpec | null) => { if (s) out.push(s); };
  const pos = get('position');
  const xs = get('x'), ys = get('y'), zs = get('z');
  const dims = inp.threeD ? 3 : 2;
  const rest = [inp.rest.x, inp.rest.y, inp.rest.z];
  const animatedAxes = [xs, ys, zs].filter((v) => isAnim(v) || (v && v.$control));
  const separate = !pos && (animatedAxes.length > 1 || animatedAxes.some(overshoots) || (animatedAxes.length === 1));
  if (pos !== undefined) {
    push(lowerValue(pos, { path: `${TG}/ADBE Position`, rest: rest.slice(0, dims), tol: TOL.px, offset: true, dims }, ctx));
  } else if (separate) {
    out.push({ p: `${TG}/ADBE Position`, sep: true });
    const axes: [string, any, number][] = [['ADBE Position_0', xs, 0], ['ADBE Position_1', ys, 1]];
    if (inp.threeD) axes.push(['ADBE Position_2', zs, 2]);
    for (const [mn, v, i] of axes) push(lowerValue(v ?? rest[i], { path: `${TG}/${mn}`, rest: [rest[i]], tol: TOL.px, offset: true, dims: 1 }, ctx));
  } else {
    push({ p: `${TG}/ADBE Position`, v: rest.slice(0, dims) });
  }
  // A static prop next to an animation of the same prop is its rest value: scale={50} + animate.scale ends at 50.
  const staticRest = (k: string, def: number[], conv?: (v: any) => number[]): number[] => {
    const v = p[k];
    if (anim[k] === undefined || v === undefined || isAnim(v) || (v && v.$control)) return def;
    return conv ? conv(v) : typeof v === 'number' ? [v] : [...v];
  };
  const sc = get('scale');
  if (sc !== undefined) {
    const conv = (v: any) => (typeof v === 'number' ? [v, v, inp.threeD ? v : 100] : [v[0], v[1] ?? v[0], v[2] ?? (inp.threeD ? v[0] : 100)]);
    push(lowerValue(sc, { path: `${TG}/ADBE Scale`, rest: staticRest('scale', [100, 100, 100], conv), tol: TOL.scale, dims: 3, conv }, ctx));
  }
  const rot = get('rotation');
  if (rot !== undefined) push(lowerValue(rot, { path: `${TG}/ADBE Rotate Z`, rest: staticRest('rotation', [0]), tol: TOL.deg, dims: 1 }, ctx));
  if (inp.threeD) {
    for (const [k, mn] of [['rotationX', 'ADBE Rotate X'], ['rotationY', 'ADBE Rotate Y']] as const) {
      const v = get(k);
      if (v !== undefined) push(lowerValue(v, { path: `${TG}/${mn}`, rest: staticRest(k, [0]), tol: TOL.deg, dims: 1 }, ctx));
    }
    const ori = get('orientation');
    if (ori !== undefined) push(lowerValue(ori, { path: `${TG}/ADBE Orientation`, rest: staticRest('orientation', [0, 0, 0]), tol: TOL.deg, dims: 3 }, ctx));
  }
  const op = get('opacity');
  if (op !== undefined) push(lowerValue(op, { path: `${TG}/ADBE Opacity`, rest: staticRest('opacity', [100]), tol: TOL.opacity, dims: 1 }, ctx));
  if (Array.isArray(p.anchor)) push({ p: `${TG}/ADBE Anchor Point`, v: inp.threeD ? [p.anchor[0], p.anchor[1], p.anchor[2] ?? 0] : [p.anchor[0], p.anchor[1]] });
  return out;
}

const BOX: Record<string, [number, number]> = {
  center: [0.5, 0.5], top: [0.5, 0], bottom: [0.5, 1], left: [0, 0.5], right: [1, 0.5],
  topLeft: [0, 0], topRight: [1, 0], bottomLeft: [0, 1], bottomRight: [1, 1],
};

/** Box-relative anchor for text/shape layers ("center" default), resolved in AE from sourceRectAtTime. */
export function anchorBox(anchor: LayerProps['anchor'], def: keyof typeof BOX | null): [number, number] | undefined {
  if (Array.isArray(anchor)) return undefined;
  const k = (anchor as string | undefined) ?? def;
  if (!k) return undefined;
  const b = BOX[k];
  if (!b) throw new Error(`unknown anchor "${anchor}": use one of ${Object.keys(BOX).join(', ')} or [x, y]`);
  return b;
}
