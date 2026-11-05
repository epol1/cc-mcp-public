// K2/K3/P4 in AE: the typography, backgrounds and data viz scenes build without expression errors, undo in one step,
// lint, and stay live: rig-effect edits in AE change what the expressions draw.
import { buildScene } from '../../../src/api/index.ts';
import { buildUndoCheck, check, done, es, findComp } from './harness.ts';

const val = (comp: string, layer: string, prop: string, t: number) => es(`var L = ${findComp(comp)}.layer(${JSON.stringify(layer)}); var p = L.property(${JSON.stringify(prop)}) || L; String(L ? (function(){ var x = L; var parts = ${JSON.stringify(prop)}.split('/'); for (var i = 0; i < parts.length; i++) x = x.property(parts[i]); var v = x.valueAtTime(${t}, false); return v.toString(); })() : 'no layer')`);
const setFx = (comp: string, layer: string, fx: string, param: string, v: string) => es(`app.beginUndoGroup("kits probe"); var e = ${findComp(comp)}.layer(${JSON.stringify(layer)}).effect(${JSON.stringify(fx)})(${JSON.stringify(param)}); e.setValue(${v}); app.endUndoGroup(); "ok"`);
const rectAt = (comp: string, layer: string, t: number) => es(`var r = ${findComp(comp)}.layer(${JSON.stringify(layer)}).sourceRectAtTime(${t}, false); r.left + "," + r.top + "," + r.width + "," + r.height`).then((s) => s.split(',').map(Number));
const textAt = (comp: string, layer: string, t: number) => es(`String(${findComp(comp)}.layer(${JSON.stringify(layer)}).property("ADBE Text Properties").property("ADBE Text Document").valueAtTime(${t}, false).text)`);
export { val, setFx, rectAt, textAt };

const only = process.argv[2];

if (!only || only === 'type') {
  const C = 'TypeKit_v001';
  await buildUndoCheck('typography build', 'tests/integration/type-scene.tsx', C, { frames: 0 });
  const r = await buildScene({ file: 'tests/integration/type-scene.tsx' }, { frames: 8 });
  check('typography: builds clean', r.ok && r.exprErrors.length === 0, r.error ?? r.exprErrors.map((e) => e.error).join('; '));
  console.log('sheet:', r.contactSheets?.join(' '));
}
if (!only || only === 'bg') {
  const C = 'Backgrounds_v001';
  await buildUndoCheck('backgrounds build', 'tests/integration/backgrounds-scene.tsx', C, { frames: 0 });
  const r = await buildScene({ file: 'tests/integration/backgrounds-scene.tsx' }, { frames: 8 });
  check('backgrounds: builds clean', r.ok && r.exprErrors.length === 0, r.error ?? r.exprErrors.map((e) => e.error).join('; '));
  console.log('sheet:', r.contactSheets?.join(' '));
}
if (!only || only === 'dataviz') {
  const C = 'DataVizKit_v001';
  await buildUndoCheck('data viz build', 'tests/integration/dataviz-scene.tsx', C, { frames: 0, motion: false });
  const r = await buildScene({ file: 'tests/integration/dataviz-scene.tsx' }, { frames: 8 });
  check('data viz: builds clean', r.ok && r.exprErrors.length === 0, r.error ?? r.exprErrors.map((e) => e.error).join('; '));
  console.log('sheet:', r.contactSheets?.join(' '));
}
for (const [key, label, file, comp] of [
  ['ui', 'UI kit', 'tests/integration/ui-scene.tsx', 'UIKitTest_v001'],
  ['transitions', 'transitions', 'tests/integration/transitions-scene.tsx', 'TransitionsK4_v001'],
  ['paths', 'path tools', 'tests/integration/paths-scene.tsx', 'PathsP3_v001'],
] as const) {
  if (only && only !== key) continue;
  await buildUndoCheck(`${label} build`, file, comp, { frames: 0, motion: false });
  const r = await buildScene({ file }, { frames: 8 });
  check(`${label}: builds clean`, r.ok && r.exprErrors.length === 0, r.error ?? r.exprErrors.map((e) => `${e.node}: ${e.error.split('\n')[0]}`).join('; '));
  console.log('sheet:', r.contactSheets?.join(' '));
}
done();
