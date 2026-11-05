// Imports a generated FCP7 XML into the open Premiere project as a new sequence: one undo step, existing master
// clips reused (spike). Finds the new sequence by diffing sequence ids (the sequences collection re-sorts).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lit, nativePath, runEs } from './bridge.ts';
import { writeFcp7 } from './xml/fcp7.ts';
import type { Timeline } from './timeline.ts';

export const PRC_HOME = path.join(os.homedir(), '.ae-compose', 'pr-cut');

export interface ImportResult { sequenceId: string; name: string; xmlFile: string; undoSteps: number; warnings: string[]; durationFrames: number }

const safe = (s: string) => s.replace(/[^\w.-]+/g, '_').slice(0, 80);

export async function importTimeline(t: Timeline, opts: { bin?: string } = {}): Promise<ImportResult> {
  for (const m of Object.values(t.media)) if (!fs.existsSync(m.path)) throw new Error(`media missing: ${m.path} (importing it would open a modal dialog in Premiere)`);
  const w = writeFcp7(t);
  const dir = path.join(PRC_HOME, 'xml');
  fs.mkdirSync(dir, { recursive: true });
  const xmlFile = path.join(dir, `${safe(t.name)}_${Date.now().toString(36)}.xml`);
  fs.writeFileSync(xmlFile, w.xml);
  const r = await runEs<{ ok: boolean; id?: string; name?: string; undo: number; error?: string }>(`
if (!app.project || !app.project.rootItem) throw new Error('no project is open in Premiere');
var before = prcSeqIds(), u0 = prcUndo();
var bin = app.project.rootItem, want = ${lit(opts.bin ?? '')};
if (want) for (var i = 0; i < app.project.rootItem.children.numItems; i++) { var it = app.project.rootItem.children[i]; if (it.type === 2 && it.name === want) bin = it; }
var ok = app.project.importFiles([${lit(nativePath(xmlFile))}], true, bin, false);
var after = prcSeqIds(), id = null;
for (var j = 0; j < after.length; j++) { var seen = false; for (var k = 0; k < before.length; k++) if (before[k] === after[j]) seen = true; if (!seen) id = after[j]; }
var s = id ? prcSeq(id) : null;
if (s) app.project.openSequence(id);
prcJson({ ok: !!ok && !!id, id: id, name: s ? s.name : null, undo: prcUndo() - u0 });
`, { timeoutMs: 300_000 });
  if (!r.ok || !r.id) throw new Error(`Premiere did not create a sequence from ${xmlFile}`);
  return { sequenceId: r.id, name: r.name ?? t.name, xmlFile, undoSteps: r.undo, warnings: w.warnings, durationFrames: w.durationFrames };
}
