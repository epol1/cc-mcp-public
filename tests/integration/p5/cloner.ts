// P1/P2 in AE: a cloner builds N instances of one master (duplicated in AE), positions follow the library maths
// exactly, Seed/Speed/falloff are live on the "Cloner" effect, data labels and the palette reach the master's
// fields, editing the master changes every instance, lint skips the instances, and the build undoes in one step.
import { buildScene } from '../../../src/api/index.ts';
import { libObject } from '../../../src/aeclib/index.ts';
import { buildUndoCheck, check, done, es, findComp } from './harness.ts';

const FILE = 'tests/integration/cloner-scene.tsx';
const COMP = 'ClonerTest_v001', C = findComp(COMP);
const N = 24;
const params = { count: N, labels: true, palette: true };
const L = libObject();

await buildUndoCheck('cloner build', FILE, COMP, { frames: 4, params });
const r = await buildScene({ file: FILE }, { frames: 0, lint: true, params, resetControls: true });
check('rebuild', r.ok, r.error ?? '');
check('lint skips the instances (no per-card reading-time noise)', !!r.lint?.[0]?.ok && r.lint[0].texts === 0, `${r.lint?.[0]?.texts} texts`);

const names = (await es(`var c=${C}, o=[]; for (var i=1;i<=c.numLayers;i++) o.push(c.layer(i).name); o.join("|")`)).split('|');
const inst = names.filter((n) => /^Cards \d{3}$/.test(n));
check(`${N} instances named Cards 001…${N}`, inst.length === N && names.includes('Cards 001') && names.includes(`Cards 0${N}`), inst.slice(0, 3).join(','));
check('controller sits directly above the instances, instance 1 at the bottom', names[0] === 'Cards' && names[1] === `Cards 0${N}` && names[N] === 'Cards 001', names.slice(0, 3).join(','));

// Position of instance k (no motion at t = inPoint, noise frozen at speed 0 → compare at time 0 with Noise Speed 0).
await es(`app.beginUndoGroup("test"); var e=${C}.layer("Cards").property("ADBE Effect Parade").property("Cloner"); e.property("Noise Speed").setValue(0); e.property("Speed").setValue(0); e.property("Position Random").setValue(0); app.endUndoGroup(); "ok"`);
const pos = async (k: number) => (await es(`${C}.layer("Cards ${String(k).padStart(3, '0')}").property("ADBE Transform Group").property("ADBE Position").valueAtTime(0, false).join(",")`)).split(',').map(Number);
const a0 = (await es(`${C}.layer("Cards").property("ADBE Transform Group").property("ADBE Anchor Point").value.join(",")`)).split(',').map(Number);
const want = (k: number, seed = 7) => { const p = L.scatter(k - 1, N, 2400, 760, seed, 0.9); return [a0[0] + p[0], a0[1] + p[1]]; }; // parent (controller null) space
const p5 = await pos(5);
check('instance 5 sits where L.scatter puts index 4 (parent space)', Math.hypot(p5[0] - want(5)[0], p5[1] - want(5)[1]) < 0.01, `${p5} vs ${want(5)}`);
await es(`app.beginUndoGroup("test"); ${C}.layer("Cards").property("ADBE Effect Parade").property("Cloner").property("Seed").setValue(11); app.endUndoGroup(); "ok"`);
const p5b = await pos(5);
check('changing Seed reshuffles live', Math.hypot(p5b[0] - want(5, 11)[0], p5b[1] - want(5, 11)[1]) < 0.01, `${p5b} vs ${want(5, 11)}`);
await es(`app.beginUndoGroup("test"); ${C}.layer("Cards").property("ADBE Effect Parade").property("Cloner").property("Speed").setValue(100); app.endUndoGroup(); "ok"`);
const x0 = (await pos(5))[0], x1 = +(await es(`${C}.layer("Cards 005").property("ADBE Transform Group").property("ADBE Position").valueAtTime(1, false)[0]`));
check('Speed moves instances along the direction (100 px/s, ± variation)', Math.abs(x1 - x0) > 50 && Math.abs(x1 - x0) < 150, `${x1 - x0}`);

// Falloff: an instance at the field centre is bigger than one far away.
const scl = async (k: number) => +(await es(`${C}.layer("Cards ${String(k).padStart(3, '0')}").property("ADBE Transform Group").property("ADBE Scale").valueAtTime(0, false)[0]`));
const all = await Promise.all(Array.from({ length: N }, (_, k) => scl(k + 1)));
check('falloff + noise give different scales', Math.max(...all) - Math.min(...all) > 10, `${Math.min(...all)}–${Math.max(...all)}`);

// Fields: label from data, color from the palette.
const label = await es(`${C}.layer("Cards 007").property("ADBE Layer Overrides").property("Label").valueAtTime(0, false).text`);
check('data reaches the label field (Cards 007 → "#007")', label === '#007', label);
const colors = new Set((await es(`var c=${C}, o=[]; for (var k=1;k<=${N};k++) o.push(c.layer("Cards " + (k < 10 ? "00" : "0") + k).property("ADBE Layer Overrides").property("Card Color").valueAtTime(0, false).join(",")); o.join("|")`)).split('|'));
check('palette assigns colors from the 4 swatches', colors.size > 1 && colors.size <= 4, `${colors.size} colors`);

// Editing the master changes every instance (no rebuild): they are all layers of the one master comp.
const src = new Set((await es(`var c=${C}, o=[]; for (var i=1;i<=c.numLayers;i++) if (c.layer(i).comment.indexOf(";clone") >= 0) o.push(c.layer(i).source.id); o.join("|")`)).split('|'));
// The master by its tag (other scenes may have a "Cards Master" too): this build's part comp, namespaced (D89).
const mid = await es(`(function(){ for (var i=1;i<=app.project.numItems;i++){ var it=app.project.item(i); if (it instanceof CompItem && it.comment.indexOf('aec:clonertest~cards.inst') === 0) return String(it.id); } return 'none'; })()`);
check('every instance is a layer of the one master comp', src.size === 1 && src.has(mid), [...src].join(',') + ' vs ' + mid);
done();
