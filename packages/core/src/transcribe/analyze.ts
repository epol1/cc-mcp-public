// Turns raw recognizer words into an editable transcript: filler and repeat flags, sentences with ids, pauses.
import type { Pause, Sentence, Word } from './types.ts';

/** Single-word fillers. Multi-word ones ("you know", "I mean", "sort of") are matched as phrases below. */
const FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'erm', 'er', 'ah', 'hmm', 'mm', 'mhm', 'uh-huh']);
/** Phrases that are filler only when set off by commas or pauses ("you know," not "you know the answer"). */
const SOFT_PHRASES = [['you', 'know'], ['i', 'mean'], ['sort', 'of'], ['kind', 'of'], ['like']];

export const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}'-]+/gu, '').replace(/^-+|-+$/g, '');

const endsClause = (t: string) => /[,.;:!?—–-]$/.test(t.trim());

/** Flag fillers, soft filler phrases set off by punctuation/pauses, and immediate repeats ("the second thing, the second thing"). */
export function flagFillers(words: Word[], opts: { pause?: number } = {}): Word[] {
  const pause = opts.pause ?? 0.3;
  for (const w of words) delete w.filler;
  for (const w of words) if (FILLERS.has(norm(w.text))) w.filler = 'filler';
  // Soft phrases: "like," / "you know," when followed by punctuation or a pause, and preceded by one too.
  for (let i = 0; i < words.length; i++) {
    for (const ph of SOFT_PHRASES) {
      const n = ph.length;
      if (i + n > words.length) continue;
      if (!ph.every((p, k) => norm(words[i + k].text) === p)) continue;
      const last = words[i + n - 1], prev = words[i - 1], next = words[i + n];
      const offAfter = endsClause(last.text) || !next || next.start - last.end > pause;
      const offBefore = !prev || endsClause(prev.text) || words[i].start - prev.end > pause;
      if (offAfter && offBefore) for (let k = 0; k < n; k++) words[i + k].filler ??= 'filler';
    }
  }
  // Repeats: a run of 1–4 words immediately repeated; the first copy is the one to cut ("we, we built" keeps the second).
  for (let i = 0; i < words.length; i++) {
    for (let n = 4; n >= 1; n--) {
      if (i + 2 * n > words.length) continue;
      let same = true;
      for (let k = 0; k < n; k++) if (norm(words[i + k].text) !== norm(words[i + n + k].text) || !norm(words[i + k].text)) { same = false; break; }
      if (!same) continue;
      if (n === 1 && FILLERS.has(norm(words[i].text))) continue;
      // Deliberate repetition ("very, very") is rare for longer runs; for single words keep only stutters close in time.
      if (n === 1 && words[i + 1].start - words[i].end > 0.6) continue;
      // A sentence that ends where the next begins with the same words is not a false start ("…in a year. In a year…").
      if (/[.!?]["')\]]?$/.test(words[i + n - 1].text)) continue;
      for (let k = 0; k < n; k++) words[i + k].filler ??= 'repeat';
      i += n - 1;
      break;
    }
  }
  return words;
}

/** Sentences (ids s1, s2 …) split at sentence punctuation, speaker changes and long pauses. */
export function sentences(words: Word[], opts: { pause?: number; maxWords?: number } = {}): Sentence[] {
  const pause = opts.pause ?? 1.2, maxWords = opts.maxWords ?? 60;
  const out: Sentence[] = [];
  let from = 0;
  const flush = (to: number) => {
    if (to < from) return;
    const ws = words.slice(from, to + 1);
    out.push({ id: `s${out.length + 1}`, from: ws[0].i, to: ws[ws.length - 1].i, start: ws[0].start, end: ws[ws.length - 1].end, text: ws.map((w) => w.text).join(' ').replace(/\s+([,.;:!?])/g, '$1'), speaker: ws[0].speaker });
    from = to + 1;
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i], next = words[i + 1];
    const end = /[.!?]["')\]]?$/.test(w.text) || !next || next.start - w.end > pause || (next.speaker && next.speaker !== w.speaker) || i - from + 1 >= maxWords;
    if (end) flush(i);
  }
  return out;
}

export function pauses(words: Word[], min = 0.4): Pause[] {
  const out: Pause[] = [];
  for (let i = 0; i + 1 < words.length; i++) {
    const gap = words[i + 1].start - words[i].end;
    if (gap >= min) out.push({ after: words[i].i, start: words[i].end, end: words[i + 1].start });
  }
  return out;
}
