// Converts downloads vanilla AE can't import (ASSETS §5): WebP/AVIF stills → PNG with sharp, OGG/FLAC audio →
// WAV and WebM video → H.264 MP4 with ffmpeg. ffmpeg runs with an argument list (no shell), a time limit and
// only the downloaded file as input; nothing downloaded is ever executed.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { CONVERT_TO } from './sniff.ts';
import type { SniffedFormat } from './sniff.ts';

const run = promisify(execFile);

/** Converts `file` (of sniffed `format`) next to itself; returns the new path (the original is removed). */
export async function convertForAE(file: string, format: SniffedFormat): Promise<{ file: string; from: SniffedFormat; to: SniffedFormat }> {
  const to = CONVERT_TO[format];
  if (!to) throw new Error(`no conversion for ${format}`);
  const out = path.join(path.dirname(file), path.basename(file, path.extname(file)) + '.' + to);
  if (format === 'webp' || format === 'avif') {
    await sharp(file, { limitInputPixels: 268_402_689 }).png().toFile(out + '.part');
  } else if (format === 'heic') {
    throw new Error('HEIC stills are not supported (no decoder in sharp or ffmpeg builds here); pick a JPG/PNG variant');
  } else {
    const args = format === 'webm'
      ? ['-v', 'error', '-y', '-i', file, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-f', 'mp4', out + '.part']
      : ['-v', 'error', '-y', '-i', file, '-vn', '-c:a', 'pcm_s16le', '-f', 'wav', out + '.part'];
    try { await run('ffmpeg', args, { timeout: 15 * 60_000, windowsHide: true, maxBuffer: 8 << 20 }); }
    catch (e: any) { throw new Error(`ffmpeg could not convert ${format} → ${to}: ${String(e.stderr || e.message).trim().slice(0, 300)}`); }
  }
  fs.renameSync(out + '.part', out);
  if (out !== file) fs.rmSync(file, { force: true });
  return { file: out, from: format, to };
}
