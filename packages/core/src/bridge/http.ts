// Token-authenticated HTTP bridge client: the ae-compose CEP bridge (AE) and the pr-cut hub (Premiere) both serve
// GET /health and POST /eval on 127.0.0.1, with the port and token in a JSON file under ~/.ae-compose.
import fs from 'node:fs';
import http from 'node:http';
import type { Backend, EvalResult } from './types.ts';

export interface BridgeInfo { port: number; token: string }

export function readBridgeInfo(file: string): BridgeInfo | null {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

export interface HttpBridgeOptions {
  name: Backend['name'];
  /** JSON file with { port, token } written by the bridge when it starts listening. */
  infoFile: string;
  /** Route that evaluates a script (default /eval). */
  route?: string;
  /** Said when the info file is missing: which app and extension should be running. */
  missingHint: string;
}

export class HttpBridge implements Backend {
  readonly name: Backend['name'];
  constructor(readonly opts: HttpBridgeOptions) { this.name = opts.name; }

  async health(): Promise<{ ok: boolean; detail?: string; raw?: any }> {
    const info = readBridgeInfo(this.opts.infoFile);
    if (!info) return { ok: false, detail: `no ${this.opts.infoFile} (${this.opts.missingHint})` };
    try {
      const r = await fetch(`http://127.0.0.1:${info.port}/health`, { signal: AbortSignal.timeout(1500) });
      const j: any = await r.json();
      return { ok: !!j.ok, detail: `bridge v${j.version} (${j.role}), ${j.stats?.evals ?? 0} evals`, raw: j };
    } catch (e: any) {
      return { ok: false, detail: `bridge not reachable on :${info.port} (${e.cause?.code ?? e.message})` };
    }
  }

  async eval(script: string, opts: { timeoutMs?: number } = {}): Promise<EvalResult> {
    const info = readBridgeInfo(this.opts.infoFile);
    if (!info) return { ok: false, error: `bridge info missing; ${this.opts.missingHint}` };
    const timeoutMs = opts.timeoutMs ?? 120_000;
    const t0 = performance.now();
    try {
      const j: any = await postJson(info.port, this.opts.route ?? '/eval', { 'x-aec-token': info.token }, { script, timeoutMs }, timeoutMs + 5000);
      if (j.ok) return { ok: true, result: typeof j.result === 'string' ? j.result : JSON.stringify(j.result ?? ''), ms: j.ms ?? Math.round(performance.now() - t0) };
      return { ok: false, error: j.error, errorName: j.errorName, line: j.line, timedOut: j.timedOut, ms: Math.round(performance.now() - t0) };
    } catch (e: any) {
      return { ok: false, error: `bridge request failed: ${e.code ?? e.cause?.code ?? e.message}` };
    }
  }
}

/**
 * POST JSON to a bridge with node:http. Not fetch: Node's fetch gives up waiting for response headers after
 * 300 s whatever the abort signal says, and a large build can take longer (D86).
 */
export function postJson(port: number, route: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body), 'utf8');
    // agent: false = a fresh connection per request. Node 22 reuses keep-alive sockets, which the bridges' older
    // CEP Node closes after 5 s idle; reusing one mid-close resets the request (seen as ECONNRESET).
    const req = http.request({ host: '127.0.0.1', port, path: route, method: 'POST', agent: false, headers: { ...headers, 'content-type': 'application/json', 'content-length': data.length } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); }
      });
      res.on('error', reject);
    });
    const timer = setTimeout(() => req.destroy(Object.assign(new Error(`no answer after ${timeoutMs} ms`), { code: 'TIMEOUT' })), timeoutMs);
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.on('close', () => clearTimeout(timer));
    req.end(data);
  });
}
