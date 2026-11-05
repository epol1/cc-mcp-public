// Rig effects (F2, D74): one pseudo effect holding a rig's controls ("aec Cloner", "aec Text Reveal"). A rig is a
// definition (params with kinds, defaults and ranges) plus an instance name and values; values may be numbers,
// colors, animations or control() refs like any prop. Expressions address a param as
// `effect("<instance>")("<param>")` on the rig's own layer, or through `__AEC_LAYER(id)__` from another layer.
import type { PseudoEffectDef, PseudoParam } from './ffx/pseudo.ts';
import { pseudoEffect } from './ffx/pseudo.ts';
import type { PropSpec, ValueCtx } from './values.ts';
import { lowerValue, TOL } from './values.ts';
import { parseColor } from '@ae-mcp/core/units.ts';
import { isAnim } from '../dsl/anim.ts';
import { isControl } from '../dsl/control.ts';

export type { PseudoEffectDef, PseudoParam };

/**
 * Expression reference to a rig param's value, on this layer or on the layer with IR id `layerId`. `.value`, because
 * a Property object is always truthy in AE's JavaScript engine (a checkbox in a condition would always be on).
 */
export function rigRef(instance: string, param: string, layerId?: string): string {
  return `${layerId ? `__AEC_LAYER(${layerId})__.` : ''}effect(${JSON.stringify(instance)})(${JSON.stringify(param)}).value`;
}

const flat = (ps: PseudoParam[]): PseudoParam[] => ps.flatMap((p) => (p.kind === 'group' ? flat(p.params) : [p]));

/** GroupSpec (under ADBE Effect Parade) for one instance of a rig effect, with its values lowered to props. */
export function rigEffectSpec(def: PseudoEffectDef, instance: string, values: Record<string, any>, vctx: ValueCtx): any {
  const fx = pseudoEffect(def);
  const byName = new Map(fx.params.map((p) => [p.name, p]));
  const defs = new Map(flat(def.params).map((p) => [p.name, p]));
  const props: PropSpec[] = [];
  for (const [name, v] of Object.entries(values)) {
    if (v === undefined) continue;
    const p = byName.get(name), d = defs.get(name);
    if (!p || !d) throw new Error(`rig effect "${def.name}" has no param "${name}" (params: ${[...defs.keys()].join(', ')})`);
    let val: any = v;
    if (d.kind === 'checkbox' && typeof v === 'boolean') val = v ? 1 : 0;
    if (d.kind === 'popup' && typeof v === 'string') { const ix = d.items.indexOf(v); if (ix < 0) throw new Error(`${def.name} "${name}": "${v}" is not one of ${d.items.join(', ')}`); val = ix + 1; }
    const color = d.kind === 'color';
    const dims = color ? 4 : d.kind === 'point' ? 2 : 1;
    const conv = color ? (c: any) => (typeof c === 'string' ? parseColor(c) : c.length === 3 ? [...c, 1] : c) : undefined;
    if (!isAnim(val) && !isControl(val) && typeof val !== 'number' && !Array.isArray(val) && typeof val !== 'string') throw new Error(`${def.name} "${name}": unsupported value ${JSON.stringify(v)}`);
    // By index: pseudo matchNames contain "/", which property paths split on.
    const s = lowerValue(val, { path: `#${p.index}`, rest: Array(dims).fill(0), dims, tol: color ? TOL.color : TOL.generic, conv }, vctx);
    if (s) props.push(s);
  }
  return { mn: fx.matchName, name: instance, pseudo: fx.file, props };
}
