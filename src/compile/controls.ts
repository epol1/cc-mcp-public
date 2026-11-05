// Control registry: collects control(...) refs used in a comp and emits the "Controls" null layer,
// Essential Graphics entries, and the expression snippets that read each control. Controls with a `group` become
// one rig (pseudo) effect named after the group, holding exactly those controls (D74).
import type { ControlRef } from '../dsl/control.ts';
import { parseColor } from '@ae-mcp/core/units.ts';
import type { PseudoParam } from './ffx/pseudo.ts';
import { pseudoEffect } from './ffx/pseudo.ts';

const MN: Record<ControlRef['kind'], string> = {
  slider: 'ADBE Slider Control', angle: 'ADBE Angle Control', checkbox: 'ADBE Checkbox Control', color: 'ADBE Color Control',
  point: 'ADBE Point Control', point3d: 'ADBE Point3D Control', dropdown: 'ADBE Dropdown Control', layer: 'ADBE Layer Control',
};

export const CONTROLS_LAYER = 'Controls';
export const CONTROLS_ID_SUFFIX = 'controls';

const keyOf = (c: { name: string; group?: string }) => (c.group ? `${c.group}/${c.name}` : c.name);

/** A grouped control as a param of its group's rig effect. */
function groupParam(c: ControlRef): PseudoParam {
  switch (c.kind) {
    case 'slider': {
      const d = Number(c.default);
      const span = d === 0 ? 100 : Math.max(1, Math.abs(d) * 3);
      return { kind: 'slider', name: c.name, default: d, min: c.min ?? Math.min(0, -span), max: c.max ?? span, validMin: c.min, validMax: c.max, precision: 2 };
    }
    case 'angle': return { kind: 'angle', name: c.name, default: Number(c.default) };
    case 'checkbox': return { kind: 'checkbox', name: c.name, default: !!c.default };
    case 'color': return { kind: 'color', name: c.name, default: parseColor(c.default) };
    case 'point': return { kind: 'point', name: c.name, default: c.default as number[] };
    case 'dropdown': return { kind: 'popup', name: c.name, items: c.items ?? [], default: c.default };
    case 'layer': return { kind: 'layer', name: c.name };
    default: throw new Error(`control "${c.name}": ${c.kind} controls can't be grouped into a rig effect; drop \`group\``);
  }
}

function initial(c: ControlRef): any {
  if (c.kind === 'color') return parseColor(c.default);
  if (c.kind === 'checkbox') return c.default ? 1 : 0;
  return c.default;
}

export class ControlRegistry {
  private map = new Map<string, ControlRef>();
  /** Expression prefix for the comp that holds the Controls null: thisComp, or comp("<main>") inside precomps. */
  private host = 'thisComp';

  /** A view of this registry for a precomp: same controls, read from the main comp's Controls null. */
  scoped(mainComp: string): ControlRegistry {
    const r = Object.create(ControlRegistry.prototype) as ControlRegistry;
    r.map = this.map;
    r.host = `comp(${JSON.stringify(mainComp)})`;
    return r;
  }

  use(c: ControlRef): string {
    const prev = this.map.get(keyOf(c));
    if (prev && prev.kind !== c.kind) throw new Error(`control "${keyOf(c)}" is used as both ${prev.kind} and ${c.kind}; give them different names`);
    if (!prev) this.map.set(keyOf(c), c);
    return this.ref(keyOf(c), c);
  }

  /** Expression that reads the control's current value (clamped when min/max are given). */
  ref(key: string, c?: ControlRef): string {
    const cc = c ?? this.map.get(key);
    const layer = `${this.host}.layer(${JSON.stringify(CONTROLS_LAYER)})`;
    // Grouped: a rig effect param, whose range AE enforces itself.
    if (cc?.group) { const g = `${layer}.effect(${JSON.stringify(cc.group)})(${JSON.stringify(cc.name)}).value`; return cc.kind === "checkbox" ? `(${g} ? 1 : 0)` : g; }
    const e = `${layer}.effect(${JSON.stringify(key)})(1)`;
    if (cc && cc.kind === 'slider' && (cc.min !== undefined || cc.max !== undefined)) return `clamp(${e}, ${cc.min ?? -1e9}, ${cc.max ?? 1e9})`;
    if (cc && cc.kind === "checkbox") return `(${e}.value ? 1 : 0)`; // a Property object is always truthy in the JS engine
    return e;
  }

  get size(): number { return this.map.size; }
  all(): ControlRef[] { return [...this.map.values()]; }

  /** IR layer for the Controls null (or null when no controls are used). */
  layer(id: string): any | null {
    if (!this.map.size) return null;
    const items: any[] = [];
    const groups = new Map<string, ControlRef[]>();
    for (const c of this.all()) {
      if (c.group) { if (!groups.has(c.group)) { groups.set(c.group, []); items.push({ group: c.group }); } groups.get(c.group)!.push(c); continue; }
      const spec: any = { mn: MN[c.kind], name: c.name };
      if (c.kind === 'dropdown') spec.menu = c.items;
      if (c.kind !== 'layer') spec.props = [{ p: '#1', v: initial(c) }];
      items.push(spec);
    }
    // Each group becomes one rig effect, in the position of its first control.
    const out = items.map((it) => {
      if (!it.group) return it;
      const members = groups.get(it.group)!;
      const fx = pseudoEffect({ name: it.group, params: members.map(groupParam) });
      const props = members.filter((c) => c.kind !== "layer").map((c) => ({ p: `#${fx.params.find((p) => p.name === c.name)!.index}`, v: initial(c) }));
      return { mn: fx.matchName, name: it.group, pseudo: fx.file, props };
    });
    return { id, type: 'null', name: CONTROLS_LAYER, enabled: false, shy: false, label: 2, groups: [{ at: 'ADBE Effect Parade', items: out }] };
  }

  /** Essential Graphics entries for controls with eg !== false. */
  egProps(layerId: string): { layer: string; p: string; name: string }[] {
    return this.all().filter((c) => c.eg !== false && c.kind !== 'layer').map((c) => ({ layer: layerId, p: c.group ? `ADBE Effect Parade/${c.group}/${c.name}` : `ADBE Effect Parade/${c.name}/#1`, name: c.group ? `${c.group} ${c.name}` : c.name }));
  }
}
