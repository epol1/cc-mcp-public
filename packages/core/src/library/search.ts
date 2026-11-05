// library_search: find footage by what's said (transcript sentences) and what's seen (shot descriptions, tags,
// names), with facet filters. Hits carry "lib:<id>" ids and time ranges usable directly in edit plans, and one
// numbered thumbnail grid so the agent picks by looking.
import fs from 'node:fs';
import path from 'node:path';
import sharp, { type OverlayOptions } from 'sharp';
import { library, LIBRARY_DIR, type MediaRow } from './db.ts';

export interface SearchFilters { kind?: 'video' | 'audio'; role?: string; minDuration?: number; maxDuration?: number; orientation?: string; folder?: string; minTempo?: number; maxTempo?: number }
export interface Hit { n: number; mediaId: number; name: string; path: string; role: string | null; via: 'said' | 'seen' | 'name'; start?: number; end?: number; text?: string; score: number; thumb?: string; duration: number; size?: string }

const tokens = (q: string) => q.toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter((t) => t.length > 1 && !STOP.has(t));
const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'is', 'it', 'with', 'for', 'about', 'shot', 'clip', 'footage', 'video']);
const ftsQuery = (q: string, op: 'AND' | 'OR') => tokens(q).map((t) => `"${t.replace(/"/g, '')}"*`).join(` ${op} `);

function filterSql(f: SearchFilters): { sql: string; args: any[] } {
  const w: string[] = ["m.status = 'done'"], a: any[] = [];
  if (f.kind) { w.push('m.kind = ?'); a.push(f.kind); }
  if (f.role) { w.push('m.role = ?'); a.push(f.role); }
  if (f.minDuration !== undefined) { w.push('m.duration >= ?'); a.push(f.minDuration); }
  if (f.maxDuration !== undefined) { w.push('m.duration <= ?'); a.push(f.maxDuration); }
  if (f.orientation) { w.push('m.orientation = ?'); a.push(f.orientation); }
  if (f.folder) { w.push('m.folder LIKE ?'); a.push(`%${f.folder}%`); }
  if (f.minTempo !== undefined) { w.push('m.tempo >= ?'); a.push(f.minTempo); }
  if (f.maxTempo !== undefined) { w.push('m.tempo <= ?'); a.push(f.maxTempo); }
  return { sql: w.join(' AND '), args: a };
}

export function search(query: string, f: SearchFilters = {}, limit = 20): Hit[] {
  const d = library();
  const flt = filterSql(f);
  const hits: Hit[] = [];
  const size = (m: MediaRow) => (m.width ? `${m.width}x${m.height}` : undefined);
  const q = query.trim();
  if (!q) {
    for (const m of d.prepare(`SELECT * FROM media m WHERE ${flt.sql} ORDER BY m.folder, m.name LIMIT ?`).all(...flt.args, limit) as any[]) {
      const shot = d.prepare('SELECT thumb FROM shots WHERE media_id = ? ORDER BY n LIMIT 1').get(m.id) as any;
      hits.push({ n: 0, mediaId: m.id, name: m.name, path: m.path, role: m.role, via: 'name', score: 0, thumb: shot?.thumb, duration: m.duration, size: size(m) });
    }
  } else for (const op of ['AND', 'OR'] as const) {
    const fq = ftsQuery(q, op);
    if (!fq) break;
    const said = d.prepare(`SELECT s.media_id, s.sid, s.start, s.end, s.text, bm25(sentences_fts) score, m.* FROM sentences_fts JOIN sentences s ON s.id = sentences_fts.rowid JOIN media m ON m.id = s.media_id WHERE sentences_fts MATCH ? AND ${flt.sql} ORDER BY score LIMIT ?`).all(fq, ...flt.args, limit) as any[];
    for (const r of said) {
      const shot = d.prepare('SELECT thumb FROM shots WHERE media_id = ? AND start <= ? ORDER BY start DESC LIMIT 1').get(r.media_id, r.start) as any;
      hits.push({ n: 0, mediaId: r.media_id, name: r.name, path: r.path, role: r.role, via: 'said', start: r.start, end: r.end, text: `${r.sid}: ${r.text}`, score: r.score, thumb: shot?.thumb, duration: r.duration, size: size(r) });
    }
    const seen = d.prepare(`SELECT sh.*, bm25(shots_fts) score, m.name, m.path, m.role, m.duration, m.width, m.height FROM shots_fts JOIN shots sh ON sh.id = shots_fts.rowid JOIN media m ON m.id = sh.media_id WHERE shots_fts MATCH ? AND ${flt.sql} ORDER BY score LIMIT ?`).all(fq, ...flt.args, limit) as any[];
    for (const r of seen) hits.push({ n: 0, mediaId: r.media_id, name: r.name, path: r.path, role: r.role, via: 'seen', start: r.start, end: r.end, text: [r.shot_type, r.description, r.tags && `[${r.tags}]`].filter(Boolean).join(' ') || `shot ${r.n}`, score: r.score - 0.5, thumb: r.thumb, duration: r.duration, size: size(r as any) });
    const like = `%${tokens(q)[0] ?? q}%`;
    for (const m of d.prepare(`SELECT * FROM media m WHERE (m.name LIKE ? OR m.folder LIKE ?) AND ${flt.sql} LIMIT ?`).all(like, like, ...flt.args, limit) as any[]) {
      if (hits.some((h) => h.mediaId === m.id)) continue;
      const shot = d.prepare('SELECT thumb FROM shots WHERE media_id = ? ORDER BY n LIMIT 1').get(m.id) as any;
      hits.push({ n: 0, mediaId: m.id, name: m.name, path: m.path, role: m.role, via: 'name', score: 0, thumb: shot?.thumb, duration: m.duration, size: size(m) });
    }
    if (hits.length >= Math.min(5, limit)) break;
    hits.length = 0;
    if (op === 'OR') break;
  }
  hits.sort((a, b) => a.score - b.score);
  const out = hits.slice(0, limit);
  out.forEach((h, i) => (h.n = i + 1));
  return out;
}

/** Numbered grid of hit thumbnails. */
export async function hitGrid(hits: Hit[], file = path.join(LIBRARY_DIR, 'search.png')): Promise<string | null> {
  const withThumb = hits.filter((h) => h.thumb && fs.existsSync(h.thumb));
  if (!withThumb.length) return null;
  const cw = 256, ch = 144, label = 20, gap = 4, cols = Math.min(5, withThumb.length);
  const rows = Math.ceil(withThumb.length / cols);
  const W = cols * (cw + gap) + gap, H = rows * (ch + label + gap) + gap;
  const layers: OverlayOptions[] = [];
  for (let i = 0; i < withThumb.length; i++) {
    const h = withThumb[i], x = gap + (i % cols) * (cw + gap), y = gap + Math.floor(i / cols) * (ch + label + gap);
    layers.push({ input: await sharp(h.thumb!).resize(cw, ch, { fit: 'contain', background: '#000' }).png().toBuffer(), left: x, top: y });
    const t = `${h.n}. ${h.name}`.slice(0, 34).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${label}"><rect width="100%" height="100%" fill="#161b22"/><text x="5" y="14" font-family="Consolas, monospace" font-size="12" fill="#c9d1d9">${t}</text></svg>`), left: x, top: y + ch });
  }
  await sharp({ create: { width: W, height: H, channels: 3, background: '#0d1117' } }).composite(layers).png().toFile(file);
  return file;
}

export function formatHits(hits: Hit[]): string {
  const c = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
  return hits.map((h) => `${h.n}. lib:${h.mediaId} ${h.name} (${h.role ?? '?'}, ${Math.round(h.duration)} s${h.size ? `, ${h.size}` : ''})${h.start !== undefined ? ` @ ${c(h.start)}–${c(h.end!)}` : ''} [${h.via}]${h.text ? `: ${h.text.slice(0, 160)}` : ''}`).join('\n');
}
