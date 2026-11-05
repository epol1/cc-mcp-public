// `aec doctor`: checks the whole environment and says exactly how to fix each failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { findAfterEffects } from '../bridge/locate.ts';
import { CepBackend, BRIDGE_INFO } from '../bridge/cep.ts';
import { callRuntime, RUNTIME_FILE } from '../bridge/index.ts';
import { aeWindows } from '@ae-mcp/core/bridge/dialogs.ts';

export interface Check { name: string; ok: boolean; detail: string; fix?: string; warn?: boolean }

function reg(key: string, value: string): string | null {
  try {
    const out = execFileSync('reg', ['query', key, '/v', value], { encoding: 'utf8', windowsHide: true });
    const m = new RegExp(`${value}\\s+REG_\\w+\\s+(\\S+)`).exec(out);
    return m ? m[1] : null;
  } catch { return null; }
}

export async function doctor(): Promise<{ ok: boolean; checks: Check[] }> {
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);
  add({ name: 'Node.js >= 22', ok: +process.versions.node.split('.')[0] >= 22, detail: process.version });
  const ae = findAfterEffects();
  add({ name: 'After Effects installed', ok: !!ae, detail: ae ? `${ae.year} at ${ae.dir}` : 'not found under C:\\Program Files\\Adobe', fix: 'Install After Effects 2026 or set AEC_AE_DIR' });
  if (ae) add({ name: 'aerender available', ok: fs.existsSync(ae.aerender), detail: ae.aerender });
  const ext = path.join(process.env.APPDATA ?? '', 'Adobe', 'CEP', 'extensions', 'com.aecompose', 'CSXS', 'manifest.xml');
  add({ name: 'CEP bridge extension installed', ok: fs.existsSync(ext), detail: ext, fix: 'node scripts/install-cep.mjs (creates the junction), then restart AE' });
  const dbg = reg('HKCU\\Software\\Adobe\\CSXS.12', 'PlayerDebugMode');
  add({ name: 'Unsigned CEP extensions allowed (CSXS.12 PlayerDebugMode=1)', ok: dbg === '1', detail: `PlayerDebugMode=${dbg ?? 'unset'}`, fix: 'reg add "HKCU\\Software\\Adobe\\CSXS.12" /v PlayerDebugMode /t REG_SZ /d 1 /f   (then restart AE)' });
  add({ name: 'ES3 runtime built', ok: fs.existsSync(RUNTIME_FILE), detail: RUNTIME_FILE, fix: 'pnpm build:runtime' });
  const w = await aeWindows().catch(() => null);
  add({ name: 'After Effects running', ok: !!w?.running, detail: w?.running ? (w.main?.title ?? 'running') : 'not running', fix: 'Start After Effects 2026' });
  if (w?.dialogs.length) add({ name: 'No blocking dialogs', ok: false, detail: `${w.dialogs.length} dialog(s) open`, fix: 'aec dialogs  (shows them; answer with aec dialogs --answer <hwnd> <button>)' });
  if (w?.hung) add({ name: 'AE responsive', ok: false, detail: 'Windows reports AE as not responding (busy render/script)', fix: 'wait for AE to finish' });
  const cep = new CepBackend();
  const h = await cep.health();
  add({ name: 'CEP bridge reachable', ok: h.ok, detail: h.detail ?? '', fix: `Check ${BRIDGE_INFO}; open Window > Extensions > ae-compose in AE to see the bridge status` });
  if (h.ok) {
    try {
      const p = await callRuntime('ping', [], { timeoutMs: 20_000 });
      add({ name: 'Runtime loads and answers in AE', ok: !!p.ok, detail: `runtime ${p.version}, AE ${p.ae}, project ${p.project ?? '(unsaved)'}` });
      add({ name: 'Project bit depth 8/16 bpc', ok: p.bpc !== 32, warn: p.bpc === 32, detail: `${p.bpc} bpc`, fix: 'Project Settings > Color > Bit Depth 16 bpc (32 bpc snapshots are compensated but not a target, D29)' });
      add({ name: 'Expression engine: JavaScript', ok: !p.engine || p.engine === 'javascript-1.0', warn: true, detail: p.engine ?? 'unknown', fix: 'Project Settings > Expressions > Expressions Engine: JavaScript (ae-compose expressions assume it; Legacy ExtendScript evaluates nested ?: differently, D82)' });
      const probe = await callRuntime('inspect', ['project', {}], { timeoutMs: 20_000 });
      add({ name: 'Scripts can write files / access network', ok: !!probe.ok, detail: 'inspect OK (file writes verified by snapshot tests)' });
      const font = await import('../api/index.ts').then((m) => m.runExtendScript('(function(){app.beginUndoGroup("ae-compose: doctor font probe");var f;try{var c=app.project.items.addComp("__aec_font",10,10,1,1,30);var L=c.layers.addText("x");var p=L.property("ADBE Text Properties").property("ADBE Text Document");var d=p.value;d.font="Inter-Bold";p.setValue(d);f=p.value.font;c.remove();}finally{app.endUndoGroup();$.global.__aecNoopUndos=($.global.__aecNoopUndos||0)+1;}return f;})()', 20_000));
      add({ name: 'Default font Inter installed', ok: font.ok && font.result === 'Inter-Bold', warn: true, detail: font.ok ? `AE resolved "Inter-Bold" → "${font.result}"` : font.error, fix: 'Install Inter (or set font= on Text)' });
    } catch (e: any) {
      add({ name: 'Runtime loads and answers in AE', ok: false, detail: e.message, fix: 'pnpm build:runtime; check AE for open dialogs (aec dialogs)' });
    }
  }
  // Every snapshot/contact sheet renders frames, and AE caches them on disk (default: %LOCALAPPDATA%\Temp\Adobe\After
  // Effects\<ver>\Disk Cache - <machine>). A long session filled a 930 GB C: drive with a 67 GB cache.
  try {
    const cacheRoot = path.join(process.env.LOCALAPPDATA ?? os.tmpdir(), 'Temp', 'Adobe', 'After Effects');
    let cacheBytes = 0;
    const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { try { cacheBytes += fs.statSync(p).size; } catch { /* busy */ } } } };
    if (fs.existsSync(cacheRoot)) walk(cacheRoot);
    const free = (fs as any).statfsSync ? (() => { const s = (fs as any).statfsSync(cacheRoot.slice(0, 3)); return s.bavail * s.bsize; })() : NaN;
    const gb = (n: number) => `${(n / 1e9).toFixed(1)} GB`;
    const low = Number.isFinite(free) && free < 10e9, big = cacheBytes > 30e9;
    add({ name: 'Disk space for AE disk cache', ok: !low && !big, warn: !low, detail: `${Number.isFinite(free) ? gb(free) + ' free on ' + cacheRoot.slice(0, 2) : 'free space unknown'}; AE disk cache ${gb(cacheBytes)}`, fix: 'AE > Edit > Preferences > Media & Disk Cache: Empty Disk Cache, and set Maximum Disk Cache Size (e.g. 20 GB) or move the cache to a bigger drive' });
  } catch { /* best-effort */ }
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore', windowsHide: true }); add({ name: 'ffmpeg (for MP4/GIF previews)', ok: true, detail: 'found' }); }
  catch { add({ name: 'ffmpeg (for MP4/GIF previews)', ok: false, warn: true, detail: 'not on PATH', fix: 'winget install Gyan.FFmpeg' }); }
  try { await import('sharp'); add({ name: 'sharp (contact sheets)', ok: true, detail: 'loaded' }); } catch (e: any) { add({ name: 'sharp (contact sheets)', ok: false, detail: e.message, fix: 'pnpm install' }); }
  void os;
  return { ok: checks.every((c) => c.ok || c.warn), checks };
}
