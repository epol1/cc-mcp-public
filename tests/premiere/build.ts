// build_cut end to end in Premiere: a plan with quotes, sentences, tightening, B-roll and captions lands as a new
// sequence; the inspector reads back the planned pieces exactly; nothing is cut mid-word; undo removes the batch.
import path from 'node:path';
import { buildCut } from '@cc-mcp/pr-cut/build.ts';
import { inspectSequenceRaw } from '@cc-mcp/pr-cut/inspect.ts';
import { journaled, undoLast } from '@cc-mcp/pr-cut/undo.ts';
import { check, done, SAMPLE, testInterview, testProjectSequences, useTestProject } from './harness.ts';

await useTestProject();
const iv = testInterview();
const plan = {
  name: `pr-cut build test ${Date.now().toString(36)}`,
  media: { iv, skate: path.join(SAMPLE, 'Sample Media Clip 1.mp4') },
  segments: [
    { id: 'hook', src: 'iv', quote: 'we built the whole launch around that idea', beat: 'hook' },
    { id: 'proof', src: 'iv', sentences: ['s1', 's2'], beat: 'proof' },
    { id: 'close', src: 'iv', sentences: 's4', beat: 'close', transition: 'dissolve' },
  ],
  broll: [{ src: 'skate', over: 'proof/3' }],
  grade: { '*': { contrast: 10 } },
  captions: true,
};
const r = await journaled('build_cut', plan.name, async () => { const b = await buildCut(plan, { strips: false }); return { ...b, sequenceId: b.report.sequence?.id }; });
const { report, compiled } = r;
check('sequence created', !!report.sequence?.id, report.sequence?.name);
check('import is one undo step + 2 for captions', report.undoSteps === 3, `${report.undoSteps}`);
check('quote matched exactly', report.segments[0].match?.score === 1, JSON.stringify(report.segments[0].match));
check('fillers and repeats removed', compiled.stats.removed.fillers >= 2 && compiled.stats.removed.repeats >= 3, JSON.stringify(compiled.stats.removed));
check('no lint errors', !report.lint.some((l) => l.startsWith('error')), report.lintSummary);
check('contact sheet', !!report.contactSheet);
const s = await inspectSequenceRaw(report.sequence!.id);
const tpf = s.timebase;
const v1 = s.clips.filter((c) => c.track === 'V1');
check('V1 pieces = planned pieces', v1.length === compiled.pieces.length, `${v1.length} vs ${compiled.pieces.length}`);
const exact = compiled.pieces.every((p, k) => v1[k] && Math.round(v1[k].start / tpf) === p.start && Math.round(v1[k].end / tpf) === p.end && Math.abs(v1[k].inTicks / 254016000000 - p.inS) < 1e-6);
check('every piece edge exact in Premiere', exact);
check('B-roll on V2', s.clips.some((c) => c.track === 'V2'));
check('dissolve into close', s.transitions.some((t) => t.track === 'V1' && /Dissolve/.test(t.name)));
check('segment markers', s.markers.map((m) => m.name).join(',') === 'hook,proof,close', s.markers.map((m) => m.name).join(','));
const before = await testProjectSequences();
const u = await undoLast();
const after = await testProjectSequences();
check('undo reverts the whole build in one call', /^undone/.test(u) && after === before - 1, `${u} (${before} → ${after} sequences)`);
done();
