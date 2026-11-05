// Premiere round trip (needs Premiere + the pr-cut bridge): a Timeline written as FCP7 XML and imported must read
// back with every clip edge within one frame (exact in ticks), plus transitions, grade, motion, levels, markers,
// and exactly one undo step. Run: npx tsx tests/integration/pr/roundtrip.ts [fps]
import path from 'node:path';
import { probe } from '@ae-mcp/core/media/probe.ts';
import { framesToTicks, rate, secondsToFrames, ticksPerFrame } from '@ae-mcp/core/time/timecode.ts';
import { importTimeline } from '@ae-mcp/pr-cut/importxml.ts';
import { inspectSequenceRaw } from '@ae-mcp/pr-cut/inspect.ts';
import type { Timeline } from '@ae-mcp/pr-cut/timeline.ts';

const SAMPLE = 'C:/Users/Public/Documents/Adobe/Premiere Pro/26.0/Sample Media';
const fpsArg = process.argv[2] ?? '23.976';
const R = rate(fpsArg);
const tpf = ticksPerFrame(R);
let fails = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); if (!ok) fails++; };

const media: Timeline['media'] = {};
for (const n of [1, 2, 3, 5]) media[`c${n}`] = await probe(path.join(SAMPLE, `Sample Media Clip ${n}.mp4`));
const src = (s: number) => framesToTicks(secondsToFrames(s, R), R); // source seconds → ticks on the sequence frame grid

const t: Timeline = {
  name: `pr-cut roundtrip ${fpsArg}`, rate: R, width: 1920, height: 1080, media,
  clips: [
    { id: 'seg1', media: 'c1', vTrack: 1, aTrack: 1, start: 0, end: secondsToFrames(3, R), inTicks: src(2), outTicks: src(2) + secondsToFrames(3, R) * tpf, grade: { exposure: 0.4, temperature: -8, saturation: 110 } },
    { id: 'seg2', media: 'c2', vTrack: 1, aTrack: 1, start: secondsToFrames(3, R), end: secondsToFrames(6, R), inTicks: src(4), outTicks: src(4) + secondsToFrames(3, R) * tpf, transitionIn: { kind: 'dissolve', frames: 12 }, level: -6, levelKeys: [{ frame: secondsToFrames(4, R), db: -6 }, { frame: secondsToFrames(5, R), db: -20 }] },
    { id: 'seg3', media: 'c3', vTrack: 1, aTrack: 1, start: secondsToFrames(6, R), end: secondsToFrames(9, R), inTicks: src(1), outTicks: src(1) + secondsToFrames(3, R) * tpf, motion: { scale: 115, center: [0.05, -0.05] } },
    { id: 'b1', media: 'c5', vTrack: 2, start: secondsToFrames(1, R), end: secondsToFrames(2.5, R), inTicks: src(3), outTicks: src(3) + (secondsToFrames(2.5, R) - secondsToFrames(1, R)) * tpf },
  ],
  markers: [{ frame: 0, name: 'seg1', comment: 'hook' }, { frame: secondsToFrames(3, R), name: 'seg2', comment: 'proof' }],
};

const res = await importTimeline(t);
console.log(`imported ${res.name} (${res.sequenceId}) in ${res.undoSteps} undo step(s); xml ${res.xmlFile}`);
check('one undo step', res.undoSteps === 1, `${res.undoSteps}`);
const s = await inspectSequenceRaw(res.sequenceId);
check('sequence timebase', s.timebase === tpf, `${s.timebase} vs ${tpf}`);
check('frame size', s.width === 1920 && s.height === 1080, `${s.width}x${s.height}`);

const v1 = s.clips.filter((c) => c.track === 'V1');
const want = t.clips.filter((c) => c.vTrack === 1);
check('V1 clip count', v1.length === want.length, `${v1.length}`);
for (let k = 0; k < want.length; k++) {
  const w = want[k], g = v1[k];
  if (!g) continue;
  const dStart = Math.abs(g.start - w.start * tpf) / tpf, dEnd = Math.abs(g.end - w.end * tpf) / tpf, dIn = Math.abs(g.inTicks - w.inTicks) / tpf;
  check(`${w.id} edges exact`, dStart === 0 && dEnd === 0 && dIn === 0, `Δstart ${dStart} Δend ${dEnd} Δin ${dIn} frames`);
  check(`${w.id} media`, path.basename(g.media ?? '') === media[w.media].name, g.media);
}
const g1 = v1[0]?.lumetri;
check('seg1 grade', !!g1 && Math.abs(g1.exposure - 0.4) < 1e-6 && Math.abs(g1.temperature + 8) < 1e-6 && Math.abs(g1.saturation - 110) < 1e-6, JSON.stringify(g1));
check('seg3 punch-in', v1[2]?.scale === 115 && Math.abs((v1[2]?.position?.[0] ?? 0) - 0.55) < 1e-6 && Math.abs((v1[2]?.position?.[1] ?? 0) - 0.45) < 1e-6, `${v1[2]?.scale} ${v1[2]?.position}`);
const tr = s.transitions.filter((x) => x.track === 'V1');
check('dissolve centred on seg2', tr.length === 1 && Math.abs(tr[0].start / tpf - (secondsToFrames(3, R) - 6)) < 0.01 && Math.abs(tr[0].end / tpf - (secondsToFrames(3, R) + 6)) < 0.01, JSON.stringify(tr.map((x) => [x.name, x.start / tpf, x.end / tpf])));
const a1 = s.clips.filter((c) => c.track === 'A1');
check('A1 linked audio', a1.length === 3, `${a1.length}`);
check('seg2 level', a1[1] && Math.abs((a1[1].volumeDb ?? 0) + 6) < 0.05, `${a1[1]?.volumeDb}`);
const b = s.clips.filter((c) => c.track === 'V2');
check('B-roll on V2', b.length === 1 && b[0].start / tpf === secondsToFrames(1, R) && b[0].end / tpf === secondsToFrames(2.5, R), JSON.stringify(b.map((x) => [x.start / tpf, x.end / tpf])));
check('B-roll has no audio', s.clips.filter((c) => /Clip 5/.test(c.name) && c.track.startsWith('A')).length === 0);
check('markers', s.markers.length === 2 && s.markers[1].name === 'seg2' && s.markers[1].start / tpf === secondsToFrames(3, R), JSON.stringify(s.markers.map((m) => [m.name, m.start / tpf])));
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exitCode = fails ? 1 : 0;
