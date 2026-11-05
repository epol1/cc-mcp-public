// pr-cut's connection to Premiere: ExtendScript through the pr-cut CEP bridge (port 47812) and, when loaded, the
// UXP plugin through the same hub (/uxp/eval). A timed-out call checks Premiere's windows so a modal dialog comes
// back to the agent as a captured image instead of a silent hang.
import os from 'node:os';
import path from 'node:path';
import { HttpBridge } from '@ae-mcp/core/bridge/http.ts';
import { appWindows, autoAnswerKnown } from '@ae-mcp/core/bridge/dialogs.ts';
import type { EvalResult } from '@ae-mcp/core/bridge/types.ts';

export const PR_BRIDGE_INFO = path.join(os.homedir(), '.ae-compose', 'bridge-pr.json');
const HINT = 'is Premiere Pro running with the pr-cut extension? (node scripts/install-cep.mjs --pr, then restart Premiere)';

export const es = new HttpBridge({ name: 'pr-cep', infoFile: PR_BRIDGE_INFO, missingHint: HINT });
export const uxp = new HttpBridge({ name: 'pr-uxp', infoFile: PR_BRIDGE_INFO, route: '/uxp/eval', missingHint: HINT });

export class PremiereError extends Error {
  constructor(message: string, readonly detail: EvalResult) { super(message); }
}

/** Shared ExtendScript helpers prepended to every script (ES3). */
export const ES_PRELUDE = `
if (typeof $.global.__prc === 'undefined') $.global.__prc = {};
app.enableQE();
function prcSeq(id) { for (var i = 0; i < app.project.sequences.numSequences; i++) { var s = app.project.sequences[i]; if (s.sequenceID === id) return s; } return null; }
function prcSeqIds() { var r = []; for (var i = 0; i < app.project.sequences.numSequences; i++) r.push(app.project.sequences[i].sequenceID); return r; }
function prcJson(v) {
  if (v === null || v === undefined) return 'null';
  var t = typeof v;
  if (t === 'number') return isFinite(v) ? String(v) : 'null';
  if (t === 'boolean') return String(v);
  if (t === 'string') return '"' + v.replace(/[\\\\"]/g, function (c) { return '\\\\' + c; }).replace(/\\n/g, '\\\\n').replace(/\\r/g, '\\\\r').replace(/\\t/g, '\\\\t').replace(/[\\u0000-\\u001f]/g, ' ') + '"';
  if (v instanceof Array) { var a = []; for (var i = 0; i < v.length; i++) a.push(prcJson(v[i])); return '[' + a.join(',') + ']'; }
  var o = []; for (var k in v) if (v.hasOwnProperty(k)) o.push(prcJson(k) + ':' + prcJson(v[k])); return '{' + o.join(',') + '}';
}
function prcUndo() { return qe.project.undoStackIndex(); }
`;

/** Run ExtendScript that ends in a value; returns the parsed JSON when the script returns prcJson(...). */
export async function runEs<T = unknown>(body: string, opts: { timeoutMs?: number; json?: boolean } = {}): Promise<T> {
  const r = await es.eval(ES_PRELUDE + '\n' + body, { timeoutMs: opts.timeoutMs ?? 120_000 });
  if (!r.ok) {
    if (r.timedOut) {
      const w = await appWindows('pr', { capture: true }).catch(() => null);
      if (w?.dialogs.length) {
        const auto = await autoAnswerKnown(w, 'pr');
        throw new PremiereError(`Premiere is blocked by a dialog: ${w.dialogs.map((d) => `"${d.title}"${d.capture ? ` (image: ${d.capture})` : ''}`).join(', ')}${auto.length ? `; answered ${auto.join(', ')}` : ''}. Use answer_dialog to dismiss it.`, r);
      }
    }
    throw new PremiereError(`Premiere script failed: ${r.error}${r.line ? ` (line ${r.line})` : ''}`, r);
  }
  if (opts.json === false) return r.result as T;
  try { return JSON.parse(r.result) as T; } catch { return r.result as T; }
}

/** ES3 string literal for embedding values in scripts. */
export const lit = (v: unknown) => JSON.stringify(v).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
/** Native path for Premiere's file APIs (forward slashes fail in some, D-PR1). */
export const nativePath = (p: string) => path.resolve(p).replace(/\//g, '\\');
