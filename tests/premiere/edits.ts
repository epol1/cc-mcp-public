// Edits on a hand-cut sequence (made with plain ExtendScript, as an editor would: clips, a dissolve, a Lumetri
// grade, a Premiere title): apply_cut_edits lands a new version in one undo step with the edits applied and the
// grade and title carried; the original is unchanged; undo removes the version.
import path from 'node:path';
import { lit, nativePath, runEs } from '@cc-mcp/pr-cut/bridge.ts';
import { applyCutEdits } from '@cc-mcp/pr-cut/edit.ts';
import { inspectSequenceRaw } from '@cc-mcp/pr-cut/inspect.ts';
import { journaled, undoLast } from '@cc-mcp/pr-cut/undo.ts';
import { check, done, SAMPLE, useTestProject } from './harness.ts';

await useTestProject();
const clips = [1, 2, 3, 5].map((n) => path.join(SAMPLE, `Sample Media Clip ${n}.mp4`));
// A "hand cut": 4 clips on V1 (2 s each), a dissolve into clip 2, Lumetri on clip 1, a Premiere title on V2.
const hand = await runEs<{ id: string }>(`
var TPF = 10594584000;
var files = ${lit(clips.map(nativePath))};
var bin = app.project.rootItem.createBin('hand cut media ' + new Date().getTime());
app.project.importFiles(files, true, bin, false);
qe.project.newSequence('Hand cut ' + new Date().getTime(), ${lit(nativePath('C:/Program Files/Adobe/Adobe Premiere Pro 2026/Settings/SequencePresets/HD 1080p/HD 1080p 23.976 fps.sqpreset'))});
var seq = app.project.activeSequence;
for (var i = 0; i < bin.children.numItems; i++) {
  var it = bin.children[i];
  it.setInPoint(String(48 * TPF), 4); it.setOutPoint(String(96 * TPF), 4);
  var t = new Time(); t.ticks = String(i * 48 * TPF);
  seq.videoTracks[0].overwriteClip(it, t);
  it.clearInPoint(); it.clearOutPoint();
}
var qs = qe.project.getActiveSequence(), qt = qs.getVideoTrackAt(0), clipsQ = [];
for (var k = 0; k < qt.numItems; k++) if (qt.getItemAt(k).type === 'Clip') clipsQ.push(qt.getItemAt(k));
clipsQ[0].addVideoEffect(qe.project.getVideoEffectByName('Lumetri Color'));
clipsQ[1].addTransition(qe.project.getVideoTransitionByName('Cross Dissolve'), true, '12', '0', 0.5, false, true);
var c0 = seq.videoTracks[0].clips[0];
for (var j = 0; j < c0.components.numItems; j++) if (c0.components[j].matchName === 'AE.ADBE Lumetri') c0.components[j].properties[19].setValue(0.7, true);
seq.importMGT(${lit(nativePath('C:/Program Files/Adobe/Adobe Premiere Pro 2026/Essential Graphics/Basic Title.mogrt'))}, String(24 * TPF), 1, 1);
prcJson({ id: seq.sequenceID });
`, { timeoutMs: 120_000 });
const orig = await inspectSequenceRaw(hand.id);
check('hand cut made', orig.clips.filter((c) => c.track === 'V1').length === 4 && orig.clips.some((c) => c.mgt));

const r = await journaled('apply_cut_edits', 'hand cut', async () => {
  const b = await applyCutEdits(hand.id, [
    { op: 'delete', target: 'V1/3' },
    { op: 'trim', target: 'V1/4', end: '-12f' },
    { op: 'move', target: 'V1/4', before: 'V1/2' },
    { op: 'grade', target: 'V1/2', temperature: 20 },
  ]);
  return { ...b, sequenceId: b.report.sequence?.id };
});
check('one undo step', r.report.undoSteps === 1, `${r.report.undoSteps}`);
const v = await inspectSequenceRaw(r.report.sequence!.id);
const tpf = v.timebase;
const v1 = v.clips.filter((c) => c.track === 'V1');
check('3 clips after delete', v1.length === 3, `${v1.length}`);
check('order: 1, 5 (moved, trimmed), 2', v1.map((c) => path.basename(c.media ?? '')).join(',') === 'Sample Media Clip 1.mp4,Sample Media Clip 5.mp4,Sample Media Clip 2.mp4', v1.map((c) => path.basename(c.media ?? '')).join(','));
check('trimmed clip is 36 frames', Math.round((v1[1].end - v1[1].start) / tpf) === 36, `${(v1[1].end - v1[1].start) / tpf}`);
check('no gaps on V1', v1.every((c, k) => !k || c.start === v1[k - 1].end));
check('grade carried (exposure 0.7) on clip 1', Math.abs((v1[0].lumetri?.exposure ?? 0) - 0.7) < 1e-6, JSON.stringify(v1[0].lumetri));
check('grade edit applied (temperature 20) on clip 2', Math.abs((v1[2].lumetri?.temperature ?? 0) - 20) < 1e-6, JSON.stringify(v1[2].lumetri));
check('title carried', v.clips.some((c) => c.mgt));
const origAfter = await inspectSequenceRaw(hand.id);
check('original untouched', JSON.stringify(origAfter.clips.map((c) => [c.track, c.start, c.end, c.inTicks])) === JSON.stringify(orig.clips.map((c) => [c.track, c.start, c.end, c.inTicks])));
const u = await undoLast();
check('undo removes the version', /^undone/.test(u), u);
done();
