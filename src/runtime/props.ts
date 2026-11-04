// Property addressing and value coercion.
// Paths are "/"-separated segments relative to a layer (or group): matchName, display name, or "#<index>".
import type { Ctx } from './ctx';
import { fail, warn } from './ctx';
import { isArray } from './util';
import { isCrashy, isOpaqueValueType } from './safety';

export function child(g: PropertyGroup | Layer, seg: string): PropertyBase | null {
  let p: any = null;
  if (seg.charAt(0) === '#') p = (g as any).property(parseInt(seg.substring(1), 10));
  else p = (g as any).property(seg);
  return p || null;
}

export function resolve(root: PropertyGroup | Layer, path: string): PropertyBase | null {
  const segs = path.split('/');
  let cur: any = root;
  for (let i = 0; i < segs.length; i++) {
    if (!cur) return null;
    cur = child(cur, segs[i]);
  }
  return cur;
}

export function mustResolve(ctx: Ctx, root: PropertyGroup | Layer, path: string): PropertyBase {
  const p = resolve(root, path);
  if (!p) fail(ctx, 'property not found: "' + path + '"');
  return p as PropertyBase;
}

/** Index path from the layer down to `p`, so references can be re-fetched after siblings are added. */
export function indexPath(p: PropertyBase): number[] {
  const r: number[] = [];
  let cur: any = p;
  while (cur && cur.parentProperty) {
    r.unshift(cur.propertyIndex);
    cur = cur.parentProperty;
  }
  return r;
}

export function byIndexPath(layer: Layer, path: number[]): any {
  let cur: any = layer;
  for (let i = 0; i < path.length; i++) cur = cur.property(path[i]);
  return cur;
}

/** Number of KeyframeEase entries AE expects for this property (spatial → 1, TwoD → 2, ThreeD → 3, else 1). */
export function easeDims(prop: Property): number {
  const vt = prop.propertyValueType;
  if (vt === PropertyValueType.TwoD) return 2;
  if (vt === PropertyValueType.ThreeD) return 3;
  return 1;
}

export interface ShapeValue { v: number[][]; i?: number[][]; o?: number[][]; c?: boolean; feather?: any }

export function makeShape(s: ShapeValue): Shape {
  const sh: any = new Shape();
  const n = s.v.length;
  const zero: number[][] = [];
  for (let k = 0; k < n; k++) zero[k] = [0, 0];
  sh.vertices = s.v;
  sh.inTangents = s.i || zero;
  sh.outTangents = s.o || zero;
  sh.closed = s.c !== false;
  return sh;
}

/** Converts an IR value into what `prop.setValue` expects. `layers` resolves { layer: id } references. */
export function coerce(ctx: Ctx, prop: Property, v: any): any {
  const vt = prop.propertyValueType;
  if (isOpaqueValueType(vt) || isCrashy(prop.matchName)) fail(ctx, 'refusing to set opaque/crash-prone property ' + prop.matchName);
  if (vt === PropertyValueType.SHAPE) return makeShape(v as ShapeValue);
  if (vt === PropertyValueType.LAYER_INDEX || vt === PropertyValueType.MASK_INDEX) {
    if (v && typeof v === 'object' && v.layer !== undefined) {
      const L = ctx.layers[v.layer];
      if (!L) fail(ctx, 'layer reference not found: ' + v.layer);
      return L.index;
    }
    return v;
  }
  if (vt === PropertyValueType.COLOR && isArray(v) && v.length === 3) return [v[0], v[1], v[2], 1];
  return v;
}

export function setStatic(ctx: Ctx, prop: Property, v: any): void {
  const val = coerce(ctx, prop, v);
  if (prop.numKeys > 0) {
    for (let k = prop.numKeys; k >= 1; k--) prop.removeKey(k);
  }
  try {
    prop.setValue(val);
  } catch (e) {
    fail(ctx, 'cannot set ' + prop.name + ' (' + prop.matchName + '): ' + e);
  }
}

export function setExpression(ctx: Ctx, prop: Property, expr: string, out: { prop: Property; id: string }[]): void {
  if (!prop.canSetExpression) { warn(ctx, prop.matchName + ' cannot take an expression'); return; }
  prop.expression = expr;
  prop.expressionEnabled = true;
  out[out.length] = { prop: prop, id: ctx.cur };
}
