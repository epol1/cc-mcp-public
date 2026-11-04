// Live controls: control("Title Delay", 0.2) marks a value as tweakable in AE without rebuilding.
// Compiles to an expression control on the scene's "Controls" null (plus an Essential Graphics entry),
// and the animation/property reads it through an expression.
import type { ColorSpec } from '../shared/units.ts';

export type ControlKind = 'slider' | 'angle' | 'checkbox' | 'color' | 'point' | 'point3d' | 'dropdown' | 'layer';

export interface ControlRef {
  $control: true;
  name: string;
  kind: ControlKind;
  default: any;
  min?: number;
  max?: number;
  items?: string[]; // dropdown labels
  /** Expose in Essential Graphics (default true). */
  eg?: boolean;
  group?: string; // optional grouping prefix for organization
  /** Constant added to the control's value where it is used (see plus()). */
  plus?: number;
}

export function isControl(x: any): x is ControlRef {
  return !!x && typeof x === 'object' && x.$control === true;
}

export interface ControlOpts { min?: number; max?: number; kind?: ControlKind; eg?: boolean; group?: string }

/**
 * Marks a value as a live control.
 * - number → Slider (or `kind: "angle"`), boolean → Checkbox, color string → Color,
 *   [x, y] → Point, [x, y, z] → 3D Point, `{ items: [...], default: 'B' }` → Dropdown.
 * Name it the way a designer would read it in the Effect Controls panel ("Title Delay", "Accent Color").
 */
export function control(name: string, value: number | boolean | ColorSpec | readonly number[] | { items: string[]; default?: string }, opts: ControlOpts = {}): ControlRef {
  let kind: ControlKind = opts.kind ?? 'slider';
  let def: any = value;
  let items: string[] | undefined;
  if (!opts.kind) {
    if (typeof value === 'boolean') kind = 'checkbox';
    else if (typeof value === 'string') kind = 'color';
    else if (Array.isArray(value)) kind = value.length === 3 && value.every((n) => n <= 1) && value.some((n) => n !== 0 && n !== 1) ? 'color' : value.length === 3 ? 'point3d' : 'point';
    else if (value && typeof value === 'object' && 'items' in (value as any)) {
      kind = 'dropdown';
      items = (value as any).items;
      def = Math.max(1, (items as string[]).indexOf((value as any).default ?? (items as string[])[0]) + 1);
    }
  }
  return { $control: true, name, kind, default: def, min: opts.min, max: opts.max, items, eg: opts.eg ?? true, group: opts.group };
}

/**
 * The control's value plus a constant, for staggering: delay: plus(control('Chart Delay', 0.5), i * 0.09)
 * makes every bar start 0.09 s after the previous one while the one slider shifts them all live.
 */
export function plus(c: ControlRef, n: number): ControlRef {
  return { ...c, plus: (c.plus ?? 0) + n };
}
