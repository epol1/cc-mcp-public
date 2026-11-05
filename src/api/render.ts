// Final renders: deliverable files through AE's Render Queue (the live project state, full quality), then a
// check of what was written (ffprobe / frame count) and a poster frame for the agent to look at.
// Default location: a "renders" folder next to the saved .aep, or ~/.ae-compose/renders for an unsaved project.
// Never overwrites: an existing name gets _2, _3…
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import sharp from 'sharp';
import { callRuntime } from '../bridge/index.ts';
import { guardDiskCache } from './cache.ts';
import { OUT_ROOT } from './build.ts';

export type RenderFormat = 'mp4' | 'mov' | 'mov-alpha' | 'prores' | 'prores4444' | 'png' | 'tiff' | 'avi';
export const RENDER_FORMATS: RenderFormat[] = ['mp4', 'mov', 'mov-alpha', 'prores', 'prores4444', 'png', 'tiff', 'avi'];

export interface RenderOptions {
  /** mp4 (H.264, default), mov (ProRes 422, AE's High Quality), mov-alpha / prores4444 (ProRes 4444 with alpha), prores (422 HQ via ffmpeg), png / tiff (sequences with alpha), avi (lossless). */
  format?: RenderFormat;
  /** mp4 bitrate: draft 5, standard 15 (default), high 40 Mbps. */
  quality?: 'draft' | 'standard' | 'high';
  /** Render settings: best (default) or draft (half resolution, fast). */
  settings?: 'best' | 'draft';
  start?: number;
  end?: number;
  /** Render the comp's work area instead of its full length. */
  workArea?: boolean;
  /** Output file (with extension) or folder. */
  out?: string;
  /** Any output module template by its exact AE name (advanced; overrides format). */
  template?: string;
  timeoutMin?: number;
}

export interface RenderResult {
  ok: boolean;
  error?: string;
  comp: string;
  format: string;
  file: string;
  bytes: number;
  frames?: number;
  w?: number;
  h?: number;
  fps?: number;
  duration?: number;
  codec?: string;
  alpha?: boolean;
  poster?: string;
  ms: number;
  notes: string[];
}

const run = (cmd: string, args: string[], timeout = 3_600_000) => new Promise<string>((res, rej) => execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 64 << 20 }, (e, so, se) => (e ? rej(new Error(`${path.basename(cmd)} failed: ${String(se || e.message).slice(-600)}`)) : res(String(so)))));

const MP4: Record<string, string> = { draft: 'H.264 - Match Render Settings -  5 Mbps', standard: 'H.264 - Match Render Settings - 15 Mbps', high: 'H.264 - Match Render Settings - 40 Mbps' };
/** What AE renders for each format (the transcoded ones go through a lossless intermediate). */
const PLAN: Record<RenderFormat, { template: (q: string) => string; transcode?: 'prores' | 'png'; ext: string; seq?: boolean }> = {
  mp4: { template: (q) => MP4[q] ?? MP4.standard, ext: 'mp4' },
  mov: { template: () => 'High Quality', ext: 'mov' },
  'mov-alpha': { template: () => 'High Quality with Alpha', ext: 'mov' },
  avi: { template: () => 'Lossless', ext: 'avi' },
  tiff: { template: () => 'TIFF Sequence with Alpha', ext: 'tif', seq: true },
  prores: { template: () => 'Lossless', transcode: 'prores', ext: 'mov' },
  // AE's QuickTime "High Quality" templates encode ProRes 422 / ProRes 4444 natively on Windows too (verified).
  prores4444: { template: () => 'High Quality with Alpha', ext: 'mov' },
  png: { template: () => 'TIFF Sequence with Alpha', transcode: 'png', ext: 'png', seq: true },
};

const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'render';

/** Default renders folder: next to the saved project, else ~/.ae-compose/renders. */
export async function rendersDir(): Promise<string> {
  const ping = await callRuntime('ping', []);
  return ping.project ? path.join(path.dirname(ping.project), 'renders') : path.join(os.homedir(), '.ae-compose', 'renders');
}

/** First free "<stem>[_n]" for a file (ext) or a sequence folder. */
function freeStem(dir: string, name: string, ext: string, seq: boolean): string {
  for (let n = 1; ; n++) {
    const stem = path.join(dir, n === 1 ? name : `${name}_${n}`);
    if (!fs.existsSync(seq ? stem : `${stem}.${ext}`)) return stem;
  }
}

async function probe(file: string): Promise<Partial<RenderResult>> {
  try {
    const j = JSON.parse(await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=codec_name,width,height,r_frame_rate,nb_read_packets,pix_fmt:format=duration', '-of', 'json', file], 120_000));
    const s = j.streams?.[0] ?? {};
    const [a, b] = String(s.r_frame_rate ?? '0/1').split('/').map(Number);
    return { codec: s.codec_name, w: s.width, h: s.height, fps: b ? a / b : undefined, frames: s.nb_read_packets ? +s.nb_read_packets : undefined, duration: j.format?.duration ? +j.format.duration : undefined, alpha: /yuva|rgba|argb|bgra|abgr|gbrap|^ya/.test(String(s.pix_fmt ?? '')) };
  } catch { return {}; }
}

export async function renderComp(comp: string | number | undefined, o: RenderOptions = {}): Promise<RenderResult> {
  const t0 = Date.now();
  const notes: string[] = [];
  const format: RenderFormat = o.format ?? 'mp4';
  if (!o.template && !PLAN[format]) throw new Error(`unknown format "${format}" (formats: ${RENDER_FORMATS.join(', ')})`);
  const plan = o.template ? { template: () => o.template!, ext: '', seq: false } : PLAN[format];
  const info = await callRuntime('inspect', [{ comp: comp ?? null }, { layers: [-1] }]);
  if (!info.ok) throw new Error(info.error);
  const c = info.comp;
  if (!o.template && format === 'mp4' && (c.w % 2 || c.h % 2)) throw new Error(`H.264 needs even dimensions; "${c.name}" is ${c.w}×${c.h}. Use format "mov" or "png".`);

  // Where it goes. `out` with an extension = that file; otherwise a folder.
  let dir: string, name = safe(c.name);
  if (o.out && path.extname(o.out) && !plan.seq) { dir = path.dirname(path.resolve(o.out)); name = path.basename(o.out, path.extname(o.out)); }
  else dir = o.out ? path.resolve(o.out) : await rendersDir();
  fs.mkdirSync(dir, { recursive: true });
  const stem = freeStem(dir, name, plan.ext || 'mov', !!plan.seq);
  const transcode = (plan as any).transcode as string | undefined;
  // Sequences go in their own folder; transcoded formats render a lossless intermediate in the scratch area first.
  const tmpDir = path.join(OUT_ROOT, '_renders', `${name}_${Date.now()}`);
  const base = transcode ? path.join(tmpDir, plan.seq ? 'seq/f' : 'intermediate') : plan.seq ? path.join(stem, name) : stem;
  fs.mkdirSync(path.dirname(base), { recursive: true });

  const r = await callRuntime('render', [c.itemId, { template: plan.template(o.quality ?? 'standard'), settings: o.settings === 'draft' ? 'Draft Settings' : 'Best Settings', base: base.split(path.sep).join('/'), start: o.start, end: o.end, workArea: o.workArea }], { timeoutMs: (o.timeoutMin ?? 120) * 60_000 });
  const res: RenderResult = { ok: !!r.ok, error: r.error, comp: c.name, format: o.template ? `template "${o.template}"` : format, file: r.file ?? '', bytes: 0, ms: 0, notes };
  if (!r.ok) { res.ms = Date.now() - t0; return res; }
  if (o.settings === 'draft') notes.push('draft settings: half resolution');

  // Transcodes from the lossless intermediate.
  if (transcode === 'prores') {
    const outFile = `${stem}.mov`;
    await run('ffmpeg', ['-y', '-v', 'error', '-i', r.file, '-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le', '-vendor', 'apl0', outFile]);
    res.file = outFile;
    notes.push('Apple ProRes 422 HQ, transcoded with ffmpeg from the lossless AE render');
  } else if (transcode === 'png') {
    const src = path.dirname(r.file.replace(/\\/g, '/'));
    const tifs = fs.readdirSync(src).filter((f) => /\.tif$/i.test(f)).sort();
    fs.mkdirSync(stem, { recursive: true });
    for (let i = 0; i < tifs.length; i++) await sharp(path.join(src, tifs[i])).png().toFile(path.join(stem, `${name}_${String(i).padStart(5, '0')}.png`));
    res.file = path.join(stem, `${name}_[#####].png`);
  }
  if (transcode) fs.rmSync(tmpDir, { recursive: true, force: true });

  // What was written.
  if (plan.seq) {
    const folder = path.dirname(res.file);
    const files = fs.readdirSync(folder).filter((f) => /\.(png|tif)$/i.test(f)).sort();
    res.frames = files.length;
    res.bytes = files.reduce((n, f) => n + fs.statSync(path.join(folder, f)).size, 0);
    if (files.length) {
      const m = await sharp(path.join(folder, files[0])).metadata();
      Object.assign(res, { w: m.width, h: m.height, alpha: m.hasAlpha, fps: c.fps, duration: files.length / c.fps });
      res.poster = path.join(OUT_ROOT, '_renders', `poster_${name}_${Date.now()}.png`);
      fs.mkdirSync(path.dirname(res.poster), { recursive: true });
      await sharp(path.join(folder, files[Math.floor(files.length / 2)])).png().toFile(res.poster);
    }
  } else {
    res.bytes = fs.existsSync(res.file) ? fs.statSync(res.file).size : 0;
    Object.assign(res, await probe(res.file));
    if (res.duration) {
      res.poster = path.join(OUT_ROOT, '_renders', `poster_${name}_${Date.now()}.png`);
      fs.mkdirSync(path.dirname(res.poster), { recursive: true });
      try { await run('ffmpeg', ['-y', '-v', 'error', '-ss', String(res.duration / 2), '-i', res.file, '-frames:v', '1', res.poster], 120_000); } catch { res.poster = undefined; }
    }
  }
  const expected = Math.round(((r.end ?? c.dur) - (r.start ?? 0)) * c.fps);
  if (res.frames !== undefined && Math.abs(res.frames - expected) > 1) notes.push(`expected ${expected} frames, the file has ${res.frames}`);
  if (!res.bytes) { res.ok = false; res.error = `nothing was written to ${res.file}`; }
  { const n = await guardDiskCache(); if (n) notes.push(n); }
  res.ms = Date.now() - t0;
  return res;
}

/** One-line summary for CLI/MCP. */
export function renderSummary(r: RenderResult): string {
  if (!r.ok) return `render failed: ${r.error}`;
  const mb = (r.bytes / 1e6).toFixed(1);
  const what = [r.codec, r.w && r.h ? `${r.w}×${r.h}` : '', r.fps ? `${Math.round(r.fps * 100) / 100} fps` : '', r.frames ? `${r.frames} frames` : '', r.duration ? `${r.duration.toFixed(2)} s` : '', r.alpha ? 'alpha' : ''].filter(Boolean).join(', ');
  return `rendered "${r.comp}" (${r.format}) → ${r.file}\n  ${what}; ${mb} MB in ${(r.ms / 1000).toFixed(1)} s${r.notes.length ? '\n  ' + r.notes.join('\n  ') : ''}`;
}
