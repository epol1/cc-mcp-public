// Library indexing: only folders the user names, incremental by content hash + mtime, resumable, never touching
// the media. Per file: ffprobe facts, loudness, a transcript (speech), shots with thumbnails (picture), tempo
// (music). A detached worker (worker.ts) drains the queue; library_status polls the database.
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { probe } from '../media/probe.ts';
import { mediaHash, transcribe, whisperServer, type TranscribeEngine } from '../transcribe/index.ts';
import { analyzeBeats } from '../audio/beats.ts';
import { LIBRARY_DIR, library, mediaByHash, mediaByPath, setSentences, setShots, upsertMedia, type MediaRow } from './db.ts';

export const MEDIA_EXT = /\.(mp4|mov|mxf|m4v|avi|mkv|webm|mts|m2ts|braw|r3d|wav|mp3|aif|aiff|m4a|aac|flac|ogg)$/i;
const AUDIO_EXT = /\.(wav|mp3|aif|aiff|m4a|aac|flac|ogg)$/i;
const LOCK = path.join(LIBRARY_DIR, 'worker.lock');

function walk(dir: string, recursive: boolean, out: string[] = [], depth = 0): string[] {
  let ents: fs.Dirent[] = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (e.name.startsWith('.') || /^(\$RECYCLE\.BIN|System Volume Information|Adobe Premiere Pro (Auto-Save|Video Previews|Audio Previews)|node_modules)$/i.test(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (recursive && depth < 12) walk(p, recursive, out, depth + 1); }
    else if (MEDIA_EXT.test(e.name)) out.push(p);
  }
  return out;
}

/** Queue every media file in a folder (new or changed since the last index). Returns counts. */
export function addFolder(folder: string, opts: { recursive?: boolean } = {}): { queued: number; unchanged: number; files: number } {
  const abs = path.resolve(folder);
  if (!fs.existsSync(abs)) throw new Error(`no such folder: ${abs}`);
  const d = library();
  d.prepare('INSERT OR REPLACE INTO folders (path, added_at, recursive) VALUES (?, ?, ?)').run(abs, new Date().toISOString(), opts.recursive === false ? 0 : 1);
  const files = walk(abs, opts.recursive !== false);
  let queued = 0, unchanged = 0;
  for (const f of files) {
    const st = fs.statSync(f);
    const byPath = mediaByPath(f);
    if (byPath && byPath.mtime === st.mtimeMs && byPath.bytes === st.size && byPath.status === 'done') { unchanged++; continue; }
    const hash = mediaHash(f);
    const known = mediaByHash(hash);
    if (known && known.status === 'done') {
      // Same content elsewhere (moved or copied): point at the current path, keep the analysis.
      upsertMedia({ hash, path: f, name: path.basename(f), folder: path.dirname(f), mtime: st.mtimeMs, bytes: st.size });
      unchanged++;
      continue;
    }
    upsertMedia({ hash, path: f, name: path.basename(f), folder: path.dirname(f), kind: AUDIO_EXT.test(f) ? 'audio' : 'video', mtime: st.mtimeMs, bytes: st.size, status: 'queued', error: null });
    queued++;
  }
  return { queued, unchanged, files: files.length };
}

function ff(args: string[], timeout = 3_600_000): Promise<string> {
  return new Promise((res, rej) => execFile('ffmpeg', ['-nostdin', '-hide_banner', ...args], { windowsHide: true, maxBuffer: 256 << 20, timeout }, (err, _o, stderr) => (err && !stderr ? rej(err) : res(String(stderr)))));
}

/** Integrated loudness (LUFS) and true peak (dBTP) with ffmpeg's EBU R128 meter. */
export async function loudness(file: string, opts: { start?: number; duration?: number } = {}): Promise<{ lufs: number | null; truePeak: number | null; lra: number | null }> {
  const pre = opts.start !== undefined ? ['-ss', String(opts.start)] : [];
  const dur = opts.duration !== undefined ? ['-t', String(opts.duration)] : [];
  const err = await ff([...pre, '-i', file, ...dur, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const sum = err.slice(err.lastIndexOf('Summary:'));
  const num = (re: RegExp) => { const m = re.exec(sum); return m ? Number(m[1]) : null; };
  return { lufs: num(/I:\s+(-?[\d.]+) LUFS/), truePeak: num(/Peak:\s+(-?[\d.]+) dBFS/), lra: num(/LRA:\s+(-?[\d.]+) LU/) };
}

/** Shot boundaries by ffmpeg scene detection on a small decode; one thumbnail per shot. */
export async function detectShots(file: string, duration: number, thumbsDir: string, opts: { threshold?: number; minShot?: number } = {}): Promise<{ n: number; start: number; end: number; thumb: string }[]> {
  const th = opts.threshold ?? 0.3, minShot = opts.minShot ?? 1;
  const err = await ff(['-i', file, '-an', '-vf', `fps=6,scale=256:-2,select='gt(scene,${th})',showinfo`, '-f', 'null', '-']);
  const cuts = [...err.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1])).filter((t) => t > 0.2 && t < duration - 0.2);
  const bounds = [0];
  for (const c of cuts) if (c - bounds[bounds.length - 1] >= minShot) bounds.push(c);
  bounds.push(duration);
  fs.mkdirSync(thumbsDir, { recursive: true });
  const shots = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const mid = (bounds[i] + bounds[i + 1]) / 2;
    const thumb = path.join(thumbsDir, `shot_${String(i + 1).padStart(3, '0')}.jpg`);
    if (!fs.existsSync(thumb)) await ff(['-y', '-ss', mid.toFixed(3), '-i', file, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '4', thumb], 60_000);
    shots.push({ n: i + 1, start: Math.round(bounds[i] * 1000) / 1000, end: Math.round(bounds[i + 1] * 1000) / 1000, thumb });
  }
  return shots;
}

/** Index one queued file end to end. */
export async function indexOne(row: MediaRow, log: (s: string) => void = () => {}, engine?: TranscribeEngine): Promise<void> {
  const d = library();
  const set = (m: Partial<MediaRow>) => upsertMedia({ ...m, hash: row.hash, path: row.path });
  try {
    if (!fs.existsSync(row.path)) throw new Error('file is gone');
    set({ status: 'probing' });
    const info = await probe(row.path);
    const v = info.video;
    set({
      kind: info.kind, duration: info.duration, width: v?.width ?? null, height: v?.height ?? null, fps: v?.fps ?? null, rate: v ? `${v.rate.num}/${v.rate.den}` : null,
      codec: v?.codec ?? info.audio?.codec ?? null, audio_channels: info.audio?.channels ?? null, timecode: info.timecode ?? null, created: info.created ?? null, vfr: v?.vfr ? 1 : 0,
      orientation: v ? (v.height > v.width * 1.05 ? 'vertical' : Math.abs(v.height - v.width) < v.width * 0.05 ? 'square' : 'horizontal') : null,
    });
    if (info.audio) {
      log(`loudness ${row.name}`);
      const l = await loudness(row.path);
      set({ lufs: l.lufs, true_peak: l.truePeak });
    }
    let role: string = info.kind === 'audio' ? 'music' : 'broll';
    if (info.audio && info.duration >= 3 && info.kind !== 'audio') {
      set({ status: 'transcribing' });
      log(`transcribe ${row.name}`);
      const t = await transcribe(row.path, { engine });
      const speech = t.words.reduce((s, w) => s + (w.end - w.start), 0);
      const ratio = info.duration ? speech / info.duration : 0;
      set({ speech_ratio: Math.round(ratio * 1000) / 1000, words: t.words.length });
      const id = mediaByHash(row.hash)!.id;
      setSentences(id, t.sentences.map((s) => ({ sid: s.id, w0: s.from, w1: s.to, start: s.start, end: s.end, text: s.text, speaker: s.speaker })));
      if (ratio > 0.3 && info.duration > 45) role = 'interview';
      else if (ratio > 0.25) role = 'talking';
    }
    if (info.kind === 'audio' && info.duration > 15) {
      set({ status: 'beats' });
      log(`beats ${row.name}`);
      const b = await analyzeBeats(row.path).catch(() => null);
      if (b && b.confidence > 0.2) set({ tempo: Math.round(b.bpm * 10) / 10 });
    }
    if (info.kind === 'video') {
      set({ status: 'shots' });
      log(`shots ${row.name}`);
      const shots = await detectShots(row.path, info.duration, path.join(LIBRARY_DIR, 'thumbs', row.hash));
      setShots(mediaByHash(row.hash)!.id, shots, row.name);
    }
    set({ status: 'done', role, indexed_at: new Date().toISOString(), error: null });
    void d;
  } catch (e: any) {
    set({ status: 'error', error: String(e?.message ?? e).slice(0, 500) });
    log(`error ${row.name}: ${e?.message ?? e}`);
  }
}

/** Drain the queue (the worker's loop). */
export async function runQueue(log: (s: string) => void = () => {}): Promise<number> {
  let n = 0;
  const engine = whisperServer(); // one model load for the whole queue
  try {
    for (;;) {
      const row = library().prepare("SELECT * FROM media WHERE status IN ('queued', 'probing', 'transcribing', 'beats', 'shots') ORDER BY CASE kind WHEN 'video' THEN 0 ELSE 1 END, id LIMIT 1").get() as MediaRow | undefined;
      if (!row) return n;
      await indexOne(row, log, engine);
      n++;
    }
  } finally { engine.close(); }
}

/** Start the background worker if it isn't running. */
export function startWorker(): { started: boolean; pid?: number } {
  try {
    const pid = Number(fs.readFileSync(LOCK, 'utf8'));
    process.kill(pid, 0);
    return { started: false, pid };
  } catch { /* not running */ }
  const worker = path.join(path.dirname(fileURLToPath(import.meta.url)), 'worker.ts');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
  const out = fs.openSync(path.join(LIBRARY_DIR, 'worker.log'), 'a');
  const p = spawn(process.execPath, ['--import', 'tsx', worker], { cwd: root, detached: true, stdio: ['ignore', out, out], windowsHide: true });
  p.unref();
  return { started: true, pid: p.pid };
}

export function status(): { total: number; byStatus: Record<string, number>; byRole: Record<string, number>; current?: string; errors: { name: string; error: string }[]; folders: string[]; worker: boolean } {
  const d = library();
  const byStatus = Object.fromEntries((d.prepare('SELECT status, COUNT(*) n FROM media GROUP BY status').all() as any[]).map((r) => [r.status, r.n]));
  const byRole = Object.fromEntries((d.prepare("SELECT COALESCE(role, '?') role, COUNT(*) n FROM media WHERE status = 'done' GROUP BY role").all() as any[]).map((r) => [r.role, r.n]));
  const cur = d.prepare("SELECT name, status FROM media WHERE status IN ('probing', 'transcribing', 'beats', 'shots') LIMIT 1").get() as any;
  const errors = (d.prepare("SELECT name, error FROM media WHERE status = 'error' LIMIT 10").all() as any[]);
  let worker = false;
  try { process.kill(Number(fs.readFileSync(LOCK, 'utf8')), 0); worker = true; } catch { /* idle */ }
  return { total: Object.values(byStatus).reduce((a: number, b: any) => a + b, 0), byStatus, byRole, current: cur ? `${cur.status} ${cur.name}` : undefined, errors, folders: (d.prepare('SELECT path FROM folders').all() as any[]).map((r) => r.path), worker };
}

export { LOCK as WORKER_LOCK };
