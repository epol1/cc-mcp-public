// `node --import tsx src/audio/cli.ts <file> [json opts]`: prints a BeatAnalysis as JSON (onsets dropped). Scenes
// call it synchronously through beatsOf() (src/dsl/beats.ts), which caches the result next to the audio.
import { analyzeBeats } from './beats.ts';

const [file, opts] = process.argv.slice(2);
const a = await analyzeBeats(file, opts ? JSON.parse(opts) : {});
process.stdout.write(JSON.stringify({ ...a, onsets: a.onsets.filter((o) => o.strength > 0.5).slice(0, 2000) }));
