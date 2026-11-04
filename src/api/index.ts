// Agent-facing API shared by the CLI and the MCP server. Every mutating call returns what changed plus
// an automatic contact sheet, so the agent always sees the result (ARCHITECTURE §0.2).
import fs from 'node:fs';
import path from 'node:path';
import { callRuntime, evalAE } from '../bridge/index.ts';
import { aeWindows, pressDialog } from '../bridge/dialogs.ts';
import { outlineComp, outlineProject } from '../inspect/outline.ts';
import { writeContactSheet, normalizeCapture } from '../visual/images.ts';
import { resolveEffect, searchEffects } from '../catalog/resolve.ts';
import { compileEditOps } from '../edit/ops.ts';
import type { EditInput } from '../edit/ops.ts';
import { OUT_ROOT } from './build.ts';

export { buildScene } from './build.ts';
export type { BuildOptions, BuildReport } from './build.ts';

const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 60);

export async function inspect(target: { comp?: string | number; project?: boolean; layers?: (string | number)[]; detail?: 'outline' | 'full'; time?: number }): Promise<{ outline: string; json: any }> {
  if (target.project) {
    const j = await callRuntime('inspect', ['project', {}]);
    return { outline: outlineProject(j), json: j };
  }
  const j = await callRuntime('inspect', [{ comp: target.comp }, { detail: target.detail ?? 'outline', layers: target.layers, time: target.time }], { timeoutMs: 180_000 });
  if (!j.ok) throw new Error(j.error);
  return { outline: outlineComp(j), json: j };
}

export async function contactSheet(comp: string | number | undefined, n = 8, times?: number[]): Promise<{ sheet: string; frames: { t: number; file: string }[]; comp: string }> {
  const dir = path.join(OUT_ROOT, '_sheets', safe(String(comp ?? 'active')) + '_' + Date.now()).replace(/\\/g, '/');
  const r = await callRuntime('contactFrames', [comp ?? null, n, dir, times ?? null], { timeoutMs: 300_000 });
  if (!r.ok) throw new Error(r.error);
  const frames = r.frames.filter((f: any) => f.ok).map((f: any) => ({ t: f.t, file: f.file }));
  const sheet = path.join(dir, 'contact.png');
  await writeContactSheet(sheet, frames, { bpc: r.bpc, fps: r.fps, title: `${r.comp} — ${frames.length} frames` });
  return { sheet, frames, comp: r.comp };
}

/** Contact sheet of any project item (footage, still or comp), to look at media before using it. */
export async function previewItem(item: string | number, n = 6, times?: number[]): Promise<{ sheet: string; info: any }> {
  const dir = path.join(OUT_ROOT, '_items', safe(String(item)) + '_' + Date.now()).replace(/\\/g, '/');
  const r = await callRuntime('previewItem', [item, n, dir, times ?? null], { timeoutMs: 300_000 });
  if (!r.ok) throw new Error(r.error);
  const frames = r.frames.filter((f: any) => f.ok).map((f: any) => ({ t: f.t, file: f.file }));
  const sheet = path.join(dir, 'contact.png');
  await writeContactSheet(sheet, frames, { bpc: r.bpc, fps: r.fps, title: `${r.item ?? r.comp} — ${r.still ? 'still' : frames.length + ' frames'}` });
  const { frames: _f, ...info } = r;
  return { sheet, info };
}

/** Single frames as normalized PNGs (32 bpc fix applied), ready to show the agent. */
export async function snapshot(comp: string | number | undefined, times: number[]): Promise<{ files: string[]; comp: string }> {
  const dir = path.join(OUT_ROOT, '_snaps', safe(String(comp ?? 'active')) + '_' + Date.now()).replace(/\\/g, '/');
  const r = await callRuntime('contactFrames', [comp ?? null, times.length, dir, times], { timeoutMs: 300_000 });
  if (!r.ok) throw new Error(r.error);
  const files: string[] = [];
  for (const f of r.frames) {
    if (!f.ok) continue;
    const out = f.file.replace(/\.png$/i, '_n.png');
    fs.writeFileSync(out, await normalizeCapture(f.file, r.bpc));
    files.push(out);
  }
  return { files, comp: r.comp };
}

export async function applyEdits(input: EditInput, opts: { frames?: number } = {}): Promise<any> {
  const notes: string[] = [];
  const ops = await compileEditOps(input, notes);
  const r = await callRuntime('edit', [{ comp: input.comp }, ops, {}], { timeoutMs: 300_000 });
  if (notes.length) r.notes = notes;
  if (r.ok && (opts.frames ?? 6) > 0) {
    try { r.contactSheet = (await contactSheet(r.itemId, opts.frames ?? 6)).sheet; } catch (e: any) { r.contactSheetError = e.message; }
  }
  return r;
}

export async function undo(): Promise<any> {
  return callRuntime('undo', []);
}

export function listEffects(query = '', limit = 40) {
  return searchEffects(query, limit);
}

export async function describeEffect(name: string): Promise<any> {
  const { mn } = resolveEffect(name);
  return callRuntime('describeEffect', [mn], { timeoutMs: 60_000 });
}

export async function importFootage(file: string, folder?: string): Promise<any> {
  return callRuntime('importFile', [path.resolve(file).replace(/\\/g, '/'), folder ?? null]);
}

export async function listDialogs() {
  return aeWindows({ capture: true });
}

export async function answerDialog(hwnd: number, button: string) {
  return pressDialog(hwnd, button);
}

/** Raw ExtendScript escape hatch (logged). Returns the string value of the last expression. */
export async function runExtendScript(code: string, timeoutMs = 120_000) {
  const log = path.join(OUT_ROOT, 'extendscript.log');
  fs.mkdirSync(OUT_ROOT, { recursive: true });
  fs.appendFileSync(log, `--- ${new Date().toISOString()}\n${code}\n`);
  return evalAE(code, { timeoutMs });
}
