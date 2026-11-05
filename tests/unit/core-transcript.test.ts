// Spec for the transcript layer (packages/core/src/transcribe): filler and repeat flags, sentences, pauses, quote
// matching and word-boundary refinement against an energy envelope.
import { describe, expect, it } from 'vitest';
import { flagFillers, pauses, sentences } from '@cc-mcp/core/transcribe/analyze.ts';
import { findQuote } from '@cc-mcp/core/transcribe/match.ts';
import { refineWords, type Envelope } from '@cc-mcp/core/transcribe/refine.ts';
import { buildTranscript } from '@cc-mcp/core/transcribe/index.ts';
import { words } from './helpers/words.ts';

describe('fillers and repeats', () => {
  it('flags um/uh, set-off "you know" and "like", and the first copy of a repeat', () => {
    const w = flagFillers(words('So, um, the first thing, the first thing is, you know, speed. I like speed. We, we built it.'));
    const f = (t: string, k = 0) => w.filter((x) => x.text === t)[k]?.filler;
    expect(f('um,')).toBe('filler');
    expect(w.slice(2, 5).map((x) => x.filler)).toEqual(['repeat', 'repeat', 'repeat']); // "the first thing," (words 2–4)
    expect(w.slice(5, 8).map((x) => x.filler)).toEqual([undefined, undefined, undefined]);
    expect(f('you')).toBe('filler');
    expect(f('know,')).toBe('filler');
    expect(f('like')).toBeUndefined(); // "I like speed" is not a filler
    expect(f('We,')).toBe('repeat');
    expect(f('we')).toBeUndefined();
  });
  it('keeps deliberate repetition that is far apart in time', () => {
    const w = words('very | very good');
    flagFillers(w);
    expect(w.map((x) => x.filler)).toEqual([undefined, undefined, undefined]);
  });
});

describe('sentences and pauses', () => {
  it('splits at full stops and long pauses, with word ranges and ids', () => {
    const w = words('This is one. This is | two');
    const s = sentences(w);
    expect(s.map((x) => [x.id, x.from, x.to])).toEqual([['s1', 0, 2], ['s2', 3, 4], ['s3', 5, 5]]);
    expect(pauses(w).map((p) => p.after)).toEqual([4]);
  });
});

describe('findQuote', () => {
  const w = words('So, um, we built the whole launch around that idea, and it worked. Later we built the whole thing again.');
  it('finds a quote ignoring punctuation and fillers', () => {
    const m = findQuote(w, 'we built the whole launch around that idea')!;
    expect([m.from, m.to]).toEqual([2, 9]);
    expect(m.score).toBe(1);
  });
  it('tolerates small recognition differences and reports a runner-up', () => {
    const m = findQuote(w, 'we built the hole launch around the idea')!;
    expect([m.from, m.to]).toEqual([2, 9]);
    expect(m.score).toBeGreaterThan(0.7);
    const short = findQuote(w, 'we built the whole')!;
    expect(short.runnerUp).toBeDefined();
  });
  it('returns a low score for text that is not there', () => {
    const m = findQuote(w, 'completely different sentence about pricing');
    expect(!m || m.score < 0.5).toBe(true);
  });
});

describe('refineWords', () => {
  // Envelope: silence (-80 dB) except speech (-20 dB) at 1.00–1.50 s and 3.00–3.60 s.
  const hop = 0.01;
  const db = new Float32Array(500).fill(-80);
  for (let i = 100; i < 150; i++) db[i] = -20;
  for (let i = 300; i < 360; i++) db[i] = -20;
  const env: Envelope = { hop, db, floor: -80, speech: -60 };
  it('moves an early recognizer start (inside silence) to the onset, and ends to the offset', () => {
    const r = refineWords([{ i: 0, text: 'hello', start: 0.8, end: 1.4, p: 1 }, { i: 1, text: 'there', start: 2.2, end: 3.7, p: 1 }], env);
    expect(r[0].start).toBeCloseTo(0.97, 2); // onset 1.00 minus the 30 ms attack
    expect(r[0].end).toBeGreaterThanOrEqual(1.49);
    expect(r[0].end).toBeLessThan(1.6);
    expect(r[1].start).toBeCloseTo(2.97, 2);
    expect(r[1].end).toBeLessThan(3.7);
    expect(r[1].raw).toEqual([2.2, 3.7]);
  });
  it('keeps word order: an end never runs past the next start', () => {
    const r = refineWords([{ i: 0, text: 'a', start: 1.0, end: 1.45, p: 1 }, { i: 1, text: 'b', start: 1.2, end: 1.5, p: 1 }], env);
    expect(r[0].end).toBeLessThanOrEqual(r[1].start);
  });
});

describe('buildTranscript', () => {
  it('assembles words, flags, sentences and pauses', () => {
    const t = buildTranscript('x.mp4', 'h', { engine: 'test', duration: 10, words: words('Um, hi there. | Bye.').map(({ text, start, end, p }) => ({ text, start, end, p })) });
    expect(t.words[0].filler).toBe('filler');
    expect(t.sentences.map((s) => s.text)).toEqual(['Um, hi there.', 'Bye.']);
    expect(t.pauses).toHaveLength(1);
  });
});
