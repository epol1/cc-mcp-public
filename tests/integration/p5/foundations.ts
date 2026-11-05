// F1/F2 in AE: library calls evaluate, rig-effect params drive expressions live, grouped controls are one effect,
// lint reads rig-effect refs, sticky rig values survive a rebuild, and each build undoes in one step.
import { buildScene, lintComp, undo } from '../../../src/api/index.ts';
import { buildUndoCheck, check, done, es, findComp, fingerprint } from './harness.ts';

const FILE = 'tests/integration/foundations-scene.tsx';
const COMP = 'FoundationsTest_v001';
const C = findComp(COMP);

await buildUndoCheck('foundations build', FILE, COMP);
const r = await buildScene({ file: FILE }, { frames: 0, resetControls: true });
check('rebuild after undo', r.ok, r.error ?? '');

const fx = await es(`var c = ${C}; var o = []; var e = c.layer("Controls").property("ADBE Effect Parade"); for (var i = 1; i <= e.numProperties; i++) o.push(e.property(i).name + ":" + e.property(i).matchName.split(" ")[0]); o.join(",")`);
check('grouped controls are one rig effect on Controls', fx === 'Title:Pseudo/Title', fx);
const rot = async () => +(await es(`${C}.layer("Shape").property("ADBE Transform Group").property("ADBE Rotate Z").valueAtTime(1, false)`));
check('rig effect drives the expression (Speed 90 → 90°/s)', Math.abs((await rot()) - 90) < 1e-6, String(await rot()));
await es(`app.beginUndoGroup("test tweak"); var fx = ${C}.layer("Shape").property("ADBE Effect Parade").property("Spinner"); fx.property("Speed").setValue(45); fx.property("Reverse").setValue(1); ${C}.layer("Controls").property("ADBE Effect Parade").property("Title").property("Delay").setValue(0.8); app.endUndoGroup(); "ok"`);
check('changing rig params in AE retimes live (Speed 45, Reverse → −45°)', Math.abs((await rot()) + 45) < 1e-6, String(await rot()));

const lint = await lintComp(COMP, { frames: 0 });
check('lint reads grouped control refs (delay 0.8 after the tweak)', lint.ok, lint.error ?? '');

const before = await fingerprint(COMP);
const r2 = await buildScene({ file: FILE }, { frames: 0 });
check('sticky: rebuild keeps the AE tweaks', r2.ok && r2.restoredControls >= 3, `restored ${r2.restoredControls}`);
check('sticky: rotation still −45° after the rebuild', Math.abs((await rot()) + 45) < 1e-6, String(await rot()));
const u = await undo(r2.undoSteps ?? 1);
check('undo of the rebuild', !!u.ok, u.error ?? '');
check('one undo restores the tweaked comp exactly', (await fingerprint(COMP)) === before);

// Live text reveal: one "Reveal (chars)" effect on the text layer drives the selector.
const rev = await es(`var e = ${C}.layer("short, readable, live").property("ADBE Effect Parade").property("Reveal (chars)"); e ? [e.property("Each").value, e.property("Duration").value, e.property("Delay").value].join(",") : "none"`);
// Rig sliders store float32 values (0.02 reads back as 0.0199999996).
const near = (got: string, want: number[]) => { const g = got.split(',').map(Number); return g.length === want.length && g.every((v, i) => Math.abs(v - want[i]) < 1e-5); };
check('live text reveal exposes Each/Duration/Delay', near(rev, [0.02, 0.5, 0.8]), rev);

// Camera move rig: one "Camera Move" effect on the move null; Travel Y drives the move live.
const RIG = 'RigTest_v001', R = findComp(RIG);
await buildUndoCheck('camera rig build', 'tests/integration/rigs-scene.tsx', RIG, { frames: 0 });
await buildScene({ file: 'tests/integration/rigs-scene.tsx' }, { frames: 0, resetControls: true });
const movePos = async (t: number) => (await es(`${R}.layer("Camera Move").property("ADBE Transform Group").property("ADBE Position").valueAtTime(${t}, false).join(",")`)).split(',').map(Number);
const cm = await es(`var e = ${R}.layer("Camera Move").property("ADBE Effect Parade").property("Camera Move"); [e.property("Travel Y").value, e.property("Delay").value, e.property("Duration").value, e.property("Shake Amount").value].join(",")`);
check('camera move rig holds travel/delay/duration/shake', near(cm, [-350, 0.4, 3, 4]), cm);
const end = await movePos(3.9);
check('move reaches its travel at the end', Math.abs(end[1] + 350) < 0.01, end.join(','));
check('move eases (still at rest before the delay)', Math.abs((await movePos(0.2))[1]) < 1e-6);
await es(`app.beginUndoGroup("tweak"); ${R}.layer("Camera Move").property("ADBE Effect Parade").property("Camera Move").property("Travel Y").setValue(-500); app.endUndoGroup(); "ok"`);
check('changing Travel Y retimes the move live', Math.abs((await movePos(3.9))[1] + 500) < 0.01);
done();
