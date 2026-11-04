// AE integration check for ripple edits: insert hold time in a scene, compare frames before/after the shift,
// stretch a scene, remove time; each edit must undo in one step.
import sharp from 'sharp';
import { applyEdits, inspect, snapshot, undo } from '../../src/api/index.ts';
import { buildScene } from '../../src/api/build.ts';

await buildScene({ file: 'tests/integration/ripple-scene.tsx' }, { frames: 0, resetControls: true });

const COMP = 'RippleTest_v001';
async function diff(a: string, b: string): Promise<number> {
  const [x, y] = await Promise.all([a, b].map((f) => sharp(f).removeAlpha().raw().toBuffer()));
  let s = 0;
  for (let i = 0; i < x.length; i++) s += Math.abs(x[i] - y[i]);
  return s / x.length; // mean abs difference per channel (0–255)
}
const outline = async () => (await inspect({ comp: COMP })).outline;
const line = (o: string, re: RegExp) => o.split('\n').filter((l) => re.test(l)).join('\n');

const before = await snapshot(COMP, [1.0, 2.5, 3.0, 4.5, 5.5]);
console.log(line(await outline(), /Scenes|Card|Bar"|Scale:/));

// 1) hold inside Beat 2 at its quietest moment
const r1 = await applyEdits({ comp: COMP, ops: [{ op: 'ripple', scene: { at: '2.5' }, by: 1 } as any] }, { frames: 0 });
console.log('\n#1', JSON.stringify(r1.changes?.[0]?.ripple ?? r1), r1.warnings);
const o1 = await outline();
console.log(line(o1, /Scenes|Card|Bar"|Scale:|Comp "/));
const at = r1.changes[0].ripple.edit.at as number, by = 1;
const after = await snapshot(COMP, [1.0, 2.5, 3.0, 4.5 + by, 5.5 + by]);
for (let i = 0; i < 5; i++) console.log(`frame ${i}: diff ${(await diff(before.files[i], after.files[i])).toFixed(2)}`);
console.log('insert point', at);
const u1 = await undo();
console.log('undo', JSON.stringify(u1), line(await outline(), /Comp "|Scenes/));

// 2) stretch Beat 1 by 1.5×
const r2 = await applyEdits({ comp: COMP, ops: [{ op: 'ripple', scene: 'Beat 1', scale: 1.5 } as any] }, { frames: 0 });
console.log('\n#2', JSON.stringify(r2.changes?.[0]?.ripple ?? r2), r2.warnings);
console.log(line(await outline(), /Scenes|Card|Comp "|SECOND|FIRST/));
const after2 = await snapshot(COMP, [4.5 + 1, 5.5 + 1]);
console.log(`stretch: shifted frames diff ${(await diff(before.files[3], after2.files[0])).toFixed(2)} / ${(await diff(before.files[4], after2.files[1])).toFixed(2)}`);
await undo();

// 3) remove 0.5 s at 5.0 (inside Beat 3, card still on)
const r3 = await applyEdits({ comp: COMP, ops: [{ op: 'ripple', at: 5.0, by: -0.5 } as any] }, { frames: 0 });
console.log('\n#3', JSON.stringify(r3.changes?.[0]?.ripple ?? r3), r3.warnings);
console.log(line(await outline(), /Scenes|Card|Comp "/));
await undo();
console.log('\nfinal', line(await outline(), /Comp "|Scenes/));
