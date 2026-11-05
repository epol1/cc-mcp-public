// A1/A2 in AE: builds sample motion inside their undo group (one undo still restores the comp), the style lint
// flags the craft problems planted in style-scene.tsx, the speed graph is drawn, and motion_preview writes a
// frame strip and a GIF.
import fs from 'node:fs';
import { buildScene, motionPreview } from '../../../src/api/index.ts';
import { buildUndoCheck, check, done } from './harness.ts';

const FILE = 'tests/integration/style-scene.tsx', COMP = 'StyleTest_v001';
await buildUndoCheck('style scene build (with motion sampling)', FILE, COMP, { frames: 0 });
const r = await buildScene({ file: FILE }, { frames: 0 });
const m = r.motion?.[0];
check('motion report ok', !!m?.ok, m?.error ?? '');
check('speed graph written', !!m?.graph && fs.existsSync(m.graph));
const rules = new Set((m?.style ?? []).map((i) => i.rule));
for (const rule of ['crowded-entrance', 'slide-furniture', 'linear-move', 'short-end-hold']) check(`style lint flags ${rule}`, rules.has(rule as any), [...rules].join(', '));
check('style issues are in the lint list too', !!r.lint?.[0]?.lines.some((l) => l.includes('[crowded-entrance]')));
const quiet = await buildScene({ file: FILE }, { frames: 0, lint: { ignore: ['crowded-entrance', 'slide-furniture', 'linear-move', 'short-end-hold'] as any } });
check('lint.ignore silences style rules', !(quiet.motion?.[0]?.style ?? []).some((i) => ['crowded-entrance', 'slide-furniture', 'linear-move', 'short-end-hold'].includes(i.rule)));
const p = await motionPreview(COMP, { start: 0.4, end: 1.0, frames: 8 });
check('motion_preview writes a strip and a GIF', fs.existsSync(p.strip) && !!p.gif && fs.existsSync(p.gif) && fs.statSync(p.gif).size > 1000);
check('motion summary describes arrivals', (m?.summary ?? []).some((l) => /arrives|fades in|appears/.test(l)), (m?.summary ?? []).join(' | '));
done();
