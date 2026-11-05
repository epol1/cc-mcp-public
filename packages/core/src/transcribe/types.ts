// Transcript records shared by the media library, pr-cut and ae-compose captions. Times are seconds in the media.

export interface Word {
  /** Index in the transcript's word list: edit plans address ranges of words by these. */
  i: number;
  text: string;
  start: number;
  end: number;
  /** Recognizer confidence 0–1. */
  p: number;
  speaker?: string;
  /** Filler ("um", "uh", "you know" …) or the first half of a repeat ("we, we built"). */
  filler?: 'filler' | 'repeat';
  /** Start/end as the recognizer gave them, before refinement against the audio. */
  raw?: [number, number];
}

export interface Sentence { id: string; from: number; to: number; start: number; end: number; text: string; speaker?: string }

export interface Pause { after: number; start: number; end: number }

export interface Transcript {
  media: string;
  /** Content hash of the media (identity that survives renames). */
  hash: string;
  duration: number;
  engine: string;
  model?: string;
  language?: string;
  words: Word[];
  sentences: Sentence[];
  /** Gaps between words longer than the pause threshold. */
  pauses: Pause[];
  /** Word boundaries were snapped to audio energy (see refine.ts). */
  refined?: boolean;
  createdAt: string;
}
