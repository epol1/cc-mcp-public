// Typed 3D and particle edit ops (real AE): camera, light, material, geometry and particles change the right AE
// properties with the DSL's names, a preset's live control is set instead of the param it drives, and each batch
// undoes in one step (full-detail inspector JSON identical to before).
// Run: npx tsx tests/integration/edit-3d.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildScene } from '../../src/api/build.ts';
import { applyEdits, inspect, undo } from '../../src/api/index.ts';

let fails = 0;
const check = (ok: boolean, msg: string) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) fails++; };
const find = (n: any, m: string): any => (n?.m === m || n?.n === m ? n : (n?.c ?? []).map((c: any) => find(c, m)).find(Boolean));

const b = await buildScene({ file: 'tests/integration/matrix-scene.tsx' }, { frames: 0, resetControls: true, lint: false });
const comp = b.comps[b.comps.length - 1].name;
// A preset whose params are live controls, plus extruded text for geometry.
const f = path.join(os.tmpdir(), 'aec-edit3d.tsx');
fs.writeFileSync(f, `import { scene, Composition, Solid, Text, Camera, ParticleWorld } from 'ae-compose';
export default scene({ name: 'Edit3D', width: 1280, height: 720, fps: 30, duration: '3s', bg: '#000000', renderer: 'advanced3d' }, () => (
  <Composition><Solid color="#000000" /><Text id="word" font="Inter-Black" size={120} threeD geometry={{ extrusion: 20 }}>DEPTH</Text>
  <ParticleWorld id="sparks" preset="sparks" seed={3} /><Camera name="Camera" lens={35} /></Composition>
));`);
const b2 = await buildScene({ file: f }, { frames: 0, resetControls: true, lint: false });
const comp2 = b2.comps[b2.comps.length - 1].name;

const L = async (c: string, name: string) => (await inspect({ comp: c, detail: 'full', layers: [name] })).json.layers[0];
const full = async (c: string) => JSON.stringify((await inspect({ comp: c, detail: 'full' })).json.layers);

type Case = { name: string; comp: string; ops: any[]; check: () => Promise<boolean | string> };
const CASES: Case[] = [
  { name: 'camera (default camera, lens → zoom, focus, aperture keys)', comp, ops: [{ op: 'camera', set: { lens: 85, focusDistance: 900, aperture: { keys: [{ t: 0, v: 10 }, { t: 2, v: 60, easing: 'easeInOutSine' }] } } }],
    check: async () => { const c = await L(comp, 'Camera'); const z = find({ c: c.props }, 'ADBE Camera Zoom')?.v, fd = find({ c: c.props }, 'ADBE Camera Focus Distance')?.v, ak = find({ c: c.props }, 'ADBE Camera Aperture')?.keys?.length; return (Math.abs(z - (1280 * 85) / 36) < 1 && Math.abs(fd - 900) < 1e-3 && ak >= 2) || `zoom ${z}, focus ${fd}, aperture keys ${ak}`; } },
  { name: 'light (intensity, color, cone)', comp, ops: [{ op: 'light', layer: 'Spot', set: { intensity: 200, color: '#ff8800', coneAngle: 45 } }],
    check: async () => { const s = await L(comp, 'Spot'); const i = find({ c: s.props }, 'ADBE Light Intensity')?.v, a = find({ c: s.props }, 'ADBE Light Cone Angle')?.v, col = find({ c: s.props }, 'ADBE Light Color')?.v; return (i === 200 && a === 45 && Math.abs(col[0] - 1) < 1e-3 && Math.abs(col[1] - 0x88 / 255) < 1e-2) || `intensity ${i}, cone ${a}, color ${col}`; } },
  { name: 'material (specular, shininess, casts shadows off)', comp, ops: [{ op: 'material', layer: 'card3d', set: { specular: 80, shininess: 60, castsShadows: false } }],
    check: async () => { const c = await L(comp, 'card3d'); return (find({ c: c.props }, 'ADBE Specular Coefficient')?.v === 80 && find({ c: c.props }, 'ADBE Shininess Coefficient')?.v === 60 && find({ c: c.props }, 'ADBE Casts Shadows')?.v === 0) || 'material values not applied'; } },
  { name: 'geometry (extrusion + bevel on 3D text)', comp: comp2, ops: [{ op: 'geometry', layer: 'word', set: { extrusion: 60, bevel: { style: 'convex', depth: 4 } } }],
    check: async () => { const w = await L(comp2, 'word'); return (find({ c: w.props }, 'ADBE Extrsn Depth')?.v === 60 && find({ c: w.props }, 'ADBE Bevel Styles')?.v === 4) || 'geometry not applied'; } },
  { name: 'particles (direct param + preset control)', comp: comp2, ops: [{ op: 'particles', layer: 'sparks', set: { 'Longevity (sec)': 1.6, birthRate: 5 } }],
    check: async () => {
      const s = await L(comp2, 'sparks');
      const lon = find(find({ c: s.props }, 'CC Particle World'), 'Longevity (sec)')?.v;
      const ctl = await L(comp2, 'Controls');
      const br = find(find({ c: ctl.props }, 'Sparks Birth Rate'), 'ADBE Slider Control-0001')?.v;
      return (Math.abs(lon - 1.6) < 1e-3 && br === 5) || `longevity ${lon}, Sparks Birth Rate control ${br}`;
    } },
];
for (const c of CASES) {
  const before = await full(c.comp);
  const r = await applyEdits({ comp: c.comp, ops: c.ops }, { frames: 0, lint: false });
  let ok = r.ok, why = r.ok ? '' : `edit failed: ${r.error}`;
  if (ok) { const res = await c.check(); if (res !== true) { ok = false; why = String(res); } }
  if (r.ok) { await undo(); if ((await full(c.comp)) !== before) { ok = false; why += ' | one undo did not restore the comp exactly'; } }
  check(ok, `${c.name}${why ? ' — ' + why : ''}${r.notes?.length ? ` (${r.notes.join('; ')})` : ''}`);
}
console.log(fails ? `${fails} FAILED` : 'edit-3d OK');
process.exitCode = fails ? 1 : 0;
