// Word bounds measured in AE (K3 emphasis, karaoke underline). AE has no per-word bounds API, so three hidden
// "measuring copies" of the target's line do it with sourceRectAtTime:
//   line  the target word's whole line           → the line's width (for centred / right-aligned text),
//                                                   and its top/bottom relative to the baseline;
//   pre   the line up to and including the word  → the word's right edge;
//   word  the word alone                         → the word's width.
// Each copy is a point-text layer aligned like the target whose Source Text expression reads the target's live
// text and style (`sourceText.style.setText(...)`, so font, size, tracking and caps match; in AE 26.5 it also
// carries the paragraph's justification), picks line j and word k, and returns its piece. So the line copy is laid
// out exactly like the target's line j, and the line up to the word starts on the same glyph, whatever the
// justification. The mark's expressions combine the three rects in the target's layer space:
//   x1 = line.left + pre.width,  x0 = x1 − word.width,  baseline = j × leading.
// Everything is live: retyping the
// target, changing its font or the word index moves the mark. Limits: point text only (no paragraph boxes, whose
// wrapping AE decides), one style per line (style runs are measured with the first character's style), and ink
// bounds (a few px of side bearing).
import { jsx } from '../jsx-runtime.ts';
import type { AecElement } from '../jsx-runtime.ts';
import { Text } from '../primitives.ts';
import type { TextProps } from '../primitives.ts';
import type { Time } from '@cc-mcp/core/units.ts';
import { SOURCE_TEXT, textOf } from './common.ts';

export type MeasurePart = 'line' | 'pre' | 'word';

export interface MeasureOptions {
  /** Prefix of the helper ids: `<id>.measure-line`, `<id>.measure-pre`, `<id>.measure-word`. */
  id: string;
  /** Layer-name prefix (names must be unique: expressions address layers by name). */
  name: string;
  /** Style of the target (font, size, tracking, caps, faux styles, leading): the copies are built with it. */
  style: Pick<TextProps, 'font' | 'size' | 'tracking' | 'caps' | 'fauxBold' | 'fauxItalic' | 'leading'>;
  /** Paragraph alignment of the target. */
  align?: TextProps['align'];
  /**
   * Expression lines that define `T` (the target text layer, or null when there is none at this time) and `kk`
   * (the 0-based word index). They may depend on `time` (karaoke follows the spoken word).
   */
  pick: string[];
  /** Placeholder text for the copies (the target's text at build time). */
  sample: string;
  from?: Time;
  duration?: Time;
}

/** Expression lines: from `raw` (the target's text) and `kk`, find line `j`, its text `line`, `pre` and `word`. */
export function wordScan(): string[] {
  return [
    'var k = Math.max(0, Math.round(kk)), lines = raw.split(/\\r\\n|\\r|\\n|\\u0003/), wn = 0, j = -1, line = "", pre = "", word = "";',
    'for (var q = 0; q < lines.length && j < 0; q++) { var re = /\\S+/g, m; while ((m = re.exec(lines[q])) !== null) { if (wn === k) { j = q; line = lines[q]; pre = line.substring(0, m.index + m[0].length); word = m[0]; break; } wn++; } }',
    'if (j < 0) { j = 0; line = ""; }',
  ];
}

const PART_LABEL: Record<MeasurePart, string> = { line: 'line', pre: 'line up to the word', word: 'word' };

/** The Source Text expression of one measuring copy. */
export function measureCopyExpr(o: MeasureOptions, part: MeasurePart): string {
  return [
    `// ae-compose word bounds: measuring copy (${PART_LABEL[part]}); reads the target's text and style live`,
    ...o.pick,
    'var raw = "";',
    `if (T) { ${textOf('src', 'T.text.sourceText.value')} raw = src; }`,
    ...wordScan(),
    `var s = ${part};`,
    'var out = s; if (T) { try { out = T.text.sourceText.style.setText(s); } catch (err) {} }',
    'out;',
  ].join('\n');
}

export const measureIds = (id: string) => ({ line: `${id}.measure-line`, pre: `${id}.measure-pre`, word: `${id}.measure-word` });

/** The three hidden, guide-layer measuring copies (put them anywhere in the same comp; they never render). */
export function measureHelpers(o: MeasureOptions): AecElement[] {
  const ids = measureIds(o.id);
  return (['line', 'pre', 'word'] as MeasurePart[]).map((part) => jsx(Text, {
    id: ids[part],
    name: `${o.name} measure ${part}`,
    text: o.sample || 'M',
    font: o.style.font,
    size: o.style.size,
    tracking: o.style.tracking,
    caps: o.style.caps,
    fauxBold: o.style.fauxBold,
    fauxItalic: o.style.fauxItalic,
    leading: o.style.leading,
    align: o.align,
    hidden: true,
    guide: true,
    shy: true,
    from: o.from,
    duration: o.duration,
    tags: ['helper'],
    expressions: { [SOURCE_TEXT]: measureCopyExpr(o, part) },
  }));
}

/**
 * Expression lines that define, in the target's layer space: `x0`, `x1` (the word's left and right), `top`, `bot`
 * (the line's ink top and bottom), `base` (the line's baseline) and `fs` (font size). Needs `T` and `kk` (the same
 * `pick` lines first).
 */
export function boundsCode(o: MeasureOptions): string[] {
  const ids = measureIds(o.id);
  const size = o.style.size ?? 72;
  const leading = typeof o.style.leading === 'number' ? String(o.style.leading) : 'fs * 1.2'; // AE auto leading is 120 %
  return [
    'var raw = "";',
    `if (T) { ${textOf('src', 'T.text.sourceText.value')} raw = src; }`,
    ...wordScan(),
    `var Hl = __AEC_LAYER(${ids.line})__.sourceRectAtTime(time, false), Hp = __AEC_LAYER(${ids.pre})__.sourceRectAtTime(time, false), Hw = __AEC_LAYER(${ids.word})__.sourceRectAtTime(time, false);`,
    `var fs = ${size}; if (T) { try { var fz = T.text.sourceText.style.fontSize; if (fz > 0) fs = fz; } catch (err) {} }`,
    'var x1 = Hl.left + Hp.width, x0 = x1 - Hw.width;',
    `var base = j * ${leading}, top = base + Hl.top, bot = base + Hl.top + Hl.height;`,
  ];
}
