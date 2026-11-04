// 3D + particle checks in real AE (GOAL §6):
//  1. renderer switching: Classic 3D → Advanced 3D → Cinema 4D → Classic, via the `comp` edit op; each switch is
//     one undo step, and 3D layers keep their transforms/materials.
//  2. seeds: rebuilding a particle scene gives pixel-identical frames; a different seed gives different frames.
// Run: npx tsx tests/integration/renderer-seeds.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { buildScene } from '../../src/api/build.ts';
import { applyEdits, inspect, snapshot, undo } from '../../src/api/index.ts';

let fails = 0;
const check = (ok: boolean, msg: string) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) fails++; };
const diff = async (a: string, b: string) => {
  const [x, y] = await Promise.all([a, b].map((f) => sharp(f).removeAlpha().raw().toBuffer()));
  let s = 0; for (let i = 0; i < x.length; i++) s += Math.abs(x[i] - y[i]);
  return s / x.length;
};

// 1) Renderer switching on the primitive matrix (has 3D card, camera, lights).
const b = await buildScene({ file: 'tests/integration/matrix-scene.tsx' }, { frames: 0, resetControls: true });
const comp = b.comps[b.comps.length - 1].name;
const state = async () => { const j = (await inspect({ comp, detail: 'full', layers: ['card3d'] })).json; const L = j.layers[0]; const find = (n: any, m: string): any => (n.m === m ? n : (n.c ?? []).map((c: any) => find(c, m)).find(Boolean)); return { renderer: j.comp.renderer, ry: find({ c: L.props }, 'ADBE Rotate Y')?.v, z: find({ c: L.props }, 'ADBE Position')?.v?.[2] }; };
const s0 = await state();
check(s0.renderer === 'ADBE Advanced 3d' && Math.abs(s0.ry - 25) < 1e-6 && Math.abs(s0.z - 400) < 1e-6, `initial renderer Classic 3D, card rotationY 25, z 400 (${JSON.stringify(s0)})`);
for (const [r, id] of [['advanced3d', 'ADBE Calder'], ['cinema4d', 'ADBE Ernst'], ['classic3d', 'ADBE Advanced 3d']] as const) {
  const e = await applyEdits({ comp, ops: [{ op: 'comp', set: { renderer: r } }] as any }, { frames: 0 });
  const s = await state();
  check(e.ok && s.renderer === id && Math.abs(s.ry - 25) < 1e-6 && Math.abs(s.z - 400) < 1e-6, `switch to ${r}: renderer ${s.renderer}, card transform kept`);
}
await undo();
check((await state()).renderer === 'ADBE Ernst', 'one undo reverts the last renderer switch (back to Cinema 4D)');
await undo(2);
check((await state()).renderer === 'ADBE Advanced 3d', 'undo(2) reverts two more switches (back to Classic 3D)');

// 2) Seeds: same seed → identical frames across rebuilds; another seed → different frames.
const scene = (seed: number) => {
  const f = path.join(os.tmpdir(), `ae-compose-seed-${seed}.tsx`);
  fs.writeFileSync(f, `import { scene, Composition, Solid, ParticleWorld } from 'ae-compose';
export default scene({ name: 'SeedTest', width: 640, height: 360, fps: 30, duration: '2s', bg: '#000000' }, () => (
  <Composition><Solid color="#000000" /><ParticleWorld id="sp" preset="sparks" seed={${seed}} controls={false} /></Composition>
));`);
  return f;
};
const shot = async (seed: number) => { await buildScene({ file: scene(seed) }, { frames: 0, resetControls: true }); return (await snapshot('SeedTest_v001', [1.2])).files[0]; };
const a1 = await shot(7), a2 = await shot(7), c = await shot(8);
const same = await diff(a1, a2), other = await diff(a1, c);
check(same === 0, `rebuild with seed 7 → identical frame (mean diff ${same.toFixed(4)})`);
check(other > 0.5, `seed 8 → different frame (mean diff ${other.toFixed(2)})`);

console.log(fails ? `${fails} FAILED` : 'renderer + seeds OK');
process.exitCode = fails ? 1 : 0;
