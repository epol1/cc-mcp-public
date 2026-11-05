// Text measuring for caption layout (pure, Node): grapheme-aware character counts, word splitting that keeps
// no-break spaces, and an approximate rendered width (Helvetica-like advances per character) so lines can be
// broken to a pixel width before AE measures the real font metrics.

const SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;
const INVISIBLE = /^[\p{Cf}\p{Cc}]+$/u;

/** Breaking whitespace. No-break spaces (U+00A0, U+2007, U+202F) are not in it, so they keep words together. */
export const BREAKING_SPACE = /[ \t\n\r\f\v\u1680\u2000-\u2006\u2008-\u200a\u2028\u2029\u205f\u3000]+/;
const BREAKING_SPACE_CHAR = new RegExp(`^${BREAKING_SPACE.source.slice(0, -1)}$`);

export function isBreakingSpace(ch: string): boolean {
  return BREAKING_SPACE_CHAR.test(ch);
}

/** User-perceived characters: an emoji with skin tone or ZWJ sequence, or a letter with combining marks, is one. */
export function graphemes(s: string): string[] {
  if (PRINTABLE_ASCII.test(s)) return s.split('');
  return Array.from(SEGMENTER.segment(s), (x) => x.segment);
}

/** Visible characters (graphemes), ignoring bidi marks and other format controls. */
export function charCount(s: string): number {
  if (PRINTABLE_ASCII.test(s)) return s.length;
  let n = 0;
  for (const g of graphemes(s)) if (!INVISIBLE.test(g)) n++;
  return n;
}

export function splitWords(s: string): string[] {
  return s.split(BREAKING_SPACE).filter((w) => w.length > 0);
}

/** Collapses runs of whitespace to one space and trims. */
export function collapseSpace(s: string): string {
  return splitWords(s).join(' ');
}

// Advances in em, from Helvetica's metrics (units per 1000).
const ADVANCE = new Map<string, number>();
function advances(chars: string, em: number): void {
  for (const c of chars) ADVANCE.set(c, em);
}
advances(' ', 0.278);
advances('ijl', 0.222);
advances('ft', 0.278);
advances('r', 0.333);
advances('ckszvxy', 0.5);
advances('abdeghnopqu', 0.556);
advances('w', 0.722);
advances('m', 0.833);
advances('I', 0.278);
advances('J', 0.5);
advances('L', 0.556);
advances('FTZ', 0.611);
advances('ABEKPSVXY', 0.667);
advances('CDHNRU', 0.722);
advances('GOQ', 0.778);
advances('M', 0.833);
advances('W', 0.944);
advances('0123456789#$_?', 0.556);
advances('.,:;!/\\[]', 0.278);
advances("'", 0.191);
advances('"', 0.355);
advances('-()`', 0.333);
advances('{}', 0.334);
advances('|', 0.26);
advances('*', 0.389);
advances('^', 0.469);
advances('+=<>~', 0.584);
advances('&', 0.667);
advances('%', 0.889);
advances('@', 1.015);
advances('\u2014\u2026', 1.0); // em dash, ellipsis
advances('\u2013', 0.556); // en dash
advances('\u2018\u2019', 0.222);
advances('\u201c\u201d', 0.333);
advances('\u2022', 0.35);
advances('\u00a0\u202f\u2007', 0.278);

const WIDE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff01-\uff60\uffe0-\uffe6]/u;
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;

/** Advance of one grapheme in em. */
function graphemeAdvance(g: string): number {
  const known = ADVANCE.get(g);
  if (known !== undefined) return known;
  const base = String.fromCodePoint(g.codePointAt(0) ?? 32);
  const cp = base.codePointAt(0) ?? 32;
  if (INVISIBLE.test(g)) return 0;
  if (PICTOGRAPHIC.test(base) && (cp >= 0x1f000 || g.includes('\ufe0f'))) return 1.2; // colour emoji
  if (WIDE_SCRIPT.test(base)) return 1.0;
  const own = ADVANCE.get(base); // accented letter: width of its base letter
  if (own !== undefined) return own;
  const plain = base.normalize('NFD')[0];
  const fromPlain = ADVANCE.get(plain);
  if (fromPlain !== undefined) return fromPlain;
  if (/\p{Lu}/u.test(base)) return 0.68;
  if (/\p{Ll}/u.test(base)) return 0.54;
  if (/\p{N}/u.test(base)) return 0.556;
  if (/\p{M}/u.test(base)) return 0;
  return 0.556;
}

export interface ApproxWidthOptions {
  /** AE tracking, in thousandths of an em added after every character. */
  tracking?: number;
  /** A condensed face: about 82 % of the regular advances. */
  condensed?: boolean;
}

/**
 * Approximate width in px of `s` set at `fontSize` px in a regular sans (Helvetica-like advances: narrow i/l/.,
 * wide m/w, wider caps, tabular digits, CJK at 1 em, colour emoji at 1.2 em). Good to a few percent for typical
 * grotesques; use it for line breaking before AE measures the real metrics.
 */
export function approxWidth(s: string, fontSize: number, opts: ApproxWidthOptions = {}): number {
  let em = 0;
  let n = 0;
  for (const g of graphemes(s)) {
    const a = graphemeAdvance(g);
    if (a === 0) continue;
    em += a;
    n++;
  }
  const scale = opts.condensed ? 0.82 : 1;
  return fontSize * (em * scale + (n * (opts.tracking ?? 0)) / 1000);
}
