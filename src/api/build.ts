// High-level build: TSX/IR → native comps in AE → snapshots → contact sheet → agent-readable report.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadScene } from '../scene/load.ts';
import { compileScene, REFRAMES } from '../compile/compile.ts';
import type { Reframe } from '../compile/compile.ts';
import type { SceneDef } from '../dsl/scene.ts';
import { validateIr } from '../ir/schema.ts';
import { guardDiskCache } from './cache.ts';
import { lintFromSamples, lintSettings, SAMPLE_OPTS } from './lint.ts';
import type { LintOptions, LintReport } from './lint.ts';
import type { SourceLoc } from '../dsl/jsx-runtime.ts';
import { callRuntime } from '../bridge/index.ts';
import { writeContactSheet } from '../visual/images.ts';
import { MOTION_SAMPLE_OPTS, motionReport } from './motion.ts';
import type { MotionOptions, MotionReport } from './motion.ts';
import { STYLE_RULES } from '../motion/types.ts';
import { saveLintForPanel } from './panelstate.ts';

export const OUT_ROOT = path.join(os.homedir(), '.ae-compose', 'out');

export interface BuildOptions {
  /** Rebuild in place (same ids → same comps), keeping live control values (default true). */
  replace?: boolean;
  /** On a rebuild, reset live controls to the values in the code instead of keeping the ones tweaked in AE. */
  resetControls?: boolean;
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
  /** Lint the main comp after building (default on; false disables; options merge over the scene's `lint`). */
  lint?: boolean | LintOptions;
  /** Motion previews + style lint (default on): a speed graph, a motion summary and the craft rules. */
  motion?: boolean | MotionOptions;
  /**
   * Responsive reframe (A4): also (or only) build the scene at other frame sizes as sibling comps ("Name_v001_9x16"):
   * '9:16' (vertical social, platform-safe zones, type ×0.8), '1:1', '4:5', '16:9', or { width, height, typeScale }.
   */
  reframe?: string | Reframe | (string | Reframe)[];
}

export interface BuiltComp { id: string; name: string; itemId: number; layers: number }
export interface BuildReport {
  /** Undo steps this build took (one per variant comp, plus one for a compare comp): pass to undo(steps). */
  undoSteps?: number;
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
  /** Lint report per built main comp (one per variant). */
  lint?: (LintReport & { label?: string })[];
  /** Time spent per build phase inside AE (ms), summed over variants. */
  phases?: Record<string, number>;
  /** Motion report per built main comp: speed graph PNG, summary lines, style issues (also merged into `lint`). */
  motion?: (MotionReport & { label?: string })[];
}

const loc = (s?: SourceLoc) => (s ? `${path.basename(s.file)}:${s.line}:${s.col}` : undefined);

function sheetTimes(dur: number, fps: number, n: number): number[] {
  const last = Math.max(0, dur - 1 / fps);
  if (n <= 1) return [last / 2];
  return Array.from({ length: n }, (_, i) => Math.round(((last * i) / (n - 1)) * fps) / fps);
}

/** Build calls get 5 min, plus 1.5 s per layer past 100: a 170-layer chart scene takes 2–5 min in a long AE session. */
function buildTimeout(ir: any): number {
  const layers = (ir.comps ?? []).reduce((n: number, c: any) => n + (c.layers?.length ?? 0), 0);
  return 300_000 + Math.max(0, layers - 100) * 1500;
}

export async function buildScene(input: { file?: string; source?: string; def?: SceneDef<any>; ir?: any; cwd?: string }, opts: BuildOptions = {}): Promise<BuildReport> {
  const t0 = Date.now();
  const report: BuildReport = { ok: true, scene: '', comps: [], warnings: [], exprErrors: [], contactSheets: [], frames: [], restoredControls: 0, ms: 0 };
  let irs: { ir: any; sources: Record<string, SourceLoc | undefined>; label?: string; params?: Record<string, any>; reframe?: Reframe }[] = [];
  let compareWanted = false;
  let sceneLint: LintOptions | false | undefined;
  if (input.ir) irs = [{ ir: input.ir, sources: {} }];
  else {
    const loaded = input.def ? { def: input.def, file: input.file ?? path.join(process.cwd(), 'scene.tsx') } : await loadScene(input);
    const def = loaded.def;
    compareWanted = !!def.config.compare;
    sceneLint = def.config.lint;
    const vkeys = def.config.variants && opts.variants !== false ? Object.keys(def.config.variants).filter((k) => opts.variants === true || opts.variants === undefined || (opts.variants as string[]).includes(k)) : [];
    const runs = vkeys.length ? vkeys.map((k) => ({ variant: k, params: { ...def.config.variants![k], ...(opts.params ?? {}) } })) : [{ variant: undefined as string | undefined, params: opts.params }];
    const frames: (Reframe | undefined)[] = opts.reframe === undefined ? [undefined] : (Array.isArray(opts.reframe) ? opts.reframe : [opts.reframe]).map((f) => {
      if (typeof f !== 'string') return f;
      if (!REFRAMES[f]) throw new Error(`reframe "${f}": use ${Object.keys(REFRAMES).join(', ')} or { width, height }`);
      return REFRAMES[f];
    });
    for (const r of runs) for (const fr of frames) {
      const c = compileScene(def, { version: opts.version, variant: r.variant, params: r.params, sceneFile: loaded.file, reframe: fr });
      const label = [r.variant, fr?.label].filter(Boolean).join('_') || undefined;
      report.warnings.push(...c.warnings.map((w) => (label ? `[${label}] ${w}` : w)));
      irs.push({ ir: c.ir, sources: c.sources, label, params: r.variant ? { ...(def.config.params ?? {}), ...(r.params ?? {}) } : undefined, reframe: fr });
    }
  }
  report.scene = irs[0].ir.scene;
  const outDir = opts.outDir ?? path.join(OUT_ROOT, report.scene.replace(/[^A-Za-z0-9_-]+/g, '_'));
  fs.mkdirSync(outDir, { recursive: true });
  const nFrames = opts.frames ?? 8;
  const lint = lintSettings(sceneLint, opts.lint);
  const lintRuns: { label?: string; data: any; frames: { t: number; file: string }[]; bpc: number; reels?: boolean }[] = [];
  const motionOpts: MotionOptions | false = opts.motion === false ? false : opts.motion === true || opts.motion === undefined ? {} : opts.motion;
  const motionRuns: { label?: string; data: any; ir: any }[] = [];
  for (const { ir } of irs) validateIr(ir); // fail in Node with a path, before anything reaches AE
  (report.phases ??= {})['node.compile'] = Date.now() - t0; // scene load + compile + IR validation
  for (const { ir, sources, label, reframe } of irs) {
    // Variant keys come from scene code or MCP input: never let one escape outDir (it feeds a recursive delete).
    const safeLabel = label === undefined ? undefined : (String(label).replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+$/, '') || 'variant');
    const irFile = path.join(outDir, `ir${safeLabel ? '_' + safeLabel : ''}.json`);
    fs.writeFileSync(irFile, JSON.stringify(ir, null, 1));
    report.irFile = irFile;
    const main = ir.comps.find((c: any) => c.id === ir.main) ?? ir.comps[ir.comps.length - 1];
    const times = nFrames > 0 ? [...sheetTimes(main.dur, main.fps, nFrames), ...(opts.times ?? [])] : opts.times ?? [];
    const snapDir = path.join(outDir, 'frames', label ?? 'main').replace(/\\/g, '/');
    fs.rmSync(snapDir, { recursive: true, force: true });
    const tCall = Date.now();
    const r = await callRuntime('build', [ir, { replace: opts.replace !== false, keepControls: !opts.resetControls, open: opts.open !== false && label === irs[irs.length - 1].label, snapshots: times.length ? [{ times, dir: snapDir }] : undefined, lint: lint ? SAMPLE_OPTS : undefined, motion: motionOpts ? MOTION_SAMPLE_OPTS : undefined }], { timeoutMs: buildTimeout(ir) });
    report.undoSteps = (report.undoSteps ?? 0) + 1;
    report.warnings.push(...(r.warnings ?? []).map((w: string) => (label ? `[${label}] ${w}` : w)));
    report.restoredControls += r.restoredControls ?? 0;
    for (const [k, v] of Object.entries(r.phases ?? {})) (report.phases ??= {})[k] = (report.phases[k] ?? 0) + (v as number);
    report.phases!['ae.call'] = (report.phases!['ae.call'] ?? 0) + (Date.now() - tCall);
    for (const e of r.exprErrors ?? []) report.exprErrors.push({ ...e, src: loc(sources[e.node]) });
    if (!r.ok) {
      report.ok = false;
      const where = loc(sources[r.node]);
      report.error = `${r.error}${r.node ? ` (at ${r.node}${where ? `, ${where}` : ''})` : ''}`;
      break;
    }
    report.comps.push(...r.comps);
    if (r.lint) lintRuns.push({ label, data: r.lint, frames: [], bpc: 8, reels: reframe?.platform === 'reels' });
    if (r.motion) motionRuns.push({ label, data: r.motion, ir });
    for (const s of r.snapshots ?? []) {
      const frames = s.frames.filter((f: any) => f.ok).map((f: any) => ({ file: f.file, t: f.t }));
      if (r.lint && s.comp === r.lint.comp) Object.assign(lintRuns[lintRuns.length - 1], { frames, bpc: s.bpc });
      report.frames.push(...frames.map((f: any) => ({ comp: s.comp, ...f })));
      if (frames.length > 1) {
        const sheet = path.join(outDir, `contact_${(label ?? 'main').replace(/[^A-Za-z0-9_-]+/g, '_')}.png`);
        await writeContactSheet(sheet, frames, { bpc: s.bpc, fps: main.fps, title: `${s.comp} — ${frames.length} frames` });
        report.contactSheets.push(sheet);
      }
    }
  }
  if (report.ok && compareWanted && irs.length > 1) {
    try { await buildCompare(irs, report, outDir); } catch (e: any) { report.warnings.push(`compare comp failed: ${e.message}`); }
  }
  if (lint && lintRuns.length) {
    report.lint = [];
    for (const run of lintRuns) {
      // A vertical-platform reframe is judged against the platform's UI-free zone.
      const lo = run.reels && (lint.safe === undefined || lint.safe === 'title') ? { ...lint, safe: 'reels' as const } : lint;
      try { report.lint.push({ ...(await lintFromSamples(run.data, lo, run.frames, run.bpc)), label: run.label }); } catch (e: any) { report.warnings.push(`lint failed: ${e.message}`); }
    }
  }
  if (motionOpts && motionRuns.length) {
    report.motion = [];
    const ignore = lint ? (lint.ignore ?? []) : [];
    for (const run of motionRuns) {
      try {
        const style = motionOpts.style === false ? false as const : { ...(motionOpts.style ?? {}), ignore: [...(motionOpts.style?.ignore ?? []), ...(ignore.filter((r) => (STYLE_RULES as string[]).includes(r)) as any[])] };
        const m = await motionReport(run.data, { ...motionOpts, style }, run.ir, lintRuns.find((l) => l.label === run.label)?.data);
        report.motion.push({ ...m, label: run.label });
        // The craft rules join the lint report (same shape), so the agent reads one list.
        const L = report.lint?.find((l) => l.label === run.label);
        if (L && m.ok) { L.issues.push(...(m.style as any[])); L.lines.push(...m.lines); }
      } catch (e: any) { report.warnings.push(`motion report failed: ${e.message}`); }
    }
  }
  for (const l of report.lint ?? []) if (l.ok) saveLintForPanel(l.comp, l.issues);
  report.ms = Date.now() - t0;
  { const note = await guardDiskCache(); if (note) report.warnings.push(note); }
  return report;
}

const short = (v: any) => (typeof v === 'number' ? +v.toFixed(3) : typeof v === 'string' ? v : JSON.stringify(v));

/** Grid of the variant comps (as precomps) with labels: variant key + the params that differ. */
async function buildCompare(irs: { ir: any; label?: string; params?: Record<string, any> }[], report: BuildReport, outDir: string): Promise<void> {
  const mains = irs.map((x) => ({ comp: x.ir.comps.find((c: any) => c.id === x.ir.main), label: x.label ?? '', params: x.params ?? {} }));
  const first = mains[0].comp;
  const n = mains.length, cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
  const W = first.w, H = first.h, label = Math.round(H * 0.045), cellW = W / cols, cellH = H / rows;
  const s = Math.min(cellW / W, (cellH - label * 1.6) / H) * 0.94 * 100;
  const keys = [...new Set(mains.flatMap((m) => Object.keys(m.params)))];
  const differing = keys.filter((k) => new Set(mains.map((m) => JSON.stringify(m.params[k]))).size > 1);
  const layers: any[] = [];
  mains.forEach((m, i) => {
    const cx = (i % cols + 0.5) * cellW, cy = (Math.floor(i / cols) + 0.5) * cellH;
    const imgH = (H * s) / 100;
    layers.push({ id: `compare.${m.comp.id}`, type: 'precomp', name: m.comp.name, precomp: { comp: m.comp.id }, in: 0, out: Math.max(...mains.map((x) => x.comp.dur)), props: [{ p: 'ADBE Transform Group/ADBE Position', v: [cx, cy - label * 0.8] }, { p: 'ADBE Transform Group/ADBE Scale', v: [s, s, 100] }] });
    const desc = differing.filter((k) => m.params[k] !== undefined).map((k) => `${k} ${short(m.params[k])}`).join(' · ');
    layers.push({ id: `compare.label.${m.comp.id}`, type: 'text', name: `Label ${m.label}`, in: 0, out: Math.max(...mains.map((x) => x.comp.dur)), text: { text: `${m.label}${desc ? '\r' + desc : ''}`, font: 'Inter-SemiBold', size: label * 0.5, fill: [0.85, 0.87, 0.9], justify: 'center', box: { w: cellW * 0.92, h: label * 2.6 } }, anchorBox: [0.5, 0.5], props: [{ p: 'ADBE Transform Group/ADBE Position', v: [cx, cy - label * 0.8 + imgH / 2 + label * 0.75] }] });
  });
  const scene = irs[0].ir.scene;
  const ir = { irVersion: 1, scene, comps: [{ id: `${first.id.split('-')[0]}-compare`, name: `${first.name.replace(/_[^_]+$/, '')}_Compare`, w: W, h: H, fps: first.fps, dur: Math.max(...mains.map((x) => x.comp.dur)), bg: [0.06, 0.07, 0.09], layers }] };
  const times = [first.dur * 0.25, first.dur * 0.5, first.dur * 0.9].map((t) => Math.round(t * first.fps) / first.fps);
  const r = await callRuntime('build', [ir, { replace: true, open: true, snapshots: [{ times, dir: path.join(outDir, 'frames', 'compare').replace(/\\/g, '/') }] }], { timeoutMs: 600_000 });
  report.undoSteps = (report.undoSteps ?? 0) + 1;
  if (!r.ok) throw new Error(r.error);
  report.comps.push(...r.comps);
  for (const snap of r.snapshots ?? []) {
    const frames = snap.frames.filter((f: any) => f.ok).map((f: any) => ({ file: f.file, t: f.t }));
    const sheet = path.join(outDir, 'contact_compare.png');
    await writeContactSheet(sheet, frames, { bpc: snap.bpc, fps: first.fps, cols: frames.length, title: `${snap.comp} — variants side by side` });
    report.contactSheets.push(sheet);
  }
}
