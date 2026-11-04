// Image post-processing for AE captures: 32 bpc fix (D13), contact sheets with timecode labels.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

/** saveFrameToPng in 32 bpc projects writes values scaled ×0.1 (exactly linear). Undo it. */
export async function normalizeCapture(file: string, bpc: number): Promise<Buffer> {
  const img = sharp(file);
  if (bpc === 32) return img.linear(10, 0).png().toBuffer();
  return img.png().toBuffer();
}

export function timecode(t: number, fps: number): string {
  const f = Math.round(t * fps);
  const s = Math.floor(f / fps);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}:${String(f % Math.round(fps)).padStart(2, '0')}`;
}

export interface SheetFrame { file: string; t: number; label?: string }

/**
 * Grid of frames with a label strip under each (timecode + optional text). Returns PNG bytes.
 * Frames are normalized for 32 bpc first. Cell width defaults to 480 px.
 */
export async function contactSheet(frames: SheetFrame[], opts: { bpc: number; fps: number; cols?: number; cellWidth?: number; title?: string }): Promise<Buffer> {
  const cols = opts.cols ?? Math.min(frames.length, frames.length <= 4 ? frames.length : frames.length <= 9 ? 3 : 4);
  const cw = opts.cellWidth ?? 480;
  const first = await sharp(frames[0].file).metadata();
  const ch = Math.round((cw * (first.height ?? 1080)) / (first.width ?? 1920));
  const strip = 26, gap = 6, head = opts.title ? 34 : 0;
  const rows = Math.ceil(frames.length / cols);
  const W = cols * cw + (cols + 1) * gap;
  const H = head + rows * (ch + strip) + (rows + 1) * gap;
  const layers: sharp.OverlayOptions[] = [];
  for (let i = 0; i < frames.length; i++) {
    const x = gap + (i % cols) * (cw + gap);
    const y = head + gap + Math.floor(i / cols) * (ch + strip + gap);
    const buf = await sharp(await normalizeCapture(frames[i].file, opts.bpc)).resize(cw, ch, { fit: 'contain', background: '#000' }).png().toBuffer();
    layers.push({ input: buf, left: x, top: y });
    const label = `${timecode(frames[i].t, opts.fps)}${frames[i].label ? '  ' + frames[i].label : ''}`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${strip}"><rect width="100%" height="100%" fill="#161b22"/><text x="8" y="18" font-family="Consolas, monospace" font-size="14" fill="#c9d1d9">${label.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></svg>`;
    layers.push({ input: Buffer.from(svg), left: x, top: y + ch });
  }
  if (opts.title) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${head}"><text x="${gap + 2}" y="24" font-family="Segoe UI, Arial" font-size="18" fill="#e6edf3">${opts.title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></svg>`;
    layers.push({ input: Buffer.from(svg), left: 0, top: 0 });
  }
  return sharp({ create: { width: W, height: H, channels: 3, background: '#0d1117' } }).composite(layers).png().toBuffer();
}

export async function writeContactSheet(outFile: string, frames: SheetFrame[], opts: Parameters<typeof contactSheet>[1]): Promise<string> {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, await contactSheet(frames, opts));
  return outFile;
}
