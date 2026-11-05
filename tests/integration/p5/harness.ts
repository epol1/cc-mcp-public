// Helpers for the Phase 5 AE integration checks (run by tests/integration/p5.test.ts, or directly with tsx).
// Each check builds or edits, confirms the result through the inspector or AE values, undoes once and confirms the
// comp is back exactly as before, and runs lint. Output lines start with PASS or FAIL.
import { buildScene, inspect, undo } from '../../../src/api/index.ts';
import type { BuildOptions, BuildReport } from '../../../src/api/index.ts';
import { evalAE } from '../../../src/bridge/index.ts';

let failures = 0;
export function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail && !ok ? ` (${detail})` : ''}`);
}
export function done(): void {
  console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
  if (failures) process.exitCode = 1;
}

/** Runs ExtendScript and returns its string result (throws on errors). */
export async function es(code: string, timeoutMs = 120_000): Promise<string> {
  const r = await evalAE(code, { timeoutMs });
  if (!r.ok) throw new Error(`AE: ${r.error}`);
  return r.result;
}

export const findComp = (name: string) => `(function () { for (var i = 1; i <= app.project.numItems; i++) { var it = app.project.item(i); if (it instanceof CompItem && it.name === ${JSON.stringify(name)}) return it; } return null; })()`;

/** A comparable fingerprint of a comp (full inspector JSON minus volatile fields), or "none". */
export async function fingerprint(comp: string): Promise<string> {
  const exists = await es(`${findComp(comp)} ? "1" : "0"`);
  if (exists !== '1') return 'none';
  const j = (await inspect({ comp, detail: 'full' })).json;
  return JSON.stringify(j, (k, v) => (k === 'itemId' || k === 'ms' || k === 'id' && typeof v === 'number' ? undefined : v));
}

/** Builds, checks the report, undoes once and compares fingerprints; returns the report of the build. */
export async function buildUndoCheck(label: string, file: string, comp: string, opts: BuildOptions = {}, verify?: (r: BuildReport) => Promise<void>): Promise<BuildReport> {
  const before = await fingerprint(comp);
  const r = await buildScene({ file }, { frames: 4, ...opts });
  check(`${label}: builds`, r.ok, r.error ?? '');
  check(`${label}: no expression errors`, r.exprErrors.length === 0, r.exprErrors.map((e) => `${e.node}: ${e.error.split('\n')[0]}`).join('; '));
  check(`${label}: lint ran`, !!r.lint?.length && r.lint.every((l) => l.ok), r.lint?.map((l) => l.error ?? '').join(' '));
  if (r.ok && verify) await verify(r);
  const u = await undo(r.undoSteps ?? 1);
  check(`${label}: undo succeeded`, !!u.ok, u.error ?? '');
  const after = await fingerprint(comp);
  check(`${label}: one undo restores the comp exactly`, after === before, after === 'none' ? 'comp still exists' : before === 'none' ? 'comp should be gone' : 'fingerprint differs');
  return r;
}
