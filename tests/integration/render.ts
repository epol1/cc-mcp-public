// Final renders (real AE): every format writes the right file (codec, size, frame count, alpha), the user's
// Render Queue is left exactly as it was, and nothing is overwritten. Before a render a build undoes in one step; a
// scripted render clears AE's undo history (D65), so afterwards `undo` must say so instead of pretending, and must
// not undo the render's own cleanup.
// Run: npx tsx tests/integration/render.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildScene } from '../../src/api/build.ts';
import { inspect, renderComp, undo } from '../../src/api/index.ts';
import { evalAE } from '../../src/bridge/index.ts';
import { aeWindows } from '../../src/bridge/dialogs.ts';

let fails = 0;
const check = (ok: boolean, msg: string) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) fails++; };
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'aec-render-'));
const rqCount = async () => +((await evalAE('app.project.renderQueue.numItems')) as any).result;

const scene = path.join(out, 'render-scene.tsx');
const name = `RenderTest${Date.now() % 100000}`;
fs.writeFileSync(scene, `import { scene, Composition, Solid, Text, perWord } from 'ae-compose';
export default scene({ name: '${name}', width: 640, height: 360, fps: 30, duration: '2s', bg: '#000000' }, () => (
  <Composition><Text size={60} color="#ffffff" animate={{ text: perWord({ from: { y: 20, opacity: 0 } }) }}>Hello there</Text></Composition>
));`);
const comps = async () => (await inspect({ project: true })).json.items.filter((i: any) => i.name === `${name}_v001`).length;

const rq0 = await rqCount();
// Before any render: build → one undo removes it, then build again for the renders.
const b0 = await buildScene({ file: scene }, { frames: 0, lint: false });
await undo(b0.undoSteps ?? 1);
check(b0.ok && (await comps()) === 0, 'build then one undo removes it (no render yet)');
const b = await buildScene({ file: scene }, { frames: 0, lint: false });
check(b.ok && (await comps()) === 1, 'test scene built');
const comp = `${name}_v001`;

const cases: [string, any, (r: any) => boolean][] = [
  ['mp4', { format: 'mp4' }, (r) => r.codec === 'h264' && r.w === 640 && r.h === 360 && r.frames === 60],
  ['mp4 range + draft', { format: 'mp4', start: 0.5, end: 1, settings: 'draft' }, (r) => r.codec === 'h264' && r.w === 320 && r.frames === 15],
  ['mov (ProRes 422)', { format: 'mov', end: 0.5 }, (r) => r.codec === 'prores' && !r.alpha && r.frames === 15],
  ['prores4444 (alpha)', { format: 'prores4444', end: 0.5 }, (r) => r.codec === 'prores' && r.alpha === true],
  ['prores (422 HQ)', { format: 'prores', end: 0.5 }, (r) => r.codec === 'prores' && r.frames === 15],
  ['png sequence (alpha)', { format: 'png', end: 0.5 }, (r) => r.frames === 15 && r.alpha === true && /\[#####\]\.png$/.test(r.file)],
];
for (const [label, opts, ok] of cases) {
  const r = await renderComp(comp, { ...opts, out });
  check(r.ok && ok(r), `${label}: ${r.ok ? `${r.codec ?? 'seq'} ${r.w}×${r.h} ${r.frames} frames${r.alpha ? ' alpha' : ''}` : r.error}`);
}
const first = path.join(out, `${comp}.mp4`);
const again = await renderComp(comp, { format: 'mp4', end: 0.2, out });
check(again.ok && again.file !== first && fs.existsSync(first), `no overwrite: another mp4 render went to ${path.basename(again.file)}`);
check((await rqCount()) === rq0, `render queue left as it was (${rq0} items)`);
check(!(await aeWindows()).dialogs.length, 'no dialogs left open');
const u = await undo(1);
check(!u.ok && /cleared its undo history at the render/.test(u.error ?? '') && (await rqCount()) === rq0 && (await comps()) === 1, `after a render, undo reports the cleared history and touches nothing (${u.error?.slice(0, 60)}…)`);
// Remove the test comp by hand (it can no longer be undone).
await evalAE(`(function(){app.beginUndoGroup('aec test cleanup');for(var i=app.project.numItems;i>=1;i--){var it=app.project.item(i);if(it.name==='${comp}'||(it instanceof FolderItem&&it.name==='${name}'))it.remove();}app.endUndoGroup();})()`);
check((await comps()) === 0, 'test comp removed');

fs.rmSync(out, { recursive: true, force: true });
console.log(fails ? `${fails} FAILED` : 'render OK');
process.exitCode = fails ? 1 : 0;
