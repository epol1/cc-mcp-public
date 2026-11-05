// Text effects (K3): Decode (scramble resolving left to right), Typewriter (typed with a blinking caret),
// SplitFlap (per-character roll through letters with a flip per step) and VariableFont (weight steps through a
// family's PostScript names). Each returns one <Text> layer (so it works inside layouts) carrying one rig effect
// with its live values; progress is a keyed slider ("Progress", "Weight"), so a designer retimes it by dragging
// keys. The text stays editable: every Source Text expression reads the layer's own text (`value`).
import { jsx } from '../jsx-runtime.ts';
import { childrenOf } from '../jsx-runtime.ts';
import { RigEffect, Text } from '../primitives.ts';
import type { TextProps } from '../primitives.ts';
import { keys, tween } from '../anim.ts';
import type { Anim, TextUnitsAnim } from '../anim.ts';
import type { EasingSpec } from '../../shared/easing.ts';
import type { Time } from '@cc-mcp/core/units.ts';
import type { PseudoEffectDef } from '../../compile/ffx/pseudo.ts';
import { dslWarn } from '../warn.ts';
import { EASE, SOURCE_TEXT, amountPath, animatorPath, checkbox, secs, slider, textOf } from './common.ts';

type Base = Omit<TextProps, 'effects'> & { id: string; effects?: any[] };

function textOfProps(p: TextProps & { children?: any }, who: string): string {
  const t = p.text ?? childrenOf(p.children).filter((c) => typeof c === 'string').join('');
  if (!t) throw new Error(`${who}: needs text (children or text=)`);
  return t;
}

/** Splits a component's own props from the <Text> props it passes through. */
function textProps<P extends Base>(p: P, own: string[]): any {
  const o: any = { ...p };
  for (const k of own) delete o[k];
  return o;
}

const withExpr = (p: Base, path: string, code: string) => ({ ...(p.expressions ?? {}), [path]: code });

// ---------------------------------------------------------------------------------------------------------
// Decode

export interface DecodeProps extends Base {
  /** Resolve time (default 1.2 s). */
  duration?: Time;
  /** Start, from the layer start (default 0). */
  delay?: Time;
  /** Easing of the resolve (default easeOutCubic). */
  easing?: EasingSpec;
  /** Characters to scramble through (default A–Z, 0–9 and #$%&*). Monospace fonts keep the line still. */
  chars?: string;
  seed?: number;
  /** Scramble changes per second (default 20). Live: "Rate". */
  rate?: number;
}

const DECODE: PseudoEffectDef = { name: 'aec Decode', params: [slider('Progress', 0, 0, 100, 1), slider('Rate', 20, 0, 60, 1), slider('Seed', 1, 0, 9999, 0)] };

/** Scrambled text that resolves left to right (L.scramble on Source Text). Line breaks and spaces are kept. */
export function Decode(p: DecodeProps) {
  const text = textOfProps(p, `Decode "${p.id}"`);
  const chars = p.chars ?? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*';
  const code = [
    '// ae-compose decode: scramble resolving left to right; Progress (keys), Rate and Seed in the Decode effect',
    textOf('raw', 'value'),
    'var e = effect("Decode"), ls = raw.split(/\\r\\n|\\r|\\n/), n = 0, out = [], o = 0;',
    'for (var q = 0; q < ls.length; q++) n += ls[q].length;',
    'var done = L.clamp(e("Progress").value / 100, 0, 1) * n, tk = time * e("Rate").value / 20;',
    `for (var q2 = 0; q2 < ls.length; q2++) { var len = ls[q2].length; out.push(L.scramble(ls[q2], len ? L.clamp((done - o) / len, 0, 1) : 1, e("Seed").value + q2, tk, ${JSON.stringify(chars)})); o += len; }`,
    'out.join("\\r");',
  ].join('\n');
  const values = {
    Progress: tween({ from: 0, to: 100, duration: p.duration ?? 1.2, delay: p.delay, easing: p.easing ?? 'easeOutCubic' }),
    Rate: p.rate ?? 20,
    Seed: p.seed ?? 1,
  };
  return jsx(Text, {
    ...textProps(p, ['duration', 'delay', 'easing', 'chars', 'seed', 'rate', 'children']),
    text,
    expressions: withExpr(p, SOURCE_TEXT, code),
    effects: [...(p.effects ?? []), jsx(RigEffect, { def: DECODE, name: 'Decode', values })],
  });
}
(Decode as any).displayName = 'Decode';

// ---------------------------------------------------------------------------------------------------------
// Typewriter

export interface TypewriterProps extends Base {
  /** Characters per second (default 18). */
  cps?: number;
  /** Start, from the layer start (default 0). */
  delay?: Time;
  /** Caret character (default "|"; "" for none). */
  caret?: string;
  /** Caret blinks per second once typing is done (default 1.6). Live: "Blink". */
  blink?: number;
  /** Rhythm variation 0–1: uneven keystrokes and short pauses after punctuation (default 0.3; 0 = even). */
  humanize?: number;
  seed?: number;
}

const TYPE: PseudoEffectDef = { name: 'aec Typewriter', params: [slider('Progress', 0, 0, 100, 1), slider('Blink', 1.6, 0, 10, 1), checkbox('Show Caret', true)] };

const hash = (i: number, k: number) => { const x = Math.sin(i * 127.1 + k * 311.7 + 74.7) * 43758.5453123; return x - Math.floor(x); };

/** Progress keys for a typed reveal: even (a linear tween) or humanized (hold keys, one per character). */
export function typingProgress(text: string, o: { cps?: number; delay?: Time; humanize?: number; seed?: number }): Anim {
  const n = text.replace(/\r\n|\r|\n/g, '\n').length;
  const cps = Math.max(0.5, o.cps ?? 18);
  const h = Math.max(0, Math.min(1, o.humanize ?? 0.3));
  const d0 = secs(o.delay, 0);
  if (h === 0 || n > 300 || n < 2) {
    if (h > 0 && n > 300) dslWarn(`Typewriter: ${n} characters; typing evenly (humanize is limited to 300 characters)`);
    return tween({ from: 0, to: 100, duration: n / cps, delay: d0, easing: 'linear' });
  }
  const seed = o.seed ?? 1;
  const ks: { t: number; v: number; hold: boolean }[] = [{ t: d0, v: 0, hold: true }];
  let t = d0;
  for (let i = 0; i < n; i++) {
    const ch = text.charAt(i);
    const prev = i > 0 ? text.charAt(i - 1) : '';
    let dt = (1 / cps) * (1 + h * (hash(i, seed) * 2 - 1) * 0.8);
    if (/[.!?]/.test(prev)) dt += (h * 6) / cps;
    else if (/[,;:]/.test(prev)) dt += (h * 3) / cps;
    else if (ch === ' ') dt *= 1 + h * 0.5;
    t += Math.max(0.2 / cps, dt);
    ks.push({ t: Math.round(t * 1000) / 1000, v: Math.round(((i + 1) / n) * 100000) / 1000, hold: true });
  }
  return keys(...ks);
}

/** Text typed character by character with a blinking caret (L.typed on Source Text). */
export function Typewriter(p: TypewriterProps) {
  const text = textOfProps(p, `Typewriter "${p.id}"`);
  const caret = p.caret ?? '|';
  const code = [
    '// ae-compose typewriter: Progress (keys), Blink and Show Caret in the Typewriter effect',
    textOf('raw', 'value'),
    'var e = effect("Typewriter");',
    `L.typed(raw, L.clamp(e("Progress").value / 100, 0, 1), e("Show Caret").value ? ${JSON.stringify(caret)} : "", time, e("Blink").value);`,
  ].join('\n');
  const values = { Progress: typingProgress(text, p), Blink: p.blink ?? 1.6, 'Show Caret': caret !== '' };
  return jsx(Text, {
    align: 'left',
    ...textProps(p, ['cps', 'delay', 'caret', 'blink', 'humanize', 'seed', 'children']),
    text,
    expressions: withExpr(p, SOURCE_TEXT, code),
    effects: [...(p.effects ?? []), jsx(RigEffect, { def: TYPE, name: 'Typewriter', values })],
  });
}
(Typewriter as any).displayName = 'Typewriter';

// ---------------------------------------------------------------------------------------------------------
// Split-flap

export interface SplitFlapProps extends Base {
  /** Letters each character rolls through before landing (default 8). Live: "Flips". */
  flips?: number;
  /** Stagger between characters (default 0.05 s). Live: "Each". */
  each?: Time;
  /** Roll time per character (default 0.9 s). Live: "Duration". */
  duration?: Time;
  /** Start, from the layer start (default 0). Live: "Delay". */
  delay?: Time;
}

const FLAP: PseudoEffectDef = { name: 'aec Split Flap', params: [slider('Flips', 8, 1, 40, 0), slider('Each', 0.05, 0, 0.5, 3), slider('Duration', 0.9, 0.05, 5, 2, { validMin: 0.01 }), slider('Delay', 0, 0, 20, 2)] };

/** Departure-board text: each character rolls through letters (Character Offset) with a flip (Rotation X) per step. */
export function SplitFlap(p: SplitFlapProps) {
  const text = textOfProps(p, `SplitFlap "${p.id}"`);
  const head = [
    'var e = effect("Split Flap"), N = Math.max(1, Math.round(e("Flips").value));',
    'var t = time - inPoint - e("Delay").value - (textIndex - 1) * e("Each").value;',
    `var p = L.bezier(${EASE.outCubic}, t / Math.max(e("Duration").value, 0.001)), r = (1 - p) * N, s = Math.max(0, Math.ceil(r - 1e-6));`,
  ];
  // Based On "Characters Excluding Spaces": spaces never roll.
  const roll: TextUnitsAnim = { $text: 'units', by: 'charNoSpaces', name: 'Flap Roll', from: { characterOffset: -8 }, each: 0, duration: 0.1 };
  const flip: TextUnitsAnim = { $text: 'units', by: 'charNoSpaces', name: 'Flap Flip', from: { rotationX: -90 }, each: 0, duration: 0.1 };
  const prev = p.animate?.text;
  const texts = prev === undefined ? [] : Array.isArray(prev) ? prev : [prev];
  const ex = {
    ...(p.expressions ?? {}),
    [amountPath('Flap Roll')]: ['// ae-compose split-flap: letter steps (offset −Flips … 0) per character; timing in the Split Flap effect', ...head, 'var a = 100 * s / N;', '[a, a, a];'].join('\n'),
    [animatorPath('Flap Roll', 'ADBE Text Animator Properties/ADBE Text Character Offset')]: '-Math.max(1, Math.round(effect("Split Flap")("Flips").value));',
    [amountPath('Flap Flip')]: ['// ae-compose split-flap: one flip (Rotation X −90° → 0) per letter step', ...head, 'var f = s - r, a = t > 0 && s > 0 ? 100 * (1 - f) * (1 - f) : 0;', '[a, a, a];'].join('\n'),
  };
  const values = { Flips: p.flips ?? 8, Each: secs(p.each, 0.05), Duration: secs(p.duration, 0.9), Delay: secs(p.delay, 0) };
  return jsx(Text, {
    font: 'Inter-Bold',
    ...textProps(p, ['flips', 'each', 'duration', 'delay', 'children']),
    text,
    animate: { ...(p.animate ?? {}), text: [...texts, roll, flip] },
    expressions: ex,
    effects: [...(p.effects ?? []), jsx(RigEffect, { def: FLAP, name: 'Split Flap', values })],
  });
}
(SplitFlap as any).displayName = 'SplitFlap';

// ---------------------------------------------------------------------------------------------------------
// Variable font / weight steps

export interface VariableFontProps extends Omit<Base, 'font'> {
  /**
   * PostScript names from light to heavy, e.g. ['Inter-Regular', 'Inter-Medium', 'Inter-SemiBold', 'Inter-Bold',
   * 'Inter-Black'] (or variable-font instance names resolved in AE, see docs).
   */
  fonts: string[];
  /** Weight position 0–100 along `fonts` at the start and end (default 0 → 100). Live (keyed): "Weight". */
  fromWeight?: number;
  toWeight?: number;
  duration?: Time;
  delay?: Time;
  easing?: EasingSpec;
  /** Keys of your own on "Weight" instead (absolute 0–100 values). */
  weight?: Anim;
}

/**
 * Weight animation by stepping through a family's PostScript names on Source Text (style.setFont). AE 2026's
 * scripting exposes variable-font axes only as FontObject data (designAxesData, postScriptNameForDesignVector),
 * not as an animatable property, so a "Weight" slider (keyed) picks the nearest font of the list each frame.
 */
export function VariableFont(p: VariableFontProps) {
  if (!p.fonts?.length) throw new Error(`VariableFont "${p.id}": fonts (PostScript names, light to heavy) are required`);
  const text = textOfProps(p as any, `VariableFont "${p.id}"`);
  const def: PseudoEffectDef = { name: 'aec Font Weight', params: [slider('Weight', p.fromWeight ?? 0, 0, 100, 1)] };
  const code = [
    '// ae-compose font weight: the Weight slider (keys) picks a font of the list',
    `var F = ${JSON.stringify(p.fonts)}, w = L.clamp(effect("Font Weight")("Weight").value / 100, 0, 1);`,
    'style.setFont(F[Math.round(w * (F.length - 1))]);',
  ].join('\n');
  const weight = p.weight ?? tween({ from: p.fromWeight ?? 0, to: p.toWeight ?? 100, duration: p.duration ?? 1, delay: p.delay, easing: p.easing ?? 'easeInOutCubic' });
  return jsx(Text, {
    ...textProps(p as any, ['fonts', 'fromWeight', 'toWeight', 'duration', 'delay', 'easing', 'weight', 'children']),
    font: p.fonts[Math.round((Math.max(0, Math.min(100, p.fromWeight ?? 0)) / 100) * (p.fonts.length - 1))],
    text,
    expressions: withExpr(p as any, SOURCE_TEXT, code),
    effects: [...(p.effects ?? []), jsx(RigEffect, { def, name: 'Font Weight', values: { Weight: weight } })],
  });
}
(VariableFont as any).displayName = 'VariableFont';
