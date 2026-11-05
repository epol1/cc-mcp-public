// Captions: SRT/VTT/word-JSON parsing, writers and round trips, balanced line breaking, re-flow with cue
// splitting, grouping timed words into cues, word-time estimates and reading checks.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  approxWidth,
  breakLines,
  captionsFromWords,
  charCount,
  distributeWordTimes,
  lineCount,
  loadCaptions,
  parseCaptions,
  parseSrt,
  parseVtt,
  parseWordJson,
  readingIssues,
  reflow,
  sniffFormat,
  toSrt,
  toVtt,
  type Caption,
  type CaptionWord,
} from '@cc-mcp/core/text/captions.ts';

const BOM = String.fromCharCode(0xfeff);
const NBSP = String.fromCharCode(0xa0);
const RLM = String.fromCharCode(0x200f);

/** Words spoken at a steady pace: `per` seconds each, ending `gap` before the next. */
function speak(text: string, t0 = 0, per = 0.35, gap = 0.05): CaptionWord[] {
  return text.split(' ').map((w, i) => ({ text: w, start: round(t0 + i * per), end: round(t0 + (i + 1) * per - gap) }));
}
const round = (t: number): number => Math.round(t * 1000) / 1000;
const cue = (start: number, end: number, text: string, index = 1): Caption => ({ index, start, end, text, lines: [text], words: [], wordsTimed: false });

// ---------------------------------------------------------------------------------------------------------

const SRT = BOM + [
  '1',
  '00:00:01,000 --> 00:00:03,500',
  '<i>Welcome to the show.</i>',
  '',
  '2',
  '00:00:04,000 --> 00:00:06,250',
  '{\\an8}<font color="#ffcc00">Tonight:</font> captions',
  'that <b>move</b>.',
  '',
  '3',
  '00:00:06,250 --> 00:00:08,000',
  'AT&amp;T &lt;3 {i}italic{/i}',
  '',
].join('\r\n');

describe('parseSrt', () => {
  it('reads cues through BOM, CRLF, HTML and ASS tags, entities', () => {
    const caps = parseSrt(SRT);
    expect(caps.map((c) => [c.index, c.start, c.end, c.text])).toEqual([
      [1, 1, 3.5, 'Welcome to the show.'],
      [2, 4, 6.25, 'Tonight: captions that move.'],
      [3, 6.25, 8, 'AT&T <3 italic'],
    ]);
    expect(caps[1].lines).toEqual(['Tonight: captions', 'that move.']);
    expect(caps[1].wordsTimed).toBe(false);
  });

  it('estimates word times inside each cue', () => {
    const c = parseSrt(SRT)[1];
    expect(c.words.map((w) => w.text)).toEqual(['Tonight:', 'captions', 'that', 'move.']);
    expect(c.words[0].start).toBe(4);
    expect(c.words[3].end).toBe(6.25);
    for (let i = 1; i < c.words.length; i++) expect(c.words[i].start).toBeGreaterThan(c.words[i - 1].end);
    // Longer words get more time.
    const d = (w: CaptionWord): number => w.end - w.start;
    expect(d(c.words[1])).toBeGreaterThan(d(c.words[2]));
  });

  it('survives missing index lines and blank lines, period ms, no hours, empty and out-of-order cues', () => {
    const src = [
      '00:00:05.5 --> 00:00:07.0',
      'Second, but listed first',
      '',
      '00:01,000 --> 00:02,000',
      'First without hours or index',
      '2',
      '00:00:02,500 --> 00:00:03,000',
      '',
      '00:00:06,000 --> 00:00:09,000',
      'Overlaps the second',
    ].join('\n');
    const caps = parseSrt(src);
    expect(caps.map((c) => [c.index, c.start, c.end, c.text])).toEqual([
      [1, 1, 2, 'First without hours or index'],
      [2, 5.5, 7, 'Second, but listed first'],
      [3, 6, 9, 'Overlaps the second'],
    ]);
  });

  it('keeps a stray blank line inside a cue and numeric caption text', () => {
    const src = ['1', '00:00:01,000 --> 00:00:02,000', 'Line one', '', 'Line two after a stray blank', '', '2', '00:00:03,000 --> 00:00:04,000', '1999', '', '3', '00:00:05,000 --> 00:00:06,000', 'Next'].join('\n');
    const caps = parseSrt(src);
    expect(caps.map((c) => c.lines)).toEqual([['Line one', 'Line two after a stray blank'], ['1999'], ['Next']]);
  });

  it('passes unicode, emoji and right-to-left text through untouched', () => {
    const he = `${RLM}שלום, מה שלומך?`;
    const src = ['1', '00:00:00,000 --> 00:00:02,000', 'Café naïve 👋🏽 ok 🎉', '', '2', '00:00:02,000 --> 00:00:04,000', he, '', '3', '00:00:04,000 --> 00:00:06,000', '字幕のテスト'].join('\n');
    const caps = parseSrt(src);
    expect(caps.map((c) => c.text)).toEqual(['Café naïve 👋🏽 ok 🎉', he, '字幕のテスト']);
    expect(charCount(caps[0].text)).toBe(17); // the waving hand with skin tone is one character
    expect(charCount(he)).toBe(15); // the RLM mark is invisible
  });

  it('returns nothing for text without timings', () => {
    expect(parseSrt('just some text\nwithout cues')).toEqual([]);
    expect(parseSrt('')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------

const VTT = [
  'WEBVTT - Launch film',
  'Kind: captions',
  'Language: en',
  '',
  'NOTE This file was made by hand.',
  'It has a two-line note.',
  '',
  'STYLE',
  '::cue(.yellow) { color: yellow; }',
  '',
  'REGION',
  'id:fred width:40%',
  '',
  'intro',
  '00:00:00.500 --> 00:00:02.000 line:85% align:center',
  '<v Roger Bingham>We are in <c.yellow>New York</c> City</v>',
  '',
  '00:02.000 --> 00:04.000',
  "<v.loud Esme>It's <i>loud</i> &amp; clear!",
  '',
  '2',
  '00:00:04.000 --> 00:00:05.000',
  '<lang en>Line one</lang>',
  '<ruby>漢<rt>kan</rt></ruby>字',
  '',
].join('\n');

describe('parseVtt', () => {
  it('skips header, NOTE, STYLE and REGION blocks; keeps ids, voices and lines; ignores cue settings', () => {
    const caps = parseVtt(VTT);
    expect(caps.map((c) => [c.index, c.id, c.start, c.end, c.speaker, c.text])).toEqual([
      [1, 'intro', 0.5, 2, 'Roger Bingham', 'We are in New York City'],
      [2, undefined, 2, 4, 'Esme', "It's loud & clear!"],
      [3, '2', 4, 5, undefined, 'Line one 漢字'],
    ]);
    expect(caps[2].lines).toEqual(['Line one', '漢字']);
    expect(caps.every((c) => !c.wordsTimed)).toBe(true);
  });

  it('reads inline word timestamps as word timing', () => {
    const [c] = parseVtt('WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nNever <00:00:01.400>gonna <00:00:01.800>give you <00:00:02.600>up\n');
    expect(c.wordsTimed).toBe(true);
    expect(c.text).toBe('Never gonna give you up');
    const starts = c.words.map((w) => w.start);
    expect(starts[0]).toBe(1);
    expect(starts[1]).toBe(1.4);
    expect(starts[2]).toBe(1.8);
    expect(starts[3]).toBeGreaterThan(1.8); // "you" shares give's segment
    expect(starts[3]).toBeLessThan(2.6);
    expect(starts[4]).toBe(2.6);
    expect(c.words[4].end).toBe(3);
    expect(c.words[0].end).toBeLessThan(1.4);
  });

  it('keeps a word whole when a timestamp falls inside it, and reads YouTube-style karaoke', () => {
    const [a] = parseVtt('WEBVTT\n\n00:01.000 --> 00:02.000\nHel<00:01.300>lo world');
    expect(a.words.map((w) => w.text)).toEqual(['Hello', 'world']);
    expect(a.words[0].start).toBe(1);
    expect(a.words[1].end).toBe(2);
    const yt = ['WEBVTT', 'Kind: captions', 'Language: en', '', '00:00:00.160 --> 00:00:02.270 align:start position:0%', ' ', 'hello<00:00:00.480><c> everyone</c><00:00:00.880><c> welcome</c>', ''].join('\n');
    const [b] = parseVtt(yt);
    expect(b.lines).toEqual(['hello everyone welcome']);
    expect(b.words.map((w) => [w.text, w.start])).toEqual([['hello', 0.16], ['everyone', 0.48], ['welcome', 0.88]]);
  });

  it('is lenient: no header, CRLF, empty cues dropped, whitespace-only separators', () => {
    const caps = parseVtt('00:00:01.000 --> 00:00:02.000\r\nNo header here\r\n\r\n00:00:03.000 --> 00:00:04.000\r\n\r\n00:00:05.000 --> 00:00:06.000\r\n<v Ann></v>\r\n');
    expect(caps.map((c) => c.text)).toEqual(['No header here']);
    const sloppy = parseVtt('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nFirst cue\n \nsecond-id\n00:00:03.000 --> 00:00:04.000\nSecond cue\n');
    expect(sloppy.map((c) => [c.id, c.text])).toEqual([[undefined, 'First cue'], ['second-id', 'Second cue']]);
  });

  it('times a first word that starts after the cue', () => {
    const [c] = parseVtt('WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<00:00:01.500>Late start\n');
    expect(c.words.map((w) => [w.text, w.start])).toEqual([['Late', 1.5], ['start', expect.any(Number)]]);
    const out = toVtt([c], { words: true });
    expect(out).toMatch(/\n<00:00:01\.500>Late <00:00:02\.\d{3}>start\n/); // estimated words get stamps too
    expect(parseVtt(out)[0].words.map((w) => w.start)).toEqual(c.words.map((w) => w.start));
  });
});

// ---------------------------------------------------------------------------------------------------------

const WHISPER = {
  text: " Hello world. Don't stop.",
  segments: [
    {
      id: 0, start: 0, end: 1.2, text: ' Hello world.',
      words: [
        { word: ' Hello', start: 0, end: 0.48, probability: 0.97 },
        { word: ' world', start: 0.5, end: 1.0, probability: 0.95 },
        { word: '.', start: 1.0, end: 1.2, probability: 0.9 },
      ],
    },
    {
      id: 1, start: 1.6, end: 2.6, text: " Don't stop.",
      words: [
        { word: ' Don', start: 1.6, end: 1.8, probability: 0.9 },
        { word: "'t", start: 1.8, end: 1.95, probability: 0.9 },
        { word: ' stop.', start: 2.0, end: 2.6, probability: 0.9 },
      ],
    },
  ],
  language: 'en',
};

describe('parseWordJson', () => {
  it('reads Whisper segments: trims leading spaces, joins sub-word tokens and punctuation', () => {
    expect(parseWordJson(JSON.stringify(WHISPER))).toEqual([
      { text: 'Hello', start: 0, end: 0.48 },
      { text: 'world.', start: 0.5, end: 1.2 },
      { text: "Don't", start: 1.6, end: 1.95 },
      { text: 'stop.', start: 2.0, end: 2.6 },
    ]);
    expect(parseWordJson(WHISPER)).toHaveLength(4); // objects work too
  });

  it('reads {words} with millisecond times and speakers (AssemblyAI)', () => {
    const aai = { text: 'Hi there. Bye.', words: [
      { text: 'Hi', start: 250, end: 600, confidence: 0.9, speaker: 'A' },
      { text: 'there.', start: 650, end: 1100, confidence: 0.9, speaker: 'A' },
      { text: 'Bye.', start: 2400, end: 2900, confidence: 0.9, speaker: 'B' },
    ] };
    expect(parseWordJson(aai)).toEqual([
      { text: 'Hi', start: 0.25, end: 0.6, speaker: 'A' },
      { text: 'there.', start: 0.65, end: 1.1, speaker: 'A' },
      { text: 'Bye.', start: 2.4, end: 2.9, speaker: 'B' },
    ]);
  });

  it('finds nested word lists and prefers punctuated words (Deepgram)', () => {
    const dg = { metadata: { request_id: 'x', models: ['nova'] }, results: { channels: [{ alternatives: [{ transcript: 'hello world', confidence: 0.99, words: [
      { word: 'hello', start: 0.08, end: 0.4, confidence: 0.99, punctuated_word: 'Hello' },
      { word: 'world', start: 0.4, end: 0.9, confidence: 0.98, punctuated_word: 'world!' },
    ] }] }] } };
    expect(parseWordJson(dg).map((w) => w.text)).toEqual(['Hello', 'world!']);
  });

  it('reads bare arrays with word or text keys', () => {
    expect(parseWordJson([{ word: 'one', start: 0, end: 0.3 }, { word: 'two', start: 0.3, end: 0.6 }]).map((w) => w.text)).toEqual(['one', 'two']);
    expect(parseWordJson('[{"text":"uno","start":1,"end":1.2},{"text":"dos","start":1.3,"end":1.6}]')).toEqual([
      { text: 'uno', start: 1, end: 1.2 },
      { text: 'dos', start: 1.3, end: 1.6 },
    ]);
  });

  it('spreads words across segment-only JSON (whisper.cpp offsets)', () => {
    const cpp = { transcription: [
      { timestamps: { from: '00:00:00,000', to: '00:00:01,500' }, offsets: { from: 0, to: 1500 }, text: ' And so my fellow Americans' },
      { timestamps: { from: '00:00:01,500', to: '00:00:03,000' }, offsets: { from: 1500, to: 3000 }, text: ' ask not what your country can do' },
    ] };
    const words = parseWordJson(cpp);
    expect(words.map((w) => w.text).join(' ')).toBe('And so my fellow Americans ask not what your country can do');
    expect(words[0].start).toBe(0);
    expect(words[4].end).toBe(1.5);
    expect(words[5].start).toBe(1.5);
    const caps = parseCaptions(JSON.stringify(cpp));
    expect(caps.map((c) => [c.start, c.end, c.text, c.wordsTimed])).toEqual([
      [0, 1.5, 'And so my fellow Americans', false],
      [1.5, 3, 'ask not what your country can do', false],
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('parseCaptions and loadCaptions', () => {
  it('sniffs the format', () => {
    expect(sniffFormat(SRT)).toBe('srt');
    expect(sniffFormat(VTT)).toBe('vtt');
    expect(sniffFormat(JSON.stringify(WHISPER))).toBe('json');
    expect(sniffFormat('00:00:01.000 --> 00:00:02.000\n<v Bob>Hi')).toBe('vtt');
    expect(parseCaptions(SRT)).toEqual(parseSrt(SRT));
    expect(parseCaptions(VTT)).toEqual(parseVtt(VTT));
    expect(parseCaptions(VTT, 'srt').map((c) => c.text)).toContain('We are in New York City');
  });

  it('groups word JSON into cues', () => {
    const caps = parseCaptions(JSON.stringify(WHISPER));
    expect(caps.map((c) => [c.text, c.wordsTimed])).toEqual([['Hello world.', true], ["Don't stop.", true]]);
  });

  it('loads files by extension, sniffing unknown ones', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aec-captions-'));
    writeFileSync(join(dir, 'a.srt'), SRT);
    writeFileSync(join(dir, 'b.vtt'), VTT);
    writeFileSync(join(dir, 'c.json'), JSON.stringify(WHISPER));
    writeFileSync(join(dir, 'd.txt'), VTT);
    expect(loadCaptions(join(dir, 'a.srt'))).toHaveLength(3);
    expect(loadCaptions(join(dir, 'b.vtt'))[0].speaker).toBe('Roger Bingham');
    expect(loadCaptions(join(dir, 'c.json'))).toHaveLength(2);
    expect(loadCaptions(join(dir, 'd.txt'))[0].id).toBe('intro');
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('writers and round trips', () => {
  it('writes SRT with numbered cues and comma milliseconds', () => {
    const caps: Caption[] = [
      { ...cue(1.5, 3.25, 'Hello there, friend.'), lines: ['Hello there,', 'friend.'] },
      cue(3725.007, 3726, 'One hour in', 2),
      cue(5, 6, '   ', 3),
    ];
    expect(toSrt(caps)).toBe('1\n00:00:01,500 --> 00:00:03,250\nHello there,\nfriend.\n\n2\n01:02:05,007 --> 01:02:06,000\nOne hour in\n');
  });

  it('SRT: parse → toSrt → parse is stable', () => {
    const a = parseSrt(SRT);
    expect(parseSrt(toSrt(a))).toEqual(a);
    const messy = parseSrt('00:00:05.5 --> 00:00:07.0\nSecond 👋🏽\n\n00:01,000 --> 00:02,000\nשלום עולם\nsecond line');
    expect(parseSrt(toSrt(messy))).toEqual(messy);
  });

  it('VTT: parse → toVtt → parse keeps ids, voices, escapes and lines', () => {
    const a = parseVtt(VTT);
    const out = toVtt(a);
    expect(out.startsWith('WEBVTT\n\nintro\n00:00:00.500 --> 00:00:02.000\n<v Roger Bingham>We are in New York City\n')).toBe(true);
    expect(out).toContain("It's loud &amp; clear!");
    expect(parseVtt(out)).toEqual(a);
  });

  it('VTT with word timestamps round-trips karaoke timing', () => {
    const src = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nNever <00:00:01.400>gonna <00:00:01.800>give <00:00:02.200>you <00:00:02.600>up\n';
    const a = parseVtt(src);
    const out = toVtt(a, { words: true });
    expect(out).toBe(src);
    expect(parseVtt(out)).toEqual(a);
    expect(toVtt(a)).toContain('\nNever gonna give you up\n');
  });

  it('captions from words → SRT/VTT → parse keep text, lines, times and word starts', () => {
    const caps = captionsFromWords(speak('We spent two years building a caption engine. It reads like a human would.', 0.5));
    const srt = parseSrt(toSrt(caps));
    expect(srt.map((c) => [c.start, c.end, c.text, c.lines])).toEqual(caps.map((c) => [c.start, c.end, c.text, c.lines]));
    const vtt = parseVtt(toVtt(caps, { words: true }));
    expect(vtt.map((c) => c.words.map((w) => [w.text, w.start]))).toEqual(caps.map((c) => c.words.map((w) => [w.text, w.start])));
    expect(vtt.every((c) => c.wordsTimed)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------

const SENTENCES = [
  'The quick brown fox jumps over the lazy dog and runs into the forest.',
  'We built this tool so that every editor can ship captions in minutes, not hours.',
  'If you want to learn more about our product, visit the website today.',
  'Our new app helps small teams plan their week in just a few minutes.',
  'I went to the store yesterday, and I bought some milk for the kids.',
  'This is the moment when everything changes for the better, forever.',
  'Dr. Smith told me that the results would be ready by Monday morning.',
  'Ship faster with fewer meetings and better tools for everyone on the team.',
  'It costs only 10 dollars per month for the whole team to use it.',
  'We sat down this morning with Dr. Smith to talk about the new results.',
];

describe('breakLines', () => {
  it('keeps text that fits on one line', () => {
    expect(breakLines('Short and sweet.')).toEqual(['Short and sweet.']);
    expect(breakLines('  spaced   out\n text ')).toEqual(['spaced out text']);
    expect(breakLines('   ')).toEqual([]);
  });

  it('splits typical 60–80 character sentences into two balanced lines', () => {
    for (const s of SENTENCES) {
      const lines = breakLines(s, { maxChars: 42 });
      expect(lines, s).toHaveLength(2);
      expect(lines.join(' ')).toBe(s);
      for (const l of lines) expect(l.length, l).toBeLessThanOrEqual(42);
      expect(Math.abs(lines[0].length - lines[1].length), JSON.stringify(lines)).toBeLessThanOrEqual(12);
    }
  });

  it('never ends a line on an article, a title or a number before its unit', () => {
    for (const s of SENTENCES) {
      for (const l of breakLines(s).slice(0, -1)) expect(l, s).not.toMatch(/\b(?:the|a|an|our|Dr\.|10)$/i);
    }
  });

  it('prefers breaking after punctuation and before conjunctions', () => {
    expect(breakLines('I went to the store yesterday, and I bought some milk for the kids.')).toEqual(['I went to the store yesterday,', 'and I bought some milk for the kids.']);
    expect(breakLines('Thanks for watching. See you next week on the channel.')).toEqual(['Thanks for watching.', 'See you next week on the channel.']);
    expect(breakLines('We built this tool so that every editor can ship captions in minutes, not hours.')).toEqual(['We built this tool so that every editor', 'can ship captions in minutes, not hours.']);
    expect(breakLines('It costs only 10 dollars per month for the whole team to use it.')).toEqual(['It costs only 10 dollars per month', 'for the whole team to use it.']);
  });

  it('avoids a short word alone on the last line where greedy filling leaves one', () => {
    const cases: [string, number][] = [
      ['Captions should never leave a lonely word at the end of it', 20],
      ['We make tools that help people tell their story in motion now', 21],
      ['Join thousands of creators who already publish their videos with us', 22],
    ];
    for (const [s, n] of cases) {
      const lines = breakLines(s, { maxChars: n, maxLines: 4 });
      expect(lines.length, s).toBe(lineCount(s, { maxChars: n }));
      expect(lines[lines.length - 1].split(' ').length, JSON.stringify(lines)).toBeGreaterThan(1);
      for (const l of lines) expect(l.length).toBeLessThanOrEqual(n);
    }
    expect(breakLines('Captions should never leave a lonely word at the end of it', { maxChars: 20 })).toEqual(['Captions should', 'never leave', 'a lonely word', 'at the end of it']);
  });

  it('returns more lines than maxLines when the text needs them', () => {
    const s = 'This caption is much too long to fit on two lines of twenty characters each, so it needs more.';
    const lines = breakLines(s, { maxChars: 20, maxLines: 2 });
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.join(' ')).toBe(s);
  });

  it('breaks a URL only at its separators and a long word with a hyphen', () => {
    const url = 'https://example.com/products/captions/download-latest-version?ref=promo';
    const lines = breakLines(`Download it now from ${url}`, { maxChars: 42 });
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(42);
    expect(lines[0]).toBe('Download it now from');
    expect(lines.slice(1).join('')).toBe(url);
    for (const l of lines.slice(1, -1)) expect(l).toMatch(/[/.\-_?&=#:@,]$/);
    const de = breakLines('Donaudampfschifffahrtsgesellschaftskapitän ist hier', { maxChars: 20 });
    // Even pieces (15/15/12 letters) rather than greedy ones (19/19/4), each fitting with its hyphen.
    expect(de).toEqual(['Donaudampfschif-', 'ffahrtsgesellsc-', 'haftskapitän', 'ist hier']);
  });

  it('keeps no-break spaces together and passes RTL and emoji through', () => {
    expect(breakLines(`Run 10${NBSP}km today`, { maxChars: 8 })).toContain(`10${NBSP}km`);
    const he = 'שלום עולם, זהו משפט ארוך בעברית שצריך להתפצל לשתי שורות';
    const heLines = breakLines(he, { maxChars: 30 });
    expect(heLines).toHaveLength(2);
    expect(heLines.join(' ')).toBe(he);
    expect(heLines).toEqual(['שלום עולם, זהו משפט ארוך', 'בעברית שצריך להתפצל לשתי שורות']); // logical order kept
    const emoji = 'Launch day 🚀 is finally here 🎉🎉 and we could not be more excited';
    const el = breakLines(emoji, { maxChars: 42 });
    expect(el.join(' ')).toBe(emoji);
    for (const l of el) expect(charCount(l)).toBeLessThanOrEqual(42);
  });

  it('breaks to a pixel width with a measure function', () => {
    const measure = (s: string): number => approxWidth(s, 56);
    const s = 'Make every second count with captions that move';
    const lines = breakLines(s, { maxWidth: 600, measure });
    for (const l of lines) expect(measure(l)).toBeLessThanOrEqual(600);
    expect(lines.join(' ')).toBe(s);
    const caps = breakLines(s.toUpperCase(), { maxWidth: 600, measure });
    expect(caps.length).toBeGreaterThan(lines.length); // capitals are wider
    expect(() => breakLines(s, { maxWidth: 600 })).toThrow(/measure/);
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('reflow', () => {
  const long = 'Our new caption engine reads your transcript, finds the natural pauses, balances every line and keeps the timing in sync with the voice.';

  it('splits a cue that needs more than maxLines lines, dividing time by character share', () => {
    const caps = reflow([cue(10, 16, long), cue(16, 17, 'Done.', 2)], { maxChars: 42, maxLines: 2 });
    expect(caps.length).toBe(3);
    expect(caps.map((c) => c.index)).toEqual([1, 2, 3]);
    const [a, b] = caps;
    expect(`${a.text} ${b.text}`).toBe(long);
    expect(a.start).toBe(10);
    expect(b.end).toBe(16);
    expect(a.end).toBe(b.start);
    for (const c of [a, b]) {
      expect(c.lines.length).toBeLessThanOrEqual(2);
      for (const l of c.lines) expect(l.length).toBeLessThanOrEqual(42);
      expect(c.words.map((w) => w.text).join(' ')).toBe(c.text);
      expect(c.words[0].start).toBe(c.start);
      expect(c.words[c.words.length - 1].end).toBe(c.end);
    }
    const share = (a.text.length + 1) / (a.text.length + b.text.length + 2);
    expect(a.end - a.start).toBeCloseTo(6 * share, 2);
    expect(a.text.endsWith(',')).toBe(true); // split at the clause
    expect(caps[2].text).toBe('Done.');
  });

  it('splits timed cues at word timing', () => {
    const [timed] = captionsFromWords(speak(long.replace(/,/g, ''), 2, 0.3, 0.04), { maxChars: 200, maxLines: 1, maxDuration: 60 });
    expect(timed.words).toHaveLength(23);
    const caps = reflow([timed], { maxChars: 32, maxLines: 2 });
    expect(caps.length).toBeGreaterThan(1);
    expect(caps[0].start).toBe(timed.start);
    expect(caps[caps.length - 1].end).toBe(timed.end);
    for (let i = 1; i < caps.length; i++) {
      expect(caps[i].start).toBe(caps[i].words[0].start);
      expect(caps[i - 1].end).toBe(caps[i].start);
      expect(caps[i].wordsTimed).toBe(true);
    }
    expect(caps.flatMap((c) => c.words)).toEqual(timed.words);
  });

  it('only re-breaks lines when the cue fits, keeping speaker and id', () => {
    const c: Caption = { ...cue(0, 3, 'Every frame matters when you only have six seconds.'), speaker: 'Ann', id: 'a1' };
    const [r] = reflow([c], { maxChars: 24, maxLines: 3 });
    expect(r.lines).toHaveLength(3);
    expect(r.lines.join(' ')).toBe(c.text);
    for (const l of r.lines) expect(l.length).toBeLessThanOrEqual(24);
    expect(r.speaker).toBe('Ann');
    expect(r.id).toBe('a1');
    expect(r.start).toBe(0);
    expect(r.end).toBe(3);
  });

  it('re-flows to a pixel width (safe-area box)', () => {
    const measure = (s: string): number => approxWidth(s, 48);
    const caps = reflow([cue(0, 8, long)], { maxWidth: 1080 * 0.8, measure, maxLines: 2 });
    for (const c of caps) {
      expect(c.lines.length).toBeLessThanOrEqual(2);
      for (const l of c.lines) expect(measure(l)).toBeLessThanOrEqual(1080 * 0.8);
    }
    expect(caps.map((c) => c.text).join(' ')).toBe(long);
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('captionsFromWords', () => {
  it('splits at sentence ends, balances long sentences and avoids one-word cues', () => {
    const ws = speak('So here is the thing. We spent two years building a caption engine that actually understands how people read on small screens and it shows. Yes. Try it today.');
    const caps = captionsFromWords(ws);
    expect(caps.map((c) => c.text)).toEqual([
      'So here is the thing.',
      'We spent two years building a caption engine that actually',
      'understands how people read on small screens and it shows.',
      'Yes. Try it today.',
    ]);
    expect(caps[1].lines).toEqual(['We spent two years building', 'a caption engine that actually']);
    for (const c of caps) {
      expect(c.wordsTimed).toBe(true);
      expect(c.start).toBe(c.words[0].start);
      expect(c.lines.length).toBeLessThanOrEqual(2);
    }
    expect(caps.map((c) => c.index)).toEqual([1, 2, 3, 4]);
  });

  it('splits at pauses and speaker changes', () => {
    const ws = [...speak('this is the first thought', 0), ...speak('and after a pause the second', 2.5)];
    expect(captionsFromWords(ws).map((c) => c.text)).toEqual(['this is the first thought', 'and after a pause the second']);
    const dialog = [...speak('how are you doing', 0).map((w) => ({ ...w, speaker: 'A' })), ...speak('pretty good thanks', 1.4).map((w) => ({ ...w, speaker: 'B' }))];
    const caps = captionsFromWords(dialog);
    expect(caps.map((c) => [c.speaker, c.text])).toEqual([['A', 'how are you doing'], ['B', 'pretty good thanks']]);
  });

  it('splits by maxDuration and maxChars × maxLines', () => {
    const slow = speak('these words are spoken very slowly with long drawn out vowels', 0, 0.9, 0.05);
    const caps = captionsFromWords(slow, { maxDuration: 4 });
    for (const c of caps) expect(c.words[c.words.length - 1].end - c.start).toBeLessThanOrEqual(4);
    expect(caps.every((c) => c.words.length > 1)).toBe(true);
    const fast = speak('and then we kept going and going without ever stopping to breathe because the deadline was tomorrow morning at nine', 0, 0.25, 0.02);
    const narrow = captionsFromWords(fast, { maxChars: 32 });
    expect(narrow.map((c) => c.lines)).toEqual([
      ['and then we kept going', 'and going without ever stopping'],
      ['to breathe because the deadline', 'was tomorrow morning at nine'],
    ]);
    const one = captionsFromWords(fast, { maxChars: 32, maxLines: 1 });
    for (const c of one) expect(c.lines).toHaveLength(1);
    expect(one.some((c) => c.words.length === 1)).toBe(false);
  });

  it('closes blinks between cues and holds short cues to minDuration', () => {
    const ws = [...speak('Hello there.', 0, 0.2, 0.02), ...speak('General Kenobi, you are a bold one.', 0.5, 0.3, 0.05), ...speak('Go!', 5, 0.2, 0)];
    const caps = captionsFromWords(ws, { minDuration: 1 });
    expect(caps.map((c) => c.text)).toEqual(['Hello there.', 'General Kenobi, you are a bold one.', 'Go!']);
    expect(caps[0].end).toBe(caps[1].start); // 0.12 s gap closed; also short, but the next cue starts first
    expect(caps[2].end).toBe(6); // held to 1 s
    expect(caps[1].end).toBe(2.55);
  });

  it('cleans up words: trims, drops empties, joins punctuation tokens, sorts', () => {
    const caps = captionsFromWords([
      { text: ' world', start: 0.5, end: 0.9 },
      { text: 'Hello', start: 0, end: 0.4 },
      { text: '', start: 0.9, end: 0.9 },
      { text: '!', start: 0.9, end: 1.0 },
    ]);
    expect(caps).toHaveLength(1);
    expect(caps[0].text).toBe('Hello world!');
    expect(caps[0].words.map((w) => [w.text, w.start, w.end])).toEqual([['Hello', 0, 0.4], ['world!', 0.5, 1]]);
    expect(captionsFromWords([])).toEqual([]);
  });

  it('handles a long unpunctuated transcript quickly', () => {
    const base = 'we kept building the thing because people wanted it and the deadline kept moving closer every day'.split(' ');
    const ws = Array.from({ length: 3000 }, (_, i) => ({ text: base[i % base.length], start: i * 0.3, end: i * 0.3 + 0.25 }));
    const t0 = performance.now();
    const caps = captionsFromWords(ws);
    expect(performance.now() - t0).toBeLessThan(5000);
    expect(caps.flatMap((c) => c.words)).toHaveLength(3000);
    for (const c of caps) {
      expect(c.lines.length).toBeLessThanOrEqual(2);
      expect(c.words.length).toBeGreaterThan(1);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('distributeWordTimes', () => {
  it('spreads untimed words by length with small gaps, filling the cue', () => {
    const ws = distributeWordTimes(cue(2, 4, 'a wonderful day'));
    expect(ws.map((w) => w.text)).toEqual(['a', 'wonderful', 'day']);
    expect(ws[0].start).toBe(2);
    expect(ws[2].end).toBe(4);
    expect(ws[1].end - ws[1].start).toBeGreaterThan(ws[2].end - ws[2].start);
    expect(ws[1].start).toBeGreaterThan(ws[0].end);
    expect(ws[1].start - ws[0].end).toBeLessThanOrEqual(0.04 + 1e-9);
  });

  it('keeps timed words and fills only the untimed ones between them', () => {
    const c: Caption = { ...cue(0, 3, 'one two three four'), words: [
      { text: 'one', start: 0, end: 0.5 },
      { text: 'two', start: NaN, end: NaN },
      { text: 'three', start: NaN, end: NaN },
      { text: 'four', start: 2, end: 3 },
    ], wordsTimed: true };
    const ws = distributeWordTimes(c);
    expect(ws[0]).toEqual({ text: 'one', start: 0, end: 0.5 });
    expect(ws[3]).toEqual({ text: 'four', start: 2, end: 3 });
    expect(ws[1].start).toBe(0.5);
    expect(ws[2].end).toBeLessThanOrEqual(2);
    expect(ws[2].start).toBeGreaterThan(ws[1].start);
    expect(c.words[1].start).toBeNaN(); // input untouched
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('readingIssues', () => {
  it('flags fast, short, long, blinking and overlapping cues', () => {
    const caps = [
      cue(0, 1, 'This sentence is far too long to read in one second.', 1),
      cue(1, 1.5, 'Hi.', 2),
      cue(1.533, 9, 'A long hold on screen', 3),
      cue(8.5, 10, 'Overlap', 4),
      cue(10, 12, 'Back to back is fine', 5),
    ];
    const issues = readingIssues(caps);
    expect(issues.map((i) => [i.index, i.rule])).toEqual([
      [1, 'too-fast'],
      [2, 'too-short'],
      [2, 'gap'],
      [3, 'too-long'],
      [3, 'overlap'],
    ]);
    const fast = issues[0];
    expect(fast.t).toEqual([0, 1]);
    expect(fast.message).toMatch(/52 characters in 1\.00 s = 52\.0\/s \(max 17\); needs 3\.06 s/);
    expect(issues[2].t).toEqual([1.5, 1.533]);
    expect(issues[4].t).toEqual([8.5, 9]);
    expect(issues[4].message).toMatch(/overlaps cue 4 by 0\.50 s/);
  });

  it('takes limits and the frame rate as options', () => {
    const caps = [cue(0, 2, 'Twenty characters!!!', 1), cue(2.1, 4, 'Next', 2)];
    expect(readingIssues(caps)).toEqual([]);
    expect(readingIssues(caps, { maxCps: 8 }).map((i) => i.rule)).toEqual(['too-fast']);
    expect(readingIssues(caps, { fps: 12 }).map((i) => i.rule)).toEqual(['gap']); // 0.1 s < 2 frames at 12 fps
    expect(readingIssues(caps, { minDuration: 1.95 }).map((i) => [i.index, i.rule])).toEqual([[2, 'too-short']]);
  });

  it('finds no issues in well-timed generated captions', () => {
    const caps = captionsFromWords(speak('We spent two years building a caption engine. It reads like a human would.', 0, 0.4));
    expect(readingIssues(caps)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('approxWidth', () => {
  it('uses Helvetica-like advances per character', () => {
    expect(approxWidth('Hello world', 100)).toBeCloseTo(494.5, 1);
    expect(approxWidth('Hello world', 50)).toBeCloseTo(247.25, 1);
    expect(approxWidth('iiii', 100)).toBeLessThan(approxWidth('mmmm', 100));
    expect(approxWidth('HELLO', 100)).toBeGreaterThan(approxWidth('hello', 100));
    expect(approxWidth('0123', 100)).toBeCloseTo(222.4, 1);
  });

  it('handles tracking, condensed faces, emoji, CJK, accents and invisible marks', () => {
    expect(approxWidth('abc', 100, { tracking: 100 }) - approxWidth('abc', 100)).toBeCloseTo(30, 6);
    expect(approxWidth('abc', 100, { condensed: true })).toBeCloseTo(approxWidth('abc', 100) * 0.82, 6);
    expect(approxWidth('👍', 100)).toBeCloseTo(120, 6);
    expect(approxWidth('👋🏽', 100)).toBeCloseTo(120, 6);
    expect(approxWidth('漢字', 100)).toBeCloseTo(200, 6);
    expect(approxWidth('é', 100)).toBeCloseTo(approxWidth('e', 100), 6);
    expect(approxWidth(`e${String.fromCharCode(0x301)}`, 100)).toBeCloseTo(approxWidth('e', 100), 6);
    expect(approxWidth(`${RLM}ab`, 100)).toBeCloseTo(approxWidth('ab', 100), 6);
  });
});
