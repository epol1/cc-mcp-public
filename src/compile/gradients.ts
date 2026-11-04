// Shape gradients. Gradient stops are not scriptable, and touching G-Fill internals crashes AE 26.5 (D15),
// so the final implementation applies a generated .ffx animation preset (see roadmap task "gradients").
// Until then: a solid Fill/Stroke with the first stop + an explicit warning (never a silent fallback).
import { parseColor } from '../shared/units.ts';
import type { ValueCtx } from './values.ts';

export function buildGradient(kind: 'gfill' | 'gstroke', p: any, _ctx: ValueCtx, warnings: string[]): any {
  const first = p.stops?.[0]?.color ?? '#ffffff';
  warnings.push(`${kind === 'gfill' ? 'GradientFill' : 'GradientStroke'} "${p.name ?? ''}": gradient stops are not wired yet; using a solid ${kind === 'gfill' ? 'fill' : 'stroke'} with the first stop`);
  if (kind === 'gfill') return { mn: 'ADBE Vector Graphic - Fill', name: p.name, props: [{ p: 'ADBE Vector Fill Color', v: parseColor(first) }] };
  return { mn: 'ADBE Vector Graphic - Stroke', name: p.name, props: [{ p: 'ADBE Vector Stroke Color', v: parseColor(first) }, { p: 'ADBE Vector Stroke Width', v: p.width ?? 4 }] };
}
