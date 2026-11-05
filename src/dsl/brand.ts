// Brand tokens: one place for a brand's colors, fonts and type sizes, used across scenes. Colors listed in `live`
// become live controls ("Accent Color") wherever they're used, so a designer can re-color the whole piece in AE.
import { control } from './control.ts';
import type { ControlRef } from './control.ts';
import type { ColorSpec } from '@cc-mcp/core/units.ts';
import { parseColor } from '@cc-mcp/core/units.ts';

export interface BrandSpec<C extends string = string, F extends string = string, S extends string = string> {
  colors: Record<C, ColorSpec>;
  /** PostScript font names by role, e.g. { display: 'Inter-Black', body: 'Inter-Medium' }. */
  fonts?: Record<F, string>;
  /** Type sizes by role (px at 1920×1080), e.g. { hero: 180, body: 44 }. */
  sizes?: Record<S, number>;
  /** Color names that become live controls named "<Name> Color" (e.g. ['accent'] → "Accent Color"). */
  live?: NoInfer<C>[];
}

export interface Brand<C extends string, F extends string, S extends string> {
  /** Color tokens: plain colors, or controls for the `live` ones (use them anywhere a color is accepted). */
  colors: Record<C, ColorSpec | ControlRef>;
  fonts: Record<F, string>;
  sizes: Record<S, number>;
  /** The plain value of a color token (for places that need a fixed color, like gradient stops). */
  value(name: C): string;
}

const title = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * const b = brand({ colors: { ink: '#0b0d12', accent: '#4683c4' }, fonts: { display: 'Inter-Black' }, live: ['accent'] });
 * <Text font={b.fonts.display} color={b.colors.accent}>…</Text>
 */
export function brand<C extends string, F extends string = never, S extends string = never>(spec: BrandSpec<C, F, S>): Brand<C, F, S> {
  const colors = {} as Record<C, ColorSpec | ControlRef>;
  for (const k of Object.keys(spec.colors) as C[]) {
    const v = spec.colors[k];
    parseColor(v); // fail early on a bad color
    colors[k] = spec.live?.includes(k) ? control(`${title(k)} Color`, v as any) : v;
  }
  for (const k of spec.live ?? []) if (!(k in spec.colors)) throw new Error(`brand(): live color "${k}" is not in colors`);
  return {
    colors,
    fonts: (spec.fonts ?? {}) as Record<F, string>,
    sizes: (spec.sizes ?? {}) as Record<S, number>,
    value: (name: C) => {
      const v = spec.colors[name];
      if (v === undefined) throw new Error(`brand(): no color "${name}"`);
      return typeof v === 'string' ? v : '#' + parseColor(v).slice(0, 3).map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
    },
  };
}
