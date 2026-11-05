// match_shots in Premiere: the same shot twice, the second deliberately mis-graded (brighter, warmer, more
// saturated); matching it to the first brings its frame statistics back close to the reference, as a new version.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { buildCut } from '@cc-mcp/pr-cut/build.ts';
import { matchShots } from '@cc-mcp/pr-cut/finish.ts';
import { exportFrames } from '@cc-mcp/pr-cut/frames.ts';
import { inspectSequenceRaw } from '@cc-mcp/pr-cut/inspect.ts';
import { fromTicksPerFrame } from '@cc-mcp/core/time/timecode.ts';
import { journaled } from '@cc-mcp/pr-cut/undo.ts';
import { check, done, SAMPLE, TEST_DIR, useTestProject } from './harness.ts';

await useTestProject();
const clip = path.join(SAMPLE, 'Sample Media Clip 3.mp4');
const plan = {
  name: `pr-cut match test ${Date.now().toString(36)}`, media: { a: clip }, markers: false, jumpCuts: 'none',
  segments: [
    { id: 'ref', src: 'a', from: 2, to: 4 },
    { id: 'off', src: 'a', from: 2, to: 4, grade: { exposure: 1.2, temperature: 40, saturation: 140 } },
  ],
};
const b = await journaled('build_cut', plan.name, async () => { const r = await buildCut(plan, { sheet: false, strips: false }); return { ...r, sequenceId: r.report.sequence?.id }; });
const seq = b.report.sequence!.id;

async function stats(seqId: string) {
  const s = await inspectSequenceRaw(seqId);
  const R = fromTicksPerFrame(s.timebase);
  const v1 = s.clips.filter((c) => c.track === 'V1');
  const files = await exportFrames(seqId, v1.map((c) => Math.round((c.start + c.end) / 2 / s.timebase)), R, path.join(TEST_DIR, 'match', seqId.slice(0, 8)));
  const out = [];
  for (const f of files) {
    const { data, info } = await sharp(f).resize(320).raw().toBuffer({ resolveWithObject: true });
    let r = 0, g = 0, bl = 0, n = 0;
    for (let i = 0; i < data.length; i += info.channels) { r += data[i]; g += data[i + 1]; bl += data[i + 2]; n++; }
    out.push({ r: r / n, g: g / n, b: bl / n, luma: (0.2126 * r + 0.7152 * g + 0.0722 * bl) / n });
  }
  return out;
}
const before = await stats(seq);
const dist = (x: typeof before[0], y: typeof before[0]) => Math.abs(x.luma - y.luma) + Math.abs((x.r - x.b) - (y.r - y.b));
const d0 = dist(before[0], before[1]);
const m = await matchShots(seq, 'V1/1', ['V1/2']);
const after = await stats(m.report!.sequence!.id);
const d1 = dist(after[0], after[1]);
console.log(m.summary.split('\n').slice(0, 2).join(' | '));
check('mismatch is visible before', d0 > 30, d0.toFixed(1));
check('matched shot is much closer to the reference', d1 < d0 * 0.35, `${d0.toFixed(1)} → ${d1.toFixed(1)}`);
check('reference untouched in the new version', Math.abs(after[0].luma - before[0].luma) < 1, `${before[0].luma.toFixed(1)} vs ${after[0].luma.toFixed(1)}`);
check('original sequence unchanged', Math.abs((await stats(seq))[1].luma - before[1].luma) < 1);
void fs;
done();
