// prc doctor: is everything pr-cut needs in place? Premiere, the CEP bridge, the UXP plugin, the transcription
// engine, ffmpeg, the media library and the caches — each with a fix when it isn't.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { appWindows } from '@cc-mcp/core/bridge/dialogs.ts';
import { AEC_HOME, TRANSCRIPTS, whisperEngine } from '@cc-mcp/core/transcribe/index.ts';
import { es, PR_BRIDGE_INFO } from './bridge.ts';

export interface Check { name: string; ok: boolean; detail: string; fix?: string }

function dirSize(dir: string): number {
  let n = 0;
  try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); n += e.isDirectory() ? dirSize(p) : fs.statSync(p).size; } } catch { /* missing */ }
  return n;
}
const mb = (b: number) => `${(b / 1048576).toFixed(1)} MB`;

export async function doctor(): Promise<Check[]> {
  const out: Check[] = [];
  const w = await appWindows('pr').catch(() => null);
  out.push({ name: 'Premiere Pro running', ok: !!w?.running, detail: w?.main ? `${w.main.title}${w.hung ? ' (not responding)' : ''}${w.dialogs.length ? `; ${w.dialogs.length} dialog(s) open` : ''}` : 'not running', fix: 'Start Premiere Pro 2026' });
  const h = await es.health();
  out.push({ name: 'pr-cut CEP bridge', ok: h.ok, detail: h.detail ?? '', fix: `node scripts/install-cep.mjs --pr, then restart Premiere (info: ${PR_BRIDGE_INFO})` });
  const ux = (h as any).raw?.uxp;
  out.push({ name: 'pr-cut UXP plugin', ok: !!ux?.connected, detail: ux?.connected ? `connected (${ux.pluginVersion ?? '?'})` : 'not connected (optional: transcripts from Premiere, transactions)', fix: 'Load packages/bridge-uxp-pr in the UXP Developer Tool (Developer Mode on)' });
  if (h.ok) {
    try {
      const v = await es.eval('app.version + " / project: " + (app.project && app.project.path ? app.project.path : "none")', { timeoutMs: 5000 });
      out.push({ name: 'ExtendScript round trip', ok: v.ok, detail: v.ok ? v.result : v.error });
    } catch (e: any) { out.push({ name: 'ExtendScript round trip', ok: false, detail: e.message }); }
  }
  const wh = await whisperEngine.available();
  out.push({ name: 'Transcription (faster-whisper)', ok: wh.ok, detail: wh.detail });
  let ff = '';
  try { ff = execFileSync('ffmpeg', ['-version'], { encoding: 'utf8' }).split('\n')[0]; } catch { /* missing */ }
  out.push({ name: 'ffmpeg', ok: !!ff, detail: ff || 'not on PATH', fix: 'choco install ffmpeg' });
  const lib = path.join(AEC_HOME, 'library', 'library.db');
  out.push({ name: 'Media library', ok: true, detail: fs.existsSync(lib) ? `${lib} (${mb(fs.statSync(lib).size)})` : 'empty (library_add a folder to start)' });
  out.push({ name: 'Caches', ok: true, detail: `transcripts ${mb(dirSize(TRANSCRIPTS))}, frames ${mb(dirSize(path.join(AEC_HOME, 'pr-cut', 'frames')))}, library ${mb(dirSize(path.join(AEC_HOME, 'library')))}` });
  return out;
}

export const formatChecks = (c: Check[]) => c.map((x) => `${x.ok ? 'ok  ' : 'FAIL'} ${x.name}: ${x.detail}${!x.ok && x.fix ? `\n     fix: ${x.fix}` : ''}`).join('\n');
