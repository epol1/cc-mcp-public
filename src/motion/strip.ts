// Motion strips: many small frames of one segment in a single PNG (every 2–4 frames, with time labels) so an agent
// that sees still images can judge a move or a transition, and an animated GIF of the same frames for humans.
// Frames come from AE captures: 32 bpc captures are normalized like contact sheets (src/visual/images.ts) and
// 16-bit PNGs are reduced to 8-bit sRGB.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import type { OverlayOptions } from 'sharp';
import { normalizeCapture } from '../visual/images.ts';

export interface StripFrame { t: number; file: string; label?: string }

export interface StripOptions {
  /** Project bit depth of the captures (32 undoes AE's ×0.1 scaling; default 8). */
  bpc?: number;
  /** Comp frame rate: labels show the frame number too. */
  fps?: number;
  /** Frames per row (default up to 8). */
  cols?: number;
  /** Width of one frame in px (default 240). */
  cellWidth?: number;
  title?: string;
}

export interface GifOptions {
  bpc?: number;
  /** Playback frame rate (default: real time, from the spacing of the frame times). */
  fps?: number;
  /** Output width in px (default 480). */
  width?: number;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** One capture as 8-bit sRGB PNG bytes, flattened on black and resized to w×h. */
async function cell(file: string, bpc: number, w: number, h: number): Promise<Buffer> {
  const buf = await normalizeCapture(file, bpc);
  return sharp(buf).flatten({ background: '#000' }).resize(w, h, { fit: 'contain', background: '#000' }).toColourspace('srgb').png().toBuffer();
}

const label = (f: StripFrame, fps?: number) => `${f.t.toFixed(2)}s${fps ? `  f${Math.round(f.t * fps)}` : ''}${f.label ? '  ' + f.label : ''}`;

/** A grid of small frames in time order with a time label under each. Writes a PNG and returns its path. */
export async function motionStrip(frames: StripFrame[], file: string, o: StripOptions = {}): Promise<string> {
  if (!frames.length) throw new Error('motionStrip needs at least one frame');
  const fs0 = [...frames].sort((x, y) => x.t - y.t);
  const cols = o.cols ?? Math.min(8, fs0.length), cw = o.cellWidth ?? 240;
  const meta = await sharp(fs0[0].file).metadata();
  const ch = Math.max(1, Math.round((cw * (meta.height ?? 1080)) / (meta.width ?? 1920)));
  const strip = 20, gap = 4, head = o.title ? 30 : 0;
  const rows = Math.ceil(fs0.length / cols);
  const W = cols * cw + (cols + 1) * gap, H = head + rows * (ch + strip + gap) + gap;
  const layers: OverlayOptions[] = [];
  for (let i = 0; i < fs0.length; i++) {
    const x = gap + (i % cols) * (cw + gap), y = head + gap + Math.floor(i / cols) * (ch + strip + gap);
    layers.push({ input: await cell(fs0[i].file, o.bpc ?? 8, cw, ch), left: x, top: y });
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${strip}"><rect width="100%" height="100%" fill="#161b22"/><text x="6" y="14" font-family="Consolas, monospace" font-size="12" fill="#c9d1d9">${esc(label(fs0[i], o.fps))}</text></svg>`;
    layers.push({ input: Buffer.from(svg), left: x, top: y + ch });
  }
  if (o.title) layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${head}"><text x="${gap + 2}" y="21" font-family="Segoe UI, Arial" font-size="16" fill="#e6edf3">${esc(o.title)}</text></svg>`), left: 0, top: 0 });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await sharp({ create: { width: W, height: H, channels: 3, background: '#0d1117' } }).composite(layers).png().toFile(file);
  return file;
}

const run = (cmd: string, args: string[]) => new Promise<void>((res, rej) =>
  execFile(cmd, args, { timeout: 300_000, windowsHide: true, maxBuffer: 16 << 20 }, (e, _so, se) => (e ? rej(new Error(`${cmd} failed: ${String(se || e.message).slice(-600)}`)) : res())));

/** Playback rate that shows the frames in real time: 1 / the median spacing of their times, clamped to 1–50 fps. */
export function realtimeFps(frames: { t: number }[]): number {
  const ts = frames.map((f) => f.t).sort((a, b) => a - b);
  const dt = ts.slice(1).map((t, i) => t - ts[i]).filter((x) => x > 1e-6).sort((a, b) => a - b);
  if (!dt.length) return 10;
  return Math.min(50, Math.max(1, Math.round(1 / dt[Math.floor(dt.length / 2)])));
}

/** An animated, looping GIF of the frames via ffmpeg (palettegen + paletteuse). Returns its path. */
export async function gif(frames: StripFrame[], file: string, o: GifOptions = {}): Promise<string> {
  if (!frames.length) throw new Error('gif needs at least one frame');
  const fs0 = [...frames].sort((x, y) => x.t - y.t);
  const meta = await sharp(fs0[0].file).metadata();
  const w = 2 * Math.round((o.width ?? 480) / 2);
  const h = 2 * Math.max(1, Math.round((w * (meta.height ?? 1080)) / (meta.width ?? 1920) / 2));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aec-gif-'));
  try {
    for (let i = 0; i < fs0.length; i++) fs.writeFileSync(path.join(dir, `f_${String(i).padStart(4, '0')}.png`), await cell(fs0[i].file, o.bpc ?? 8, w, h));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const fps = o.fps ?? realtimeFps(fs0);
    await run('ffmpeg', ['-y', '-v', 'error', '-framerate', String(fps), '-i', path.join(dir, 'f_%04d.png'),
      '-vf', 'split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4', '-loop', '0', file]);
    return file;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
