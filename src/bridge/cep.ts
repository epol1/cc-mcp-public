// CEP backend: HTTP to the ae-compose CEP extension on 127.0.0.1 (token in ~/.ae-compose/bridge.json).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Backend, EvalResult } from './types.ts';

export const BRIDGE_INFO = path.join(os.homedir(), '.ae-compose', 'bridge.json');

interface BridgeInfo { port: number; token: string }

function readInfo(): BridgeInfo | null {
  try { return JSON.parse(fs.readFileSync(BRIDGE_INFO, 'utf8')); } catch { return null; }
}

export class CepBackend implements Backend {
  readonly name = 'cep' as const;

  async health(): Promise<{ ok: boolean; detail?: string }> {
    const info = readInfo();
    if (!info) return { ok: false, detail: `no ${BRIDGE_INFO} (CEP extension never started)` };
    try {
      const r = await fetch(`http://127.0.0.1:${info.port}/health`, { signal: AbortSignal.timeout(1500) });
      const j: any = await r.json();
      return { ok: !!j.ok, detail: `bridge v${j.version} (${j.role}), ${j.stats?.evals ?? 0} evals` };
    } catch (e: any) {
      return { ok: false, detail: `bridge not reachable on :${info.port} (${e.cause?.code ?? e.message})` };
    }
  }

  async eval(script: string, opts: { timeoutMs?: number } = {}): Promise<EvalResult> {
    const info = readInfo();
    if (!info) return { ok: false, error: 'CEP bridge info missing; is After Effects running with the ae-compose extension?' };
    const timeoutMs = opts.timeoutMs ?? 120_000;
    const t0 = performance.now();
    try {
      const r = await fetch(`http://127.0.0.1:${info.port}/eval`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-aec-token': info.token },
        body: JSON.stringify({ script, timeoutMs }),
        signal: AbortSignal.timeout(timeoutMs + 5000),
      });
      const j: any = await r.json();
      if (j.ok) return { ok: true, result: j.result ?? '', ms: j.ms ?? Math.round(performance.now() - t0) };
      return { ok: false, error: j.error, errorName: j.errorName, line: j.line, timedOut: j.timedOut, ms: Math.round(performance.now() - t0) };
    } catch (e: any) {
      return { ok: false, error: `bridge request failed: ${e.cause?.code ?? e.message}` };
    }
  }
}
