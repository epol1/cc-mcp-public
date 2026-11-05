// Undo for pr-cut batches. Premiere's ExtendScript has no undo groups, so each batch records the undo-stack index
// before and after it (QE undoStackIndex); `undo` steps back exactly that many entries, and only when nothing else
// happened since (otherwise it would revert the editor's own work). XML builds are a single step anyway.
import fs from 'node:fs';
import path from 'node:path';
import { runEs } from './bridge.ts';
import { PRC_HOME } from './importxml.ts';

const JOURNAL = path.join(PRC_HOME, 'journal.json');

export interface JournalEntry { at: string; tool: string; label: string; before: number; after: number; sequenceId?: string; projectPath?: string; undone?: boolean }

function read(): JournalEntry[] { try { return JSON.parse(fs.readFileSync(JOURNAL, 'utf8')); } catch { return []; } }
function write(j: JournalEntry[]) { fs.mkdirSync(PRC_HOME, { recursive: true }); fs.writeFileSync(JOURNAL, JSON.stringify(j.slice(-200), null, 1)); }

export async function undoState(): Promise<{ index: number; projectPath: string }> {
  return runEs(`prcJson({ index: prcUndo(), projectPath: app.project ? app.project.path : '' })`);
}

export function record(e: Omit<JournalEntry, 'at'>) {
  const j = read();
  j.push({ ...e, at: new Date().toISOString() });
  write(j);
}

/** Wrap a mutating batch: records the undo span so `undo` can revert it in one call. */
export async function journaled<T>(tool: string, label: string, fn: () => Promise<T & { sequenceId?: string }>): Promise<T & { undoSteps: number }> {
  const s0 = await undoState();
  const r = await fn();
  const s1 = await undoState();
  record({ tool, label, before: s0.index, after: s1.index, sequenceId: (r as any).sequenceId, projectPath: s1.projectPath });
  return { ...r, undoSteps: s1.index - s0.index };
}

export async function undoLast(opts: { force?: boolean } = {}): Promise<string> {
  const j = read();
  const last = [...j].reverse().find((e) => !e.undone);
  if (!last) return 'nothing to undo: no pr-cut batch is recorded';
  const s = await undoState();
  if (last.projectPath && s.projectPath !== last.projectPath) return `not undone: the last batch (${last.tool} "${last.label}") was in ${last.projectPath}, but ${s.projectPath || 'no project'} is open`;
  if (s.index !== last.after && !opts.force) {
    return `not undone: Premiere's undo history moved since ${last.tool} "${last.label}" (index ${last.after} → ${s.index}); someone edited in between. Undo by hand (Ctrl+Z ${last.after - last.before}×), or pass force to step back ${last.after - last.before} entries anyway.`;
  }
  // The undo index is not one per action: one XML import moves it by a dozen and a single undo reverts all of it
  // (D-PR). So step back until the index is back where the batch started, never by count, and stop if Premiere
  // switches to another project (it can when an undo removes the open sequence) or an undo makes no progress.
  const r = await runEs<{ index: number; done: number; reached: boolean }>(`
var want = ${JSON.stringify(last.projectPath ?? '')}, target = ${last.before}, n = 0, idx = prcUndo();
while (idx > target && n < 50) {
  if (want && app.project.path !== want) break;
  qe.project.undo(); n++;
  var now = prcUndo(); if (now >= idx) break; idx = now;
}
prcJson({ index: idx, done: n, reached: idx <= target });`);
  last.undone = true;
  write(j);
  if (!r.reached) return `partly undone: ${r.done} step(s) of ${last.tool} "${last.label}" (Premiere switched to another project or stopped undoing); finish with Ctrl+Z in ${last.projectPath}`;
  return `undone: ${last.tool} "${last.label}" in ${r.done} undo step${r.done === 1 ? '' : 's'} (undo index ${s.index} → ${r.index})`;
}
