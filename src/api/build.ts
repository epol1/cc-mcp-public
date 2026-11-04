// High-level build: TSX/IR → native comps in AE → snapshots → contact sheet → agent-readable report.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadScene } from '../scene/load.ts';
import { compileScene } from '../compile/compile.ts';
import type { SceneDef } from '../dsl/scene.ts';
import type { SourceLoc } from '../dsl/jsx-runtime.ts';
import { callRuntime } from '../bridge/index.ts';
import { writeContactSheet } from '../visual/images.ts';

export const OUT_ROOT = path.join(os.homedir(), '.ae-compose', 'out');

export interface BuildOptions {
  /** Rebuild in place (same ids → same comps), keeping live control values (default true). */
  replace?: boolean;
  /** Build variants declared in the scene (default true); or a subset by key. */
  variants?: boolean | string[];
  params?: Record<string, any>;
  version?: number;
  /** Frames in the automatic contact sheet (0 disables; default 8). */
  frames?: number;
  /** Extra exact times (seconds) to snapshot. */
  times?: number[];
  open?: boolean;
  outDir?: string;
}

export interface BuiltComp { id: string; name: string; itemId: number; layers: number }
export interface BuildReport {
  ok: boolean;
  scene: string;
  comps: BuiltComp[];
  warnings: string[];
  exprErrors: { node: string; prop: string; error: string; src?: string }[];
  error?: string;
  contactSheets: string[];
  frames: { comp: string; t: number; file: string }[];
  restoredControls: number;
  ms: number;
  irFile?: string;
}

const loc = (s?: SourceLoc) => (s ? `${path.basename(s.file)}:${s.line}:${s.col}` : undefined);

function sheetTimes(dur: number, fps: number, n: number): number[] {
  const last = Math.max(0, dur - 1 / fps);
  if (n <= 1) return [last / 2];
  return Array.from({ length: n }, (_, i) => Math.round(((last * i) / (n - 1)) * fps) / fps);
}

export async function buildScene(input: { file?: string; source?: string; def?: SceneDef; ir?: any; cwd?: string }, opts: BuildOptions = {}): Promise<BuildReport> {
  const t0 = Date.now();
  const report: BuildReport = { ok: true, scene: '', comps: [], warnings: [], exprErrors: [], contactSheets: [], frames: [], restoredControls: 0, ms: 0 };
  let irs: { ir: any; sources: Record<string, SourceLoc | undefined>; label?: string }[] = [];
  if (input.ir) irs = [{ ir: input.ir, sources: {} }];
  else {
    const loaded = input.def ? { def: input.def, file: input.file ?? path.join(process.cwd(), 'scene.tsx') } : await loadScene(input);
    const def = loaded.def;
    const vkeys = def.config.variants && opts.variants !== false ? Object.keys(def.config.variants).filter((k) => opts.variants === true || opts.variants === undefined || (opts.variants as string[]).includes(k)) : [];
    const runs = vkeys.length ? vkeys.map((k) => ({ variant: k, params: { ...def.config.variants![k], ...(opts.params ?? {}) } })) : [{ variant: undefined as string | undefined, params: opts.params }];
    for (const r of runs) {
      const c = compileScene(def, { version: opts.version, variant: r.variant, params: r.params, sceneFile: loaded.file });
      report.warnings.push(...c.warnings.map((w) => (r.variant ? `[${r.variant}] ${w}` : w)));
      irs.push({ ir: c.ir, sources: c.sources, label: r.variant });
    }
  }
  report.scene = irs[0].ir.scene;
  const outDir = opts.outDir ?? path.join(OUT_ROOT, report.scene.replace(/[^A-Za-z0-9_-]+/g, '_'));
  fs.mkdirSync(outDir, { recursive: true });
  const nFrames = opts.frames ?? 8;
  for (const { ir, sources, label } of irs) {
    const irFile = path.join(outDir, `ir${label ? '_' + label : ''}.json`);
    fs.writeFileSync(irFile, JSON.stringify(ir, null, 1));
    report.irFile = irFile;
    const main = ir.comps.find((c: any) => c.id === ir.main) ?? ir.comps[ir.comps.length - 1];
    const times = nFrames > 0 ? [...sheetTimes(main.dur, main.fps, nFrames), ...(opts.times ?? [])] : opts.times ?? [];
    const snapDir = path.join(outDir, 'frames', label ?? 'main').replace(/\\/g, '/');
    fs.rmSync(snapDir, { recursive: true, force: true });
    const r = await callRuntime('build', [ir, { replace: opts.replace !== false, open: opts.open !== false && label === irs[irs.length - 1].label, snapshots: times.length ? [{ times, dir: snapDir }] : undefined }], { timeoutMs: 300_000 });
    report.warnings.push(...(r.warnings ?? []).map((w: string) => (label ? `[${label}] ${w}` : w)));
    report.restoredControls += r.restoredControls ?? 0;
    for (const e of r.exprErrors ?? []) report.exprErrors.push({ ...e, src: loc(sources[e.node]) });
    if (!r.ok) {
      report.ok = false;
      const where = loc(sources[r.node]);
      report.error = `${r.error}${r.node ? ` (at ${r.node}${where ? `, ${where}` : ''})` : ''}`;
      break;
    }
    report.comps.push(...r.comps);
    for (const s of r.snapshots ?? []) {
      const frames = s.frames.filter((f: any) => f.ok).map((f: any) => ({ file: f.file, t: f.t }));
      report.frames.push(...frames.map((f: any) => ({ comp: s.comp, ...f })));
      if (frames.length > 1) {
        const sheet = path.join(outDir, `contact_${(label ?? 'main').replace(/[^A-Za-z0-9_-]+/g, '_')}.png`);
        await writeContactSheet(sheet, frames, { bpc: s.bpc, fps: main.fps, title: `${s.comp} — ${frames.length} frames` });
        report.contactSheets.push(sheet);
      }
    }
  }
  report.ms = Date.now() - t0;
  return report;
}
