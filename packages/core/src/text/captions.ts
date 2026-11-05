// Captions (pure Node, no AE): parse SRT, WebVTT and word-timed JSON (Whisper and similar) into timed cues,
// group timed words into cues, re-flow lines to a safe-area width (splitting cues that need too many lines),
// estimate word times for a karaoke highlight, check reading speed, and write SRT/VTT back out. Times are
// seconds. Parsing and writing live in ./caption-formats.ts, timing and layout in ./caption-timing.ts, line
// breaking in ./linebreak.ts and text measuring in ./measure.ts.

import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { parseJsonCaptions, parseSrt, parseVtt } from './caption-formats.ts';

export interface CaptionWord {
  text: string;
  start: number;
  end: number;
  /** Speaker label from diarized JSON (whisperX, AssemblyAI, Deepgram). */
  speaker?: string;
}

export interface Caption {
  /** 1-based position after parsing (cues are sorted by start; empty cues are dropped). */
  index: number;
  start: number;
  end: number;
  /** The cue's words on one line, whitespace collapsed, markup removed. */
  text: string;
  /** Display lines: as written in SRT/VTT, or balanced by breakLines. */
  lines: string[];
  /** One entry per whitespace-separated word of `text`, always with times (estimated when not wordsTimed). */
  words: CaptionWord[];
  /** Word times come from the source (VTT inline timestamps or word JSON), not estimated. */
  wordsTimed: boolean;
  /** VTT voice (<v Name>) or diarized speaker. */
  speaker?: string;
  /** VTT cue identifier. */
  id?: string;
}

export type CaptionFormat = 'srt' | 'vtt' | 'json';

export { parseSrt, parseVtt, parseWordJson, toSrt, toVtt } from './caption-formats.ts';
export { captionsFromWords, distributeWordTimes, readingIssues, reflow } from './caption-timing.ts';
export type { ReadingIssue, ReadingOptions, ReadingRule, WordGroupOptions } from './caption-timing.ts';
export { breakLines, lineCount } from './linebreak.ts';
export type { BreakOptions } from './linebreak.ts';
export { approxWidth, charCount } from './measure.ts';
export type { ApproxWidthOptions } from './measure.ts';

/** Guesses the format: a WEBVTT header, JSON, VTT-only markup (voices, inline timestamps), else SRT. */
export function sniffFormat(src: string): CaptionFormat {
  const s = src.replace(/^\ufeff/, '').trimStart();
  if (/^WEBVTT/.test(s)) return 'vtt';
  if (s.startsWith('{') || s.startsWith('[')) {
    try {
      JSON.parse(s);
      return 'json';
    } catch {
      // not JSON; fall through
    }
  }
  if (/<v[\s.][^>]*>|<(?:\d+:)?\d{1,2}:\d{1,2}\.\d+>/.test(s)) return 'vtt';
  return 'srt';
}

/** Parses SRT, VTT or word JSON (sniffed when `format` isn't given). Word JSON is grouped into cues. */
export function parseCaptions(src: string, format?: CaptionFormat): Caption[] {
  const f = format ?? sniffFormat(src);
  if (f === 'vtt') return parseVtt(src);
  if (f === 'json') return parseJsonCaptions(src);
  return parseSrt(src);
}

const EXTENSIONS: Record<string, CaptionFormat> = { '.srt': 'srt', '.vtt': 'vtt', '.webvtt': 'vtt', '.json': 'json' };

/** Reads a caption file; the format comes from the extension (.srt, .vtt, .json), else it is sniffed. */
export function loadCaptions(file: string): Caption[] {
  const src = readFileSync(file, 'utf8');
  return parseCaptions(src, EXTENSIONS[extname(file).toLowerCase()]);
}
