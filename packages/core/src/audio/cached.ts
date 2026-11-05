// Beat analysis cached by the music file's content hash under ~/.ae-compose/beats (pr-cut montages and snapping,
// the media library's tempo). ae-compose scenes use their own synchronous cache (src/dsl/beats.ts).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyzeBeats, type BeatAnalysis } from './beats.ts';
import { mediaHash } from '../transcribe/index.ts';

const DIR = path.join(os.homedir(), '.ae-compose', 'beats');

export async function beatsCached(file: string): Promise<BeatAnalysis> {
  const f = path.join(DIR, `${mediaHash(file)}.json`);
  try { return { ...JSON.parse(fs.readFileSync(f, 'utf8')), file }; } catch { /* not cached */ }
  const a = await analyzeBeats(file);
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ ...a, onsets: [] }));
  return a;
}
