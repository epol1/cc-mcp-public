// Imports a generated FCP7 XML into the open Premiere project as a new sequence: one undo step, existing master
// clips reused (spike). Finds the new sequence by diffing sequence ids (the sequences collection re-sorts).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lit, nativePath, PRC_HOME, runEs } from './bridge.ts';
import { recordChange } from './undo.ts';
import { writeFcp7 } from './xml/fcp7.ts';
import type { Timeline } from './timeline.ts';

export { PRC_HOME } from './bridge.ts';

export interface ImportResult { sequenceId: string; name: string; xmlFile: string; undoSteps: number; warnings: string[]; durationFrames: number }

const safe = (s: string) => s.replace(/[^\w.-]+/g, '_').slice(0, 80);

export async function importTimeline(t: Timeline, opts: { bin?: string } = {}): Promise<ImportResult> {
  for (const m of Object.values(t.media)) if (m.path && !fs.existsSync(m.path)) throw new Error(`media missing: ${m.path} (importing it would open a modal dialog in Premiere)`);
  const w = writeFcp7(t);
  const dir = path.join(PRC_HOME, 'xml');
  fs.mkdirSync(dir, { recursive: true });
  const xmlFile = path.join(dir, `${safe(t.name)}_${Date.now().toString(36)}.xml`);
  fs.writeFileSync(xmlFile, w.xml);
  const r = await runEs<{ ok: boolean; id?: string; name?: string; u0: number; u1: number; project: string; projects: number; error?: string }>(`
if (!app.project || !app.project.rootItem) throw new Error('no project is open in Premiere');
var before = prcSeqIds(), u0 = prcUndo();
var bin = app.project.rootItem, want = ${lit(opts.bin ?? '')};
if (want) for (var i = 0; i < app.project.rootItem.children.numItems; i++) { var it = app.project.rootItem.children[i]; if (it.type === 2 && it.name === want) bin = it; }
var ok = app.project.importFiles([${lit(nativePath(xmlFile))}], true, bin, false);
var after = prcSeqIds(), id = null, named = null;
// The new sequence is the one carrying the cut's name (importing a nest also creates the nested sequence).
for (var j = 0; j < after.length; j++) { var seen = false; for (var k = 0; k < before.length; k++) if (before[k] === after[j]) seen = true; if (!seen) { id = after[j]; if (prcSeq(id).name === ${lit(t.name)}) named = id; } }
if (named) id = named;
var s = id ? prcSeq(id) : null;
if (s) app.project.openSequence(id);
prcJson({ ok: !!ok && !!id, id: id, name: s ? s.name : null, u0: u0, u1: prcUndo(), project: app.project.path, projects: app.projects.numProjects });
`, { timeoutMs: 300_000 });
  if (r.u1 > r.u0) recordChange(r.u0, r.u1, r.id ?? undefined, r.project, t.name);
  if (!r.ok || !r.id) throw new Error(`Premiere did not create a sequence from ${xmlFile}`);
  // One Ctrl+Z reverts an XML import (sequence and any media it brought in), whatever the undo index moved by.
  // Premiere's undo index is read through QE, which can follow another open project: then pr-cut can't journal it.
  const untracked = r.u1 <= r.u0 ? [`pr-cut couldn't follow this import in Premiere's undo history${r.projects > 1 ? ` (${r.projects} projects are open: close the others)` : ''}, so its undo can't revert it; Ctrl+Z in this project can`] : [];
  return { sequenceId: r.id, name: r.name ?? t.name, xmlFile, undoSteps: 1, warnings: [...w.warnings, ...untracked], durationFrames: w.durationFrames };
}
