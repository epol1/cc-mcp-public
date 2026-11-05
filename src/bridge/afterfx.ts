// Fallback backend: `AfterFX.com -r wrapper.jsx`; the wrapper evals the payload under try/catch and writes JSON.
// ~1.1 s per call (measured). Used when the CEP bridge is unavailable.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import type { Backend, EvalResult } from '@ae-mcp/core/bridge/types.ts';
import { findAfterEffects } from './locate.ts';

function jsString(s: string): string {
  return JSON.stringify(s).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

export class AfterFxBackend implements Backend {
  readonly name = 'afterfx' as const;

  async health(): Promise<{ ok: boolean; detail?: string }> {
    const ae = findAfterEffects();
    return ae ? { ok: true, detail: ae.com } : { ok: false, detail: 'AfterFX.com not found' };
  }

  async eval(script: string, opts: { timeoutMs?: number } = {}): Promise<EvalResult> {
    const ae = findAfterEffects();
    if (!ae) return { ok: false, error: 'After Effects not found' };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aec-'));
    const out = path.join(dir, 'result.json').replace(/\\/g, '/');
    const wrapper = path.join(dir, 'run.jsx');
    fs.writeFileSync(wrapper, `(function(){var r,f=new File(${jsString(out)});try{var v=eval(${jsString(script)});r='{"ok":true,"result":'+__q(v===undefined||v===null?'':String(v))+'}';}catch(e){r='{"ok":false,"error":'+__q(String(e&&e.message||e))+',"line":'+(e&&e.line||0)+'}';}f.encoding='UTF-8';f.open('w');f.write(r);f.close();
function __q(s){var o=['"'];for(var i=0;i<s.length;i++){var c=s.charCodeAt(i);if(c===34)o.push('\\\\"');else if(c===92)o.push('\\\\\\\\');else if(c<32||c>126)o.push('\\\\u'+('0000'+c.toString(16)).slice(-4));else o.push(s.charAt(i));}o.push('"');return o.join('');}})();`);
    const t0 = performance.now();
    const timeoutMs = opts.timeoutMs ?? 120_000;
    await new Promise<void>((res) => execFile(ae.com, ['-r', wrapper], { timeout: 30_000, windowsHide: true }, () => res()));
    while (performance.now() - t0 < timeoutMs) {
      if (fs.existsSync(out)) {
        try {
          const j = JSON.parse(fs.readFileSync(out, 'utf8'));
          fs.rmSync(dir, { recursive: true, force: true });
          return j.ok ? { ok: true, result: j.result, ms: Math.round(performance.now() - t0) } : { ok: false, error: j.error, line: j.line };
        } catch { /* partially written */ }
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    return { ok: false, error: `timeout after ${timeoutMs} ms`, timedOut: true };
  }
}
