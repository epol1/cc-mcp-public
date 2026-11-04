// Bridge entry: picks a backend, makes sure the ES3 runtime is loaded in AE, runs runtime calls,
// and turns hangs/dialogs into structured, agent-readable errors.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CepBackend } from './cep.ts';
import { AfterFxBackend } from './afterfx.ts';
import { aeWindows, autoAnswerKnown, pressDialog } from './dialogs.ts';
import type { Backend, EvalResult } from './types.ts';
import { es3String, toEs3Literal } from '../codegen/literal.ts';
import { parse as parseJs } from 'acorn';

/** Throws if `code` is not valid ES3 (what ExtendScript accepts). */
export function assertEs3(code: string): void {
  try { parseJs(code, { ecmaVersion: 3, sourceType: 'script' }); }
  catch (e: any) { const at = e.pos ?? 0; throw new Error(`generated request is not valid ES3 (${e.message}) near: ${code.slice(Math.max(0, at - 60), at + 60)}`); }
}

export type { Backend, EvalResult, DialogInfo } from './types.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const RUNTIME_FILE = path.join(ROOT, 'dist/runtime/aec-runtime.jsx');

let backend: Backend | null = null;

export async function getBackend(): Promise<Backend> {
  if (backend) return backend;
  const cep = new CepBackend();
  if ((await cep.health()).ok) return (backend = cep);
  const fx = new AfterFxBackend();
  if ((await fx.health()).ok) return (backend = fx);
  throw new Error('No After Effects backend available: start After Effects 2026 (the ae-compose CEP extension loads with it).');
}

export function resetBackend(): void { backend = null; }

export function runtimeVersion(): string {
  const vf = path.join(ROOT, 'dist/runtime/version.json');
  if (!fs.existsSync(vf)) throw new Error('ES3 runtime not built: run `pnpm build:runtime`.');
  return JSON.parse(fs.readFileSync(vf, 'utf8')).version;
}

/** Preamble that (re)loads the runtime when missing or stale. Cheap when already loaded. */
export function ensurePreamble(): string {
  const v = runtimeVersion();
  return `if (!$.global.AEC || $.global.AEC.version !== ${es3String(v)}) { $.evalFile(new File(${es3String(RUNTIME_FILE.replace(/\\/g, '/'))})); }\n` +
    `if (!$.global.AEC || $.global.AEC.version !== ${es3String(v)}) { throw new Error("ae-compose runtime failed to load"); }\n`;
}

/** Raw eval with watchdog: on a timeout we look for dialogs and attach them (with captures) to the error. */
/**
 * Runs a script in AE. `cancelDialogs` (for read-only probes such as effect description): any modal dialog that
 * opens while the script runs (a LUT file picker, an effect's options dialog) is cancelled within seconds instead
 * of blocking AE until a human closes it.
 */
export async function evalAE(script: string, opts: { timeoutMs?: number; cancelDialogs?: boolean } = {}): Promise<EvalResult> {
  const b = await getBackend();
  let running = true;
  const cancelled: string[] = [];
  const watcher = opts.cancelDialogs
    ? (async () => {
        while (running) {
          await new Promise((res) => setTimeout(res, 3000));
          if (!running) break;
          try {
            const w = await aeWindows();
            // Only titled dialogs: untitled #32770 windows can be AE's own panels (seen at startup).
            for (const d of w.dialogs) { if (!d.title) continue; const pr = await pressDialog(d.hwnd, 'Cancel'); if (pr.pressed) cancelled.push(d.title); }
          } catch { /* best-effort */ }
        }
      })()
    : null;
  let r: EvalResult;
  try { r = await b.eval(script, opts); } finally { running = false; }
  void watcher;
  if (cancelled.length) (r as any).cancelledDialogs = cancelled;
  if (!r.ok && (r.timedOut || /bridge request failed/.test(r.error))) {
    try {
      const w = await aeWindows({ capture: true });
      if (w.dialogs.length) {
        const auto = await autoAnswerKnown(w);
        return { ...r, error: r.error + (auto.length ? ` (auto-answered: ${auto.join('; ')})` : ''), dialogs: w.dialogs };
      }
      if (w.hung) return { ...r, error: r.error + ' (After Effects is busy / not responding; no dialog is open)' };
      if (!w.running) return { ...r, error: r.error + ' (After Effects is not running)' };
    } catch { /* watchdog is best-effort */ }
  }
  return r;
}

/** Calls AEC.<fn>(...args) in AE and parses the JSON it returns. */
export async function callRuntime<T = any>(fn: string, args: unknown[], opts: { timeoutMs?: number; cancelDialogs?: boolean } = {}): Promise<T> {
  const call = `AEC.${fn}(${args.map((a) => toEs3Literal(a)).join(', ')});`;
  assertEs3(call); // every generated request is parsed as ES3 before it is sent (a syntax error in AE shows a modal alert)
  const script = ensurePreamble() + call;
  const r = await evalAE(script, opts);
  if (!r.ok) {
    const err: any = new Error(`AE eval failed: ${r.error}${r.line ? ` (line ${r.line})` : ''}`);
    err.dialogs = r.dialogs;
    throw err;
  }
  try {
    const j = JSON.parse(r.result);
    if ((r as any).cancelledDialogs && j && typeof j === 'object') j.cancelledDialogs = (r as any).cancelledDialogs;
    return j as T;
  } catch {
    throw new Error(`runtime returned non-JSON: ${r.result.slice(0, 300)}`);
  }
}
