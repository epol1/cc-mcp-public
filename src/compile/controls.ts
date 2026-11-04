// Control registry: collects control(...) refs used in a comp and emits the "Controls" null layer,
// Essential Graphics entries, and the expression snippets that read each control.
import type { ControlRef } from '../dsl/control.ts';
import { parseColor } from '../shared/units.ts';

const MN: Record<ControlRef['kind'], string> = {
  slider: 'ADBE Slider Control', angle: 'ADBE Angle Control', checkbox: 'ADBE Checkbox Control', color: 'ADBE Color Control',
  point: 'ADBE Point Control', point3d: 'ADBE Point3D Control', dropdown: 'ADBE Dropdown Control', layer: 'ADBE Layer Control',
};

export const CONTROLS_LAYER = 'Controls';
export const CONTROLS_ID_SUFFIX = 'controls';

export class ControlRegistry {
  private map = new Map<string, ControlRef>();

  use(c: ControlRef): string {
    const prev = this.map.get(c.name);
    if (prev && prev.kind !== c.kind) throw new Error(`control "${c.name}" is used as both ${prev.kind} and ${c.kind}; give them different names`);
    if (!prev) this.map.set(c.name, c);
    return this.ref(c.name, c);
  }

  /** Expression that reads the control's current value (clamped when min/max are given). */
  ref(name: string, c?: ControlRef): string {
    const e = `thisComp.layer(${JSON.stringify(CONTROLS_LAYER)}).effect(${JSON.stringify(name)})(1)`;
    const cc = c ?? this.map.get(name);
    if (cc && cc.kind === 'slider' && (cc.min !== undefined || cc.max !== undefined)) return `clamp(${e}, ${cc.min ?? -1e9}, ${cc.max ?? 1e9})`;
    if (cc && cc.kind === 'checkbox') return `(${e} ? 1 : 0)`;
    return e;
  }

  get size(): number { return this.map.size; }
  all(): ControlRef[] { return [...this.map.values()]; }

  /** IR layer for the Controls null (or null when no controls are used). */
  layer(id: string): any | null {
    if (!this.map.size) return null;
    const items = this.all().map((c) => {
      let v: any = c.default;
      if (c.kind === 'color') v = parseColor(c.default);
      if (c.kind === 'checkbox') v = c.default ? 1 : 0;
      const spec: any = { mn: MN[c.kind], name: c.name };
      if (c.kind === 'dropdown') spec.menu = c.items;
      if (c.kind !== 'layer') spec.props = [{ p: '#1', v }];
      return spec;
    });
    return { id, type: 'null', name: CONTROLS_LAYER, enabled: false, shy: false, label: 2, groups: [{ at: 'ADBE Effect Parade', items }] };
  }

  /** Essential Graphics entries for controls with eg !== false. */
  egProps(layerId: string): { layer: string; p: string; name: string }[] {
    return this.all().filter((c) => c.eg !== false && c.kind !== 'layer').map((c) => ({ layer: layerId, p: `ADBE Effect Parade/${c.name}/#1`, name: c.name }));
  }
}
