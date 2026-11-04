// Showcase 09 — Editing a hand-built project (not made by ae-compose). Imports the collected fixture
// assets/handmade/languages_proj/languages.aep INTO the open project (the user's project stays open; nothing is
// written to the original file), inspects it, then restyles it with edit ops: re-ease every position move to a
// snappier curve, add a glow, ripple a hold into the timeline, and add live Map Delay / Map Speed controls to
// the hand-made map move. Contact sheets before and
// after are written to ~/.ae-compose/out/EditExisting, then ONE undo restores the comp exactly.
// Run: npx tsx examples/09-edit-existing/run.ts [--keep]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { applyEdits, contactSheet, importFootage, inspect, undo } from '../../src/api/index.ts';

const here = path.dirname(new URL(import.meta.url).pathname).replace(/^\/(\w:)/, '$1');
// Outputs (outlines, contact sheets) are derived from a client project: keep them out of the repo.
const outDir = path.join(os.homedir(), '.ae-compose', 'out', 'EditExisting');
fs.mkdirSync(outDir, { recursive: true });
const aep = path.resolve(here, '../../assets/handmade/languages_proj/languages.aep');

// 1) Import (reused if it is already in the project).
const project = await inspect({ project: true });
let main = project.json.items.find((i: any) => i.type === 'Composition' && i.name === 'Comp 1' && i.folder === 'languages.aep');
if (!main) {
  const r = await importFootage(aep);
  console.log('imported', r.name ?? r.error);
  main = (await inspect({ project: true })).json.items.find((i: any) => i.type === 'Composition' && i.name === 'Comp 1' && i.folder === 'languages.aep');
}
if (!main) throw new Error('Comp 1 not found after import');
const comp = main.id as number;
console.log(`target: "${main.name}" #${comp} ${main.w}×${main.h} ${main.dur}s ${main.layers} layers`);

// 2) Look before touching.
const before = await inspect({ comp });
fs.writeFileSync(path.join(outDir, 'outline_before.txt'), before.outline);
const sheetBefore = await contactSheet(comp, 8);
fs.copyFileSync(sheetBefore.sheet, path.join(outDir, 'contact_before.png'));
console.log(before.outline.split('\n').slice(0, 25).join('\n'));

// 3) Find what to edit from the inspector data (not by guessing names).
const layers = before.json.layers as any[];
const findProp = (L: any, m: string): any => { const walk = (n: any): any => (n.m === m && n.keys ? n : (n.c ?? []).map(walk).find(Boolean)); return (L.props ?? []).map(walk).find(Boolean); };
const moving = layers.filter((L) => { const p = findProp(L, 'ADBE Position'); return p && p.keys && p.keys.length >= 2; });
const texts = layers.filter((L) => L.type === 'text' || L.type === 'precomp');
console.log(`${moving.length} layers with position keys; ${texts.length} text/precomp layers`);

const ops: any[] = [];
for (const L of moving.slice(0, 6)) ops.push({ op: 'ease', layer: L.index, prop: 'position', easing: 'easeOutExpo' });
if (texts[0]) ops.push({ op: 'addEffect', layer: texts[0].index, effect: 'Glow', params: { 'Glow Radius': 25, 'Glow Intensity': 0.6 } });
ops.push({ op: 'ripple', at: Math.min(2, main.dur / 3), by: 0.5 });
// Live controls on a hand-built animation: delay and speed sliders that retime its keys without editing them.
if (moving[0]) ops.push({ op: 'addControls', layer: moving[0].index, prop: 'position', delay: 'Map Delay', speed: 'Map Speed' });

const r = await applyEdits({ comp, ops }, { frames: 8 });
console.log('edit', r.ok ? 'ok' : `${r.error} at ${r.at}${r.rolledBack ? ' (rolled back)' : ''}`);
console.log('ripple:', JSON.stringify(r.changes?.slice(-1)?.[0]?.ripple));
for (const w of r.warnings ?? []) console.log('warning:', w);
if (r.contactSheet) fs.copyFileSync(r.contactSheet, path.join(outDir, 'contact_after.png'));
fs.writeFileSync(path.join(outDir, 'outline_after.txt'), (await inspect({ comp })).outline);

// 4) One undo restores the comp exactly (pass --keep to leave the edits in place).
if (!process.argv.includes('--keep')) {
  await undo();
  const restored = await inspect({ comp });
  console.log('undone; comp restored:', restored.outline === before.outline);
}
