// Storyboard first (Phase 5 A3): planScene(beatSheet) checks the plan against the direction rules before any detail
// is written and scaffolds a buildable scene .tsx (named beats, placeholders, transitions, controls). verifyScaffold
// compiles it with the real compiler (no After Effects). formatPlan renders the result for the agent.
import fs from 'node:fs';
import path from 'node:path';
import { buildTimeline } from './timing.ts';
import { checkPlan } from './check.ts';
import { planStyleIssues } from './style.ts';
import { scaffold } from './scaffold.ts';
import { readBrand } from './brand.ts';
import type { BrandInfo } from './brand.ts';
import type { BeatSheet, PlanIssue, PlanOptions, PlanResult } from './types.ts';

export * from './types.ts';
export { buildTimeline, readingTime, TIMING } from './timing.ts';
export { checkPlan, isFurniture } from './check.ts';
export { planMotion, planStyleIssues } from './style.ts';
export { scaffold } from './scaffold.ts';
export { readBrand, brandTokensUsed } from './brand.ts';
export type { BrandInfo } from './brand.ts';

/** Throws one error listing every structural problem (the plan can't be timed without these). */
export function validateSheet(sheet: BeatSheet): void {
  const errs: string[] = [];
  if (!sheet || typeof sheet !== 'object') throw new Error('plan: a beat sheet object is required');
  if (!sheet.name || typeof sheet.name !== 'string') errs.push('name: a scene name is required');
  if (typeof sheet.message !== 'string') errs.push('message: the one message of the piece is required');
  if (!Array.isArray(sheet.beats) || !sheet.beats.length) errs.push('beats: at least one beat is required');
  const posNum = (v: any) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  (sheet.beats ?? []).forEach((b, i) => {
    const at = `beats[${i}]${b?.name ? ` "${b.name}"` : ''}`;
    if (!b || typeof b !== 'object') { errs.push(`${at}: must be an object`); return; }
    if (!b.name || typeof b.name !== 'string') errs.push(`${at}.name: required`);
    if (!posNum(b.duration)) errs.push(`${at}.duration: seconds > 0 required`);
    if (b.text !== undefined && typeof b.text !== 'string' && !(Array.isArray(b.text) && b.text.every((t) => typeof t === 'string'))) errs.push(`${at}.text: a string or an array of strings`);
    if (b.hold !== undefined && !(typeof b.hold === 'number' && b.hold >= 0)) errs.push(`${at}.hold: seconds ≥ 0`);
    if (b.overlap !== undefined && !(typeof b.overlap === 'number' && Number.isFinite(b.overlap))) errs.push(`${at}.overlap: seconds`);
    if (b.holdTo !== undefined && b.holdTo !== 'end') errs.push(`${at}.holdTo: only 'end'`);
  });
  for (const k of ['width', 'height', 'fps'] as const) if (sheet[k] !== undefined && !posNum(sheet[k])) errs.push(`${k}: a positive number`);
  if (sheet.end?.hold !== undefined && !(typeof sheet.end.hold === 'number' && sheet.end.hold >= 0)) errs.push('end.hold: seconds ≥ 0');
  if (errs.length) throw new Error(`plan: invalid beat sheet:\n- ${errs.join('\n- ')}`);
}

/** A path as the scene file should reference it: relative to the file (./x, ../x), or absolute with forward slashes. */
export function refFrom(target: string, file?: string): string {
  const abs = path.resolve(target);
  if (!file) return abs.replace(/\\/g, '/');
  const rel = path.relative(path.dirname(path.resolve(file)), abs);
  if (!rel || path.isAbsolute(rel)) return abs.replace(/\\/g, '/');
  const r = rel.replace(/\\/g, '/');
  return r.startsWith('.') ? r : `./${r}`;
}

const order = (i: PlanIssue) => (i.severity === 'warn' ? 0 : 1);

/** Check a beat sheet and scaffold the scene. Writes `opts.file` when given (refuses to overwrite unless opts.overwrite). */
export function planScene(sheet: BeatSheet, opts: PlanOptions = {}): PlanResult {
  validateSheet(sheet);
  const cwd = opts.cwd ?? process.cwd();
  const issues: PlanIssue[] = [];
  let brand: { info: BrandInfo; spec: string } | undefined;
  if (sheet.brand) {
    const abs = path.resolve(cwd, sheet.brand);
    const info = fs.existsSync(abs) ? readBrand(abs) : null;
    if (info) brand = { info, spec: refFrom(abs, opts.file) };
    else issues.push({ rule: 'missing-file', severity: 'warn', message: `brand "${sheet.brand}" ${fs.existsSync(abs) ? 'has no `export const X = brand({...})`' : `not found (looked at ${abs})`}: the scaffold uses the default palette` });
  }
  let logoSrc: string | undefined;
  if (sheet.end?.logo) {
    const abs = path.resolve(cwd, sheet.end.logo);
    if (fs.existsSync(abs) && /\.svg$/i.test(abs)) logoSrc = refFrom(abs, opts.file);
    else issues.push({ rule: 'missing-file', severity: 'warn', beat: 'End Card', message: `logo "${sheet.end.logo}" ${fs.existsSync(abs) ? 'is not an .svg' : `not found (looked at ${abs})`}: the end card gets a placeholder mark` });
  }
  let musicSrc: string | undefined;
  if (sheet.music) {
    const abs = path.resolve(cwd, sheet.music);
    if (fs.existsSync(abs)) musicSrc = refFrom(abs, opts.file);
    else issues.push({ rule: 'missing-file', severity: 'warn', message: `music "${sheet.music}" not found (looked at ${abs}): no audio or beat markers in the scaffold` });
  }
  const { timeline, notes } = buildTimeline(sheet, !!logoSrc);
  issues.push(...notes, ...checkPlan(sheet, timeline));
  // Style rules on the planned timing; dead air already reported as a gap by the overlap rule is not repeated.
  const gaps = issues.filter((i) => i.rule === 'overlap' && i.t && i.t[1] > i.t[0] && /dead air/.test(i.message));
  for (const s of planStyleIssues(timeline))
    if (!(s.rule === 'dead-air' && gaps.some((g) => s.t && s.t[0] < g.t![1] + 0.1 && s.t[1] > g.t![0] - 0.1))) issues.push(s);
  issues.sort((a, b) => order(a) - order(b) || (a.t?.[0] ?? -1) - (b.t?.[0] ?? -1));
  const tsx = scaffold({ sheet, tl: timeline, brand, logoSrc, musicSrc });
  let file: string | undefined;
  if (opts.file) {
    file = path.resolve(opts.file);
    if (fs.existsSync(file) && !opts.overwrite) throw new Error(`plan: ${file} exists; pass overwrite: true to replace it`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, tsx);
  }
  return { tsx, file, issues, timeline };
}

export interface ScaffoldCheck { ok: boolean; error?: string; warnings: string[]; scenes: string[]; layers: number }

/** Compile a scaffold (file, or source + cwd) with the real compiler, without After Effects. */
export async function verifyScaffold(input: { file?: string; source?: string; cwd?: string }): Promise<ScaffoldCheck> {
  try {
    const { loadScene } = await import('../scene/load.ts');
    const { compileScene } = await import('../compile/compile.ts');
    const { def, file } = await loadScene(input);
    const r = compileScene(def, { sceneFile: file });
    const main = r.ir.comps.find((c: any) => c.id === r.ir.main) ?? r.ir.comps[r.ir.comps.length - 1];
    return { ok: true, warnings: r.warnings, scenes: (main.markers ?? []).filter((m: any) => m.dur).map((m: any) => m.comment), layers: main.layers.length };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e), warnings: [], scenes: [], layers: 0 };
  }
}

const s1 = (x: number) => `${(Math.round(x * 10) / 10).toFixed(1)}s`;

/** Agent-readable report: the timeline per beat, then the issues (warnings first). */
export function formatPlan(r: PlanResult, check?: ScaffoldCheck): string[] {
  const tl = r.timeline;
  const warns = r.issues.filter((i) => i.severity === 'warn').length;
  const lines = [`plan "${tl.name}": ${tl.beats.length} beats, ${s1(tl.duration)} at ${tl.width}×${tl.height} @ ${tl.fps} fps; ${warns} warning(s), ${r.issues.length - warns} note(s)`];
  for (const b of tl.beats) {
    lines.push(`- ${b.name} ${s1(b.start)}–${s1(b.end)}${b.transitionIn ? ` [in: ${b.transitionIn}, overlap ${s1(b.overlap)}]` : ''}${b.exits ? `, exits from ${s1(b.end - tl.exitLead)}` : ', holds to its end'}`);
    for (const e of b.elements) lines.push(`    ${e.role}${e.text ? ` "${(e.text.length > 40 ? e.text.slice(0, 39) + '…' : e.text).replace(/\s*[\r\n]+\s*/g, ' ')}"` : ''}: in ${s1(e.arrive[0])}–${s1(e.arrive[1])}, still ${s1(e.readable[0])}–${s1(e.readable[1])}${e.role === 'visual' || e.role === 'logo' ? '' : ` (needs ${s1(e.needs)})`}${e.leave ? `, out ${s1(e.leave[0])}–${s1(e.leave[1])}` : ''}`);
  }
  if (r.issues.length) lines.push('issues:', ...r.issues.map((i) => `- ${i.severity === 'warn' ? 'warn' : 'note'} [${i.rule}] ${i.message}`));
  else lines.push('issues: none');
  if (check) lines.push(check.ok ? `scaffold compiles: ${check.layers} layers, scenes ${check.scenes.join(', ')}${check.warnings.length ? `; compiler warnings: ${check.warnings.join('; ')}` : ''}` : `scaffold does NOT compile: ${check.error}`);
  return lines;
}
