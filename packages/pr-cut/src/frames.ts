// Composited program frames from Premiere (QE exportFramePNG, ~0.4 s each at 1080p, no dialog, no undo step) for
// contact sheets and cut-point strips, so the agent sees exactly what the editor will see: grade, punch-ins, B-roll,
// titles, captions.
import fs from 'node:fs';
import path from 'node:path';
import sharp, { type OverlayOptions } from 'sharp';
import { framesToTimecode, type Rate } from '@ae-mcp/core/time/timecode.ts';
import { writeContactSheet, type SheetFrame } from '@ae-mcp/core/visual/images.ts';
import { lit, nativePath, runEs } from './bridge.ts';
import { PRC_HOME } from './importxml.ts';

export async function exportFrames(sequenceId: string, frames: number[], r: Rate, dir: string): Promise<string[]> {
  fs.mkdirSync(dir, { recursive: true });
  const jobs = frames.map((f, k) => ({ tc: framesToTimecode(Math.max(0, f), r), base: nativePath(path.join(dir, `f${String(k).padStart(3, '0')}_${f}`)) }));
  await runEs(`
var s = prcSeq(${lit(sequenceId)});
if (!s) throw new Error('sequence not found: ' + ${lit(sequenceId)});
app.project.openSequence(s.sequenceID);
var q = qe.project.getActiveSequence();
var jobs = ${JSON.stringify(jobs)};
for (var i = 0; i < jobs.length; i++) q.exportFramePNG(jobs[i].tc, jobs[i].base);
prcJson({ n: jobs.length });
`, { timeoutMs: 30_000 + frames.length * 3000 });
  // exportFramePNG appends .png and may finish writing just after the call returns.
  const files = jobs.map((j) => j.base + '.png');
  const t0 = Date.now();
  while (Date.now() - t0 < 15_000 && files.some((f) => !fs.existsSync(f) || fs.statSync(f).size === 0)) await new Promise((r) => setTimeout(r, 100));
  return files.map((f) => (fs.existsSync(f) ? f : ''));
}

export interface SheetItem { frame: number; label: string }

export async function sequenceContactSheet(sequenceId: string, items: SheetItem[], r: Rate, title: string): Promise<string | null> {
  if (!items.length) return null;
  const dir = path.join(PRC_HOME, 'frames', `${sequenceId.slice(0, 8)}_${Date.now().toString(36)}`);
  const files = await exportFrames(sequenceId, items.map((i) => i.frame), r, dir);
  const frames: SheetFrame[] = items.map((it, k) => ({ file: files[k], t: it.frame * r.den / r.num, label: it.label })).filter((f) => f.file);
  if (!frames.length) return null;
  return writeContactSheet(path.join(dir, 'contact.png'), frames, { bpc: 8, fps: r.num / r.den, title, cellWidth: frames.length > 9 ? 360 : 480 });
}

/** Frames on both sides of each cut, one row per cut: [cut-6, cut-1 | cut, cut+6]. */
export async function cutStrips(sequenceId: string, cuts: { frame: number; label: string }[], r: Rate, title: string): Promise<string | null> {
  if (!cuts.length) return null;
  const offsets = [-6, -1, 0, 6];
  const dir = path.join(PRC_HOME, 'frames', `strips_${sequenceId.slice(0, 8)}_${Date.now().toString(36)}`);
  const files = await exportFrames(sequenceId, cuts.flatMap((c) => offsets.map((o) => c.frame + o)), r, dir);
  const cw = 320, ch = 180, strip = 22, gap = 4, head = 30;
  const W = offsets.length * cw + (offsets.length + 1) * gap + 8, H = head + cuts.length * (ch + strip + gap) + gap;
  const layers: OverlayOptions[] = [];
  for (let i = 0; i < cuts.length; i++) {
    for (let k = 0; k < offsets.length; k++) {
      const f = files[i * offsets.length + k];
      if (!f) continue;
      const x = gap + k * (cw + gap) + (k >= 2 ? 8 : 0), y = head + gap + i * (ch + strip + gap);
      layers.push({ input: await sharp(f).resize(cw, ch, { fit: 'contain', background: '#000' }).png().toBuffer(), left: x, top: y });
    }
    const y = head + gap + i * (ch + strip + gap) + ch;
    const label = `${framesToTimecode(cuts[i].frame, r)}  ${cuts[i].label}`.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${strip}"><rect width="100%" height="100%" fill="#161b22"/><text x="8" y="16" font-family="Consolas, monospace" font-size="13" fill="#c9d1d9">${label}</text></svg>`), left: 0, top: y });
    layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="4" height="${ch}"><rect width="4" height="${ch}" fill="#f0883e"/></svg>`), left: gap + 2 * (cw + gap) + 1, top: head + gap + i * (ch + strip + gap) });
  }
  layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${head}"><text x="8" y="21" font-family="Segoe UI, Arial" font-size="16" fill="#e6edf3">${title.replace(/&/g, '&amp;').replace(/</g, '&lt;')} — frames -6, -1 | cut, +6</text></svg>`), left: 0, top: 0 });
  const out = path.join(dir, 'strips.png');
  await sharp({ create: { width: W, height: H, channels: 3, background: '#0d1117' } }).composite(layers).png().toFile(out);
  return out;
}
