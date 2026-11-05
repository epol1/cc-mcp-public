// Every cloner distribution lands where aec-lib puts it (parent space), and follow/step/stagger/falloff/data
// behave: tests the distributions scene in AE, then one-step undo of the build.
import { buildScene } from '../../../src/api/index.ts';
import { libObject } from '../../../src/aeclib/index.ts';
import { buildUndoCheck, check, done, es, findComp } from './harness.ts';

const FILE = 'tests/integration/distributions-scene.tsx', COMP = 'DistTest_v001', C = findComp(COMP);
const L = libObject();
await buildUndoCheck('distributions build', FILE, COMP, { frames: 0 });
const r = await buildScene({ file: FILE }, { frames: 0, resetControls: true });
check('rebuild', r.ok && r.exprErrors.length === 0, r.error ?? r.exprErrors.map((e) => e.error).join(';'));

const val = async (layer: string, prop: string, t: number) => (await es(`var v = ${C}.layer(${JSON.stringify(layer)}).property("ADBE Transform Group").property(${JSON.stringify(prop)}).valueAtTime(${t}, false); (v.join ? v.join(",") : String(v))`)).split(',').map(Number);
const anchor = async (ctl: string) => val(ctl, 'ADBE Anchor Point', 0);
const name = (pre: string, k: number, n: number) => `${pre} ${String(k).padStart(Math.max(3, String(n).length), '0')}`;
const near = (a: number[], b: number[], eps = 0.05) => a.length >= b.length && b.every((x, i) => Math.abs(a[i] - x) < eps);
async function dist(pre: string, n: number, f: (i: number) => number[], t = 0) {
  const a = await anchor(pre);
  let bad = 0, first = '';
  for (let k = 1; k <= n; k++) { const got = await val(name(pre, k, n), 'ADBE Position', t); const p = f(k - 1); const want = p.map((x, d) => x + (a[d] ?? 0)); if (!near(got, want)) { bad++; if (!first) first = `${name(pre, k, n)} ${got.map((x) => x.toFixed(1))} vs ${want.map((x) => x.toFixed(1))}`; } }
  check(`${pre}: all ${n} positions match aec-lib`, bad === 0, first);
}
await dist('ln', 6, (i) => L.line(i, 6, 80, 30, true).map((x: number) => L.step(x, 25)));
await dist('gr', 12, (i) => L.grid(i, 12, 4, 70, 60));
await dist('ci', 8, (i) => L.circle(i, 8, 150, 20 + 30 * 0, 270), 0);
await dist('sc', 9, (i) => L.scatter(i, 9, 500, 260, 3, 0.5));
await dist('sp', 20, (i) => L.sphere(i, 20, 160));
await dist('hx', 16, (i) => L.helix(i, 16, 90, 260, 2));
await dist('dat', 3, (i) => { const p = L.line(i, 3, 200, 0, true); return [p[0] + [0, 10, -10][i], p[1] + [-20, 0, 20][i]]; });

// Circle motion: 30 °/s around → at t = 1 the start angle is 50°.
const ci1 = await val(name('ci', 3, 8), 'ADBE Position', 1), a = await anchor('ci');
const c2 = L.circle(2, 8, 150, 50, 270);
check('circle motion turns the ring (°/s)', near(ci1, [a[0] + c2[0], a[1] + c2[1]], 0.1), `${ci1} vs ${[a[0] + c2[0], a[1] + c2[1]]}`);
const rot = (await val(name('ci', 3, 8), 'ADBE Rotate Z', 0))[0];
check('circle orient adds the angle on the ring', Math.abs(rot - L.circleAngle(2, 8, 20, 270)) < 0.01, `${rot}`);
// Path: instances on the curve between 10 % and 90 %.
const pa = await val(name('pa', 1, 7), 'ADBE Position', 0);
check('path distribution puts instance 1 on the curve', pa.length > 1 && Number.isFinite(pa[0]), `${pa}`);
// Step: rotation quantized to 15° (7° base → 0° or 15°).
const lr = (await val(name('ln', 2, 6), 'ADBE Rotate Z', 0))[0];
check('step quantizes rotation (7° → 0°)', Math.abs(lr - 0) < 1e-6, `${lr}`);
// Stagger (center order, 0.1 s): the middle instance's master time leads the corner ones.
const tr = async (k: number, t: number) => +(await es(`${C}.layer(${JSON.stringify(name('gr', k, 12))}).property("ADBE Time Remapping").valueAtTime(${t}, false)`));
const d1 = 1 - (await tr(1, 1)), d6 = 1 - (await tr(6, 1));
check('stagger offsets the master time per instance (center first)', Math.abs(d1 - L.stagger(0, 12, 0.1, 2)) < 0.01 && Math.abs(d6 - L.stagger(5, 12, 0.1, 2)) < 0.01, `${d1}, ${d6}`);
// Follow: instance k sits where the controller was (k − 1) × 0.15 s earlier (unrotated controller: a + P(t') − P(t)).
const f3 = await val(name('lead', 3, 5), 'ADBE Position', 2), la = await anchor('lead');
const P2 = await val('lead', 'ADBE Position', 2), P17 = await val('lead', 'ADBE Position', 1.7);
check('follow: instance 3 trails the controller by 2 × 0.15 s', near(f3, [la[0] + P17[0] - P2[0], la[1] + P17[1] - P2[1]], 0.1), `${f3} vs ${[la[0] + P17[0] - P2[0], la[1] + P17[1] - P2[1]]}`);
// Linear falloff with blur: blur differs across the field.
const blur = async (k: number) => +(await es(`${C}.layer(${JSON.stringify(name('sc', k, 9))}).property("ADBE Effect Parade").property("Cloner Blur").property(1).valueAtTime(0, false)`));
const bl = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8, 9].map(blur));
check('linear falloff drives blur per instance', Math.max(...bl) - Math.min(...bl) > 2, bl.map((x) => x.toFixed(1)).join(','));
// Data text field from the CSV.
const tag = await es(`${C}.layer(${JSON.stringify(name('dat', 2, 3))}).property("ADBE Layer Overrides").property("Tag").valueAtTime(0, false).text`);
check('CSV rows reach the master text field', tag === 'beta', tag);
done();
