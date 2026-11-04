// Short low-res motion previews. Default: capture frames inside AE (renders the live, unsaved state,
// never touches the user's project file) → ffmpeg MP4/GIF. Option `aerender`: render a COPY of the saved
// .aep with aerender (unsaved changes are not included; reported as a warning). See D33.
import fs from 'node:fs';
import { guardDiskCache } from '../api/cache.ts';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { callRuntime } from '../bridge/index.ts';
import { findAfterEffects } from '../bridge/locate.ts';
import { normalizeCapture } from './images.ts';
import { OUT_ROOT } from '../api/build.ts';

export interface PreviewOpts { start?: number; end?: number; scale?: number; fps?: number; gif?: boolean; aerender?: boolean }
export interface PreviewResult { file: string; frames: number; method: 'capture' | 'aerender'; ms: number; warnings: string[] }

const run = (cmd: string, args: string[], timeout = 600_000) => new Promise<string>((res, rej) => execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 32 << 20 }, (e, so, se) => (e ? rej(new Error(`${path.basename(cmd)} failed: ${String(se || e.message).slice(-800)}`)) : res(String(so)))));

export async function renderPreview(comp: string | number | undefined, o: PreviewOpts = {}): Promise<PreviewResult> {
  const t0 = Date.now();
  const warnings: string[] = [];
  const info = await callRuntime('inspect', [{ comp: comp ?? null }, { layers: [-1] }]);
  if (!info.ok) throw new Error(info.error);
  const c = info.comp;
  const start = o.start ?? 0, end = Math.min(o.end ?? c.dur, c.dur);
  const fps = o.fps ?? Math.min(15, c.fps), scale = o.scale ?? 0.5;
  const dir = path.join(OUT_ROOT, '_previews', `${c.name.replace(/[^A-Za-z0-9_-]+/g, '_')}_${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  const outFile = path.join(dir, `preview.${o.gif ? 'gif' : 'mp4'}`);
  if (o.aerender) {
    const ae = findAfterEffects();
    const proj = await callRuntime('ping', []);
    if (!ae || !proj.project) throw new Error('aerender preview needs a saved project; use the default capture mode for unsaved work');
    warnings.push('aerender renders the SAVED project file; unsaved changes are not included');
    const copy = path.join(dir, 'render-copy.aep');
    fs.copyFileSync(proj.project, copy);
    const mp4 = path.join(dir, 'aerender.mp4');
    await run(ae.aerender, ['-project', copy, '-comp', c.name, '-s', String(Math.round(start * c.fps)), '-e', String(Math.round(end * c.fps) - 1), '-RStemplate', 'Draft Settings', '-OMtemplate', 'H.264 - Match Render Settings -  5 Mbps', '-output', mp4]);
    if (o.gif) await run('ffmpeg', ['-y', '-v', 'error', '-i', mp4, '-vf', `fps=${fps},scale=iw*${scale}:-2:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse`, outFile]);
    else fs.renameSync(mp4, outFile);
    return { file: outFile, frames: Math.round((end - start) * fps), method: 'aerender', ms: Date.now() - t0, warnings };
  }
  const times: number[] = [];
  for (let t = start; t < end - 1e-6; t += 1 / fps) times.push(Math.round(t * c.fps) / c.fps);
  const cap = await callRuntime('contactFrames', [c.itemId, times.length, dir.replace(/\\/g, '/'), times], { timeoutMs: 900_000 });
  if (!cap.ok) throw new Error(cap.error);
  const ok = cap.frames.filter((f: any) => f.ok);
  if (ok.length < times.length) warnings.push(`${times.length - ok.length} frame(s) failed to capture`);
  for (let i = 0; i < ok.length; i++) fs.writeFileSync(path.join(dir, `f_${String(i).padStart(4, '0')}.png`), await normalizeCapture(ok[i].file, cap.bpc));
  const input = ['-y', '-v', 'error', '-framerate', String(fps), '-i', path.join(dir, 'f_%04d.png')];
  if (o.gif) await run('ffmpeg', [...input, '-vf', `scale=iw*${scale}:-2:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse`, outFile]);
  else await run('ffmpeg', [...input, '-vf', `scale=trunc(iw*${scale}/2)*2:-2`, '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-crf', '23', outFile]);
  await guardDiskCache();
  return { file: outFile, frames: ok.length, method: 'capture', ms: Date.now() - t0, warnings };
}
