// Agent-facing API shared by the CLI and the MCP server. Every mutating call returns what changed plus
// an automatic contact sheet, so the agent always sees the result (ARCHITECTURE §0.2).
import fs from 'node:fs';
import path from 'node:path';
import { callRuntime, evalAE } from '../bridge/index.ts';
import { aeWindows, pressDialog } from '@ae-mcp/core/bridge/dialogs.ts';
import { outlineComp, outlineProject } from '../inspect/outline.ts';
import { writeContactSheet, normalizeCapture } from '@ae-mcp/core/visual/images.ts';
import { resolveEffect, searchEffects } from '../catalog/resolve.ts';
import { compileEditOps } from '../edit/ops.ts';
import type { EditInput } from '../edit/ops.ts';
import { OUT_ROOT } from './build.ts';
import { guardDiskCache } from './cache.ts';
import { attachGradients } from '../inspect/aep.ts';
import { lintFromSamples, lintSettings, SAMPLE_OPTS } from './lint.ts';
import type { LintOptions } from './lint.ts';
import { MOTION_SAMPLE_OPTS, motionReport } from './motion.ts';
import type { MotionOptions } from './motion.ts';
import { STYLE_RULES } from '@ae-mcp/core/motion/types.ts';
import { saveLintForPanel } from './panelstate.ts';
export { readInbox } from './panelstate.ts';

export { buildScene } from './build.ts';
export { motionOfComp, motionPreview, motionReport } from './motion.ts';
export { deliverScene } from './deliver.ts';
export type { DeliverOptions, DeliverReport } from './deliver.ts';
export type { MotionOptions, MotionReport } from './motion.ts';
export { lintComp } from './lint.ts';
export { renderComp, renderSummary, RENDER_FORMATS } from './render.ts';
export type { RenderOptions, RenderResult, RenderFormat } from './render.ts';
export type { LintOptions, LintReport } from './lint.ts';
export type { BuildOptions, BuildReport } from './build.ts';

const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 60);

export async function inspect(target: { comp?: string | number; project?: boolean; layers?: (string | number)[]; detail?: 'outline' | 'full'; time?: number }): Promise<{ outline: string; json: any }> {
  if (target.project) {
    const j = await callRuntime('inspect', ['project', {}]);
    return { outline: outlineProject(j), json: j };
  }
  const j = await callRuntime('inspect', [{ comp: target.comp }, { detail: target.detail ?? 'outline', layers: target.layers, time: target.time }], { timeoutMs: 180_000 });
  if (!j.ok) throw new Error(j.error);
  attachGradients(j); // shape-gradient stops from the saved .aep (AE can't read them by script)
  return { outline: outlineComp(j), json: j };
}

export async function contactSheet(comp: string | number | undefined, n = 8, times?: number[]): Promise<{ sheet: string; frames: { t: number; file: string }[]; comp: string; bpc: number }> {
  const dir = path.join(OUT_ROOT, '_sheets', safe(String(comp ?? 'active')) + '_' + Date.now()).replace(/\\/g, '/');
  const r = await callRuntime('contactFrames', [comp ?? null, n, dir, times ?? null], { timeoutMs: 300_000 });
  if (!r.ok) throw new Error(r.error);
  const frames = r.frames.filter((f: any) => f.ok).map((f: any) => ({ t: f.t, file: f.file }));
  const sheet = path.join(dir, 'contact.png');
  await writeContactSheet(sheet, frames, { bpc: r.bpc, fps: r.fps, title: `${r.comp} — ${frames.length} frames` });
  await guardDiskCache();
  return { sheet, frames, comp: r.comp, bpc: r.bpc };
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
  await guardDiskCache();
  return { files, comp: r.comp };
}

export async function applyEdits(input: EditInput, opts: { frames?: number; lint?: boolean | LintOptions; motion?: boolean | MotionOptions } = {}): Promise<any> {
  const notes: string[] = [];
  const ops = await compileEditOps(input, notes);
  const lint = lintSettings(opts.lint);
  const motion = opts.motion === false ? false : opts.motion === true || opts.motion === undefined ? {} : opts.motion;
  const r = await callRuntime('edit', [{ comp: input.comp }, ops, { ...(lint ? { lint: SAMPLE_OPTS } : {}), ...(motion ? { motion: MOTION_SAMPLE_OPTS } : {}) }], { timeoutMs: 300_000 });
  if (notes.length) r.notes = notes;
  let sheet: Awaited<ReturnType<typeof contactSheet>> | undefined;
  if (r.ok && (opts.frames ?? 6) > 0) {
    try { sheet = await contactSheet(r.itemId, opts.frames ?? 6); r.contactSheet = sheet.sheet; } catch (e: any) { r.contactSheetError = e.message; }
  }
  // The raw samples are replaced by the report (what the agent needs to read).
  const rawLint = r.lint;
  if (r.lint) r.lint = lint && r.ok ? await lintFromSamples(r.lint, lint, sheet?.frames, sheet?.bpc) : undefined;
  if (r.motion) {
    r.motion = motion && r.ok ? await motionReport(r.motion, { ...motion, style: motion.style === false ? false : { ...(motion.style ?? {}), ignore: [...(motion.style?.ignore ?? []), ...((lint ? lint.ignore ?? [] : []).filter((x) => (STYLE_RULES as string[]).includes(x)) as any[])] } }, undefined, rawLint) : undefined;
    if (r.motion?.ok && r.lint) { r.lint.issues.push(...r.motion.style); r.lint.lines.push(...r.motion.lines); }
  }
  if (r.lint?.ok) saveLintForPanel(r.lint.comp, r.lint.issues);
  return r;
}

/** Undo the last `steps` ae-compose builds/edits (variant builds report their step count as `undoSteps`). */
export async function undo(steps = 1): Promise<any> {
  return callRuntime('undo', [steps]);
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
