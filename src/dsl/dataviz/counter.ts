// Counter (K2): a Text layer whose Source Text expression counts from `from` to `value` with an easing, formatted with
// prefix/suffix/decimals/thousands separator through the expression library's L.num. Its numbers and timing live on
// one "Counter" rig effect on the text layer (Value, From, Delay, Duration, Easing, Decimals), so a designer retypes
// the number or retimes the count in Effect Controls. Never the Numbers effect: it opens a modal dialog.
import { jsx } from '../jsx-runtime.ts';
import type { AecElement } from '../jsx-runtime.ts';
import { RigEffect, Text } from '../primitives.ts';
import type { TextProps } from '../primitives.ts';
import type { PseudoEffectDef } from '../../compile/ffx/pseudo.ts';
import type { ControlRef } from '../control.ts';
import { isControl } from '../control.ts';
import type { EaseName, NumberFormat } from './common.ts';
import { EASES, easeIndex, formatNumber, jsFormat } from './common.ts';

export interface CounterProps extends Omit<TextProps, 'text' | 'children'>, NumberFormat {
  /** Unique id. */
  id: string;
  /** The number it counts to (a control() makes it a scene control instead). Live: "Value". */
  value: number | ControlRef;
  /** Where the count starts (default 0). Live: "From". */
  from?: number;
  /** Seconds after the layer starts (default 0). Live: "Delay". */
  delay?: number;
  /** Seconds the count takes (default 1.2). Live: "Duration". */
  countDuration?: number;
  /** Default easeOutExpo: fast start, long settle. Live: "Easing". */
  easing?: EaseName;
}

const big = { validMin: -1e9, validMax: 1e9 };
/** "aec Counter": the counter's number and timing. */
export const COUNTER_DEF: PseudoEffectDef = { name: 'aec Counter', params: [
  { kind: 'slider', name: 'Value', default: 0, min: 0, max: 10000, precision: 2, ...big },
  { kind: 'slider', name: 'From', default: 0, min: 0, max: 10000, precision: 2, ...big },
  { kind: 'slider', name: 'Delay', default: 0, min: 0, max: 10, validMin: 0, precision: 2 },
  { kind: 'slider', name: 'Duration', default: 1.2, min: 0.05, max: 5, validMin: 0.01, precision: 2 },
  { kind: 'popup', name: 'Easing', items: EASES.map((e) => e.label), default: 1 },
  { kind: 'slider', name: 'Decimals', default: 0, min: 0, max: 4, validMin: 0, validMax: 6, precision: 0 },
] };

/** The Source Text expression of a counter (reads the "Counter" effect on its own layer). */
export function counterExpr(f: NumberFormat, title: string): string {
  const ez = EASES.filter((x) => x.bezier).map((x) => `[${x.bezier!.join(', ')}]`).join(', ');
  return [
    `// ae-compose counter "${title.replace(/[\r\n]+/g, ' ')}": counts From → Value (live: the "Counter" effect on this layer)`,
    'var e = effect("Counter"), D = Math.max(e("Duration").value, 0.01), ez = Math.round(e("Easing").value), EZ = [' + ez + '];',
    'var u = time - inPoint - e("Delay").value;',
    'var p = u <= 0 ? 0 : ez > EZ.length ? L.spring(u / D, 1 / thisComp.frameDuration, 13, 140, 1) : L.eased(EZ[Math.max(ez, 1) - 1], u / D);',
    `${jsFormat('L.lerp(e("From").value, e("Value").value, p)', f, 'Math.round(e("Decimals").value)')};`,
  ].join('\n');
}

/** A number that counts up: `<Counter id="users" value={1200000} suffix="+" font="Inter-Black" size={200} />`. */
export function Counter(p: CounterProps): AecElement {
  if (!p.id) throw new Error('<Counter> needs an id');
  const { value, from, delay, countDuration, easing, prefix, suffix, decimals, separator, decimalMark, expressions, ...text } = p;
  const final = isControl(value) ? Number(value.default) : value;
  if (!Number.isFinite(final)) throw new Error(`<Counter id="${p.id}">: value must be a number (got ${JSON.stringify(value)})`);
  const d = decimals ?? (Number.isInteger(final) ? 0 : Math.min(2, String(final).split('.')[1]?.length ?? 0));
  const f: NumberFormat = { prefix, suffix, decimals: d, separator, decimalMark };
  const values = { Value: value, From: from ?? 0, Delay: delay ?? 0, Duration: countDuration ?? 1.2, Easing: easeIndex(easing, 'easeOutExpo'), Decimals: d };
  return jsx(Text, {
    ...text,
    // Measured at its final width, so a centred or right-aligned counter doesn't shift its anchor while counting.
    text: formatNumber(final, f),
    expressions: { ...(expressions ?? {}), 'ADBE Text Properties/ADBE Text Document': counterExpr(f, p.name ?? p.id) },
    children: jsx(RigEffect, { def: COUNTER_DEF, name: 'Counter', values }),
  });
}
