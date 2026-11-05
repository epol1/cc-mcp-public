// Lint report for a comp: text samples from AE (taken inside a build/edit's undo group, or standalone) judged by
// the rules in src/lint, plus a blank-frame check on rendered frames. Builds and edits attach it automatically.
import { callRuntime } from '../bridge/index.ts';
import { formatIssues, lintRules, LINT_RULES } from '../lint/index.ts';
import type { LintData, LintIssue, LintOptions, LintRule } from '../lint/index.ts';
import { blankFrames } from '../lint/frames.ts';

export type { LintOptions, LintIssue, LintRule };

export interface LintReport {
  comp: string;
  ok: boolean;
  error?: string;
  issues: LintIssue[];
  /** One line per issue, warnings first. */
  lines: string[];
  texts: number;
  samples: number;
  frames: number;
  truncated?: boolean;
  ms: number;
}

/** AE-side sampler settings: a sample every 0.1 s (snapped to frames). */
export const SAMPLE_OPTS = { step: 0.1 };

/** Merges lint settings: scene config first, then the call's options; false anywhere disables lint. */
export function lintSettings(...layers: (boolean | LintOptions | undefined)[]): LintOptions | false {
  let out: LintOptions = {};
  for (const l of layers) {
    if (l === false) return false;
    if (l && typeof l === 'object') out = { ...out, ...l, ignore: [...(out.ignore ?? []), ...(l.ignore ?? [])] };
  }
  for (const r of out.ignore ?? []) if (!LINT_RULES.includes(r)) throw new Error(`unknown lint rule "${r}" (rules: ${LINT_RULES.join(', ')})`);
  return out;
}

/** Judges samples the runtime already took (build/edit results), plus rendered frames when there are some. */
export async function lintFromSamples(data: any, opts: LintOptions, frames?: { t: number; file: string }[], bpc = 8): Promise<LintReport> {
  const t0 = Date.now();
  if (!data || !data.ok) return { comp: data?.comp ?? '', ok: false, error: data?.error ?? 'no lint samples', issues: [], lines: [], texts: 0, samples: 0, frames: 0, ms: 0 };
  const d = data as LintData;
  const issues = lintRules(d, opts);
  if (frames?.length && !(opts.ignore ?? []).includes('blank-frame')) issues.push(...(await blankFrames(frames, bpc)));
  const lines = formatIssues(issues);
  if (d.truncated) lines.push(`note: only the first ${d.texts.length} text layers were checked`);
  return { comp: d.comp, ok: true, issues, lines, texts: d.texts.length, samples: d.times.length, frames: frames?.length ?? 0, truncated: d.truncated, ms: (d.ms ?? 0) + Date.now() - t0 };
}

/** Standalone lint of any comp (generated or hand-built). Renders `frames` frames for the blank-frame check. */
export async function lintComp(comp: string | number | undefined, opts: LintOptions & { frames?: number } = {}): Promise<LintReport> {
  const data = await callRuntime('lintSample', [comp ?? null, SAMPLE_OPTS], { timeoutMs: 300_000 });
  let frames: { t: number; file: string }[] | undefined, bpc = 8;
  const n = opts.frames ?? 8;
  if (data.ok && n > 0) {
    const { contactSheet } = await import('./index.ts');
    const r = await contactSheet(data.itemId, n);
    frames = r.frames;
    bpc = r.bpc;
  }
  return lintFromSamples(data, opts, frames, bpc);
}

/** Report header plus its issue lines (at most `max`), for CLI and MCP output. */
export function lintSummary(r: LintReport | undefined, label?: string, max = 15): string[] {
  if (!r) return [];
  const tag = `lint${label ? ` [${label}]` : ''} ${r.comp}`;
  if (!r.ok) return [`${tag}: failed (${r.error})`];
  const warns = r.issues.filter((i) => i.severity === 'warn').length, notes = r.issues.length - warns;
  const head = `${tag}: ${warns ? `${warns} warning${warns === 1 ? '' : 's'}` : 'no warnings'}${notes ? `, ${notes} note${notes === 1 ? '' : 's'}` : ''} (${r.texts} text layers over ${r.samples} samples${r.frames ? `, ${r.frames} frames` : ''})`;
  const lines = r.lines.slice(0, max).map((l) => `- ${l}`);
  if (r.lines.length > max) lines.push(`- … ${r.lines.length - max} more (lint_comp lists them all)`);
  return [head, ...lines];
}

/** zod-free shape check for lint options coming from CLI flags. */
export function lintFlags(flags: Record<string, any>): boolean | LintOptions | undefined {
  if (flags['no-lint']) return false;
  const o: LintOptions = {};
  if (flags.safe !== undefined) o.safe = flags.safe === 'title' || flags.safe === 'action' ? flags.safe : +flags.safe;
  if (flags['reading-rate'] !== undefined) o.readingRate = +flags['reading-rate'];
  if (flags.ignore !== undefined) o.ignore = String(flags.ignore).split(',') as LintRule[];
  return Object.keys(o).length ? o : undefined;
}
