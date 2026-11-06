// Undo for pr-cut batches. Premiere's ExtendScript has no undo groups and its undo index moves by many entries per
// compound action (one XML import ≈ 12, reverted by one undo), so a batch records where the index stood just before
// its first change, read inside the same ExtendScript call that makes it (an import or a clone), and where it stood
// when the batch ended. `undo` steps back until the index is where the batch started, and only when nothing else
// happened since (otherwise it would revert the editor's own work).
import fs from 'node:fs';
import path from 'node:path';
import { PRC_HOME, runEs } from './bridge.ts';

const JOURNAL = path.join(PRC_HOME, 'journal.json');
/** Undo steps a batch may span and still be stepped back (Premiere's default history is 32 states). */
const HISTORY = 30;

export interface JournalEntry { at: string; tool: string; label: string; before: number; after: number; sequenceId?: string; projectPath?: string; undone?: boolean; /** Recorded by the first change of a batch still running. */ open?: boolean }

function read(): JournalEntry[] { try { return JSON.parse(fs.readFileSync(JOURNAL, 'utf8')); } catch { return []; } }
function write(j: JournalEntry[]) { fs.mkdirSync(PRC_HOME, { recursive: true }); fs.writeFileSync(JOURNAL, JSON.stringify(j.slice(-200), null, 1)); }

export async function undoState(): Promise<{ index: number; projectPath: string }> {
  return runEs(`prcJson({ index: prcUndo(), projectPath: app.project ? app.project.path : '' })`);
}

/**
 * The first change of a batch (an import, a clone) records itself right away with the index read just before it,
 * so a batch that fails later is still undoable and nothing the editor did earlier falls inside its span.
 */
export function recordChange(before: number, after: number, sequenceId: string | undefined, projectPath: string, label: string) {
  const j = read();
  j.push({ at: new Date().toISOString(), tool: 'change', label, before, after, sequenceId, projectPath, open: true });
  write(j);
}

/** Wrap a mutating batch: closes the entries its changes opened into one, ending at the index after the batch. */
export async function journaled<T>(tool: string, label: string, fn: () => Promise<T & { sequenceId?: string }>): Promise<T & { undoSteps: number }> {
  const start = read().length;
  let r: (T & { sequenceId?: string }) | undefined;
  try {
    r = await fn();
    return { ...r, undoSteps: (r as any).report?.undoSteps ?? (r as any).undoSteps ?? 0 };
  } finally {
    const s1 = await undoState().catch(() => null);
    const j = read();
    const mine = j.slice(start).filter((e) => e.open);
    if (mine.length) {
      const first = mine[0];
      const merged: JournalEntry = { at: first.at, tool, label: r ? label : `${label} (failed part way)`, before: first.before, after: s1?.index ?? mine[mine.length - 1].after, sequenceId: (r as any)?.sequenceId ?? mine[mine.length - 1].sequenceId, projectPath: first.projectPath };
      write([...j.slice(0, start), ...j.slice(start).filter((e) => !e.open), merged]);
    }
  }
}

export async function undoLast(opts: { force?: boolean } = {}): Promise<string> {
  const j = read();
  const last = [...j].reverse().find((e) => !e.undone);
  if (!last) return 'nothing to undo: no pr-cut batch is recorded';
  const s = await undoState();
  if (last.projectPath && s.projectPath !== last.projectPath) return `not undone: the last batch (${last.tool} "${last.label}") was in ${last.projectPath}, but ${s.projectPath || 'no project'} is open`;
  // pr-cut batches only ever create a new sequence, so a batch that can't be stepped back is undone by removing the
  // sequence it created (itself one undoable step in Premiere).
  const removeSeq = async (why: string, stepped = 0) => {
    const ok = await runEs<boolean>(`var s = prcSeq(${JSON.stringify(last.sequenceId ?? '')}); prcJson(s ? !!app.project.deleteSequence(s) : false)`, { timeoutMs: 120_000 });
    if (!ok) return null;
    last.undone = true;
    write(j);
    return `undone: ${last.tool} "${last.label}" by removing the sequence it created${stepped ? ` (after ${stepped} undo step${stepped === 1 ? '' : 's'})` : ''}: ${why}. Media it imported stay in the project panel.`;
  };
  // Premiere's history was cleared since (a restart, a reopened project): nothing is left to step back through. Changes
  // made to that sequence by hand since would go with it, so this takes force.
  // (At or below the batch's start with the sequence still there: an undo by hand would have removed it.)
  if (last.sequenceId && s.index <= last.before && last.after > last.before && (await runEs<boolean>(`prcJson(!!prcSeq(${JSON.stringify(last.sequenceId)}))`))) {
    if (!opts.force) return `not undone: Premiere's undo history was cleared since ${last.tool} "${last.label}" (a restart or a reopened project). Pass force to remove the sequence it created, with any changes made to it since.`;
    const m = await removeSeq("Premiere's undo history was cleared since");
    if (m) return m;
  }
  if (s.index !== last.after && !opts.force) {
    return `not undone: Premiere's undo history moved since ${last.tool} "${last.label}" (undo index ${last.after} → ${s.index}); someone worked in between. Undo by hand in Premiere, or pass force to step back to where the batch started (index ${last.before}).`;
  }
  // Premiere keeps a limited undo history (32 states by default): a batch longer than that (a cut with a caption
  // template per caption) can't be stepped back to its start.
  if (last.sequenceId && last.after - last.before > HISTORY) { const m = await removeSeq(`its ${last.after - last.before} steps are more than Premiere's undo history holds`); if (m) return m; }
  // Step back until the index is where the batch started, never by count, and stop if Premiere switches to another
  // project (it can when an undo removes the open sequence) or an undo makes no progress.
  const r = await runEs<{ index: number; done: number; reached: boolean }>(`
var want = ${JSON.stringify(last.projectPath ?? '')}, target = ${last.before}, n = 0, idx = prcUndo();
while (idx > target && n < 2000) {
  if (want && app.project.path !== want) break;
  qe.project.undo(); n++;
  var now = prcUndo(); if (now >= idx) break; idx = now;
}
prcJson({ index: idx, done: n, reached: idx <= target });`, { timeoutMs: 600_000 });
  if (!r.reached) {
    if (last.sequenceId) { const m = await removeSeq('Premiere stopped undoing part way', r.done); if (m) return m; }
    last.after = r.index; // what is left of the batch, if the user calls undo again
    write(j);
    return `partly undone: ${r.done} step(s) of ${last.tool} "${last.label}" (Premiere switched to another project or stopped undoing at index ${r.index}, batch started at ${last.before}); undo again or finish with Ctrl+Z in ${last.projectPath}`;
  }
  last.undone = true;
  write(j);
  return `undone: ${last.tool} "${last.label}" in ${r.done} undo step${r.done === 1 ? '' : 's'} (undo index ${s.index} → ${r.index})`;
}
