// Emphasis (K3): a highlight bar, underline, outline box or hand-drawn circle that follows one word of a <Text>,
// plus a color pop and a scale punch on that word. One "aec Emphasis" rig effect on the mark layer holds every
// live value (Word, Start, Draw, Out, colors, padding, thickness, scale, punch), so a designer can move the
// emphasis to another word, retime it or recolor it in Effect Controls. The word's position comes from AE: three
// hidden measuring copies (./measure.ts) and sourceRectAtTime, so it stays right when the text is retyped.
// The mark is parented to the text (it follows the text's moves and scale) and draws on from the left.
// The word pop is a per-word text animator ("Emphasis") on the text whose selector picks word `Word`.
import { Fragment, jsx, isElement } from '../jsx-runtime.ts';
import type { AecElement } from '../jsx-runtime.ts';
import { childrenOf } from '../jsx-runtime.ts';
import { Ellipse, Fill, Rect, RigEffect, Shape, Stroke, Trim } from '../primitives.ts';
import type { TextProps } from '../primitives.ts';
import { expr, perWord } from '../anim.ts';
import type { TextUnitsAnim } from '../anim.ts';
import type { ControlRef } from '../control.ts';
import type { ColorSpec, Time } from '@ae-mcp/core/units.ts';
import type { PseudoEffectDef, PseudoParam } from '../../compile/ffx/pseudo.ts';
import { dslWarn } from '../warn.ts';
import { EASE, amountPath, animatorPath, colorParam, fxOf, hexOf, resolveWord, secs, slider } from './common.ts';
import { boundsCode, measureHelpers } from './measure.ts';
import type { MeasureOptions } from './measure.ts';

export type EmphasisKind = 'bar' | 'underline' | 'box' | 'circle';

export interface EmphasisOptions {
  /** Unique id: the mark is `<id>`, the measuring copies `<id>.measure-*`. */
  id: string;
  /** The word: 0-based index, or the word as written (first match, case and punctuation ignored). Live: "Word". */
  word: number | string;
  /** bar (highlight behind the word, default), underline, box (outline), circle (hand-drawn ellipse). */
  kind?: EmphasisKind;
  /** Mark color (default a warm yellow). Brand tokens and controls link live. */
  color?: ColorSpec | ControlRef;
  /** The word's color while emphasized (a color pop). Omit for none. */
  wordColor?: ColorSpec | ControlRef;
  /** The word's scale while emphasized, % (default 100 = none). */
  scale?: number;
  /** Peak of the scale punch, % (default: scale + 12 when scale or wordColor is set, else none). */
  punch?: number;
  /** When the mark starts drawing, from the text layer's start (default 0.6 s). Live: "Start". */
  at?: Time;
  /** Draw-on time (default 0.45 s; circle 0.7 s). Live: "Draw". */
  draw?: Time;
  /** Retract the mark this long before the text layer ends (default: no). Live: "Out". */
  out?: Time;
  /** Padding around the word [x, y] px (default bar [14, 6], underline [4, 0], box/circle [22, 14]). */
  padding?: [number, number];
  /** Underline height / stroke width px (default underline 10, box/circle 6). */
  thickness?: number;
  /** Underline distance below the baseline px (default 0.12 × size). */
  offset?: number;
  /** Bar/box corner roundness px (default 6). */
  roundness?: number;
  /** Mark opacity % (default 100). */
  opacity?: number;
  /** Mark layer name (default "<text name> Emphasis"). */
  name?: string;
}

export interface EmphasisProps extends EmphasisOptions {
  /** The <Text> to emphasize (as the only child). */
  children?: any;
}

const KIND_DEFAULTS: Record<EmphasisKind, { pad: [number, number]; thick: number; draw: number }> = {
  bar: { pad: [14, 6], thick: 10, draw: 0.45 },
  underline: { pad: [4, 0], thick: 10, draw: 0.45 },
  box: { pad: [22, 14], thick: 6, draw: 0.6 },
  circle: { pad: [26, 18], thick: 6, draw: 0.7 },
};

/** "aec Emphasis": the rig effect definition for these options. */
function emphasisDef(o: EmphasisOptions, size: number, pop: boolean, punch: boolean): PseudoEffectDef {
  const kind = o.kind ?? 'bar';
  const d = KIND_DEFAULTS[kind];
  const params: PseudoParam[] = [
    slider('Word', 0, 0, 60, 0, { validMin: 0 }),
    slider('Start', 0.6, 0, 20),
    slider('Draw', d.draw, 0.01, 3, 2, { validMin: 0.01 }),
    slider('Out', 0, 0, 10),
    colorParam('Mark Color', o.color ?? '#ffd23f'),
    slider('Opacity', 100, 0, 100, 0),
    slider('Pad X', d.pad[0], -50, 200, 1),
    slider('Pad Y', d.pad[1], -50, 200, 1),
  ];
  if (kind !== 'bar') params.push(slider('Thickness', d.thick, 0, 100, 1));
  if (kind === 'underline') params.push(slider('Offset', Math.round(size * 0.12), -200, 200, 1));
  if (kind === 'bar' || kind === 'box') params.push(slider('Roundness', 6, 0, 200, 1));
  if (pop) params.push(colorParam('Word Color', o.wordColor ?? '#0b0d12'), slider('Pop', 0.18, 0.01, 2, 2, { validMin: 0.01 }));
  if (punch) params.push(slider('Scale', 100, 50, 200, 1), slider('Punch', 112, 50, 250, 1));
  return { name: 'aec Emphasis', params };
}

/**
 * Emphasis as two parts, for texts inside layout containers: `text` (the <Text> with its word animator, to place
 * where the original was) and `marks` (the mark and its measuring copies, to place outside the layout; put them
 * before the layout for a bar behind the text).
 */
export function emphasize(target: AecElement, o: EmphasisOptions): { text: AecElement; marks: AecElement } {
  if (!isElement(target) || target.type?.aec !== 'text') throw new Error(`Emphasis "${o.id}": the target must be a <Text> element`);
  const tp = target.props as TextProps & { children?: any };
  if (!o.id) throw new Error('Emphasis: an id is required');
  if (!tp.id) throw new Error(`Emphasis "${o.id}": the <Text> needs an id (the mark is parented to it)`);
  if (tp.box) throw new Error(`Emphasis "${o.id}": box (paragraph) text isn't supported (AE decides its wrapping); use point text with "\\r" line breaks (AutoFit makes them)`);
  if (tp.path) throw new Error(`Emphasis "${o.id}": text on a path isn't supported`);
  const text = tp.text ?? childrenOf(tp.children).filter((c) => typeof c === 'string').join('');
  const k = resolveWord(text, o.word, `Emphasis "${o.id}"`);
  if (tp.runs?.length) dslWarn(`Emphasis "${o.id}": the text has style runs; the word is measured with the first character's style`);
  const kind = o.kind ?? 'bar';
  const kd = KIND_DEFAULTS[kind];
  const size = tp.size ?? 72;
  const pop = o.wordColor !== undefined;
  const scaled = o.scale !== undefined && o.scale !== 100;
  const punch = scaled || o.punch !== undefined || pop;
  const scale = o.scale ?? 100;
  const peak = o.punch ?? scale + 12;
  const def = emphasisDef(o, size, pop, punch);
  const textName = tp.name ?? (text.replace(/\s+/g, ' ').trim().slice(0, 20) || tp.id);
  const markName = o.name ?? `${textName} Emphasis`;
  const markId = o.id;
  const E = fxOf('Emphasis', markId);

  // The measuring copies and the bounds of word `Word` of the target, in the target's layer space.
  const m: MeasureOptions = {
    id: o.id,
    name: markName,
    style: { font: tp.font, size, tracking: tp.tracking, caps: tp.caps, fauxBold: tp.fauxBold, fauxItalic: tp.fauxItalic, leading: tp.leading },
    align: tp.align,
    pick: [`var T = __AEC_LAYER(${tp.id})__, kk = ${E}("Word").value;`],
    sample: text,
    from: tp.from,
    duration: tp.duration,
  };
  const head = [
    `// ae-compose emphasis (${kind}): word "Word" of the text, measured live; values in the Emphasis effect`,
    ...m.pick,
    ...boundsCode(m),
    'var e = effect("Emphasis"), d = Math.max(e("Draw").value, 0.01), px = e("Pad X").value, py = e("Pad Y").value;',
    `var pin = L.bezier(${kind === 'circle' || kind === 'box' ? EASE.inOutCubic : EASE.outQuint}, (time - T.inPoint - e("Start").value) / d);`,
    `var o = e("Out").value, pout = o > 0 ? L.bezier(${EASE.inCubic}, (time - (T.outPoint - o)) / (d * 0.7)) : 0;`,
    'var w = x1 - x0 + 2 * px, vis = Math.max(0, pin - pout), left = x0 - px + w * pout;',
  ];
  const code = (...last: string[]) => expr([...head, ...last].join('\n'));
  const markColor = expr(`${fxOf('Emphasis')}("Mark Color").value`);
  let contents: AecElement[];
  if (kind === 'bar' || kind === 'underline') {
    const yc = kind === 'bar' ? '(top + bot) / 2' : 'base + e("Offset").value + e("Thickness").value / 2';
    const hh = kind === 'bar' ? 'bot - top + 2 * py' : 'e("Thickness").value + 2 * py';
    contents = [
      jsx(Rect, {
        name: 'Mark',
        size: code(`[w * vis, ${hh}];`),
        position: code(`[left + w * vis / 2, ${yc}];`),
        roundness: kind === 'bar' ? expr(`${fxOf('Emphasis')}("Roundness").value`) : 0,
      }),
      jsx(Fill, { color: markColor }),
    ];
  } else {
    const ex = kind === 'circle' ? 1.08 : 1, ey = kind === 'circle' ? 1.3 : 1;
    const sizeCode = code(`[w * ${ex}, (bot - top + 2 * py) * ${ey}];`);
    const posCode = code('[(x0 + x1) / 2, (top + bot) / 2];');
    contents = [
      kind === 'circle'
        ? jsx(Ellipse, { name: 'Mark', size: sizeCode, position: posCode })
        : jsx(Rect, { name: 'Mark', size: sizeCode, position: posCode, roundness: expr(`${fxOf('Emphasis')}("Roundness").value`) }),
      jsx(Trim, { start: code('100 * pout;'), end: code('100 * pin;'), offset: kind === 'circle' ? -35 : 0 }),
      jsx(Stroke, { color: markColor, width: expr(`${fxOf('Emphasis')}("Thickness").value`), cap: 'round', join: 'round' }),
    ];
  }
  const values: Record<string, any> = { Word: k, Start: secs(o.at, 0.6), Draw: secs(o.draw, kd.draw), Out: secs(o.out, 0), 'Mark Color': o.color ?? '#ffd23f', Opacity: o.opacity ?? 100 };
  if (o.padding) { values['Pad X'] = o.padding[0]; values['Pad Y'] = o.padding[1]; }
  if (o.thickness !== undefined && kind !== 'bar') values.Thickness = o.thickness;
  if (o.offset !== undefined && kind === 'underline') values.Offset = o.offset;
  if (o.roundness !== undefined && (kind === 'bar' || kind === 'box')) values.Roundness = o.roundness;
  if (pop) values['Word Color'] = o.wordColor;
  if (punch) { values.Scale = scale; values.Punch = peak; }
  const mark = jsx(Shape, {
    id: markId,
    name: markName,
    space: 'comp',
    parent: tp.id,
    from: tp.from,
    duration: tp.duration,
    opacity: expr(`${fxOf('Emphasis')}("Opacity").value`),
    children: [...contents, jsx(RigEffect, { def, name: 'Emphasis', values })],
  });

  // The word pop on the text: a per-word animator whose selector picks word `Word` (Based On: Words).
  let textEl = target;
  if (pop || punch) {
    const from: any = {};
    if (pop) from.fill = hexOf(o.wordColor!);
    if (punch) from.scale = scale;
    const anim: TextUnitsAnim = perWord({ name: 'Emphasis', from, each: 0, duration: 0.2 });
    const prev = tp.animate?.text;
    const texts = prev === undefined ? [] : Array.isArray(prev) ? prev : [prev];
    const ex: Record<string, string> = { ...(tp.expressions ?? {}) };
    ex[amountPath('Emphasis')] = [
      '// ae-compose emphasis: selects word "Word" of the Emphasis effect (Based On: Words), with a short ramp in and out',
      `var e = ${E}, r = Math.max(${pop ? 'e("Pop").value' : '0.18'}, 0.01);`,
      `var a = textIndex - 1 === Math.round(e("Word").value) ? 100 * L.bezier(${EASE.outCubic}, (time - inPoint - e("Start").value) / r) : 0;`,
      'var o = e("Out").value; if (o > 0) a *= 1 - L.clamp((time - (outPoint - o)) / r, 0, 1);',
      '[a, a, a];',
    ].join('\n');
    if (pop) ex[animatorPath('Emphasis', 'ADBE Text Animator Properties/ADBE Text Fill Color')] = `${E}("Word Color").value;`;
    if (punch) {
      ex[animatorPath('Emphasis', 'ADBE Text Animator Properties/ADBE Text Scale 3D')] = [
        '// ae-compose emphasis: scale punch (a spring from Punch down to Scale)',
        `var e = ${E}, x = L.spring(time - inPoint - e("Start").value, 1 / thisComp.frameDuration, 11, 240, 1);`,
        'var s = e("Punch").value + (e("Scale").value - e("Punch").value) * x;',
        '[s, s, 100];',
      ].join('\n');
    }
    textEl = { ...target, props: { ...tp, animate: { ...(tp.animate ?? {}), text: [...texts, anim] }, expressions: ex } };
  }
  return { text: textEl, marks: jsx(Fragment, { children: [...measureHelpers(m), mark] }) };
}

/**
 * <Emphasis id="em" word="motion" kind="bar"><Text id="title">MAKE MOTION</Text></Emphasis>: the text plus a mark
 * that follows the word (a bar goes behind the text; underline, box and circle on top). For a text inside a
 * <Stack>/<Grid>, use emphasize() instead, so the layout sees one layer.
 */
export function Emphasis(p: EmphasisProps) {
  const kids = childrenOf(p.children).filter(isElement) as AecElement[];
  if (kids.length !== 1) throw new Error(`<Emphasis id="${p.id}"> takes exactly one <Text> child`);
  const { children: _c, ...o } = p;
  const r = emphasize(kids[0], o);
  return jsx(Fragment, { children: (o.kind ?? 'bar') === 'bar' ? [r.marks, r.text] : [r.text, r.marks] });
}
(Emphasis as any).displayName = 'Emphasis';
