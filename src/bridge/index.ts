// Bridge entry: picks a backend, makes sure the ES3 runtime is loaded in AE, runs runtime calls,
// and turns hangs/dialogs into structured, agent-readable errors.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CepBackend } from './cep.ts';
import { AfterFxBackend } from './afterfx.ts';
import { aeWindows, autoAnswerKnown } from './dialogs.ts';
import type { Backend, EvalResult } from './types.ts';
import { es3String, toEs3Literal } from '../codegen/literal.ts';

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
export async function evalAE(script: string, opts: { timeoutMs?: number } = {}): Promise<EvalResult> {
  const b = await getBackend();
  const r = await b.eval(script, opts);
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
export async function callRuntime<T = any>(fn: string, args: unknown[], opts: { timeoutMs?: number } = {}): Promise<T> {
  const script = ensurePreamble() + `AEC.${fn}(${args.map((a) => toEs3Literal(a)).join(', ')});`;
  const r = await evalAE(script, opts);
  if (!r.ok) {
    const err: any = new Error(`AE eval failed: ${r.error}${r.line ? ` (line ${r.line})` : ''}`);
    err.dialogs = r.dialogs;
    throw err;
  }
  try {
    return JSON.parse(r.result) as T;
  } catch {
    throw new Error(`runtime returned non-JSON: ${r.result.slice(0, 300)}`);
  }
}
