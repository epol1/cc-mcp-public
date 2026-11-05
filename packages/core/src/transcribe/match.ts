// Find a quote in a transcript by words, forgiving punctuation, fillers and small recognition differences.
// Token-level edit distance over sliding windows; returns the best word range with a 0–1 score and the runner-up
// so callers can refuse ambiguous matches ("and that is why" may occur twice).
import { norm } from './analyze.ts';
import type { Word } from './types.ts';

export interface QuoteMatch { from: number; to: number; score: number; text: string; runnerUp?: { from: number; to: number; score: number } }

function editDistance(a: string[], b: string[]): number {
  const m = a.length, n = b.length;
  let prev = new Array(n + 1).fill(0).map((_, j) => j), cur = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const sub = a[i - 1] === b[j - 1] ? 0 : near(a[i - 1], b[j - 1]) ? 0.5 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + sub);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

/** Recognizer spelling variants count half: "ok"/"okay", "gonna"/"going", numbers vs words. */
function near(a: string, b: string): boolean {
  if (a.length > 3 && b.length > 3 && (a.startsWith(b.slice(0, 4)) || b.startsWith(a.slice(0, 4)))) return true;
  return false;
}

const FILLER = new Set(['um', 'umm', 'uh', 'uhh', 'erm', 'er', 'ah', 'hmm', 'mm']);

export function findQuote(words: Word[], quote: string, opts: { from?: number; to?: number } = {}): QuoteMatch | null {
  const q = quote.split(/\s+/).map(norm).filter((t) => t && !FILLER.has(t));
  if (!q.length) return null;
  const lo = opts.from ?? 0, hi = Math.min(words.length - 1, opts.to ?? words.length - 1);
  // Candidate tokens with their word indices, fillers skipped (the transcript may contain "um" the quote doesn't).
  const toks: { t: string; i: number }[] = [];
  for (let i = lo; i <= hi; i++) { const t = norm(words[i].text); if (t && !FILLER.has(t)) toks.push({ t, i }); }
  const first = new Set([q[0], q[1]].filter(Boolean));
  const scored: { from: number; to: number; score: number }[] = [];
  for (let s = 0; s < toks.length; s++) {
    // Prune: windows must start near a token matching the quote's first or second word, unless the quote is short.
    if (q.length > 3 && !first.has(toks[s].t) && !(toks[s + 1] && first.has(toks[s + 1].t))) continue;
    let best: { len: number; d: number } | null = null;
    for (let len = Math.max(1, q.length - 3); len <= q.length + 3 && s + len <= toks.length; len++) {
      const d = editDistance(q, toks.slice(s, s + len).map((x) => x.t));
      if (!best || d < best.d) best = { len, d };
    }
    if (!best) continue;
    const score = 1 - best.d / Math.max(q.length, best.len);
    scored.push({ from: toks[s].i, to: toks[s + best.len - 1].i, score });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  const runnerUp = scored.find((x) => x.to < top.from || x.from > top.to);
  return { ...top, text: words.slice(top.from, top.to + 1).map((w) => w.text).join(' '), ...(runnerUp ? { runnerUp } : {}) };
}
