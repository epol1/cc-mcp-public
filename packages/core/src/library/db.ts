// The media library: one SQLite database (node:sqlite, FTS5) of the user's footage by what's said (transcript
// sentences) and what's seen (shots with descriptions and tags), plus technical and audio facts. Shared by pr-cut
// (library_* tools, B-roll and music in edit plans) and ae-compose (find_assets' local source).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const LIBRARY_DIR = path.join(os.homedir(), '.ae-compose', 'library');
export const LIBRARY_DB = path.join(LIBRARY_DIR, 'library.db');

export interface MediaRow {
  id: number; hash: string; path: string; name: string; folder: string; kind: string; duration: number;
  width: number | null; height: number | null; fps: number | null; rate: string | null; codec: string | null;
  audio_channels: number | null; timecode: string | null; created: string | null; bytes: number; mtime: number; vfr: number;
  orientation: string | null; lufs: number | null; true_peak: number | null; tempo: number | null; speech_ratio: number | null;
  words: number | null; status: string; error: string | null; indexed_at: string | null; role: string | null;
}
export interface ShotRow { id: number; media_id: number; n: number; start: number; end: number; thumb: string | null; description: string | null; tags: string | null; shot_type: string | null; quality: string | null }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY, hash TEXT UNIQUE NOT NULL, path TEXT NOT NULL, name TEXT NOT NULL, folder TEXT NOT NULL, kind TEXT NOT NULL,
  duration REAL NOT NULL DEFAULT 0, width INTEGER, height INTEGER, fps REAL, rate TEXT, codec TEXT, audio_channels INTEGER, timecode TEXT,
  created TEXT, bytes INTEGER NOT NULL DEFAULT 0, mtime REAL NOT NULL DEFAULT 0, vfr INTEGER NOT NULL DEFAULT 0, orientation TEXT,
  lufs REAL, true_peak REAL, tempo REAL, speech_ratio REAL, words INTEGER, status TEXT NOT NULL DEFAULT 'queued', error TEXT,
  indexed_at TEXT, role TEXT
);
CREATE INDEX IF NOT EXISTS media_path ON media(path);
CREATE TABLE IF NOT EXISTS sentences (id INTEGER PRIMARY KEY, media_id INTEGER NOT NULL, sid TEXT NOT NULL, w0 INTEGER, w1 INTEGER, start REAL NOT NULL, end REAL NOT NULL, text TEXT NOT NULL, speaker TEXT);
CREATE INDEX IF NOT EXISTS sentences_media ON sentences(media_id);
CREATE VIRTUAL TABLE IF NOT EXISTS sentences_fts USING fts5(text, content='sentences', content_rowid='id', tokenize='porter unicode61');
CREATE TABLE IF NOT EXISTS shots (id INTEGER PRIMARY KEY, media_id INTEGER NOT NULL, n INTEGER NOT NULL, start REAL NOT NULL, end REAL NOT NULL, thumb TEXT, description TEXT, tags TEXT, shot_type TEXT, quality TEXT);
CREATE INDEX IF NOT EXISTS shots_media ON shots(media_id);
CREATE VIRTUAL TABLE IF NOT EXISTS shots_fts USING fts5(description, tags, name, content='', tokenize='porter unicode61');
CREATE TABLE IF NOT EXISTS folders (path TEXT PRIMARY KEY, added_at TEXT NOT NULL, recursive INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS sync (group_id INTEGER NOT NULL, media_id INTEGER NOT NULL, offset REAL NOT NULL, score REAL, PRIMARY KEY (group_id, media_id));
`;

let db: DatabaseSync | null = null;
export function library(): DatabaseSync {
  if (db) return db;
  fs.mkdirSync(LIBRARY_DIR, { recursive: true });
  db = new DatabaseSync(LIBRARY_DB);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

export function mediaById(id: number): MediaRow | undefined { return library().prepare('SELECT * FROM media WHERE id = ?').get(id) as any; }
export function mediaByHash(hash: string): MediaRow | undefined { return library().prepare('SELECT * FROM media WHERE hash = ?').get(hash) as any; }
export function mediaByPath(p: string): MediaRow | undefined { return library().prepare('SELECT * FROM media WHERE path = ?').get(path.resolve(p)) as any; }

/** "lib:<id or hash prefix>" → path (for edit plans). */
export function libraryPath(ref: string): string | null {
  const r = /^\d+$/.test(ref) ? mediaById(+ref) : (library().prepare('SELECT * FROM media WHERE hash LIKE ? LIMIT 2').all(ref + '%') as any[]).find(Boolean);
  return r && fs.existsSync(r.path) ? r.path : null;
}

export function upsertMedia(m: Partial<MediaRow> & { hash: string; path: string }): number {
  const d = library();
  const cur = mediaByHash(m.hash);
  const cols = Object.keys(m).filter((k) => k !== 'id');
  if (cur) {
    d.prepare(`UPDATE media SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => (m as any)[c] ?? null), cur.id);
    return cur.id;
  }
  const r = d.prepare(`INSERT INTO media (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((c) => (m as any)[c] ?? null));
  return Number(r.lastInsertRowid);
}

export function setSentences(mediaId: number, rows: { sid: string; w0: number; w1: number; start: number; end: number; text: string; speaker?: string }[]) {
  const d = library();
  const old = d.prepare('SELECT id, text FROM sentences WHERE media_id = ?').all(mediaId) as any[];
  const del = d.prepare("INSERT INTO sentences_fts(sentences_fts, rowid, text) VALUES('delete', ?, ?)");
  for (const o of old) del.run(o.id, o.text);
  d.prepare('DELETE FROM sentences WHERE media_id = ?').run(mediaId);
  const ins = d.prepare('INSERT INTO sentences (media_id, sid, w0, w1, start, end, text, speaker) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const fts = d.prepare('INSERT INTO sentences_fts(rowid, text) VALUES (?, ?)');
  d.exec('BEGIN');
  try {
    for (const s of rows) { const r = ins.run(mediaId, s.sid, s.w0, s.w1, s.start, s.end, s.text, s.speaker ?? null); fts.run(Number(r.lastInsertRowid), s.text); }
    d.exec('COMMIT');
  } catch (e) { d.exec('ROLLBACK'); throw e; }
}

export function setShots(mediaId: number, shots: { n: number; start: number; end: number; thumb?: string }[], name: string) {
  const d = library();
  // Keep descriptions already written for shots with the same boundaries.
  const old = new Map((d.prepare('SELECT * FROM shots WHERE media_id = ?').all(mediaId) as any[]).map((s) => [`${s.start.toFixed(2)}`, s]));
  for (const s of old.values()) d.prepare("INSERT INTO shots_fts(shots_fts, rowid, description, tags, name) VALUES('delete', ?, ?, ?, ?)").run(s.id, s.description ?? '', s.tags ?? '', name);
  d.prepare('DELETE FROM shots WHERE media_id = ?').run(mediaId);
  const ins = d.prepare('INSERT INTO shots (media_id, n, start, end, thumb, description, tags, shot_type, quality) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const fts = d.prepare('INSERT INTO shots_fts(rowid, description, tags, name) VALUES (?, ?, ?, ?)');
  for (const s of shots) {
    const o = old.get(s.start.toFixed(2));
    const r = ins.run(mediaId, s.n, s.start, s.end, s.thumb ?? null, o?.description ?? null, o?.tags ?? null, o?.shot_type ?? null, o?.quality ?? null);
    fts.run(Number(r.lastInsertRowid), o?.description ?? '', o?.tags ?? '', name);
  }
}

export function annotateShot(mediaId: number, n: number, a: { description?: string; tags?: string[]; shot_type?: string; quality?: string }) {
  const d = library();
  const s = d.prepare('SELECT * FROM shots WHERE media_id = ? AND n = ?').get(mediaId, n) as any;
  if (!s) throw new Error(`media ${mediaId} has no shot ${n}`);
  const m = mediaById(mediaId)!;
  d.prepare("INSERT INTO shots_fts(shots_fts, rowid, description, tags, name) VALUES('delete', ?, ?, ?, ?)").run(s.id, s.description ?? '', s.tags ?? '', m.name);
  const desc = a.description ?? s.description, tags = a.tags ? a.tags.join(', ') : s.tags;
  d.prepare('UPDATE shots SET description = ?, tags = ?, shot_type = ?, quality = ? WHERE id = ?').run(desc, tags, a.shot_type ?? s.shot_type, a.quality ?? s.quality, s.id);
  d.prepare('INSERT INTO shots_fts(rowid, description, tags, name) VALUES (?, ?, ?, ?)').run(s.id, desc ?? '', tags ?? '', m.name);
}

export function shotsOf(mediaId: number): ShotRow[] { return library().prepare('SELECT * FROM shots WHERE media_id = ? ORDER BY n').all(mediaId) as any; }
