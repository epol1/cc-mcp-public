// Caption timing and layout (pure, Node): groups timed words into cues, re-flows cue lines to a width and
// splits cues that need too many lines, estimates word times for untimed text (for a karaoke highlight), and
// checks reading speed and cue spacing.

import type { Caption, CaptionWord } from './captions.ts';
import { boundaryCost, breakLines, DEFAULT_MAX_LINES, endsSentence, lineCount, partition, resolveMetric, type BreakOptions } from './linebreak.ts';
import { charCount, splitWords } from './measure.ts';

/** Gap left between estimated words, seconds (at most 20 % of a word's slot). */
const WORD_GAP = 0.04;
/** Cue-splitting costs, in the line-breaking cost units (see boundaryCost). */
const SINGLE_WORD_CUE = 1500;
const PAUSE_BONUS = 300;
const CUE_BREAK_WEIGHT = 1.5;
/** A one-word segment joins a neighbour when the pause between them is at most this long, seconds. */
const MERGE_GAP = 1.0;
/** Gaps between generated cues shorter than this are closed, so the caption doesn't blink off, seconds. */
const CHAIN_GAP = 0.25;
const EPS = 5e-4;

const round3 = (t: number): number => Math.round(t * 1000) / 1000;
const isTimed = (w: CaptionWord): boolean => Number.isFinite(w.start) && Number.isFinite(w.end);

// ---------------------------------------------------------------------------------------------------------
// Word times.

/** Spreads words i..k over [lo, hi] by character length, leaving a small gap after each (but the cue's last). */
function spread(words: CaptionWord[], i: number, k: number, lo: number, hi: number): void {
  const span = Math.max(0, hi - lo);
  let total = 0;
  for (let q = i; q <= k; q++) total += charCount(words[q].text) + 1;
  let t = lo;
  for (let q = i; q <= k; q++) {
    const slot = (span * (charCount(words[q].text) + 1)) / total;
    const start = t;
    t += slot;
    const end = q < words.length - 1 ? t - Math.min(WORD_GAP, slot * 0.2) : t;
    words[q].start = round3(start);
    words[q].end = round3(Math.max(start, end));
  }
}

/**
 * Word times for a cue. Fully timed words are kept. A run of untimed words (NaN times) shares the time between
 * its neighbours by character length; a word with only a start (a VTT inline timestamp) anchors the run that
 * follows it. A cue without words is tokenized from its text.
 */
export function distributeWordTimes(c: Caption): CaptionWord[] {
  const src: CaptionWord[] = c.words.length ? c.words : splitWords(c.text).map((text) => ({ text, start: NaN, end: NaN }));
  const out = src.map((w) => ({ ...w }));
  const n = out.length;
  let i = 0;
  while (i < n) {
    if (isTimed(out[i])) {
      i++;
      continue;
    }
    let k = i;
    while (k + 1 < n && !Number.isFinite(out[k + 1].start)) k++;
    const lo = Number.isFinite(out[i].start) ? out[i].start : i > 0 ? out[i - 1].end : c.start;
    const hi = k + 1 < n ? out[k + 1].start : c.end;
    spread(out, i, k, lo, Math.max(lo, hi));
    i = k + 1;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Cue splitting, shared by captionsFromWords and reflow.

interface SplitSpec {
  texts: string[];
  opts: BreakOptions;
  maxLines: number;
  /** Extra fit test (duration). */
  fits?: (i: number, j: number) => boolean;
  /** Pause before word j, seconds. */
  pauseBefore?: (j: number) => number;
}

/** Word boundaries [0, …, n] of the fewest cues that each fit maxLines lines, balanced and at good break points. */
function cueBounds(s: SplitSpec): number[] {
  const m = resolveMetric(s.opts);
  const capacity = m.limit * s.maxLines;
  const n = s.texts.length;
  const textOf = (i: number, j: number): string => s.texts.slice(i, j).join(' ');
  return partition({
    n,
    fits: (i, j) => (!s.fits || s.fits(i, j)) && lineCount(textOf(i, j), s.opts) <= s.maxLines,
    groupCost: (i, j) => {
      const slack = Math.max(0, capacity - m.measure(textOf(i, j))) / capacity;
      return 1000 * slack * slack + (j - i === 1 && n > 1 ? SINGLE_WORD_CUE : 0);
    },
    breakCost: (j) => CUE_BREAK_WEIGHT * boundaryCost(s.texts, j) - PAUSE_BONUS * Math.min(1, Math.max(0, s.pauseBefore?.(j) ?? 0)),
  });
}

// ---------------------------------------------------------------------------------------------------------
// Grouping timed words into cues.

export interface WordGroupOptions extends BreakOptions {
  /** Longest cue, seconds (default 6). */
  maxDuration?: number;
  /** A pause at least this long ends a cue, seconds (default 0.6). */
  pauseSplit?: number;
  /** Cues shorter than this are held longer, into the following gap, seconds (default 0.83). */
  minDuration?: number;
}

const CLOSING_PUNCT = /^[.,!?;:\u2026)\]}"'\u201d\u2019\u00bb%]+$/u;

/** Trimmed, non-empty, single-token words in time order; punctuation-only tokens join the word before. */
export function cleanWords(words: readonly CaptionWord[]): CaptionWord[] {
  const filled: CaptionWord[] = [];
  let last = 0;
  for (const w of words) {
    const start = Number.isFinite(w.start) ? w.start : last;
    const end = Math.max(start, Number.isFinite(w.end) ? w.end : start);
    last = end;
    filled.push({ ...w, text: String(w.text ?? ''), start, end });
  }
  const sorted = filled.map((w, i) => ({ w, i })).sort((a, b) => a.w.start - b.w.start || a.i - b.i).map((x) => x.w);
  const out: CaptionWord[] = [];
  for (const w of sorted) {
    const parts = splitWords(w.text);
    if (!parts.length) continue;
    const pieces: CaptionWord[] = parts.map((text) => ({ ...w, text, start: NaN, end: NaN }));
    if (parts.length > 1) spread(pieces, 0, pieces.length - 1, w.start, w.end);
    else Object.assign(pieces[0], { start: w.start, end: w.end });
    for (const p of pieces) {
      const prev = out[out.length - 1];
      if (prev && CLOSING_PUNCT.test(p.text)) {
        prev.text += p.text;
        prev.end = Math.max(prev.end, p.end);
      } else out.push(p);
    }
  }
  return out;
}

type Range = [number, number];

/** Splits after sentence ends, at pauses ≥ pauseSplit and at speaker changes. */
function hardSegments(ws: CaptionWord[], pauseSplit: number): Range[] {
  const segs: Range[] = [];
  let a = 0;
  for (let j = 1; j < ws.length; j++) {
    const pause = ws[j].start - ws[j - 1].end;
    if (endsSentence(ws[j - 1].text) || pause >= pauseSplit - EPS || ws[j].speaker !== ws[j - 1].speaker) {
      segs.push([a, j]);
      a = j;
    }
  }
  segs.push([a, ws.length]);
  return segs;
}

/** Joins one-word segments ("Yes.") to the closer neighbour by the same speaker, when the pause allows. */
function mergeSingles(segs: Range[], ws: CaptionWord[]): Range[] {
  const out = segs.slice();
  for (let s = 0; s < out.length; s++) {
    const [a, b] = out[s];
    if (b - a !== 1) continue;
    const prev = out[s - 1];
    const next = out[s + 1];
    const gapPrev = prev && ws[prev[0]].speaker === ws[a].speaker ? ws[a].start - ws[prev[1] - 1].end : Infinity;
    const gapNext = next && ws[next[0]].speaker === ws[a].speaker ? ws[next[0]].start - ws[a].end : Infinity;
    if (Math.min(gapPrev, gapNext) > MERGE_GAP) continue;
    if (gapPrev <= gapNext) {
      out.splice(s - 1, 2, [prev[0], b]);
      s--;
    } else out.splice(s, 2, [a, next[1]]);
  }
  return out;
}

function makeCue(words: CaptionWord[], index: number, opts: BreakOptions): Caption {
  const text = words.map((w) => w.text).join(' ');
  const c: Caption = {
    index,
    start: words[0].start,
    end: Math.max(...words.map((w) => w.end)),
    text,
    lines: breakLines(text, opts),
    words: words.map((w) => ({ ...w })),
    wordsTimed: true,
  };
  if (words[0].speaker !== undefined) c.speaker = words[0].speaker;
  return c;
}

/** Closes blinks between consecutive cues and holds too-short cues into the gap that follows. */
function settleTiming(caps: Caption[], minDuration: number): void {
  for (let i = 0; i < caps.length; i++) {
    const c = caps[i];
    const next = caps[i + 1];
    if (next && next.start > c.end && next.start - c.end < CHAIN_GAP) c.end = next.start;
    if (c.end - c.start < minDuration) c.end = round3(Math.min(c.start + minDuration, next ? Math.max(c.end, next.start) : Infinity));
  }
}

/**
 * Groups timed words into cues: splits at sentence ends, at pauses ≥ pauseSplit (0.6 s) and at speaker
 * changes, and splits further (balanced, at the best break points) where a cue would need more than maxLines
 * lines of maxChars/maxWidth or last longer than maxDuration (6 s). A one-word cue is avoided whenever a
 * neighbour can take the word. Lines are balanced with breakLines.
 */
export function captionsFromWords(words: CaptionWord[], opts: WordGroupOptions = {}): Caption[] {
  const maxLines = opts.maxLines ?? DEFAULT_MAX_LINES;
  const maxDuration = opts.maxDuration ?? 6;
  const ws = cleanWords(words);
  if (!ws.length) return [];
  const segs = mergeSingles(hardSegments(ws, opts.pauseSplit ?? 0.6), ws);
  const ranges: Range[] = [];
  for (const [a, b] of segs) {
    const bounds = cueBounds({
      texts: ws.slice(a, b).map((w) => w.text),
      opts,
      maxLines,
      fits: (i, j) => ws[a + j - 1].end - ws[a + i].start <= maxDuration + EPS,
      pauseBefore: (j) => ws[a + j].start - ws[a + j - 1].end,
    });
    for (let k = 1; k < bounds.length; k++) ranges.push([a + bounds[k - 1], a + bounds[k]]);
  }
  const caps = ranges.map(([a, b], i) => makeCue(ws.slice(a, b), i + 1, opts));
  settleTiming(caps, opts.minDuration ?? 0.83);
  return caps;
}

// ---------------------------------------------------------------------------------------------------------
// Re-flowing.

/** Splits one cue into consecutive cues of at most maxLines lines; time follows word timing or character share. */
function splitCue(c: Caption, opts: BreakOptions, maxLines: number): Caption[] {
  const texts = splitWords(c.text);
  const timed = c.wordsTimed && c.words.length === texts.length;
  const bounds = cueBounds({
    texts,
    opts,
    maxLines,
    pauseBefore: timed ? (j) => c.words[j].start - c.words[j - 1].end : undefined,
  });
  const chunks: string[] = [];
  for (let k = 1; k < bounds.length; k++) chunks.push(texts.slice(bounds[k - 1], bounds[k]).join(' '));
  const starts: number[] = [];
  if (timed) for (let k = 0; k < chunks.length; k++) starts.push(k === 0 ? c.start : c.words[bounds[k]].start);
  else {
    const sizes = chunks.map((t) => charCount(t) + 1);
    const total = sizes.reduce((a, b) => a + b, 0);
    let acc = 0;
    for (const s of sizes) {
      starts.push(round3(c.start + ((c.end - c.start) * acc) / total));
      acc += s;
    }
  }
  return chunks.map((text, k) => {
    const part: Caption = {
      ...c,
      start: starts[k],
      end: k + 1 < chunks.length ? starts[k + 1] : c.end,
      text,
      lines: breakLines(text, opts),
      words: [],
      wordsTimed: timed,
    };
    if (c.id !== undefined) part.id = k === 0 ? c.id : `${c.id}-${k + 1}`;
    part.words = timed ? c.words.slice(bounds[k], bounds[k + 1]).map((w) => ({ ...w })) : distributeWordTimes(part);
    return part;
  });
}

/**
 * Re-flows every caption's lines for a width (maxChars, or maxWidth with measure) and splits cues that need
 * more than maxLines lines into consecutive cues. Split time follows word timing when the words are timed,
 * else each part gets a share of the cue proportional to its characters. Indexes are renumbered.
 */
export function reflow(caps: Caption[], opts: BreakOptions = {}): Caption[] {
  const maxLines = opts.maxLines ?? DEFAULT_MAX_LINES;
  const out: Caption[] = [];
  for (const c of caps) {
    const lines = breakLines(c.text, opts);
    if (lines.length <= maxLines) out.push({ ...c, lines, words: c.words.map((w) => ({ ...w })) });
    else out.push(...splitCue(c, opts, maxLines));
  }
  return out.map((c, i) => ({ ...c, index: i + 1 }));
}

// ---------------------------------------------------------------------------------------------------------
// Reading checks.

export type ReadingRule = 'too-fast' | 'too-short' | 'too-long' | 'gap' | 'overlap';

export interface ReadingIssue {
  index: number;
  rule: ReadingRule;
  message: string;
  t: [number, number];
}

export interface ReadingOptions {
  /** Characters per second, spaces included (default 17, the Netflix adult limit). */
  maxCps?: number;
  /** Seconds (default 0.83, 20 frames at 24 fps). */
  minDuration?: number;
  /** Seconds (default 7). */
  maxDuration?: number;
  /** Frame rate for the 2-frame gap rule (default 30). */
  fps?: number;
}

const fmt = (t: number): string => t.toFixed(2);

/**
 * Reading checks per cue: more characters per second than maxCps (17), shorter than minDuration (0.83 s) or
 * longer than maxDuration (7 s), overlapping a later cue, or followed by a gap of less than 2 frames (the
 * caption blinks off and on). Back-to-back cues (gap 0) are fine.
 */
export function readingIssues(caps: Caption[], opts: ReadingOptions = {}): ReadingIssue[] {
  const maxCps = opts.maxCps ?? 17;
  const minDuration = opts.minDuration ?? 0.83;
  const maxDuration = opts.maxDuration ?? 7;
  const fps = opts.fps ?? 30;
  const order = caps.map((c, i) => ({ c, i })).sort((a, b) => a.c.start - b.c.start || a.i - b.i).map((x) => x.c);
  const out: ReadingIssue[] = [];
  for (let i = 0; i < order.length; i++) {
    const c = order[i];
    const t: [number, number] = [c.start, c.end];
    const d = c.end - c.start;
    const chars = charCount(c.text);
    if (d < minDuration - EPS) out.push({ index: c.index, rule: 'too-short', message: `on screen ${fmt(d)} s; needs at least ${fmt(minDuration)} s`, t });
    if (d > maxDuration + EPS) out.push({ index: c.index, rule: 'too-long', message: `on screen ${fmt(d)} s; split it (max ${fmt(maxDuration)} s)`, t });
    if (chars > 0 && d > 0 && chars / d > maxCps + EPS) {
      out.push({ index: c.index, rule: 'too-fast', message: `${chars} characters in ${fmt(d)} s = ${(chars / d).toFixed(1)}/s (max ${maxCps}); needs ${fmt(chars / maxCps)} s or fewer words`, t });
    }
    let overlapped = false;
    for (let j = i + 1; j < order.length && order[j].start < c.end - EPS; j++) {
      const o = order[j];
      overlapped = true;
      out.push({ index: c.index, rule: 'overlap', message: `overlaps cue ${o.index} by ${fmt(Math.min(c.end, o.end) - o.start)} s`, t: [o.start, Math.min(c.end, o.end)] });
    }
    const next = order[i + 1];
    if (next && !overlapped) {
      const gap = next.start - c.end;
      const minGap = 2 / fps;
      if (gap > EPS && gap < minGap - EPS) {
        out.push({ index: c.index, rule: 'gap', message: `${gap.toFixed(3)} s gap before cue ${next.index} blinks; close it or make it at least 2 frames (${minGap.toFixed(3)} s)`, t: [c.end, next.start] });
      }
    }
  }
  return out;
}
