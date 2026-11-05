// Synthetic transcript words for pr-cut and transcript specs.
import type { Word } from '@ae-mcp/core/transcribe/types.ts';

/** Words from "text" with a 0.3 s word and a 0.1 s gap; "|" inserts a 1.5 s pause. */
export function words(text: string): Word[] {
  const out: Word[] = [];
  let t = 0;
  for (const tok of text.split(' ')) {
    if (tok === '|') { t += 1.4; continue; }
    out.push({ i: out.length, text: tok, start: t, end: t + 0.3, p: 0.9 });
    t += 0.4;
  }
  return out;
}
