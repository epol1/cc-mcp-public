// AutoFit (K3): text that fits a box. At build time the text is broken into balanced lines (breakLines with an
// approximate width) and the size is stepped down until the lines fit `maxLines` and the box; in AE a scale
// expression shrinks the layer further if the real metrics still overflow (sourceRectAtTime vs the box, never
// enlarging past Max Scale). The box size lives in one "aec Auto Fit" rig effect, so a designer can retype the
// text or resize the box and it still fits. The result is ordinary point text with line breaks ("\r").
import { jsx } from '../jsx-runtime.ts';
import { childrenOf } from '../jsx-runtime.ts';
import { RigEffect, Text } from '../primitives.ts';
import type { TextProps } from '../primitives.ts';
import type { PseudoEffectDef } from '../../compile/ffx/pseudo.ts';
import { breakLines } from '../../text/linebreak.ts';
import { dslWarn } from '../warn.ts';
import { slider, textMeasure } from './common.ts';

export interface AutoFitProps extends Omit<TextProps, 'box'> {
  id: string;
  /** The box the text must fit, px (centred on the layer's position). */
  fit: { width: number; height: number };
  /** Largest size (default `size` or 72) and smallest size the build may pick (default 40 % of it). */
  minSize?: number;
  /** Most lines (default: as many as fit the height). */
  maxLines?: number;
  /** Balanced lines (default true). With false, the text keeps its own line breaks only. */
  balance?: boolean;
}

export interface FitResult { lines: string[]; size: number; fits: boolean; leading: number }

/**
 * Build-time fit: the largest size (in 2 % steps, down to minSize) whose balanced lines fit width × height and
 * maxLines. Hard line breaks in the text are kept (each paragraph is balanced on its own).
 */
export function autoFitLines(text: string, o: { width: number; height: number; size?: number; minSize?: number; maxLines?: number; font?: string; tracking?: number; caps?: boolean; leading?: number | 'auto'; balance?: boolean }): FitResult {
  const max = o.size ?? 72;
  const min = Math.min(max, o.minSize ?? Math.round(max * 0.4));
  const paras = text.split(/\r\n|\r|\n/);
  const lead = (s: number) => (typeof o.leading === 'number' ? o.leading * (s / max) : s * 1.2);
  let last: FitResult | null = null;
  for (let size = max; size >= min - 1e-9; size = size > min && size * 0.98 < min ? min : size * 0.98) {
    const s = Math.round(size * 10) / 10;
    const measure = textMeasure({ font: o.font, size: s, tracking: o.tracking, caps: o.caps });
    const lines = o.balance === false ? paras : paras.flatMap((p) => (p.trim() ? breakLines(p, { maxWidth: o.width, measure, maxLines: 99 }) : ['']));
    const widest = Math.max(...lines.map(measure));
    // Height: lines × leading, the last line counted by its cap height + descent (~1 em).
    const height = (lines.length - 1) * lead(s) + s;
    const fits = widest <= o.width + 1e-6 && height <= o.height + 1e-6 && (o.maxLines === undefined || lines.length <= o.maxLines);
    last = { lines, size: s, fits, leading: lead(s) };
    if (fits) return last;
    if (s <= min) break;
  }
  return last!;
}

const DEF: PseudoEffectDef = { name: 'aec Auto Fit', params: [slider('Width', 800, 1, 8000, 0), slider('Height', 400, 1, 8000, 0), slider('Max Scale', 100, 1, 400, 0), slider('Measure At', -1, -1, 600, 2)] };

/** <AutoFit id="t" fit={{ width: 900, height: 300 }} size={120}>Long headline…</AutoFit> */
export function AutoFit(p: AutoFitProps & { children?: any }) {
  const text = p.text ?? childrenOf(p.children).filter((c) => typeof c === 'string').join('');
  if (!text) throw new Error(`AutoFit "${p.id}": needs text`);
  if (!p.fit || !(p.fit.width > 0) || !(p.fit.height > 0)) throw new Error(`AutoFit "${p.id}": fit={{ width, height }} (px) is required`);
  const r = autoFitLines(text, { width: p.fit.width, height: p.fit.height, size: p.size, minSize: p.minSize, maxLines: p.maxLines, font: p.font, tracking: p.tracking, caps: p.caps === 'all', leading: p.leading, balance: p.balance });
  if (!r.fits) dslWarn(`AutoFit "${p.id}": "${text.slice(0, 40)}" doesn't fit ${p.fit.width}×${p.fit.height} even at ${r.size}px; AE scales it down further`);
  const code = [
    '// ae-compose auto-fit: shrink to the box in the Auto Fit effect (measured at Measure At s, −1 = mid-layer)',
    'var e = effect("Auto Fit"), ma = e("Measure At").value, tm = ma < 0 ? (inPoint + outPoint) / 2 : inPoint + ma;',
    'var r = sourceRectAtTime(tm, false), k = Math.min(e("Max Scale").value / 100, e("Width").value / Math.max(r.width, 1), e("Height").value / Math.max(r.height, 1));',
    'value.length > 2 ? [value[0] * k, value[1] * k, value[2]] : [value[0] * k, value[1] * k];',
  ].join('\n');
  const { fit, minSize: _m, maxLines: _l, balance: _b, children: _c, text: _t, ...rest } = p;
  return jsx(Text, {
    ...rest,
    text: r.lines.join('\r'),
    size: r.size,
    leading: typeof p.leading === 'number' ? Math.round(r.leading * 10) / 10 : p.leading,
    expressions: { ...(p.expressions ?? {}), 'ADBE Transform Group/ADBE Scale': code },
    effects: [...(p.effects ?? []), jsx(RigEffect, { def: DEF, name: 'Auto Fit', values: { Width: fit.width, Height: fit.height } })],
  });
}
(AutoFit as any).displayName = 'AutoFit';
