// Motion Graphics templates for Premiere (pr-cut places them as titles): the comp's Essential Graphics properties
// become the template's fields. Default location: a "mogrt" folder next to the saved .aep, or ~/.ae-compose/mogrt.
// An existing file is only replaced with `overwrite`. AE exports only from a saved project with no unsaved changes:
// `save` saves it in place first (the user's file, so only when they agree).
// AE's export takes a FOLDER and writes "<template name>.mogrt" into it, so it exports into a fresh temp folder and
// the file is moved to its name. While it exports, AE may stop on a modal warning that UI Automation can't read
// (fonts that aren't from Adobe Fonts): it is answered OK (continue) and its capture is returned.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { callRuntime } from '../bridge/index.ts';
import { aeWindows, pressDialog } from '@cc-mcp/core/bridge/dialogs.ts';
import { OUT_ROOT } from './build.ts';

export interface MogrtResult {
  ok: boolean;
  error?: string;
  comp: string;
  template?: string;
  /** Essential Graphics property names: the fields Premiere shows (and pr-cut titles set by name). */
  fields: string[];
  file: string;
  /** The project was saved in place first (`save`). */
  saved?: boolean;
  /** Captures of warnings AE showed during the export (answered OK). */
  warnings: string[];
  bytes: number;
  w?: number;
  h?: number;
  dur?: number;
  fps?: number;
}

const safe = (s: string) => s.replace(/[^A-Za-z0-9 _-]+/g, '_').trim() || 'template';

export async function exportMogrt(comp: string | number | undefined, o: { out?: string; overwrite?: boolean; save?: boolean } = {}): Promise<MogrtResult> {
  const info = await callRuntime('inspect', [{ comp: comp ?? null }, { layers: [-1] }]);
  if (!info.ok) throw new Error(info.error);
  const c = info.comp;
  let file: string;
  if (o.out && /\.mogrt$/i.test(o.out)) file = path.resolve(o.out);
  else {
    const ping = await callRuntime('ping', []);
    const dir = o.out ? path.resolve(o.out) : ping.project ? path.join(path.dirname(ping.project), 'mogrt') : path.join(os.homedir(), '.ae-compose', 'mogrt');
    file = path.join(dir, `${safe(c.name)}.mogrt`);
    if (!o.overwrite) for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `${safe(c.name)}_${n}.mogrt`);
  }
  if (fs.existsSync(file) && !o.overwrite) throw new Error(`${file} exists (pass overwrite to replace it)`);
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) throw new Error(`${file} is a folder`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(OUT_ROOT, '_mogrt', String(Date.now()));
  fs.mkdirSync(tmp, { recursive: true });

  // Answer export warnings while the call runs (main window disabled + an untitled modal; progress dialogs have titles).
  const warnings: string[] = [];
  const answered = new Set<number>();
  let running = true;
  const watcher = (async () => {
    while (running) {
      await new Promise((res) => setTimeout(res, 2000));
      if (!running) break;
      try {
        const w = await aeWindows({ capture: true });
        if (w.main?.enabled !== false) continue;
        for (const d of w.dialogs.filter((x) => !x.title && !answered.has(x.hwnd))) {
          const pr = await pressDialog(d.hwnd, 'OK');
          if (pr.pressed) { answered.add(d.hwnd); if (d.capture) warnings.push(d.capture); }
        }
      } catch { /* best effort */ }
    }
  })();
  let r: any;
  try { r = await callRuntime('exportMogrt', [c.itemId, tmp.split(path.sep).join('/'), !!o.save], { timeoutMs: 600_000 }); } finally { running = false; await watcher; }

  const res: MogrtResult = { ok: !!r.ok, error: r.error, comp: c.name, template: r.template, fields: r.fields ?? [], file, saved: r.saved, warnings, bytes: 0, w: r.w, h: r.h, dur: r.dur, fps: r.fps };
  if (res.ok) {
    const made = fs.readdirSync(tmp).filter((f) => /\.mogrt$/i.test(f));
    if (made.length !== 1) { res.ok = false; res.error = `expected one .mogrt in ${tmp}, found ${made.length}`; }
    else {
      fs.copyFileSync(path.join(tmp, made[0]), file);
      res.bytes = fs.statSync(file).size;
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  if (res.ok && !res.bytes) { res.ok = false; res.error = `nothing was written to ${file}`; }
  return res;
}

export function mogrtSummary(r: MogrtResult): string {
  if (!r.ok) return `export failed: ${r.error}`;
  const lines = [
    `exported "${r.comp}" → ${r.file} (${(r.bytes / 1e6).toFixed(2)} MB, ${r.w}×${r.h}, ${r.dur?.toFixed(2)} s)`,
    `  template "${r.template}", fields: ${r.fields.map((f) => `"${f}"`).join(', ')}`,
    '  place it in Premiere with pr-cut titles (fields by these names)',
  ];
  if (r.saved) lines.push('  the project was saved first');
  for (const w of r.warnings) lines.push(`  AE warned during the export (answered OK, look at it): ${w}. Usually fonts that aren't from Adobe Fonts: a machine without them installed shows substitutes.`);
  return lines.join('\n');
}
