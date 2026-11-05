// The download cache (~/.ae-compose/assets/<source>/<id>/<variant>/): fetched files are kept indefinitely and
// shared by every project, under a size cap (5 GB, AEC_ASSET_CACHE_GB) enforced least-recently-used first.
// Eviction only ever deletes inside this folder, and only entries the index knows about.
import fs from 'node:fs';
import path from 'node:path';
import { assetHome, cacheCapBytes } from './config.ts';
import type { AssetHit } from './types.ts';

export interface CacheEntry {
  /** "<asset id>@<variant>" */
  key: string;
  /** Folder of this entry, relative to the cache root. */
  dir: string;
  /** Main file, relative to `dir`. */
  main: string;
  files: string[];
  bytes: number;
  sha256: string;
  fetchedAt: number;
  lastUsed: number;
}

interface Index { entries: Record<string, CacheEntry> }

const indexFile = () => path.join(assetHome(), 'index.json');
const slug = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '_').slice(0, 80);

function load(): Index {
  try { const j = JSON.parse(fs.readFileSync(indexFile(), 'utf8')); return j && j.entries ? j : { entries: {} }; } catch { return { entries: {} }; }
}
function save(ix: Index): void {
  fs.mkdirSync(assetHome(), { recursive: true });
  // A unique temp name per writer (an MCP server and a build's child process may write at the same time).
  const tmp = `${indexFile()}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(ix));
  fs.renameSync(tmp, indexFile());
}

/** The hit record stored next to a cached asset's files (not a project file). */
export const HIT_FILE = '.hit.json';

/** The hit stored with a cached file (by the file's path), or undefined. */
export function cachedHit(mainFile: string): AssetHit | undefined {
  try { return JSON.parse(fs.readFileSync(path.join(path.dirname(mainFile), HIT_FILE), 'utf8')); } catch { return undefined; }
}

export const cacheKey = (id: string, variant: string) => `${id}@${variant}`;

/** The folder for an entry: <root>/<source>/<rest of id>/<variant> (sanitized; never outside the root). */
export function entryDir(id: string, variant: string): string {
  const [source, ...rest] = id.split(':');
  return path.join(slug(source), slug(rest.join('_') || 'item'), slug(variant));
}

export function absEntry(e: CacheEntry): { dir: string; main: string; files: string[] } {
  const dir = path.join(assetHome(), e.dir);
  return { dir, main: path.join(dir, e.main), files: e.files.map((f) => path.join(dir, f)) };
}

/** A cached entry whose files are all still there (touching its lastUsed), or undefined. */
export function lookup(id: string, variant: string): CacheEntry | undefined {
  const ix = load();
  const e = ix.entries[cacheKey(id, variant)];
  if (!e) return undefined;
  const a = absEntry(e);
  if (![a.main, ...a.files].every((f) => fs.existsSync(f))) { delete ix.entries[e.key]; save(ix); return undefined; }
  e.lastUsed = Date.now();
  save(ix);
  return e;
}

/**
 * A cached entry for an id spelled loosely (case-insensitive id; variant exact or as a prefix, case-insensitive).
 * Without a variant only the source's default matches (`defaultOf(entry folder)`), so a scene that names no
 * variant gets the same file on every machine, not whatever size was fetched last.
 */
export function findCached(id: string, variant: string | undefined, defaultOf: (dir: string) => string | undefined): CacheEntry | undefined {
  const want = id.toLowerCase(), v = variant?.toLowerCase();
  const cands = Object.values(load().entries).filter((e) => e.key.slice(0, e.key.lastIndexOf('@')).toLowerCase() === want);
  const label = (e: CacheEntry) => e.key.slice(e.key.lastIndexOf('@') + 1);
  const pick = v
    ? cands.find((e) => label(e).toLowerCase() === v) ?? cands.find((e) => label(e).toLowerCase().startsWith(v))
    : cands.find((e) => defaultOf(path.join(assetHome(), e.dir)) === label(e));
  return pick ? lookup(pick.key.slice(0, pick.key.lastIndexOf('@')), label(pick)) : undefined;
}

/** Any cached variant of an asset (the `asset:` resolver prefers what is already here). */
export function lookupAny(id: string): CacheEntry | undefined {
  const ix = load();
  const hits = Object.values(ix.entries).filter((e) => e.key.startsWith(id + '@')).sort((a, b) => b.lastUsed - a.lastUsed);
  for (const h of hits) { const v = h.key.slice(id.length + 1); const e = lookup(id, v); if (e) return e; }
  return undefined;
}

/** Records files already written under entryDir(id, variant), then enforces the cap (never evicting `keep`). */
export function record(id: string, variant: string, main: string, files: string[], sha256: string): CacheEntry {
  const ix = load();
  const dir = entryDir(id, variant);
  const abs = path.join(assetHome(), dir);
  const bytes = [main, ...files].reduce((n, f) => n + (fs.existsSync(path.join(abs, f)) ? fs.statSync(path.join(abs, f)).size : 0), 0);
  const e: CacheEntry = { key: cacheKey(id, variant), dir, main, files, bytes, sha256, fetchedAt: Date.now(), lastUsed: Date.now() };
  ix.entries[e.key] = e;
  save(ix);
  evict([e.key]);
  return e;
}

let housekept = false;
/**
 * Once per process: drop what lives beside the indexed files and outside the cap, inside the cache root only:
 * API responses older than 7 days, thumbnails older than 30 days, temp downloads older than a day (a killed fetch).
 */
export function housekeeping(): void {
  if (housekept) return;
  housekept = true;
  const now = Date.now(), DAY = 24 * 3600_000;
  const sweep = (dir: string, maxAge: number) => {
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      try {
        if (e.isSymbolicLink()) continue;
        if (now - fs.statSync(p).mtimeMs <= maxAge) { if (e.isDirectory()) sweep(p, maxAge); continue; }
        fs.rmSync(p, { recursive: true, force: true });
      } catch { /* in use */ }
    }
  };
  sweep(path.join(assetHome(), '_responses'), 7 * DAY);
  sweep(path.join(assetHome(), '_thumbs'), 30 * DAY);
  sweep(path.join(assetHome(), '_tmp'), DAY);
}

export function cacheStats(): { bytes: number; entries: number; cap: number; root: string } {
  const ix = load();
  const list = Object.values(ix.entries);
  return { bytes: list.reduce((n, e) => n + e.bytes, 0), entries: list.length, cap: cacheCapBytes(), root: assetHome() };
}

/**
 * Deletes least-recently-used entries until the cache fits its cap. Only folders recorded in the index and
 * resolving inside the cache root are removed. Returns the evicted keys.
 */
export function evict(keep: string[] = [], cap = cacheCapBytes()): string[] {
  const ix = load();
  const root = path.resolve(assetHome());
  let total = Object.values(ix.entries).reduce((n, e) => n + e.bytes, 0);
  const out: string[] = [];
  for (const e of Object.values(ix.entries).sort((a, b) => a.lastUsed - b.lastUsed)) {
    if (total <= cap) break;
    if (keep.includes(e.key)) continue;
    const dir = path.resolve(root, e.dir);
    if (!dir.startsWith(root + path.sep)) { delete ix.entries[e.key]; total -= e.bytes; continue; }
    fs.rmSync(dir, { recursive: true, force: true });
    total -= e.bytes;
    delete ix.entries[e.key];
    out.push(e.key);
  }
  save(ix);
  return out;
}
