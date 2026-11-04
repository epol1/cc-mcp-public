// Layout in AE: measure leaf layers with real metrics, run the shared solver, record slot centres.
import type { Ctx } from './ctx';
import { contentRect } from './layers';
import { warn } from './ctx';
import { errText } from './util';
import { frameCenter, solveLayout } from '../shared/es3/layout';
import type { IrLayer } from './layers';

export interface IrLayout { root: any; area: { x: number; y: number; w: number; h: number } }

/** Static uniform scale from the IR (applied in pass 4, so measurement must account for it). */
function irScale(L: IrLayer): number[] {
  if (!L.props) return [1, 1];
  for (let i = 0; i < L.props.length; i++) {
    const s = L.props[i];
    if (s.p === 'ADBE Transform Group/ADBE Scale' && s.v !== undefined) return [s.v[0] / 100, s.v[1] / 100];
  }
  return [1, 1];
}

/** Measures a laid-out layer's content size (call text right after its document is set, before animators). */
export function measureLeaf(ctx: Ctx, layer: Layer, L: IrLayer, sizes: { [id: string]: number[] }): void {
  if (!(L as any).layoutLeaf) return;
  const sc = irScale(L);
  let w = 0, h = 0;
  try {
    if (L.type === 'text' || L.type === 'shape') {
      const r = contentRect(layer, L.in !== undefined ? L.in : 0);
      w = r.width; h = r.height;
    } else {
      w = (layer as any).width; h = (layer as any).height;
    }
  } catch (e) { warn(ctx, 'could not measure layer for layout: ' + errText(e)); }
  sizes[L.id] = [w * Math.abs(sc[0]), h * Math.abs(sc[1])];
}

function fill(node: any, sizes: { [id: string]: number[] }, ctx: Ctx): void {
  if (node.kind === 'leaf') {
    if (node.size === undefined && node.width === undefined) {
      const s = sizes[node.id];
      if (!s) warn(ctx, 'layout leaf "' + node.id + '" was not measured');
      node.size = s || [0, 0];
    }
    return;
  }
  if (node.children) for (let i = 0; i < node.children.length; i++) fill(node.children[i], sizes, ctx);
}

/** Solves every layout of a comp; returns slot centres by layer id. */
export function solveComp(ctx: Ctx, layouts: IrLayout[], sizes: { [id: string]: number[] }, anchors: { [id: string]: number[] }): { [id: string]: number[] } {
  const pos: { [id: string]: number[] } = {};
  for (let i = 0; i < layouts.length; i++) {
    fill(layouts[i].root, sizes, ctx);
    const frames = solveLayout(layouts[i].root, layouts[i].area);
    for (const id in frames) {
      if (!Object.prototype.hasOwnProperty.call(frames, id)) continue;
      if (!ctx.layers[id]) continue;
      // The layer's anchor sits at the same relative point of its slot (centre, left edge, corner...).
      const a = anchors[id];
      const f = frames[id];
      pos[id] = a ? [f.x + f.w * a[0], f.y + f.h * a[1]] : frameCenter(f);
    }
  }
  return pos;
}
