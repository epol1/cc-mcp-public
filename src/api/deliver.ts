// Delivery packs (A4): one call builds the scene in every target frame (responsive reframe) and renders each with
// the render tool: an mp4 per aspect plus a ProRes master of the main frame. Renders clear AE's undo history (D65),
// so this is the last step, after the piece is approved.
import fs from 'node:fs';
import path from 'node:path';
import { buildScene } from './build.ts';
import { CREDITS_FILE } from '../assets/credits.ts';
import { unsavedCreditsDir } from '../assets/fetch.ts';
import { callRuntime } from '../bridge/index.ts';
import type { BuildReport } from './build.ts';
import { renderComp } from './render.ts';
import type { RenderFormat, RenderResult } from './render.ts';

export interface DeliverOptions {
  /** Frames to deliver (default 16:9, 9:16, 1:1). Each is built as a sibling comp with its own suffix (Name_v001_16x9, …_9x16). */
  targets?: string[];
  /** Format for every target (default mp4). */
  format?: RenderFormat;
  /** Also render a master of the first target: 'prores' (422 HQ), 'mov' (ProRes 422), 'prores4444' or false (default 'prores'). */
  master?: RenderFormat | false;
  quality?: 'draft' | 'standard' | 'high';
  /** Output folder (default renders/ next to the saved project). */
  out?: string;
  params?: Record<string, any>;
}

export interface DeliverReport {
  ok: boolean;
  build: BuildReport;
  renders: (RenderResult & { target: string; master?: boolean })[];
  errors: string[];
  /** CREDITS.md copied next to the renders (when the scene used fetched assets). */
  credits?: string;
  ms: number;
}

export async function deliverScene(input: { file?: string; source?: string; cwd?: string }, o: DeliverOptions = {}): Promise<DeliverReport> {
  const t0 = Date.now();
  const targets = o.targets ?? ['16:9', '9:16', '1:1'];
  const build = await buildScene(input, { reframe: targets, frames: 0, params: o.params, variants: false, motion: false });
  const report: DeliverReport = { ok: build.ok, build, renders: [], errors: build.error ? [build.error] : [], ms: 0 };
  if (!build.ok) { report.ms = Date.now() - t0; return report; }
  // Main comps in target order (reframes are named "<scene>_v001_<label>").
  const mains = build.comps.filter((c) => /_(16x9|9x16|1x1|4x5|\d+x\d+)$/.test(c.name));
  for (let i = 0; i < mains.length; i++) {
    const c = mains[i];
    const target = targets[i] ?? c.name;
    const r = await renderComp(c.name, { format: o.format ?? 'mp4', quality: o.quality, out: o.out });
    report.renders.push({ ...r, target });
    if (!r.ok) report.errors.push(`${target}: ${r.error}`);
    if (i === 0 && o.master !== false) {
      const m = await renderComp(c.name, { format: o.master ?? 'prores', out: o.out });
      report.renders.push({ ...m, target, master: true });
      if (!m.ok) report.errors.push(`${target} master: ${m.error}`);
    }
  }
  // Fetched assets travel with the renders: CREDITS.md (next to the project, else next to the scene) is copied
  // into every folder the renders went to.
  const p = await callRuntime('ping', [], { timeoutMs: 20_000 }).catch(() => null);
  // Never the shared credits of unsaved projects (they list other projects' fetches too).
  const credits = [(build.credits ?? []).filter((c) => !path.resolve(c).startsWith(path.resolve(unsavedCreditsDir()))), p?.project ? [path.join(path.dirname(p.project), CREDITS_FILE)] : [], input.file ? [path.join(path.dirname(path.resolve(input.file)), CREDITS_FILE)] : []].flat().find((f) => fs.existsSync(f));
  if (credits) {
    for (const dir of new Set(report.renders.filter((x) => x.ok && x.file).map((x) => path.dirname(x.file!)))) {
      const dest = path.join(dir, CREDITS_FILE);
      try { fs.copyFileSync(credits, dest); report.credits = dest; } catch (e: any) { report.errors.push(`copying CREDITS.md: ${e.message}`); }
    }
  }
  report.ok = report.errors.length === 0;
  report.ms = Date.now() - t0;
  return report;
}
