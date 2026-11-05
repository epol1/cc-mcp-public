// A5 in AE: beatsOf() analyzes the track, BeatMarkers writes the grid as comp markers, scenes built from bars start on
// downbeats, a ripple with snap: 'beats' ends the edited scene on a beat and leaves the beat markers where they are,
// and the off-beat lint rule catches an element entering 70 ms after a beat.
import { applyEdits, buildScene } from '../../../src/api/index.ts';
import { buildUndoCheck, check, done, es, findComp } from './harness.ts';

const FILE = 'tests/integration/beats-scene.tsx', COMP = 'BeatTest_v001', C = findComp(COMP);
await buildUndoCheck('beat scene build', FILE, COMP, { frames: 0 });
const r = await buildScene({ file: FILE }, { frames: 0 });
check('builds with the track', r.ok, r.error ?? '');
const markers = JSON.parse(await es(`var m = ${C}.markerProperty, o = []; for (var k = 1; k <= m.numKeys; k++) o.push('{"t":' + m.keyTime(k) + ',"c":"' + m.keyValue(k).comment + '","d":' + m.keyValue(k).duration + '}'); "[" + o.join(",") + "]"`));
const beats = markers.filter((m: any) => m.c === 'beat' || /^bar \d+$/.test(m.c)).map((m: any) => m.t);
const scenes = markers.filter((m: any) => m.d > 0);
check('beat and bar markers are on the comp (~105 BPM → 15–20 in 10 s)', beats.length >= 15 && beats.length <= 20, `${beats.length}`);
const onBeat = (t: number) => beats.some((b: number) => Math.abs(b - t) < 1 / 30 + 1e-3);
check('the second scene starts on a beat', scenes.length === 2 && onBeat(scenes[1].t), JSON.stringify(scenes));
check('no off-beat warnings on the grid-aligned build', !(r.motion?.[0]?.style ?? []).some((i) => i.rule === 'off-beat'));
const e = await applyEdits({ comp: COMP, ops: [{ op: 'ripple', scene: 'Intro', by: 0.4, where: 'end', snap: 'beats' } as any] }, { frames: 0, motion: false, lint: false });
check('ripple with snap: beats succeeds', !!e.ok, e.error ?? '');
const after = JSON.parse(await es(`var m = ${C}.markerProperty, o = []; for (var k = 1; k <= m.numKeys; k++) o.push('{"t":' + m.keyTime(k) + ',"c":"' + m.keyValue(k).comment + '","d":' + m.keyValue(k).duration + '}'); "[" + o.join(",") + "]"`));
const beats2 = after.filter((m: any) => m.c === 'beat' || /^bar \d+$/.test(m.c)).map((m: any) => m.t);
check('beat markers did not move with the ripple', beats2.length === beats.length && beats2.every((t: number, i: number) => Math.abs(t - beats[i]) < 1e-3));
const drop = after.find((m: any) => m.c === 'Drop');
check('the edited scene now ends on a beat (the next one starts on it)', !!drop && onBeat(drop.t), JSON.stringify(drop));
const late = await buildScene({ file: FILE }, { frames: 0, params: { offbeat: true } });
check('off-beat lint flags an entrance 70 ms after a beat', (late.motion?.[0]?.style ?? []).some((i) => i.rule === 'off-beat'), (late.motion?.[0]?.lines ?? []).join(' | '));
done();
