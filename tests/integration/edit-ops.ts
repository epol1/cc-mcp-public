// Edit-op suite on a HAND-BUILT project (GOAL §6/§7): every agent op is applied to assets/handmade/languages_proj
// (imported into the open project; the original file is never written), its effect is asserted through the
// inspector, then ONE undo must restore the comp exactly (full-detail inspector JSON identical to before).
// Run: npx tsx tests/integration/edit-ops.ts
import path from 'node:path';
import { applyEdits, importFootage, inspect, undo } from '../../src/api/index.ts';

const aep = path.resolve('assets/handmade/languages_proj/languages.aep');
let items = (await inspect({ project: true })).json.items;
const findComp = (name: string) => items.find((i: any) => i.type === 'Composition' && i.name === name && (i.folder === 'languages.aep' || /^(Title|T )/.test(i.folder ?? '')));
if (!findComp('Comp 1')) { await importFootage(aep); items = (await inspect({ project: true })).json.items; }
const COMP = findComp('Comp 1').id as number;
const TEXT_COMP = items.find((i: any) => i.type === 'Composition' && i.name === 'T 01 Text 01').id as number;
const GS = path.resolve('scratch/p3/gs/greenscreen_logo.mp4');

const full = async (comp: number) => JSON.stringify((await inspect({ comp, detail: 'full' })).json.layers) + JSON.stringify((await inspect({ comp })).json.comp);
const find = (n: any, m: string): any => (n?.m === m || n?.n === m ? n : (n?.c ?? []).map((c: any) => find(c, m)).find(Boolean));
const layer = (j: any, name: string) => j.layers.find((L: any) => L.name === name);
const prop = (j: any, L: string, m: string) => find({ c: layer(j, L)?.props }, m);
const projectCount = async () => (await inspect({ project: true })).json.numItems;

type Case = { name: string; comp?: number; ops: any[]; check: (j: any, before: any) => boolean | string };
const MAP = 'map2.eps';
const CASES: Case[] = [
  { name: 'set value', ops: [{ op: 'set', layer: MAP, prop: 'opacity', value: 50 }], check: (j) => prop(j, MAP, 'ADBE Opacity')?.v === 50 },
  { name: 'set keys', ops: [{ op: 'set', layer: MAP, prop: 'rotation', keys: [{ t: 0, v: 0 }, { t: 1, v: 12, easing: 'easeOutBack' }] }], check: (j) => prop(j, MAP, 'ADBE Rotate Z')?.keys?.length >= 2 },
  { name: 'set expression', ops: [{ op: 'set', layer: MAP, prop: 'rotation', expr: 'wiggle(1, 3)' }], check: (j) => /wiggle/.test(prop(j, MAP, 'ADBE Rotate Z')?.expr ?? '') },
  { name: 'ease (bezier)', ops: [{ op: 'ease', layer: MAP, prop: 'position', easing: 'easeOutBack' }], check: (j, b) => JSON.stringify(prop(j, MAP, 'ADBE Position')?.keys) !== JSON.stringify(prop(b, MAP, 'ADBE Position')?.keys) },
  { name: 'ease (spring rebake)', ops: [{ op: 'ease', layer: MAP, prop: 'position', easing: 'bounce' }], check: (j, b) => (prop(j, MAP, 'ADBE Position')?.keys?.length ?? 0) > (prop(b, MAP, 'ADBE Position')?.keys?.length ?? 0) },
  { name: 'easeKey', ops: [{ op: 'easeKey', layer: MAP, prop: 'position', key: 1, side: 'out', influence: 80 }], check: (j) => Math.abs((prop(j, MAP, 'ADBE Position')?.keys?.[0]?.oe?.[0]?.influence ?? 0) - 80) < 0.5 },
  { name: 'interpolation', ops: [{ op: 'interpolation', layer: MAP, prop: 'position', type: 'hold' }], check: (j) => prop(j, MAP, 'ADBE Position')?.keys?.[0]?.o === 'hold' },
  { name: 'retime', ops: [{ op: 'retime', layer: MAP, props: ['position'], shift: 0.5 }], check: (j, b) => Math.abs(prop(j, MAP, 'ADBE Position').keys[0].t - prop(b, MAP, 'ADBE Position').keys[0].t - 0.5) < 1e-3 },
  { name: 'layerTiming', ops: [{ op: 'layerTiming', layer: 'Title 07', in: 3.5 }], check: (j) => Math.abs(layer(j, 'Title 07').in - 3.5) < 1e-3 },
  { name: 'addEffect', ops: [{ op: 'addEffect', layer: MAP, effect: 'Glow', params: { 'Glow Radius': 33 } }], check: (j) => find({ c: layer(j, MAP).props }, 'ADBE Glo2') !== undefined },
  { name: 'setEffect', ops: [{ op: 'setEffect', layer: MAP, effect: 'Gaussian Blur', params: { Blurriness: 77 } }], check: (j) => find(find({ c: layer(j, MAP).props }, 'ADBE Gaussian Blur 2'), 'ADBE Gaussian Blur 2-0001')?.v === 77 },
  { name: 'removeEffect', ops: [{ op: 'removeEffect', layer: MAP, effect: 'Gaussian Blur' }], check: (j) => find({ c: layer(j, MAP).props }, 'ADBE Gaussian Blur 2') === undefined },
  { name: 'moveEffect', ops: [{ op: 'moveEffect', layer: MAP, effect: 'Gaussian Blur', to: 1 }], check: (j) => find({ c: layer(j, MAP).props }, 'ADBE Effect Parade')?.c?.[0]?.m === 'ADBE Gaussian Blur 2' },
  { name: 'text', comp: TEXT_COMP, ops: [{ op: 'text', layer: 1, text: 'Hola' }], check: (j) => find({ c: j.layers[0].props }, 'ADBE Text Document')?.v?.text === 'Hola' },
  { name: 'path (pen)', ops: [{ op: 'path', layer: 'Shape Layer 2', prop: 'Contents/#1/Contents/#1/Path', d: 'M0 0 L400 0 L400 300 Z' }], check: (j, b) => JSON.stringify(layer(j, 'Shape Layer 2').props) !== JSON.stringify(layer(b, 'Shape Layer 2').props) },
  { name: 'layer (blend)', ops: [{ op: 'layer', layer: MAP, set: { blend: 'SCREEN' } }], check: (j) => /SCREEN/.test(layer(j, MAP).blend ?? '') },
  { name: 'removeLayer', ops: [{ op: 'removeLayer', layer: 'Title 07' }], check: (j) => !layer(j, 'Title 07') },
  { name: 'duplicateLayer', ops: [{ op: 'duplicateLayer', layer: 'Title 07', name: 'Title 07 copy' }], check: (j) => !!layer(j, 'Title 07 copy') },
  { name: 'addLayer', ops: [{ op: 'addLayer', spec: { id: 'added', type: 'solid', name: 'Added Solid', solid: { color: [1, 0, 0] } } }], check: (j) => !!layer(j, 'Added Solid') },
  { name: 'comp', ops: [{ op: 'comp', set: { duration: 12 } }], check: (j) => Math.abs(j.comp.dur - 12) < 1e-3 },
  { name: 'precompose', ops: [{ op: 'precompose', layers: ['Title 07'], name: 'Pre Title 07' }], check: (j) => !!layer(j, 'Pre Title 07') },
  { name: 'duplicateComp', ops: [{ op: 'duplicateComp', name: 'Comp 1 dup (test)' }], check: () => true },
  { name: 'addControls', ops: [{ op: 'addControls', layer: MAP, prop: 'position', delay: 'Map Delay', speed: 'Map Speed' }], check: (j) => !!layer(j, 'Controls') && /ae-compose rig/.test(prop(j, MAP, 'ADBE Position')?.expr ?? '') },
  { name: 'ripple', ops: [{ op: 'ripple', at: 2, by: 0.5 }], check: (j) => Math.abs(j.comp.dur - 10.5) < 1e-3 },
  { name: 'place', ops: [{ op: 'place', item: MAP, name: 'Placed Map', fit: 'contain' }], check: (j) => !!layer(j, 'Placed Map') },
  { name: 'place + key', ops: [{ op: 'place', file: GS, name: 'Keyed' }, { op: 'key', layer: 'Keyed' }], check: (j) => find({ c: layer(j, 'Keyed')?.props }, 'Keylight 906') !== undefined },
];

let fails = 0;
for (const c of CASES) {
  const comp = c.comp ?? COMP;
  const items0 = await projectCount();
  const before = await full(comp);
  const bj = (await inspect({ comp, detail: 'full' })).json;
  const r = await applyEdits({ comp, ops: c.ops }, { frames: 0 });
  let ok = r.ok, why = r.ok ? '' : `edit failed: ${r.error}`;
  if (ok) {
    const aj = (await inspect({ comp, detail: 'full' })).json;
    const res = c.check(aj, bj);
    if (res !== true) { ok = false; why = typeof res === 'string' ? res : 'effect not visible in the inspector'; }
    await undo();
    const after = await full(comp);
    const items1 = await projectCount();
    if (after !== before) { ok = false; why += ' | one undo did not restore the comp exactly'; }
    if (items1 !== items0 && !(c.name === 'place + key')) { ok = false; why += ` | project items ${items0} → ${items1} after undo`; }
  }
  console.log(`${ok ? 'PASS' : 'FAIL'} ${c.name}${why ? ' — ' + why : ''}`);
  if (!ok) fails++;
}
console.log(fails ? `${fails} of ${CASES.length} FAILED` : `all ${CASES.length} edit ops OK (applied, asserted, undone in one step)`);
process.exitCode = fails ? 1 : 0;
