// Caption file formats (pure, Node): SRT and WebVTT readers that survive real-world files (BOM, CRLF, missing
// index lines, comma or period milliseconds, HTML and ASS styling, NOTE/STYLE/REGION blocks, cue ids and
// settings, voices, inline word timestamps), word-timed JSON from transcribers (Whisper, whisperX,
// whisper.cpp, AssemblyAI, Deepgram), and SRT/VTT writers.

import type { Caption, CaptionWord } from './captions.ts';
import { captionsFromWords, cleanWords, distributeWordTimes } from './caption-timing.ts';
import { breakLines } from './linebreak.ts';
import { collapseSpace, isBreakingSpace, splitWords } from './measure.ts';

const EPS = 5e-4;

// ---------------------------------------------------------------------------------------------------------
// Timestamps.

const TS = String.raw`(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[,.](\d+))?`;
const TIMING = new RegExp(String.raw`^\s*${TS}\s*-?->\s*${TS}(.*)$`);
const TIMESTAMP = new RegExp(String.raw`^\s*${TS}\s*$`);

function seconds(h: string | undefined, m: string, s: string, frac: string | undefined): number {
  const ms = ((Number(h ?? 0) * 60 + Number(m)) * 60 + Number(s)) * 1000 + (frac ? Math.round(Number(`0.${frac}`) * 1000) : 0);
  return ms / 1000;
}

/** "01:02:03,450", "02:03.45" or "2:03" → seconds; NaN when it isn't a timestamp. */
export function parseTimestamp(s: string): number {
  const m = TIMESTAMP.exec(s);
  return m ? seconds(m[1], m[2], m[3], m[4]) : NaN;
}

interface Timing {
  start: number;
  end: number;
}

function parseTiming(line: string): Timing | null {
  const m = TIMING.exec(line);
  if (!m) return null;
  return { start: seconds(m[1], m[2], m[3], m[4]), end: seconds(m[5], m[6], m[7], m[8]) };
}

function clock(t: number, sep: ',' | '.'): string {
  const ms = Math.max(0, Math.round(t * 1000));
  const p = (v: number, w: number): string => String(v).padStart(w, '0');
  return `${p(Math.floor(ms / 3_600_000), 2)}:${p(Math.floor(ms / 60_000) % 60, 2)}:${p(Math.floor(ms / 1000) % 60, 2)}${sep}${p(ms % 1000, 3)}`;
}

// ---------------------------------------------------------------------------------------------------------
// Cue text: markup, entities, inline timestamps.

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', lrm: '\u200e', rlm: '\u200f' };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : all;
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}

/** SRT styling that isn't HTML-like: ASS override tags ({\an8}, {\i1}), {i}…{/i}, and <br>. */
function stripSrtStyling(s: string): string {
  return s.replace(/\{\\[^}]*\}/g, '').replace(/\{\/?[ibus]\}/gi, '').replace(/<br\s*\/?>/gi, '\n');
}

interface Payload {
  lines: string[];
  /** Words in order; start is the inline timestamp the word begins after, NaN when it shares the previous one. */
  words: CaptionWord[];
  timed: boolean;
  speaker?: string;
}

const TAG = /<([^<>\n]*)>/g;

/** Strips tags (<i>, <b>, <font>, <c.x>, <v Name>, <lang>, ruby text) and reads <v> voices and inline timestamps. */
function parsePayload(raw: string, cueStart: number): Payload {
  const lines: string[] = [];
  const words: CaptionWord[] = [];
  let line = '';
  let word = '';
  let wordStart = NaN;
  let anchor = cueStart;
  let anchorUsed = false;
  /** A timestamp arrived inside a word: if the word goes on after it, the timestamp is used up by that word. */
  let midWord = false;
  let timed = false;
  let speaker: string | undefined;
  let inRuby = false;
  const flushWord = (): void => {
    if (word) words.push({ text: word, start: wordStart, end: NaN });
    word = '';
  };
  const addText = (s: string): void => {
    for (const ch of decodeEntities(s)) {
      if (ch === '\n' || isBreakingSpace(ch)) {
        midWord = false;
        flushWord();
        if (ch === '\n') {
          lines.push(line);
          line = '';
        } else line += ' ';
      } else {
        if (!word) {
          wordStart = anchorUsed ? NaN : anchor;
          anchorUsed = true;
        } else if (midWord) anchorUsed = true;
        midWord = false;
        word += ch;
        line += ch;
      }
    }
  };
  let pos = 0;
  TAG.lastIndex = 0;
  for (let m = TAG.exec(raw); m; m = TAG.exec(raw)) {
    if (!inRuby) addText(raw.slice(pos, m.index));
    pos = TAG.lastIndex;
    const tag = m[1].trim();
    if (/^\d/.test(tag)) {
      const t = parseTimestamp(tag);
      if (Number.isFinite(t)) {
        anchor = t;
        anchorUsed = false;
        midWord = word.length > 0;
        timed = true;
      }
    } else if (/^v(?:[.\s]|$)/.test(tag)) {
      const name = decodeEntities(tag.replace(/^v(?:\.\S*)?\s*/, '')).trim();
      if (name && speaker === undefined) speaker = name;
    } else if (/^rt(?:[.\s]|$)/i.test(tag)) inRuby = true;
    else if (/^\/rt$/i.test(tag)) inRuby = false;
  }
  if (!inRuby) addText(raw.slice(pos));
  flushWord();
  lines.push(line);
  if (!timed) for (const w of words) w.start = NaN;
  return { lines, words, timed, speaker };
}

function buildCue(t: Timing, p: Payload, id?: string): Caption | null {
  const lines = p.lines.map(collapseSpace).filter((l) => l.length > 0);
  if (!lines.length) return null;
  const c: Caption = { index: 0, start: t.start, end: t.end, text: lines.join(' '), lines, words: p.words, wordsTimed: p.timed };
  if (p.speaker !== undefined) c.speaker = p.speaker;
  if (id) c.id = id;
  c.words = distributeWordTimes(c);
  return c;
}

/** Sorts by start (stable) and numbers from 1. */
function finish(cues: (Caption | null)[]): Caption[] {
  const kept = cues.filter((c): c is Caption => c !== null);
  return kept
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c.start - b.c.start || a.i - b.i)
    .map((x, i) => ({ ...x.c, index: i + 1 }));
}

const normalize = (src: string): string => src.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n');

// ---------------------------------------------------------------------------------------------------------
// SRT.

/**
 * Parses SubRip. Tolerates a BOM, CRLF, missing index lines and blank lines, comma or period milliseconds,
 * hours left out, <i>/<b>/<u>/<font> tags and ASS tags ({\an8}). Empty cues are dropped; cues are sorted by start.
 */
export function parseSrt(src: string): Caption[] {
  const lines = normalize(src).split('\n');
  const raw: { t: Timing; text: string[] }[] = [];
  let cur: { t: Timing; text: string[] } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.includes('>') ? parseTiming(line) : null;
    if (t) {
      cur = { t, text: [] };
      raw.push(cur);
    } else if (/^\s*\d+\s*$/.test(line) && i + 1 < lines.length && parseTiming(lines[i + 1])) {
      // the index line of the next cue
    } else if (cur && line.trim()) cur.text.push(line);
  }
  return finish(raw.map((r) => buildCue(r.t, parsePayload(stripSrtStyling(r.text.join('\n')), r.t.start))));
}

// ---------------------------------------------------------------------------------------------------------
// WebVTT.

/**
 * Parses WebVTT: skips the header and NOTE, STYLE and REGION blocks, keeps cue ids, ignores cue settings,
 * reads <v Speaker> voices, strips <c.class>/<i>/<b>/<u>/<lang>/<ruby> markup and decodes entities. Inline
 * timestamps (<00:00:01.200>) give word timing (wordsTimed). Empty cues are dropped; cues are sorted by start.
 */
export function parseVtt(src: string): Caption[] {
  const lines = normalize(src).split('\n');
  let i = 0;
  if (/^WEBVTT/.test(lines[0] ?? '')) {
    i = 1;
    while (i < lines.length && lines[i].trim() !== '' && !lines[i].includes('-->')) i++;
  }
  const raw: { t: Timing; id?: string; payload: string[] }[] = [];
  let cur: { t: Timing; id?: string; payload: string[] } | null = null;
  let skipping = false;
  let pendingId: string | undefined;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line === '') {
      cur = null;
      skipping = false;
      pendingId = undefined;
      continue;
    }
    const t = line.includes('-->') ? parseTiming(line) : null;
    if (t) {
      // A sloppy file separated by whitespace-only lines: "text\n \nid\n00:00 --> …" — the id isn't payload.
      if (cur && cur.payload.length >= 2 && cur.payload[cur.payload.length - 2].trim() === '' && pendingId === undefined) pendingId = cur.payload.pop()?.trim();
      cur = { t, payload: [] };
      if (pendingId) cur.id = pendingId;
      raw.push(cur);
      pendingId = undefined;
      skipping = false;
      continue;
    }
    if (skipping) continue;
    if (cur) {
      cur.payload.push(line);
      continue;
    }
    if (line.trim() === '') pendingId = undefined;
    else if (/^(?:NOTE|STYLE|REGION)(?:\s|$)/.test(line)) skipping = true;
    else pendingId = line.trim();
  }
  return finish(raw.map((r) => buildCue(r.t, parsePayload(r.payload.join('\n'), r.t.start), r.id)));
}

// ---------------------------------------------------------------------------------------------------------
// Word JSON.

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

interface RawTime {
  v: number;
  /** A bare start/end number, which might be milliseconds (AssemblyAI). */
  plain: boolean;
}

function timeValue(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const s = v.trim();
    if (/^-?[\d.]+s?$/.test(s)) return parseFloat(s);
    return parseTimestamp(s);
  }
  if (isRec(v) && ('seconds' in v || 'nanos' in v)) return Number(v.seconds ?? 0) + Number(v.nanos ?? 0) / 1e9;
  return NaN;
}

function rawTime(x: Rec, which: 'start' | 'end'): RawTime {
  const offsets = x.offsets;
  if (isRec(offsets)) return { v: Number(offsets[which === 'start' ? 'from' : 'to']) / 1000, plain: false }; // whisper.cpp
  for (const key of [`${which}_ms`, `${which}Ms`]) if (key in x) return { v: Number(x[key]) / 1000, plain: false };
  if (`${which}Time` in x) return { v: timeValue(x[`${which}Time`]), plain: false };
  if (`${which}_time` in x) return { v: timeValue(x[`${which}_time`]), plain: false };
  return { v: timeValue(x[which]), plain: typeof x[which] === 'number' };
}

const hasTime = (x: Rec): boolean => 'start' in x || 'end' in x || 'offsets' in x || 'start_ms' in x || 'startMs' in x || 'startTime' in x || 'start_time' in x;
const rawText = (x: Rec): string => String(x.punctuated_word ?? x.word ?? x.text ?? '');

interface Found {
  words: Rec[];
  segments: Rec[];
}

/** Finds the word list (or segment list) in a transcriber's JSON. */
function findTranscript(node: unknown, depth = 0): Found | null {
  if (depth > 8 || typeof node !== 'object' || node === null) return null;
  if (Array.isArray(node)) {
    const items = node.filter(isRec);
    if (items.length && items.length === node.length) {
      if (items.some((x) => Array.isArray(x.words))) {
        return { segments: items, words: items.flatMap((x) => (Array.isArray(x.words) ? x.words.filter(isRec) : [])) };
      }
      if (items.some(hasTime)) {
        const wordy = items.some((x) => 'word' in x || 'punctuated_word' in x);
        const perItem = items.reduce((n, x) => n + splitWords(rawText(x)).length, 0) / items.length;
        return !wordy && perItem > 1.5 ? { segments: items, words: [] } : { segments: [], words: items };
      }
    }
    for (const x of node) {
      const f = findTranscript(x, depth + 1);
      if (f) return f;
    }
    return null;
  }
  const rec = node as Rec;
  const keys = ['segments', 'words', 'transcription', 'results', 'channels', 'alternatives', 'utterances'];
  for (const k of [...keys, ...Object.keys(rec).filter((k) => !keys.includes(k))]) {
    if (!(k in rec)) continue;
    const f = findTranscript(rec[k], depth + 1);
    if (f) return f;
  }
  return null;
}

interface WordJson {
  /** Word-level timing from the source. */
  words: CaptionWord[];
  segments: { start: number; end: number; text: string; speaker?: string }[];
}

function readWordJson(src: string | object): WordJson {
  const obj: unknown = typeof src === 'string' ? JSON.parse(src.replace(/^\ufeff/, '')) : src;
  const found = findTranscript(obj) ?? { words: [], segments: [] };
  const times = (xs: Rec[]): { s: RawTime; e: RawTime }[] => xs.map((x) => ({ s: rawTime(x, 'start'), e: rawTime(x, 'end') }));
  const wt = times(found.words);
  const st = times(found.segments);
  // AssemblyAI and some others give integer milliseconds in bare start/end fields.
  const plain = [...wt, ...st].flatMap((t) => [t.s, t.e]).filter((t) => t.plain && Number.isFinite(t.v));
  const ms = plain.length > 0 && plain.every((t) => Number.isInteger(t.v)) && Math.max(...plain.map((t) => t.v)) > 1000;
  const sec = (t: RawTime): number => (ms && t.plain ? t.v / 1000 : t.v);
  const speakerOf = (x: Rec): string | undefined => (x.speaker === undefined || x.speaker === null ? undefined : String(x.speaker));

  // Whisper marks word starts with a leading space; a token without one continues the previous word.
  const texts = found.words.map(rawText);
  const spaced = texts.slice(1).filter((t) => /^\s/.test(t)).length;
  const leadingSpaces = texts.length > 2 && spaced >= (texts.length - 1) / 2;
  const merged: CaptionWord[] = [];
  found.words.forEach((x, k) => {
    const text = texts[k].trim();
    if (!text) return;
    const w: CaptionWord = { text, start: sec(wt[k].s), end: sec(wt[k].e) };
    const sp = speakerOf(x);
    if (sp !== undefined) w.speaker = sp;
    const prev = merged[merged.length - 1];
    if (prev && leadingSpaces && !/^\s/.test(texts[k])) {
      prev.text += text;
      if (Number.isFinite(w.end)) prev.end = Math.max(prev.end, w.end);
    } else merged.push(w);
  });
  const segments = found.segments
    .map((x, k) => {
      const seg: WordJson['segments'][number] = { start: sec(st[k].s), end: sec(st[k].e), text: collapseSpace(rawText(x)) };
      const sp = speakerOf(x);
      if (sp !== undefined) seg.speaker = sp;
      return seg;
    })
    .filter((s) => s.text.length > 0 && Number.isFinite(s.start) && Number.isFinite(s.end));
  return { words: cleanWords(merged), segments };
}

/**
 * Word timing from transcriber JSON: Whisper/whisperX ({segments: [{words: [{word, start, end}]}]}), a
 * {words: [...]} object (AssemblyAI in ms, Deepgram's nested results), whisper.cpp offsets, or a bare
 * [{word|text, start, end}] array. Leading spaces are trimmed, sub-word tokens and punctuation are joined to
 * their word. Segment-only JSON gets word times spread across each segment.
 */
export function parseWordJson(src: string | object): CaptionWord[] {
  const r = readWordJson(src);
  if (r.words.length) return r.words;
  return r.segments.flatMap((s) => {
    const c: Caption = { index: 0, start: s.start, end: s.end, text: s.text, lines: [], words: [], wordsTimed: false };
    return distributeWordTimes(c).map((w) => (s.speaker !== undefined ? { ...w, speaker: s.speaker } : w));
  });
}

/** Captions from transcriber JSON: words grouped with captionsFromWords, else one cue per segment. */
export function parseJsonCaptions(src: string | object): Caption[] {
  const r = readWordJson(src);
  if (r.words.length) return captionsFromWords(r.words);
  return finish(
    r.segments.map((s) => {
      const c: Caption = { index: 0, start: s.start, end: s.end, text: s.text, lines: breakLines(s.text), words: [], wordsTimed: false };
      if (s.speaker !== undefined) c.speaker = s.speaker;
      c.words = distributeWordTimes(c);
      return c;
    }),
  );
}

// ---------------------------------------------------------------------------------------------------------
// Writers.

const displayLines = (c: Caption): string[] => {
  const lines = (c.lines.length ? c.lines : [c.text]).map(collapseSpace).filter((l) => l.length > 0);
  return lines.length ? lines : [collapseSpace(c.text)];
};
const hasText = (c: Caption): boolean => collapseSpace(c.text).length > 0 || c.lines.some((l) => collapseSpace(l).length > 0);

/** SubRip text: cues numbered from 1, HH:MM:SS,mmm times, the caption's lines. Empty cues are skipped. */
export function toSrt(caps: Caption[]): string {
  return caps
    .filter(hasText)
    .map((c, i) => `${i + 1}\n${clock(c.start, ',')} --> ${clock(c.end, ',')}\n${displayLines(c).join('\n')}\n`)
    .join('\n');
}

const escapeVtt = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Lines with an inline timestamp before every word that starts after the cue (karaoke VTT). */
function timedLines(c: Caption): string[] {
  const lines = displayLines(c).map(splitWords);
  const total = lines.reduce((n, l) => n + l.length, 0);
  const rows = total === c.words.length ? lines : [c.words.map((w) => w.text)];
  let k = 0;
  return rows.map((row) =>
    row
      .map((text) => {
        const w = c.words[k++];
        return (w && w.start > c.start + EPS ? `<${clock(w.start, '.')}>` : '') + escapeVtt(text);
      })
      .join(' '),
  );
}

/** WebVTT text: ids when known, <v Speaker> voices, escaped text; `words: true` adds inline word timestamps. */
export function toVtt(caps: Caption[], opts: { words?: boolean } = {}): string {
  const blocks = caps.filter(hasText).map((c) => {
    const lines = opts.words && c.wordsTimed && c.words.length ? timedLines(c) : displayLines(c).map(escapeVtt);
    if (c.speaker) lines[0] = `<v ${escapeVtt(c.speaker)}>${lines[0]}`;
    const id = c.id ? `${c.id.replace(/-->/g, '->').replace(/\s*\n\s*/g, ' ')}\n` : '';
    return `${id}${clock(c.start, '.')} --> ${clock(c.end, '.')}\n${lines.join('\n')}\n`;
  });
  return `WEBVTT\n\n${blocks.join('\n')}`;
}
