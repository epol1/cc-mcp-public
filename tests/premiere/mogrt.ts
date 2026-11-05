// An ae-compose .mogrt in Premiere: build_cut places it as a title with its fields filled, Premiere holds the new
// values, the title gets its own track above the picture, and the frame shows both; a title added by an edit op
// lands on a new version on the next track up. Needs the fixture
// that tests/integration/mogrt/mogrt.ts exports from AE (pnpm test:ae); it is run first when the file is missing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { buildCut } from '@ae-mcp/pr-cut/build.ts';
import { applyCutEdits } from '@ae-mcp/pr-cut/edit.ts';
import { exportFrames } from '@ae-mcp/pr-cut/frames.ts';
import { runEs, lit } from '@ae-mcp/pr-cut/bridge.ts';
import { inspectSequenceRaw } from '@ae-mcp/pr-cut/inspect.ts';
import { fromTicksPerFrame } from '@ae-mcp/core/time/timecode.ts';
import { journaled } from '@ae-mcp/pr-cut/undo.ts';
import { check, done, ROOT, SAMPLE, TEST_DIR, useTestProject } from './harness.ts';

const FIXTURE = path.join(os.homedir(), '.ae-compose', 'test', 'AecMogrtLowerThird.mogrt');
if (!fs.existsSync(FIXTURE)) execFileSync(process.execPath, ['--import', 'tsx', 'tests/integration/mogrt/mogrt.ts'], { cwd: ROOT, stdio: 'inherit', timeout: 600_000 });
check('ae-compose mogrt fixture exists', fs.existsSync(FIXTURE), FIXTURE);

await useTestProject();
const plan = {
  name: `pr-cut mogrt test ${Date.now().toString(36)}`, media: { a: path.join(SAMPLE, 'Sample Media Clip 3.mp4') }, markers: false, jumpCuts: 'none',
  segments: [{ id: 's', src: 'a', from: 2, to: 9 }],
  titles: [{ mogrt: FIXTURE, at: { seg: 's', offset: '1s' }, duration: '5s', fields: { Name: 'Ana Ruiz', Role: 'FOUNDER' } }],
};
const b = await journaled('build_cut', plan.name, async () => { const r = await buildCut(plan, { sheet: false, strips: false }); return { ...r, sequenceId: r.report.sequence?.id }; });
const seq = b.report.sequence!.id;
check('every field found by name', !b.report.warnings.some((w) => /^title /.test(w)), b.report.warnings.join('; '));

const vals = await runEs<Record<string, string>>(`var s = prcSeq(${lit(seq)}), out = {};
for (var t = 0; t < s.videoTracks.numTracks; t++) for (var i = 0; i < s.videoTracks[t].clips.numItems; i++) {
  var mg = s.videoTracks[t].clips[i].getMGTComponent();
  if (mg) for (var k = 0; k < mg.properties.numItems; k++) out[mg.properties[k].displayName] = String(mg.properties[k].getValue());
}
prcJson(out)`);
check('Name holds the new value', /Ana Ruiz/.test(vals.Name ?? ''), JSON.stringify(vals));
check('Role holds the new value', /FOUNDER/.test(vals.Role ?? ''), JSON.stringify(vals));
check('the control is a field too', 'Accent Color' in vals, Object.keys(vals).join(', '));

// The title sits above the picture (V3 by default), the interview runs on underneath, and the frame shows both:
// accent-blue pixels in the lower left, picture detail in the top half (not an opaque template).
const s = await inspectSequenceRaw(seq);
const title = s.clips.find((c) => /AecMogrtLowerThird/.test(c.name));
check('the title is on its own track above the picture', !!title && title.track !== 'V1', title?.track);
check('the picture under it is untouched (one V1 clip)', s.clips.filter((c) => c.track === 'V1').length === 1, s.clips.filter((c) => c.track === 'V1').map((c) => c.name).join(', '));
const R = fromTicksPerFrame(s.timebase);
const fps = R.num / R.den;
const [on] = await exportFrames(seq, [Math.round(2.5 * fps)], R, path.join(TEST_DIR, 'mogrt', seq.slice(0, 8)));
const img = await sharp(on).resize(480, 270, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
let blue = 0;
const top: number[] = [];
for (let y = 0; y < 270; y++) for (let x = 0; x < 480; x++) {
  const i = (y * 480 + x) * 3, r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
  if (y > 160 && x < 240 && Math.abs(r - 70) < 30 && Math.abs(g - 131) < 30 && Math.abs(b - 196) < 30) blue++;
  if (y < 135) top.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
}
const mean = top.reduce((a, v) => a + v, 0) / top.length;
const sd = Math.sqrt(top.reduce((a, v) => a + (v - mean) ** 2, 0) / top.length);
console.log(`accent pixels ${blue}, top-half luma sd ${sd.toFixed(1)}; frame ${on}`);
check('the accent bar shows in the lower left', blue > 40, String(blue));
check('the picture shows through (the template is transparent)', sd > 15, sd.toFixed(1));
// A title added by an edit lands on a new version, on a new track above everything (V4 here), the first title and
// the picture carried as they were.
const e = await applyCutEdits(seq, [{ op: 'title', mogrt: FIXTURE, at: 4, duration: '2s', fields: { Name: 'Second Title', Role: 'EDIT' } }]);
const v = await inspectSequenceRaw(e.report.sequence!.id);
const titles = v.clips.filter((c) => /AecMogrtLowerThird/.test(c.name));
check('the edit adds the title on a new track', titles.length === 2 && titles.some((c) => c.track === 'V4'), titles.map((c) => c.track).join(', '));
check('no title warnings', !e.report.warnings.some((w) => /^title /.test(w)), e.report.warnings.join('; '));
check('the picture of the new version is untouched', v.clips.filter((c) => c.track === 'V1').length === 1);
done();
