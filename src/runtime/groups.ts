// Generic structural builder: shapes, effects, masks, text animators and layer styles are all
// "addProperty(matchName) under an indexed group, then set attributes and sub-properties, then recurse".
// References are re-fetched by index path after every add, because AE invalidates sibling refs.
import type { Ctx } from './ctx';
import { fail, warn } from './ctx';
import type { IrKey } from './keys';
import { applyKeys } from './keys';
import { byIndexPath, indexPath, mustResolve, setExpression, setStatic } from './props';
import { each } from './util';

export interface PropSpec {
  p: string; // path relative to the owner (layer or group)
  v?: any; // static value
  keys?: IrKey[];
  expr?: string;
  sep?: boolean; // set dimensionsSeparated on this property
  rel?: number[]; // add the layout slot centre (component indices) to values and keys
  enabled?: boolean;
}

export interface GroupSpec {
  mn: string; // matchName to add
  name?: string;
  attrs?: { [k: string]: any }; // object attributes (e.g. maskMode, enabled)
  props?: PropSpec[];
  set?: PropSpec; // when the added item is itself a property (text animator props)
  kids?: { at: string; items: GroupSpec[] }[];
  /** Dropdown Menu Control items (setPropertyParameters). */
  menu?: string[];
  /** .ffx preset applied to this property right after it is added (shape gradient stops, D47). */
  ffx?: string;
  id?: string; // IR id for attribution
}

export interface Pending {
  exprs: { owner: number[]; layer: Layer; spec: PropSpec; id: string }[];
}

const ATTR_ENUMS: { [attr: string]: any } = {
  maskMode: MaskMode,
  maskMotionBlur: MaskMotionBlur,
  maskFeatherFalloff: MaskFeatherFalloff,
};

function setAttrs(ctx: Ctx, g: any, attrs: { [k: string]: any }): void {
  for (const k in attrs) {
    if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
    let v = attrs[k];
    const en = ATTR_ENUMS[k];
    if (en && typeof v === 'string') {
      if (en[v] === undefined) fail(ctx, 'unknown ' + k + ' "' + v + '"');
      v = en[v];
    }
    try { g[k] = v; } catch (e) { warn(ctx, 'cannot set attribute ' + k + ': ' + e); }
  }
}

/** Applies property specs on `owner`. Expressions are deferred (collected in `pending`) so all targets exist first. */
export function applyProps(ctx: Ctx, layer: Layer, owner: any, specs: PropSpec[] | undefined, pending: Pending): void {
  if (!specs) return;
  const ownerPath = owner === layer ? [] : indexPath(owner);
  for (let i = 0; i < specs.length; i++) {
    const s = specs[i];
    const prop = mustResolve(ctx, owner, s.p) as Property;
    if (s.sep !== undefined) {
      (prop as any).dimensionsSeparated = s.sep;
      continue;
    }
    const base = (ctx as any).layoutBase as number[] | null;
    if (s.rel && base) {
      const add = (v: any) => {
        if (typeof v === 'number') return v + base[s.rel![0]];
        const o: number[] = [];
        for (let d = 0; d < v.length; d++) o[d] = v[d] + (d < s.rel!.length ? base[s.rel![d]] || 0 : 0);
        return o;
      };
      if (s.v !== undefined) s.v = add(s.v);
      if (s.keys) for (let k = 0; k < s.keys.length; k++) s.keys[k].v = add(s.keys[k].v);
    }
    if (s.enabled !== undefined) {
      try { (prop as any).enabled = s.enabled; } catch (e) { warn(ctx, 'cannot toggle ' + s.p); }
    }
    if (s.keys && s.keys.length) {
      try { applyKeys(ctx, prop, s.keys); } catch (e) {
        if (String(e).indexOf('hidden') >= 0) { warn(ctx, prop.name + ' is hidden in the current renderer/state; keys not set'); continue; }
        throw e;
      }
    }
    else if (s.v !== undefined) setStatic(ctx, prop, s.v);
    if (s.expr) pending.exprs[pending.exprs.length] = { owner: ownerPath, layer: layer, spec: s, id: ctx.cur };
  }
}

export function flushExpressions(ctx: Ctx, pending: Pending, out: { prop: Property; id: string }[]): void {
  each(pending.exprs, (x) => {
    ctx.cur = x.id;
    const owner = x.owner.length ? byIndexPath(x.layer, x.owner) : x.layer;
    const prop = mustResolve(ctx, owner, x.spec.p) as Property;
    setExpression(ctx, prop, x.spec.expr as string, out);
  });
  pending.exprs = [];
}

/**
 * Applies an animation preset to one property: clear the comp selection, select only that property,
 * layer.applyPreset (the AEUX technique for gradient stops). Never reads the gradient Colors property.
 */
function applyPresetToProperty(ctx: Ctx, layer: Layer, path: number[], file: string): void {
  const comp = layer.containingComp;
  const f = new File(file);
  if (!f.exists) fail(ctx, 'preset file missing: ' + file);
  try { const sp = comp.selectedProperties; for (let i = sp.length - 1; i >= 0; i--) { try { (sp[i] as any).selected = false; } catch (e) {} } } catch (e) {}
  try { const sl = comp.selectedLayers; for (let i = sl.length - 1; i >= 0; i--) sl[i].selected = false; } catch (e) {}
  const target = byIndexPath(layer, path);
  target.selected = true;
  try { (layer as any).applyPreset(f); }
  catch (e) { warn(ctx, 'gradient preset could not be applied: ' + e); }
  try { byIndexPath(layer, path).selected = false; } catch (e) {}
  layer.selected = false;
}

/** Adds `items` under the indexed group at `at` (path relative to `owner`). */
export function buildGroups(ctx: Ctx, layer: Layer, owner: any, at: string, items: GroupSpec[], pending: Pending): void {
  const parent0 = mustResolve(ctx, owner, at) as PropertyGroup;
  const parentPath = indexPath(parent0);
  for (let i = 0; i < items.length; i++) {
    const spec = items[i];
    const prevCur = ctx.cur;
    if (spec.id) ctx.cur = spec.id;
    const parent = byIndexPath(layer, parentPath) as PropertyGroup;
    if (!parent.canAddProperty(spec.mn)) fail(ctx, 'cannot add "' + spec.mn + '" under "' + parent.matchName + '"');
    const added = parent.addProperty(spec.mn);
    const path = indexPath(added);
    let g: any = byIndexPath(layer, path);
    if (spec.name) { g.name = spec.name; g = byIndexPath(layer, path); }
    if (spec.attrs) setAttrs(ctx, g, spec.attrs);
    if (spec.menu) { (g.property(1) as any).setPropertyParameters(spec.menu); g = byIndexPath(layer, path); }
    if (spec.ffx) { applyPresetToProperty(ctx, layer, path, spec.ffx); g = byIndexPath(layer, path); }
    if (spec.kids) {
      for (let k = 0; k < spec.kids.length; k++) {
        buildGroups(ctx, layer, byIndexPath(layer, path), spec.kids[k].at, spec.kids[k].items, pending);
      }
    }
    g = byIndexPath(layer, path);
    if (spec.set) applyProps(ctx, layer, g.parentProperty, [{ p: '#' + g.propertyIndex, v: spec.set.v, keys: spec.set.keys, expr: spec.set.expr }], pending);
    if (spec.props) applyProps(ctx, layer, g, spec.props, pending);
    ctx.cur = prevCur;
  }
}
