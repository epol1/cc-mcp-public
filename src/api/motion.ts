// Motion previews and style lint for builds, edits and any comp (A1/A2): AE samples the layers' comp-space motion
// (src/runtime/motion.ts), src/motion judges it (moves, holds, easing classes, the craft rules) and draws a speed
// graph the agent can read. motionPreview renders dense frames of one segment as a strip (and a GIF for humans).
import fs from 'node:fs';
import path from 'node:path';
import { callRuntime } from '../bridge/index.ts';
import { analyzeMotion, formatStyleIssues, gif, motionStrip, motionSummary, speedGraph, styleLint } from '@ae-mcp/core/motion/index.ts';
import type { MotionData, StyleIssue, StyleOptions } from '@ae-mcp/core/motion/index.ts';
import type { LintAnim, LintData } from '../lint/index.ts';
import { cssBezier } from '../shared/bezier.ts';
import { offBeatCuts } from '@ae-mcp/core/audio/beats.ts';
import { springUnit } from '../shared/spring.ts';
import os from 'node:os';

const OUT_ROOT = path.join(os.homedir(), '.ae-compose', 'out');

export interface MotionOptions {
  /** Draw the speed graph PNG (default true). */
  graph?: boolean;
  /** Style lint settings, or false to skip the craft rules. */
  style?: StyleOptions | false;
}

export interface MotionReport {
  ok: boolean;
  error?: string;
  comp: string;
  /** Speed graph PNG: one row per animated layer, holds shaded, easing per move, "layers moving" at the bottom. */
  graph?: string;
  /** A few lines on how the piece moves (arrivals, holds, what moves at once). */
  summary: string[];
  style: StyleIssue[];
  /** Style issues as lint lines, warnings first. */
  lines: string[];
  layers: number;
  samples: number;
  ms: number;
}

/** AE-side sampling settings: every second frame (15 per second at 30 fps), at most 150 samples. */
export const MOTION_SAMPLE_OPTS = { maxSamples: 150, maxLayers: 80, clonesPerGroup: 6 };

const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 60);

/**
 * Tags the compiler knows (IR layer `tags`: 'bg', 'transition:<kind>', 'persistent', 'hero'…) added to the samples
 * by layer id, and transitions collected from them.
 */
export function tagFromIr(data: MotionData, ir?: any): MotionData {
  if (!ir) return data;
  const tags = new Map<string, string[]>();
  for (const c of ir.comps ?? []) for (const L of c.layers ?? []) if (L.tags?.length) tags.set(L.id, L.tags);
  for (const L of data.layers) {
    const t = L.id ? tags.get(L.id) : undefined;
    if (t) L.tags = [...new Set([...(L.tags ?? []), ...t])];
  }
  return data;
}

/** Progress (0–1) of one unit `x` seconds after it starts: spring, cubic bezier over `dur`, or linear. */
function unitProgress(a: LintAnim, x: number): number {
  if (x <= 0) return 0;
  if (a.spring && a.spring.every(Number.isFinite)) return springUnit(x * 60, 60, a.spring[0], a.spring[1], a.spring[2]);
  const u = Math.min(1, x / Math.max(a.dur, 1e-6));
  return a.bezier ? cssBezier(a.bezier, u) : u;
}

/**
 * Per-unit text reveals move characters, not the layer, so transform samples miss them. The text lint knows each
 * ae-compose animator's timing (LintText.anims): fold the share of units revealed (or still there, for exits) into
 * the matching top-level text layer's opacity samples, so arrivals, holds and crowded entrances include them.
 */
export function foldTextReveals(data: MotionData, lint?: LintData): MotionData {
  if (!lint?.texts?.length) return data;
  for (const T of lint.texts) {
    if (!T.anims?.length || T.path.includes(' > ')) continue;
    const M = data.layers.find((L) => L.kind === 'text' && L.name === T.name);
    if (!M) continue;
    const lin = T.lin ?? T.in, lout = T.lout ?? T.out;
    data.times.forEach((t, k) => {
      const v = M.s[k];
      if (!v) return;
      let f = 1;
      for (const a of T.anims!) {
        if (![a.each, a.dur, a.delay].every(Number.isFinite)) continue;
        const n = Math.max(1, Math.min(T.units?.[a.by] ?? 1, 200));
        const base = a.anchor === 'end' ? lout - a.delay : lin + a.off + a.delay;
        let sum = 0;
        for (let i = 0; i < n; i++) {
          const c = (n - 1) / 2;
          const order = a.order === 'end' ? n - 1 - i : a.order === 'center' ? Math.abs(i - c) : a.order === 'edges' ? c - Math.abs(i - c) : i;
          sum += unitProgress(a, t - base - order * a.each);
        }
        const p = sum / n;
        f *= a.dir === 'in' ? p : 1 - p;
      }
      M.s[k] = [v[0], v[1], v[2], v[3], v[4], v[5] * Math.max(0, Math.min(1.2, f))];
    });
    M.tags = [...new Set([...(M.tags ?? []), 'text-reveal'])];
  }
  return data;
}

/**
 * off-beat (A5): with a beat grid on the comp (BeatMarkers), scene starts and element entrances that land just off a
 * beat (within 0.15 s, more than a frame away) read as sloppy sync: snap them (beatsOf().snap) or move them on purpose.
 */
function offBeat(d: MotionData): StyleIssue[] {
  if (!d.beats?.length) return [];
  const cuts = new Map<number, string>();
  for (const s of d.scenes) if (s.t > 0.05) cuts.set(+s.t.toFixed(3), `scene "${s.name}" starts`);
  for (const L of d.layers) if (L.in > 0.05 && L.in < d.dur - 0.05 && L.kind !== 'null' && !(L.tags ?? []).includes('controls')) if (!cuts.has(+L.in.toFixed(3))) cuts.set(+L.in.toFixed(3), `"${L.name}" enters`);
  const tol = 1 / d.fps + 0.01;
  return offBeatCuts([...cuts.keys()], d.beats, { window: 0.15, tolerance: tol }).map((c) => ({
    rule: 'off-beat' as const, severity: 'warn' as const, t: [c.t, c.t] as [number, number], layer: cuts.get(+c.t.toFixed(3)),
    message: `${cuts.get(+c.t.toFixed(3))} at ${c.t.toFixed(2)}s, ${Math.abs(c.offBy * 1000).toFixed(0)} ms ${c.offBy > 0 ? 'after' : 'before'} the beat at ${c.nearest.toFixed(2)}s: snap it to the beat (beatsOf(...).snap) or move it clearly off it`,
  }));
}

/** Judges motion samples (from a build, an edit or motionSample) and draws the speed graph. */
export async function motionReport(data: any, opts: MotionOptions = {}, ir?: any, lint?: LintData): Promise<MotionReport> {
  const t0 = Date.now();
  if (!data || !data.ok) return { ok: false, error: data?.error ?? 'no motion samples', comp: data?.comp ?? '', summary: [], style: [], lines: [], layers: 0, samples: 0, ms: 0 };
  const d = foldTextReveals(tagFromIr(data as MotionData, ir), lint);
  const a = analyzeMotion(d);
  const style = opts.style === false ? [] : [...styleLint(d, a, opts.style ?? {}), ...(opts.style?.ignore?.includes('off-beat') ? [] : offBeat(d))];
  let graph: string | undefined;
  if (opts.graph !== false && d.layers.length) {
    const file = path.join(OUT_ROOT, safe(d.comp), `motion_${Date.now()}.png`);
    try { graph = (await speedGraph(d, a, file)).file; } catch { graph = undefined; }
  }
  const summary = motionSummary(a);
  if ((data as any).coarse > 1) summary.push(`sampled every ${+(d.step * d.fps).toFixed(1)} frames (expression-heavy comp, kept to the time budget): moves shorter than that may be missed`);
  return { ok: true, comp: d.comp, graph, summary, style, lines: formatStyleIssues(style), layers: d.layers.length, samples: d.times.length, ms: (data.ms ?? 0) + Date.now() - t0 };
}

/** Samples any comp's motion and judges it (for lint_comp and the motion_preview tool). */
export async function motionOfComp(comp: string | number | undefined, opts: MotionOptions = {}): Promise<MotionReport> {
  const data = await callRuntime('motionSample', [comp ?? null, MOTION_SAMPLE_OPTS], { timeoutMs: 300_000 });
  return motionReport(data, opts);
}

/**
 * Dense frames of one segment (default the busiest second) as a labelled strip PNG the agent can read, a GIF for
 * humans, and the speed graph of the whole comp.
 */
export async function motionPreview(comp: string | number | undefined, opts: { start?: number; end?: number; frames?: number; gif?: boolean } = {}): Promise<{ strip: string; gif?: string; report: MotionReport; times: number[] }> {
  const data = await callRuntime('motionSample', [comp ?? null, MOTION_SAMPLE_OPTS], { timeoutMs: 300_000 });
  const report = await motionReport(data, {});
  if (!data.ok) throw new Error(data.error);
  // Default segment: one second around the busiest moment (most layers moving).
  const peakAt = analyzeMotion(data as MotionData).activity.peakAt;
  const start = opts.start ?? Math.max(0, Math.min(data.dur - 1, peakAt - 0.5));
  const end = opts.end ?? Math.min(data.dur, start + 1);
  const n = Math.max(2, Math.min(opts.frames ?? 12, 24));
  const times = Array.from({ length: n }, (_, i) => +(start + ((end - start) * i) / (n - 1)).toFixed(4));
  const dir = path.join(OUT_ROOT, '_motion', safe(String(comp ?? 'active')) + '_' + Date.now()).replace(/\\/g, '/');
  const r = await callRuntime('contactFrames', [comp ?? null, n, dir, times], { timeoutMs: 600_000 });
  if (!r.ok) throw new Error(r.error);
  const frames = r.frames.filter((f: any) => f.ok).map((f: any) => ({ t: f.t, file: f.file }));
  fs.mkdirSync(dir, { recursive: true });
  const strip = await motionStrip(frames, path.join(dir, 'strip.png'), { bpc: r.bpc, fps: r.fps, title: `${r.comp} ${start.toFixed(2)}–${end.toFixed(2)} s` });
  const g = opts.gif === false ? undefined : await gif(frames, path.join(dir, 'preview.gif'), { bpc: r.bpc });
  return { strip, gif: g, report, times };
}
