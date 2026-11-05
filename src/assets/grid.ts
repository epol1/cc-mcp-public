// The numbered thumbnail grid find_assets returns, so the agent picks by looking (as with contact sheets).
// Thumbnails are fetched politely and cached under <asset home>/_thumbs; icons are drawn light on a dark card,
// fonts get a text card, videos and local files without an image get a labelled placeholder.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { request } from './http.ts';
import { assetHome } from './config.ts';
import { sniff } from './sniff.ts';
import { writeContactSheet } from '../visual/images.ts';
import type { AssetHit } from './types.ts';

const CELL_W = 240, CELL_H = 160;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function card(lines: string[], accent = '#30363d'): Buffer {
  const t = lines.map((l, i) => `<text x="${CELL_W / 2}" y="${CELL_H / 2 - (lines.length - 1) * 13 + i * 26}" text-anchor="middle" font-family="Segoe UI, Arial" font-size="${i === 0 ? 22 : 14}" fill="${i === 0 ? '#e6edf3' : '#8b949e'}">${esc(l.slice(0, 30))}</text>`).join('');
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${CELL_W}" height="${CELL_H}"><rect width="100%" height="100%" fill="#161b22" stroke="${accent}" stroke-width="2"/>${t}</svg>`);
}

/** The image bytes of a hit's preview (cached), or null. Untrusted: sniffed, SVGs only rasterized. */
async function previewBytes(h: AssetHit): Promise<Buffer | null> {
  if (!h.preview) return null;
  if (!/^https?:/i.test(h.preview)) {
    const p = h.preview.startsWith('file:') ? fileURLToPath(h.preview) : h.preview;
    try { return fs.statSync(p).size < 80e6 ? fs.readFileSync(p) : null; } catch { return null; }
  }
  const f = path.join(assetHome(), '_thumbs', crypto.createHash('sha1').update(h.preview).digest('hex').slice(0, 20));
  if (fs.existsSync(f)) return fs.readFileSync(f);
  try {
    // Own budget, no back-off wait: a missing thumbnail becomes a placeholder card.
    const r = await request(h.preview, { source: 'thumbs', retry: false });
    if (r.body.length > 15e6) return null;
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, r.body);
    return r.body;
  } catch { return null; }
}

async function cellImage(h: AssetHit): Promise<Buffer> {
  if (h.kind === 'font') return sharp(card(['Aa  ' + h.title, h.tags.slice(0, 2).join(' · ')], '#3d5a80')).png().toBuffer();
  const buf = await previewBytes(h);
  const kind = buf ? sniff(buf).format : undefined;
  try {
    if (buf && kind === 'svg') {
      // Icons: currentColor and black become light so they read on the dark card.
      const svg = buf.toString('utf8').replace(/currentColor/g, '#e6edf3').replace(/<svg([^>]*?)\swidth="[^"]*"/, '<svg$1').replace(/<svg([^>]*?)\sheight="[^"]*"/, '<svg$1').replace(/<svg/, `<svg width="${CELL_H - 30}" height="${CELL_H - 30}"`);
      const icon = await sharp(Buffer.from(svg), { density: 300 }).resize(CELL_H - 30, CELL_H - 30, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
      return sharp(card([''])).composite([{ input: icon, gravity: 'center' }]).png().toBuffer();
    }
    if (buf && kind && /^(jpg|png|gif|webp|avif|tiff|bmp|psd|exr|hdr)$/.test(kind)) {
      return await sharp(buf, { limitInputPixels: 268_402_689 }).resize(CELL_W, CELL_H, { fit: 'cover' }).png().toBuffer();
    }
  } catch { /* fall through to a placeholder */ }
  const ext = path.extname(h.variants[0]?.url ?? '').slice(1).toUpperCase() || h.kind.toUpperCase();
  return sharp(card([h.kind.toUpperCase(), h.title, ext + (h.duration ? ` · ${h.duration.toFixed(1)} s` : '')])).png().toBuffer();
}

/**
 * Writes the grid PNG for `hits` (numbers 1…n match the text lines) and returns its path. Uses the contact-sheet
 * layout; at most 16 cells (4×4) so the image stays readable.
 */
export async function thumbnailGrid(hits: AssetHit[], outFile: string, title?: string): Promise<string> {
  const shown = hits.slice(0, 16);
  const dir = path.join(path.dirname(outFile), path.basename(outFile, '.png') + '_cells');
  fs.mkdirSync(dir, { recursive: true });
  const frames = [];
  for (let i = 0; i < shown.length; i++) {
    const f = path.join(dir, `${i + 1}.png`);
    fs.writeFileSync(f, await cellImage(shown[i]));
    const h = shown[i];
    // The number is the handle (the text lists the full id); the label adds the source and a short name.
    const name = `${h.source} · ${h.title.replace(/\s*\([^)]*\)\s*$/, '')}`;
    frames.push({ file: f, t: 0, label: `${i + 1}  ${name.length > 26 ? name.slice(0, 25) + '…' : name}` });
  }
  if (!frames.length) throw new Error('no hits to show');
  await writeContactSheet(outFile, frames, { bpc: 8, fps: 30, cols: Math.min(4, frames.length), cellWidth: CELL_W, cellHeight: CELL_H, noTimecode: true, title });
  fs.rmSync(dir, { recursive: true, force: true });
  return outFile;
}
