// Shared helpers for the typography kit (K3): the frame a component lays out in, approximate text widths for
// build-time line breaking, rig-effect definitions, and expression snippets (ES3-safe, so they also run under
// AE's legacy ExtendScript engine) that read a text layer's live Source Text.
import { approxWidth } from '@ae-mcp/core/text/measure.ts';
import { parseColor, parseTime } from '@ae-mcp/core/units.ts';
import type { ColorSpec, Time } from '@ae-mcp/core/units.ts';
import type { ControlRef } from '../control.ts';
import { isControl } from '../control.ts';
import type { PseudoParam } from '../../compile/ffx/pseudo.ts';

export interface Frame { w: number; h: number; fps: number; vertical: boolean }

/**
 * The comp a component is built for: an explicit `frame`, else the comp the compiler is building (when it publishes
 * `globalThis.__AEC_COMP__ = { w, h, fps }`), else 1920×1080 @ 30.
 */
export function compFrame(frame?: readonly [number, number], fps?: number): Frame {
  const g = (globalThis as any).__AEC_COMP__;
  const w = frame?.[0] ?? g?.w ?? 1920;
  const h = frame?.[1] ?? g?.h ?? 1080;
  return { w, h, fps: fps ?? g?.fps ?? 30, vertical: h > w * 1.2 };
}

export const secs = (t: Time | undefined, def: number, fps = 30): number => parseTime(t, fps, def);

/** How much wider a weight sets than approxWidth's regular grotesque (Helvetica-like advances). */
export function weightFactor(font: string): number {
  if (/Condensed|Narrow|Compressed/i.test(font)) return 0.84;
  if (/Black|Heavy|ExtraBold|UltraBold/i.test(font)) return 1.1;
  if (/SemiBold|DemiBold|Bold/i.test(font)) return 1.06;
  if (/Medium/i.test(font)) return 1.03;
  return 1;
}

/** Approximate rendered width in px of a string in this style (for line breaking before AE measures). */
export function textMeasure(o: { font?: string; size?: number; tracking?: number; caps?: boolean }): (s: string) => number {
  const k = weightFactor(o.font ?? 'Inter-Bold');
  const size = o.size ?? 72;
  return (s: string) => approxWidth(o.caps ? s.toUpperCase() : s, size, { tracking: o.tracking }) * k;
}

/** A color token's plain value (a control's default) as [r, g, b, a] 0–1. */
export function colorValue(c: ColorSpec | ControlRef): number[] {
  return parseColor(isControl(c) ? (c.default as any) : (c as any));
}

/** Hex of a color token (for static props that can't take a control, e.g. a text animator's "from" fill). */
export function hexOf(c: ColorSpec | ControlRef): string {
  const v = colorValue(c);
  return '#' + v.slice(0, 3).map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0')).join('');
}

// ---------- rig-effect param builders ----------
export const slider = (name: string, def: number, min: number, max: number, precision = 2, extra: Partial<Extract<PseudoParam, { kind: 'slider' }>> = {}): PseudoParam => ({ kind: 'slider', name, default: def, min, max, precision, ...extra });
export const colorParam = (name: string, c: ColorSpec | ControlRef): PseudoParam => ({ kind: 'color', name, default: colorValue(c) });
export const checkbox = (name: string, def: boolean): PseudoParam => ({ kind: 'checkbox', name, default: def });

// ---------- expression snippets ----------
/** `effect("<inst>")` on this layer, or on the layer with IR id `layerId` (resolved by the compiler). */
export const fxOf = (inst: string, layerId?: string): string => `${layerId ? `__AEC_LAYER(${layerId})__.` : ''}effect(${JSON.stringify(inst)})`;

/** Expression line: `var <name> = <text of the Source Text value v>` (a string or a TextDocument-like object). */
export const textOf = (name: string, v: string): string =>
  `var ${name}__v = ${v}; var ${name} = (${name}__v && typeof ${name}__v === "object" && ${name}__v.text !== undefined) ? "" + ${name}__v.text : "" + ${name}__v;`;

/** Text animator property path on a text layer (animator by name, as created with `name` on perWord/perChar). */
export const animatorPath = (animator: string, rest: string): string => `ADBE Text Properties/ADBE Text Animators/${animator}/${rest}`;
/** The Amount of an animator's first (Expression) selector. */
export const amountPath = (animator: string): string => animatorPath(animator, 'ADBE Text Selectors/#1/ADBE Text Expressible Amount');
export const SOURCE_TEXT = 'ADBE Text Properties/ADBE Text Document';

/** Bezier presets used in generated expressions (CSS-style cubic beziers). */
export const EASE = {
  outCubic: '0.215, 0.61, 0.355, 1',
  inCubic: '0.55, 0.055, 0.675, 0.19',
  inOutCubic: '0.645, 0.045, 0.355, 1',
  outQuint: '0.23, 1, 0.32, 1',
} as const;

/** The words of a text as AE counts them for "Based On: Words" (whitespace-separated, line breaks included). */
export function wordsOf(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

const bare = (w: string) => w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

/** 0-based word index from an index or a word (first match, ignoring case and surrounding punctuation). */
export function resolveWord(text: string, word: number | string, who: string): number {
  const ws = wordsOf(text);
  if (typeof word === 'number') {
    if (!Number.isInteger(word) || word < 0 || word >= ws.length) throw new Error(`${who}: word ${word} is out of range; the text has ${ws.length} words (0-based): ${ws.map((w, i) => `${i}=${w}`).join(', ')}`);
    return word;
  }
  const want = bare(word);
  const i = ws.findIndex((w) => bare(w) === want);
  if (i < 0) throw new Error(`${who}: no word "${word}" in "${text}" (words: ${ws.join(', ')}); pass the word as written or its 0-based index`);
  return i;
}
