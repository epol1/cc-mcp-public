// `gradient` edit op (real AE): new stops on an existing Gradient Fill change the rendered colors, the stop tag in
// the group name is updated, and one undo restores the comp exactly. The Colors property is never read.
// Run: npx tsx tests/integration/gradient-edit.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { buildScene } from '../../src/api/build.ts';
import { applyEdits, inspect, snapshot, undo } from '../../src/api/index.ts';

let fails = 0;
const check = (ok: boolean, msg: string) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) fails++; };
const f = path.join(os.tmpdir(), 'aec-gradient-edit.tsx');
fs.writeFileSync(f, `import { scene, Composition, Shape, Rect, GradientFill } from 'ae-compose';
export default scene({ name: 'GradEdit', width: 400, height: 200, fps: 30, duration: '1s', bg: '#000000' }, () => (
  <Composition><Shape id="card" name="Card"><Rect size={[400, 200]} />
    <GradientFill start={[-200, 0]} end={[200, 0]} stops={[{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }]} /></Shape></Composition>
));`);
const b = await buildScene({ file: f }, { frames: 0, resetControls: true, lint: false });
const comp = b.comps[0].name;
const px = async (file: string, x: number, y: number) => { const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true }); const i = (y * info.width + x) * info.channels; return [data[i], data[i + 1], data[i + 2]]; };
const sample = async () => { const s = (await snapshot(comp, [0.5])).files[0]; return { left: await px(s, 10, 100), right: await px(s, 389, 100), centre: await px(s, 200, 100) }; };
const groupName = async () => (await inspect({ comp, detail: 'full', layers: ['card'] })).json.layers[0].props.find((n: any) => n.m === 'ADBE Root Vectors Group').c.map((c: any) => c.n).find((n: string) => /^Gradient Fill/.test(n));

const before = JSON.stringify((await inspect({ comp, detail: 'full' })).json.layers);
const s0 = await sample();
check(s0.left[0] > 200 && s0.right[2] > 200, `built: red on the left ${s0.left}, blue on the right ${s0.right}`);
const r = await applyEdits({ comp, ops: [{ op: 'gradient', layer: 'card', prop: `Contents/${await groupName()}`, stops: [{ offset: 0, color: '#ffff00' }, { offset: 1, color: '#00ff00' }], type: 'radial', start: [0, 0], end: [200, 0] }] }, { frames: 0, lint: false });
check(r.ok, `gradient op applied${r.ok ? '' : `: ${r.error}`}`);
const s1 = await sample();
check(s1.centre[0] > 200 && s1.centre[1] > 200 && s1.centre[2] < 60 && s1.right[1] > 150 && s1.right[0] < 100, `new stops render: yellow centre ${s1.centre}, green edge ${s1.right}`);
check(/\[#ffff00@0 #00ff00@1\]$/.test((await groupName()) ?? ''), `stop tag updated: ${await groupName()}`);
await undo();
check(JSON.stringify((await inspect({ comp, detail: 'full' })).json.layers) === before, 'one undo restores the comp exactly');
console.log(fails ? `${fails} FAILED` : 'gradient edit OK');
process.exitCode = fails ? 1 : 0;
