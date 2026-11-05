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
import { check, done, ROOT, SAMPLE, TEST_DIR, testInterview, useTestProject } from './harness.ts';

const FIXTURE = path.join(os.homedir(), '.ae-compose', 'test', 'AecMogrtLowerThird.mogrt');
const KARAOKE = path.join(os.homedir(), '.ae-compose', 'test', 'AecKaraokeCaption.mogrt');
if (!fs.existsSync(FIXTURE) || !fs.existsSync(KARAOKE)) execFileSync(process.execPath, ['--import', 'tsx', 'tests/integration/mogrt/mogrt.ts'], { cwd: ROOT, stdio: 'inherit', timeout: 600_000 });
check('ae-compose mogrt fixtures exist', fs.existsSync(FIXTURE) && fs.existsSync(KARAOKE), FIXTURE);

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
const carried = await runEs<string[]>(`var s = prcSeq(${lit(e.report.sequence!.id)}), out = [];
for (var t = 0; t < s.videoTracks.numTracks; t++) for (var i = 0; i < s.videoTracks[t].clips.numItems; i++) {
  var mg = s.videoTracks[t].clips[i].getMGTComponent();
  if (mg) for (var k = 0; k < mg.properties.numItems; k++) if (mg.properties[k].displayName === 'Name') out.push(String(mg.properties[k].getValue()));
}
prcJson(out)`);
check('the carried title keeps its text', carried.includes('Ana Ruiz') && carried.includes('Second Title'), JSON.stringify(carried));
// Karaoke captions: one ae-compose caption template per caption on its own track, text and word times filled in from
// the cut's words, back to back, and the frame shows a partly lit line at the bottom centre.
const kplan = { name: `pr-cut karaoke test ${Date.now().toString(36)}`, media: { iv: testInterview() }, markers: false, segments: [{ id: 'a', src: 'iv', sentences: ['s1', 's2'] }], captions: { mogrt: KARAOKE } };
const kb = await journaled('build_cut', kplan.name, async () => { const r = await buildCut(kplan, { sheet: false, strips: false }); return { ...r, sequenceId: r.report.sequence?.id }; });
const kseq = kb.report.sequence!.id;
check('no caption warnings', !kb.report.warnings.some((w) => /^captions/.test(w)), kb.report.warnings.join('; '));
const ks = await inspectSequenceRaw(kseq);
const caps = ks.clips.filter((c) => /AecKaraokeCaption/.test(c.name)).sort((a, b) => a.start - b.start);
check('one template per caption on its own track', caps.length >= 2 && new Set(caps.map((c) => c.track)).size === 1 && caps[0].track !== 'V1', `${caps.length} on ${[...new Set(caps.map((c) => c.track))].join(',')}`);
check('back to back, no overlaps', caps.every((c, i) => i === 0 || c.start >= caps[i - 1].end));
const kvals = await runEs<{ caption: string; times: string }[]>(`var s = prcSeq(${lit(kseq)}), out = [];
for (var t = 0; t < s.videoTracks.numTracks; t++) for (var i = 0; i < s.videoTracks[t].clips.numItems; i++) {
  var mg = s.videoTracks[t].clips[i].getMGTComponent(), o = {};
  if (!mg) continue;
  for (var k = 0; k < mg.properties.numItems; k++) o[mg.properties[k].displayName] = String(mg.properties[k].getValue());
  if (o['Word Times'] !== undefined) out.push({ caption: o['Caption'], times: o['Word Times'] });
}
prcJson(out)`);
const wordsMatch = kvals.every((v) => v.caption.split(/\s+/).filter(Boolean).length === v.times.split(' ').length);
check('each caption has its text and one time per word', kvals.length === caps.length && wordsMatch, JSON.stringify(kvals.slice(0, 2)));
check('word times start at 0 and rise', kvals.every((v) => { const t = v.times.split(' ').map(Number); return t[0] < 0.3 && t.every((x, i) => i === 0 || x >= t[i - 1]); }), kvals[0]?.times);
const KR = fromTicksPerFrame(ks.timebase);
const kfps = KR.num / KR.den;
const c0 = caps[0];
const mid = Math.round((c0.start + (c0.end - c0.start) * 0.45) / ks.timebase);
const [kf] = await exportFrames(kseq, [mid], KR, path.join(TEST_DIR, 'mogrt', kseq.slice(0, 8)));
const kimg = await sharp(kf).resize(960, 540, { fit: 'fill' }).removeAlpha().raw().toBuffer();
let hl = 0, white = 0;
// Over the test pattern's blue bar only (x 960–1230 at full size), where neither the pattern nor its moving line is yellow or white.
for (let y = 415; y < 495; y++) for (let x = 482; x < 612; x++) {
  const i = (y * 960 + x) * 3, r = kimg[i], g = kimg[i + 1], b = kimg[i + 2];
  if (r > 220 && g > 180 && b < 110) hl++;
  if (r > 235 && g > 235 && b > 235) white++;
}
console.log(`caption frame at ${(mid / kfps).toFixed(2)} s: ${hl} lit, ${white} white px; ${kf}`);
check('mid-caption the line is partly lit (highlight and plain words)', hl > 100 && white > 100, `${hl} lit, ${white} white`);
// An edit (deleting the first piece) rebuilds the caption templates from the new cut's words; the old ones are not
// carried as well.
const ke = await applyCutEdits(kseq, [{ op: 'delete', target: 'V1/1' }]);
const kv = await inspectSequenceRaw(ke.report.sequence!.id);
const caps2 = kv.clips.filter((c) => /AecKaraokeCaption/.test(c.name)).sort((a, b) => a.start - b.start);
check('the edited version has one set of captions', caps2.length >= 2 && caps2.every((c, i) => i === 0 || c.start >= caps2[i - 1].end), caps2.map((c) => `${c.track}@${c.start}`).join(' '));
const first = await runEs<string>(`var s = prcSeq(${lit(ke.report.sequence!.id)}), best = null, txt = '';
for (var t = 0; t < s.videoTracks.numTracks; t++) for (var i = 0; i < s.videoTracks[t].clips.numItems; i++) {
  var c = s.videoTracks[t].clips[i], mg = c.getMGTComponent();
  if (!mg) continue;
  for (var k = 0; k < mg.properties.numItems; k++) if (mg.properties[k].displayName === 'Caption' && (best === null || c.start.seconds < best)) { best = c.start.seconds; txt = String(mg.properties[k].getValue()); }
}
txt`, { json: false });
check('the first caption follows the edit', first.length > 0 && first !== kvals[0].caption, `${JSON.stringify(first)} (was ${JSON.stringify(kvals[0].caption)})`);
done();
