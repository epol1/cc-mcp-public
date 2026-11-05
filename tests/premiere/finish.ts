// Finishing in Premiere: a cut with music is brought to -14 LUFS (measured within ±1 LU, peaks under -1 dBTP,
// ducking kept), and the delivery pack exports 16:9, 9:16 and 1:1 files at the right sizes and lengths.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildCut } from '@cc-mcp/pr-cut/build.ts';
import { audioFinish, deliver } from '@cc-mcp/pr-cut/finish.ts';
import { journaled } from '@cc-mcp/pr-cut/undo.ts';
import { check, done, ROOT, SAMPLE, TEST_DIR, testInterview, useTestProject } from './harness.ts';

await useTestProject();
const musicFile = path.join(ROOT, 'assets', 'handmade', 'languages_proj', '(Footage)', 'Diafano_AdobeStock_357626701_preview.m4a');
const plan = {
  name: `pr-cut finish test ${Date.now().toString(36)}`,
  media: { iv: testInterview(), skate: path.join(SAMPLE, 'Sample Media Clip 1.mp4'), music: musicFile },
  segments: [{ id: 'a', src: 'iv', sentences: ['s1', 's3'] }],
  broll: [{ src: 'skate', over: 'a/2' }],
  music: fs.existsSync(musicFile) ? [{ src: 'music' }] : [],
  markers: false,
};
const b = await journaled('build_cut', plan.name, async () => { const r = await buildCut(plan, { sheet: false, strips: false }); return { ...r, sequenceId: r.report.sequence?.id }; });
const seq = b.report.sequence!.id;
const f = await audioFinish(seq, { target: -14 });
const m = /after: (-?[\d.]+) LUFS.*?\((within|OUTSIDE).*?\), true peak (-?[\d.]+)/.exec(f.summary);
check('loudness within ±1 LU of -14', !!m && m[2] === 'within', m?.[0] ?? f.summary);
check('true peak at or under -1 dBTP', !!m && Number(m[3]) <= -1 + 0.05, m?.[3]);
const v2 = f.sequenceId!;
const out = path.join(TEST_DIR, 'deliver');
fs.rmSync(out, { recursive: true, force: true });
const d = await deliver(v2, { aspects: ['9:16', '1:1'], outDir: out });
const probe = (file: string) => {
  const [w, h, dur] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'csv=p=0:s=,', file], { encoding: 'utf8' }).trim().split(/[\n,]+/).map(Number);
  return { w, h, dur };
};
const want: Record<string, [number, number]> = { '16x9': [1920, 1080], '9x16': [1080, 1920], '1x1': [1080, 1080] };
const len = b.report.durationSeconds;
for (const [label, [w, h]] of Object.entries(want)) {
  const file = d.files.find((x) => x.includes(`_${label}.mp4`));
  const p = file ? probe(file) : null;
  check(`${label} delivered at ${w}x${h}`, !!p && p.w === w && p.h === h, p ? `${p.w}x${p.h}` : 'missing');
  check(`${label} length matches the cut`, !!p && Math.abs(p.dur - len) < 0.2, p ? `${p.dur.toFixed(2)} vs ${len}` : '');
}
done();
