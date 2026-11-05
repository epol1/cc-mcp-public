// Project-level reads and one-off live actions: open project, sequences, frames at times, export, dialogs.
import path from 'node:path';
import { lit, nativePath, runEs } from './bridge.ts';

export interface ProjectInfo { open: boolean; name?: string; path?: string; sequences: { id: string; name: string; seconds: number; size: string }[]; active?: string }

export function projectInfo(): Promise<ProjectInfo> {
  return runEs(`
if (!app.project || !app.project.path) prcJson({ open: false, sequences: [] }); else {
var out = { open: true, name: app.project.name, path: app.project.path, sequences: [], active: app.project.activeSequence ? app.project.activeSequence.sequenceID : null };
for (var i = 0; i < app.project.sequences.numSequences; i++) { var s = app.project.sequences[i]; out.sequences.push({ id: s.sequenceID, name: s.name, seconds: Math.round(Number(s.end) / 254016000000 * 100) / 100, size: s.frameSizeHorizontal + 'x' + s.frameSizeVertical }); }
prcJson(out); }
`);
}

/** Find a sequence by id, exact name, or unique name fragment. */
export async function resolveSequence(ref?: string): Promise<{ id: string; name: string }> {
  const p = await projectInfo();
  if (!p.open) throw new Error('no project is open in Premiere');
  if (!ref) {
    const a = p.sequences.find((s) => s.id === p.active);
    if (!a) throw new Error('no active sequence; name one');
    return a;
  }
  const byId = p.sequences.find((s) => s.id === ref);
  if (byId) return byId;
  const exact = p.sequences.filter((s) => s.name === ref);
  if (exact.length === 1) return exact[0];
  const part = p.sequences.filter((s) => s.name.toLowerCase().includes(ref.toLowerCase()));
  if (part.length === 1) return part[0];
  if (exact.length > 1 || part.length > 1) throw new Error(`"${ref}" matches ${(exact.length > 1 ? exact : part).length} sequences: ${(exact.length > 1 ? exact : part).map((s) => `${s.name} (${s.id.slice(0, 8)})`).join(', ')}; use the id`);
  throw new Error(`no sequence "${ref}"; sequences: ${p.sequences.map((s) => s.name).join(', ') || 'none'}`);
}

export async function openProject(file: string): Promise<string> {
  const r = await runEs<{ ok: boolean; path: string }>(`var ok = app.openDocument(${lit(nativePath(file))}, true, true, true, true); prcJson({ ok: !!ok, path: app.project ? app.project.path : '' })`, { timeoutMs: 300_000 });
  if (!r.ok) throw new Error(`Premiere could not open ${file}`);
  return r.path;
}

/** Duplicate a sequence (one undo step) and return the copy's id. Never edit the user's original. */
export async function duplicateSequence(id: string, name?: string): Promise<{ id: string; name: string }> {
  return runEs(`
var s = prcSeq(${lit(id)}); if (!s) throw new Error('no sequence ' + ${lit(id)});
var before = prcSeqIds(); s.clone(); var after = prcSeqIds(), nid = null;
for (var j = 0; j < after.length; j++) { var seen = false; for (var k = 0; k < before.length; k++) if (before[k] === after[j]) seen = true; if (!seen) nid = after[j]; }
var c = prcSeq(nid); if (c && ${lit(name ?? '')}) c.name = ${lit(name ?? '')};
prcJson({ id: nid, name: c ? c.name : null });
`);
}

/** Export a sequence directly (no AME queue): H.264 MP4 by default. */
export async function exportSequence(id: string, out: string, preset = 'C:/Program Files/Adobe/Adobe Media Encoder 2026/MediaIO/systempresets/4E49434B_48323634/01 - Match Source - High bitrate.epr', opts: { workArea?: boolean } = {}): Promise<{ file: string; ms: number }> {
  return runEs(`
var s = prcSeq(${lit(id)}); if (!s) throw new Error('no sequence');
var t0 = new Date().getTime();
var r = s.exportAsMediaDirect(${lit(nativePath(out))}, ${lit(nativePath(preset))}, ${opts.workArea ? 'app.encoder.ENCODE_WORKAREA' : 'app.encoder.ENCODE_ENTIRE'});
if (r !== 'No Error') throw new Error('export failed: ' + r);
prcJson({ file: ${lit(path.resolve(out))}, ms: new Date().getTime() - t0 });
`, { timeoutMs: 3_600_000 });
}
