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

// Contents groups are never searched deeply: nested shape groups repeat the same matchNames.
const NO_DEEP: { [mn: string]: boolean } = { 'ADBE Root Vectors Group': true, 'ADBE Vectors Group': true, 'ADBE Effect Parade': true, 'ADBE Mask Parade': true, 'ADBE Text Animators': true };

function deep(g: any, seg: string, depth: number): any {
  if (depth > 4 || !g || g.propertyType === PropertyType.PROPERTY) return null;
  for (let i = 1; i <= g.numProperties; i++) {
    const c = g.property(i);
    if (c.matchName === seg || c.name === seg) return c;
  }
  for (let i = 1; i <= g.numProperties; i++) {
    const c = g.property(i);
    if (c.propertyType !== PropertyType.PROPERTY && !NO_DEEP[c.matchName]) {
      const r = deep(c, seg, depth + 1);
      if (r) return r;
    }
  }
  return null;
}

/** Resolves a path; a segment that isn't a direct child is searched in nested (non-contents) groups. */
export function resolve(root: PropertyGroup | Layer, path: string): PropertyBase | null {
  const segs = path.split('/');
  let cur: any = root;
  for (let i = 0; i < segs.length; i++) {
    if (!cur) return null;
    cur = child(cur, segs[i]) || (segs[i].charAt(0) !== '#' ? deep(cur, segs[i], 0) : null);
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
    // AE hides some properties depending on renderer/light/layer state; report, don't abort the build.
    if (String(e).indexOf('hidden') >= 0) { warn(ctx, prop.name + ' (' + prop.matchName + ') is hidden in the current renderer/state and was not set'); return; }
    fail(ctx, 'cannot set ' + prop.name + ' (' + prop.matchName + '): ' + e);
  }
}

export function setExpression(ctx: Ctx, prop: Property, expr: string, out: { prop: Property; id: string }[]): void {
  if (!prop.canSetExpression) { warn(ctx, prop.matchName + ' cannot take an expression'); return; }
  prop.expression = expr;
  prop.expressionEnabled = true;
  out[out.length] = { prop: prop, id: ctx.cur };
}
