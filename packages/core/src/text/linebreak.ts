// Balanced caption line breaking (pure, Node). Text is split into the fewest lines that fit a character count
// or a measured width, and among those splits the one with the least raggedness (sum of squared slack) and the
// best linguistic break points wins: after sentence or clause punctuation and before conjunctions and
// prepositions, never after an article, rarely after a preposition or inside a name, a number and its unit, or
// a noun phrase, and never with a short word alone on the last line when another split fits. A word is only
// broken when it alone is wider than a line (URLs at their separators, long words with a hyphen).

import { charCount, graphemes, splitWords } from './measure.ts';

export interface BreakOptions {
  /** Characters per line (default 42). */
  maxChars?: number;
  /** Line width in the units of `measure` (px with `approxWidth`); takes precedence over maxChars. */
  maxWidth?: number;
  /** Width of a string; defaults to its visible character count. */
  measure?: (s: string) => number;
  /** Lines per caption (default 2). */
  maxLines?: number;
}

export const DEFAULT_MAX_CHARS = 42;
export const DEFAULT_MAX_LINES = 2;

interface Metric {
  limit: number;
  measure: (s: string) => number;
}

export function resolveMetric(opts: BreakOptions): Metric {
  if (opts.maxWidth !== undefined) {
    if (!opts.measure) throw new Error('breakLines: maxWidth needs a measure function (e.g. s => approxWidth(s, fontSize))');
    return { limit: opts.maxWidth, measure: opts.measure };
  }
  return { limit: opts.maxChars ?? DEFAULT_MAX_CHARS, measure: opts.measure ?? charCount };
}

// ---------------------------------------------------------------------------------------------------------
// Generic partition DP, shared by line breaking and cue splitting.

export interface PartitionSpec {
  /** Number of items. */
  n: number;
  /** Items i..j-1 fit in one group. Must be monotone (sub-ranges of a fitting range fit); one item always fits. */
  fits(i: number, j: number): boolean;
  /** Cost of items i..j-1 as group k (1-based) of `groups`. */
  groupCost(i: number, j: number, k: number, groups: number): number;
  /** Cost of a boundary before item j (0 < j < n); negative is a good break. */
  breakCost(j: number): number;
}

/**
 * Boundaries [0, b1, …, n] of the cheapest split into the fewest groups that fit. A boundary j can close group
 * k only when the prefix fits in k groups and the suffix in K − k, which keeps the search to a narrow band: about
 * n × (items per group) cost evaluations, so a 3000-word transcript splits in milliseconds.
 */
export function partition(spec: PartitionSpec): number[] {
  const { n } = spec;
  if (n === 0) return [0];
  const fit = (i: number, j: number): boolean => j === i + 1 || spec.fits(i, j);
  // lo[j]: first item of the widest group ending at j; hi[i]: end of the widest group starting at i.
  const lo = new Array<number>(n + 1).fill(0);
  const fewest = new Array<number>(n + 1).fill(Infinity);
  fewest[0] = 0;
  for (let j = 1; j <= n; j++) {
    let i = j - 1;
    while (i > 0 && fit(i - 1, j)) i--;
    lo[j] = i;
    for (let a = i; a < j; a++) fewest[j] = Math.min(fewest[j], fewest[a] + 1);
  }
  const suffix = new Array<number>(n + 1).fill(Infinity);
  suffix[n] = 0;
  for (let i = n - 1; i >= 0; i--) {
    let j = i + 1;
    while (j < n && fit(i, j + 1)) j++;
    for (let b = i + 1; b <= j; b++) suffix[i] = Math.min(suffix[i], suffix[b] + 1);
  }
  const K = fewest[n];
  // best[j].get(k): cheapest cost of items 0..j-1 in exactly k groups; from[j].get(k): where group k starts.
  const best: Map<number, number>[] = [new Map([[0, 0]])];
  const from: Map<number, number>[] = [new Map()];
  for (let j = 1; j <= n; j++) {
    best.push(new Map());
    from.push(new Map());
    const brk = j < n ? spec.breakCost(j) : 0;
    for (let k = fewest[j]; k <= K - suffix[j]; k++) {
      let bc = Infinity;
      let bi = -1;
      for (let i = lo[j]; i < j; i++) {
        const p = best[i].get(k - 1);
        if (p === undefined) continue;
        const c = p + spec.groupCost(i, j, k, K) + brk;
        if (c < bc) {
          bc = c;
          bi = i;
        }
      }
      if (bi >= 0) {
        best[j].set(k, bc);
        from[j].set(k, bi);
      }
    }
  }
  const bounds = [n];
  let j = n;
  for (let k = K; k >= 1; k--) {
    j = from[j].get(k) ?? 0;
    bounds.push(j);
  }
  return bounds.reverse();
}

// ---------------------------------------------------------------------------------------------------------
// Linguistic break costs (English).

const DETERMINERS = new Set(['a', 'an', 'the', 'this', 'these', 'those', 'my', 'your', 'his', 'its', 'our', 'their', 'some', 'any', 'every', 'each', 'no', 'another', 'such']);
const CONJUNCTIONS = new Set(['and', 'but', 'or', 'nor', 'so', 'yet', 'because', 'although', 'though', 'while', 'whereas', 'unless', 'until', 'since', 'if', 'when', 'whenever', 'where', 'wherever', 'whether', 'that', 'which', 'who', 'whom', 'whose', 'than', 'as', 'once']);
const PREPOSITIONS = new Set(['about', 'above', 'across', 'after', 'against', 'along', 'among', 'around', 'at', 'before', 'behind', 'below', 'beneath', 'beside', 'between', 'beyond', 'by', 'despite', 'down', 'during', 'except', 'for', 'from', 'in', 'inside', 'into', 'like', 'near', 'of', 'off', 'on', 'onto', 'outside', 'over', 'past', 'per', 'through', 'throughout', 'to', 'toward', 'towards', 'under', 'underneath', 'unlike', 'upon', 'via', 'with', 'within', 'without']);
const TITLES = new Set(['mr', 'mrs', 'ms', 'mx', 'dr', 'prof', 'st', 'sr', 'jr', 'sgt', 'capt', 'gen', 'rev', 'hon']);
const ABBREVIATIONS = new Set([...TITLES, 'vs', 'etc', 'e.g', 'i.e', 'approx', 'vol', 'fig', 'inc', 'ltd', 'co', 'u.s', 'u.k']);

const TRAILING_CLOSERS = /["'\u201d\u2019)\]}\u00bb]*$/u;
const SENTENCE_END = /[.!?\u203d]["'\u201d\u2019)\]}\u00bb]*$/u;
const ELLIPSIS_END = /(?:\.\.\.|\u2026)["'\u201d\u2019)\]}\u00bb]*$/u;
const CLAUSE_END = /[,;:\u2014\u2013]["'\u201d\u2019)\]}\u00bb]*$/u;
const DASH_ONLY = /^[-\u2013\u2014]+$/;
const NUMBER = /^[$\u20ac\u00a3\u00a5]?\d[\d,.:]*$/u;

/** Lowercase word without surrounding punctuation ("Hello," → "hello"). */
export function bareWord(w: string): string {
  return w.toLowerCase().replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}]+$/u, '');
}

/** The word ends a sentence ("go.", "really?!", 'it."'), not an abbreviation, initial or ellipsis. */
export function endsSentence(w: string): boolean {
  if (!SENTENCE_END.test(w) || ELLIPSIS_END.test(w)) return false;
  const core = w.replace(TRAILING_CLOSERS, '');
  if (!core.endsWith('.')) return true;
  const stem = core.slice(0, -1).toLowerCase().replace(/^[^\p{L}\p{N}]+/u, '');
  if (ABBREVIATIONS.has(stem)) return false;
  if (/^\p{L}$/u.test(stem)) return false; // an initial: "J."
  if (/^(?:\p{L}\.)+\p{L}$/u.test(stem)) return false; // dotted acronyms: "U.S.", "e.g."
  return true;
}

/** Ends with a comma, semicolon, colon, dash or ellipsis. */
export function endsClause(w: string): boolean {
  return CLAUSE_END.test(w) || ELLIPSIS_END.test(w) || DASH_ONLY.test(w);
}

/**
 * Cost of breaking between words[j-1] and words[j] (negative is a good break). Units match the slack cost:
 * 1000 × (slack / limit)² per line, so a sentence break is worth about a 10-character imbalance on a 42-char line.
 */
export function boundaryCost(words: readonly string[], j: number): number {
  const prev = words[j - 1];
  const next = words[j];
  if (prev === undefined || next === undefined) return 0;
  let c = 0;
  const punct = endsSentence(prev) || endsClause(prev);
  if (endsSentence(prev)) c -= 120;
  else if (endsClause(prev)) c -= 60;
  if (DASH_ONLY.test(next)) c += 80; // keep a spaced dash at the end of the line, not the start of the next
  const p = bareWord(prev);
  const q = bareWord(next);
  if (!punct) {
    if (DETERMINERS.has(p)) c += 100;
    else if (PREPOSITIONS.has(p) || CONJUNCTIONS.has(p)) c += 45;
    if (TITLES.has(p) && /\.$/.test(prev)) c += 150; // "Dr. / Smith"
    else if (TITLES.has(p) && /^\p{Lu}/u.test(next)) c += 150;
    if (NUMBER.test(prev) && !NUMBER.test(next) && !CONJUNCTIONS.has(q) && !PREPOSITIONS.has(q)) c += 40; // "10 / minutes"
    if (/^\p{Lu}\p{Ll}/u.test(prev) && /^\p{Lu}\p{Ll}/u.test(next) && j >= 2 && !endsSentence(words[j - 2])) c += 25; // a name
    // Inside a noun phrase ("the lazy / dog"): a determiner one or two words back, and the next word isn't a
    // function word that would start a new phrase.
    if (!CONJUNCTIONS.has(q) && !PREPOSITIONS.has(q) && !DETERMINERS.has(q) && !DETERMINERS.has(p)) {
      const back1 = words[j - 2];
      const back2 = words[j - 3];
      if ((back1 !== undefined && DETERMINERS.has(bareWord(back1)) && !endsSentence(back1) && !endsClause(back1)) ||
          (back2 !== undefined && back1 !== undefined && DETERMINERS.has(bareWord(back2)) && !endsClause(back2) && !endsSentence(back2) && !endsClause(back1))) c += 40;
    }
  }
  if (CONJUNCTIONS.has(q)) c -= 35;
  else if (PREPOSITIONS.has(q)) c -= 20;
  return c;
}

// ---------------------------------------------------------------------------------------------------------
// Tokens and line breaking.

interface Token {
  text: string;
  /** Joins the previous token without a space (a piece of a word that was too long for a line). */
  glue: boolean;
  /** Shows a hyphen when a line ends after this piece. */
  hyphen: boolean;
}

const HYPHENATED_SCRIPT = /[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}]/u;
const URL_SEPARATOR = /[/.\-_?&=#:@,]/;

/**
 * Splits a word that is wider than a line into pieces that fit: after URL separators when possible, else with a
 * hyphen between letters. Pieces are evened out (the fewest pieces, each about the same width).
 */
function splitLongWord(word: string, m: Metric): Token[] {
  const g = graphemes(word);
  const greedy = cutPieces(g, m, m.limit);
  if (greedy.length < 2) return greedy;
  const even = cutPieces(g, m, Math.min(m.limit, (m.measure(word) / greedy.length) * 1.08 + m.measure('-')));
  return even.length === greedy.length ? even : greedy;
}

function cutPieces(g: string[], m: Metric, limit: number): Token[] {
  const out: Token[] = [];
  let pos = 0;
  while (pos < g.length) {
    let end = pos + 1;
    let hyphen = false;
    for (let e = pos + 1; e <= g.length; e++) {
      const h = e < g.length && HYPHENATED_SCRIPT.test(g[e - 1]) && HYPHENATED_SCRIPT.test(g[e]);
      if (m.measure(g.slice(pos, e).join('') + (h ? '-' : '')) > limit && e > pos + 1) break;
      end = e;
      hyphen = h;
    }
    if (end < g.length) {
      for (let c = end; c > pos + Math.max(1, Math.floor((end - pos) / 2)); c--) {
        if (URL_SEPARATOR.test(g[c - 1])) {
          end = c;
          hyphen = false;
          break;
        }
      }
    }
    out.push({ text: g.slice(pos, end).join(''), glue: pos > 0, hyphen });
    pos = end;
  }
  return out;
}

function tokenize(text: string, m: Metric): Token[] {
  const out: Token[] = [];
  for (const w of splitWords(text)) {
    if (m.measure(w) <= m.limit) out.push({ text: w, glue: false, hyphen: false });
    else out.push(...splitLongWord(w, m));
  }
  return out;
}

function lineText(toks: readonly Token[], i: number, j: number): string {
  let s = '';
  for (let k = i; k < j; k++) s += (k > i && !toks[k].glue ? ' ' : '') + toks[k].text;
  return toks[j - 1].hyphen && j < toks.length ? s + '-' : s;
}

/** Fewest lines the text needs (greedy first fit is optimal for that). */
export function lineCount(text: string, opts: BreakOptions = {}): number {
  const m = resolveMetric(opts);
  const toks = tokenize(text, m);
  let lines = 0;
  let i = 0;
  while (i < toks.length) {
    let j = i + 1;
    while (j < toks.length && m.measure(lineText(toks, i, j + 1)) <= m.limit) j++;
    lines++;
    i = j;
  }
  return lines;
}

const ORPHAN = 150;
const SHORT_ORPHAN = 600;
const TOP_HEAVY = 8;

/**
 * Balanced line breaking. Uses the fewest lines that fit (one line if the text fits), then picks the split with
 * the least squared slack plus linguistic break costs. Returns more than maxLines lines when the text needs
 * them; the caller then splits the cue (see reflow).
 */
export function breakLines(text: string, opts: BreakOptions = {}): string[] {
  const m = resolveMetric(opts);
  const toks = tokenize(text, m);
  const n = toks.length;
  if (n === 0) return [];
  const widths = new Map<number, number>();
  const width = (i: number, j: number): number => {
    const key = i * (n + 1) + j;
    let w = widths.get(key);
    if (w === undefined) widths.set(key, (w = m.measure(lineText(toks, i, j))));
    return w;
  };
  const texts = toks.map((t) => t.text);
  const bounds = partition({
    n,
    fits: (i, j) => width(i, j) <= m.limit + 1e-9,
    groupCost: (i, j, k, K) => {
      const slack = Math.max(0, m.limit - width(i, j)) / m.limit;
      let c = 1000 * slack * slack;
      if (K > 1 && k === K && j - i === 1 && !toks[i].glue) c += ORPHAN + (width(i, j) < 0.3 * m.limit ? SHORT_ORPHAN : 0);
      if (K === 2 && k === 2 && width(0, i) > width(i, j) + 0.02 * m.limit) c += TOP_HEAVY; // prefer a bottom-heavy pyramid
      return c;
    },
    breakCost: (j) => (toks[j].glue ? 0 : boundaryCost(texts, j)),
  });
  const lines: string[] = [];
  for (let k = 1; k < bounds.length; k++) lines.push(lineText(toks, bounds[k - 1], bounds[k]));
  return lines;
}
