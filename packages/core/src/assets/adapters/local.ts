// Local folders adapter (ASSETS §3/§4): the user's own libraries, searched first. The user's standing rule is quick
// sampling, never a full scan per query, so searches only read a small cached index
// (<asset home>/_local/index.json) built on the first search and rebuilt when older than 7 days or when the roots
// change. The build samples each root breadth-first with a time budget, a depth limit and per-folder/overall caps,
// and checks every root with a short timeout first, so an offline network share can't hang a search.
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assetHome } from '../config.ts';
import { creditLine } from '../credits.ts';
import { ASSET_KINDS } from '../types.ts';
import type { Adapter, AssetHit, AssetKind, AssetLicense, SearchQuery } from '../types.ts';

export const DEFAULT_ROOTS = ['E:\\Projects', '\\\\goblin\\depot\\3D', '\\\\goblin\\depot\\Evan', '\\\\goblin\\depot\\Work'];

const INDEX_VERSION = 1;
const MAX_AGE_MS = 7 * 24 * 3600e3;
const MAX_DEPTH = 6;
const PER_DIR = 300;
const MAX_ENTRIES = 60_000;
const ROOT_TIMEOUT_MS = 3000;
/** Folders read at once per root (network shares are latency-bound). */
const CONCURRENCY = 8;
/** fs calls in flight across all network roots (libuv has 4 threads; leave room for local disks) and per local disk set. */
const NET_OPS = 3;
const LOCAL_OPS = 16;
/** A walk that is stuck in a slow read past its budget is abandoned after this grace. */
const HARD_GRACE_MS = 1500;

export interface LocalEntry { path: string; name: string; ext: string; kind: AssetKind; bytes: number; mtime: number }
export interface LocalRootStatus { root: string; ok: boolean; files: number; dirs: number; ms: number; truncated: boolean; error?: string }
export interface LocalIndex { version: number; builtAt: string; roots: LocalRootStatus[]; entries: LocalEntry[] }

/** Configured roots: AEC_ASSET_ROOTS (";"-separated) or the defaults. */
export function localRoots(): string[] {
  const env = process.env.AEC_ASSET_ROOTS;
  const list = env && env.trim() ? env.split(';') : DEFAULT_ROOTS;
  return [...new Set(list.map(normRoot).filter(Boolean))];
}

/** Is this path inside one of the configured roots? (Only such files may be read or copied as local assets.) */
export function insideLocalRoots(p: string): boolean {
  const abs = path.resolve(p).toLowerCase();
  return localRoots().some((r) => { const root = path.resolve(r).toLowerCase(); return abs === root || abs.startsWith(root.endsWith(path.sep) ? root : root + path.sep); });
}

function normRoot(r: string): string {
  const s = r.trim().replace(/^"(.*)"$/, '$1');
  if (!s) return '';
  const p = path.resolve(s);
  // Keep "E:\" and "\\host\share\" roots intact; drop other trailing separators.
  return p.length > 3 && /[\\/]$/.test(p) && !/^\\\\[^\\]+\\[^\\]+\\$/.test(p) ? p.replace(/[\\/]+$/, '') : p;
}

const sameRoots = (a: string[], b: string[]) => {
  const k = (l: string[]) => l.map((x) => x.toLowerCase()).sort().join('|');
  return k(a) === k(b);
};

export const localIndexFile = () => path.join(assetHome(), '_local', 'index.json');

/** Per-root time budget in ms (AEC_LOCAL_INDEX_SEC, default 8 s). */
const budgetMs = () => Math.max(0, Number(process.env.AEC_LOCAL_INDEX_SEC) || 8) * 1000;

// ── Classification ────────────────────────────────────────────────────────────────────────────────────────────

const EXT_KIND: Record<string, AssetKind> = {
  jpg: 'photo', jpeg: 'photo', png: 'photo', tif: 'photo', tiff: 'photo', webp: 'photo', psd: 'photo',
  mp4: 'video', mov: 'video', m4v: 'video', avi: 'video', mxf: 'video', webm: 'video',
  hdr: 'hdri', exr: 'texture',
  glb: 'model', gltf: 'model', obj: 'model',
  ttf: 'font', otf: 'font',
  wav: 'audio', mp3: 'audio', aac: 'audio', m4a: 'audio', aif: 'audio', aiff: 'audio', ogg: 'audio', flac: 'audio',
  svg: 'icon',
};
/** Extensions the thumbnail grid can draw straight from the file. */
const THUMB_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'tif', 'tiff', 'svg']);
const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'tif', 'tiff', 'webp', 'psd']);

/** Lower-case word tokens: splits on non-alphanumerics, camelCase and letter→digit ("Wood049Color" → wood 049 color). */
export function tokens(s: string): string[] {
  return s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/(\p{L})(\p{N})/gu, '$1 $2')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

const isTextureWord = (t: string) => t === 'tex' || t === 'pbr' || /^(textur|material|paper|grunge)/.test(t)
  || /^(albedo|basecolor|roughness|normalgl|normaldx|displacement|ambientocclusion)$/.test(t);
/** PBR map names (Poly Haven "_diff_1k", ambientCG "_1K-JPG_Color"): a texture when a resolution word comes with them. */
const MAP_WORD = /^(diff|diffuse|color|col|nor|normal|rough|arm|ao|disp|metal|metalness|metallic|opacity|spec|specular|bump|height)$/;
const isHdriWord = (t: string) => /^(hdr|env)/.test(t);

/** The asset kind of a file from its extension and path, or null when it isn't an asset extension. */
export function localKindOf(file: string): AssetKind | null {
  const ext = path.extname(file).slice(1).toLowerCase();
  const k = EXT_KIND[ext];
  if (!k) return null;
  // Plain words (no camelCase split): "NormalGL" stays "normalgl", and "aTex12" in a folder name isn't "tex".
  const w = file.toLowerCase().split(/[^\p{L}\p{N}]+/u);
  if (ext === 'exr') return w.some(isHdriWord) ? 'hdri' : 'texture';
  if (IMAGE_EXT.has(ext)) {
    if (w.some(isTextureWord)) return 'texture';
    const name = tokens(path.basename(file, path.extname(file)));
    if (name.some((t) => /^\d+k$/.test(t)) && name.some((t) => MAP_WORD.test(t))) return 'texture';
  }
  return k;
}

/** Smallest file kept: 1 KB, except SVG icons (most are a few hundred bytes). */
const minBytes = (kind: AssetKind) => (kind === 'icon' ? 128 : 1024);

// ── Junk folders ──────────────────────────────────────────────────────────────────────────────────────────────

const JUNK_DIR = [
  /^(node_modules|bower_components|dist|build|__pycache__|site-packages|venv|_sheets|_lint|cache)$/i,
  /^\$recycle\.bin$/i, /^system volume information$/i,
  // After Effects / Premiere caches and auto-saves ("Adobe After Effects Disk Cache", "Media Cache Files", "Auto-Save").
  /^(adobe )?(after effects |premiere pro )?(disk cache|media cache( files)?|peak files|ae ?cache)$/i,
  /auto-save$/i,
];
/** Build outputs inside code projects (a folder holding package.json), and Unity's generated folders. */
const NODE_PROJECT_JUNK = /^(out|coverage)$/i;
const UNITY_JUNK = /^(library|temp|logs|obj|builds?|usersettings)$/i;

const skipDir = (name: string) => name.startsWith('.') || name.startsWith('$') || JUNK_DIR.some((r) => r.test(name));

/**
 * Folders that hold copies of what the API sources serve (the download cache, fetched files in a project's
 * footage/<source>/ folders) or this repo's own test data: indexing them would turn credited assets into
 * "license unknown" local hits.
 */
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..'); // repo root (packages/core/src/assets/adapters)
const FETCHED_SOURCE = /^(iconify|polyhaven|ambientcg|pexels|pixabay|unsplash|openverse|fontsource)$/i;
function skipPath(full: string, parent: string, name: string): boolean {
  const f = path.resolve(full).toLowerCase();
  if ([assetHome(), path.join(REPO, 'tests', 'fixtures'), path.join(REPO, 'scratch')].some((p) => path.resolve(p).toLowerCase() === f)) return true;
  return path.basename(parent).toLowerCase() === 'footage' && FETCHED_SOURCE.test(name);
}

// ── Building ──────────────────────────────────────────────────────────────────────────────────────────────────

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([p, new Promise<never>((_, rej) => { t = setTimeout(() => rej(Object.assign(new Error(msg), { code: 'ETIMEDOUT' })), ms); })])
    .finally(() => clearTimeout(t));
}

const errText = (e: any) => (e?.code && !String(e.message).startsWith(e.code) ? `${e.code}: ${e.message}` : String(e?.message ?? e));

/** null when the root is a reachable folder, else why not. */
async function probeRoot(root: string, ms: number): Promise<string | null> {
  try {
    const st = await withTimeout(fsp.stat(root), ms, `not reachable within ${ms / 1000} s`);
    return st.isDirectory() ? null : 'not a folder';
  } catch (e) { return errText(e); }
}

/** Probes every root; roots on one UNC host share a timeout (one blocked probe per offline server, not one per root). */
async function probeRoots(roots: string[], ms: number): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const byHost = new Map<string, string[]>();
  for (const r of roots) {
    const host = /^\\\\([^\\]+)\\/.exec(r)?.[1]?.toLowerCase() ?? `local:${r}`;
    byHost.set(host, [...(byHost.get(host) ?? []), r]);
  }
  await Promise.all([...byHost.values()].map(async ([first, ...rest]) => {
    const err = await probeRoot(first, ms);
    out.set(first, err);
    if (err && /ETIMEDOUT/.test(err)) { for (const r of rest) out.set(r, `${err} (same server as ${first})`); return; }
    await Promise.all(rest.map(async (r) => { out.set(r, await probeRoot(r, ms)); }));
  }));
  return out;
}

type Io = <T>(fn: () => Promise<T>) => Promise<T>;

/** Runs at most `n` async fs operations at once (a finished one hands its slot to the next waiter). */
function limiter(n: number): Io {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async (fn) => {
    if (active < n) active++;
    else await new Promise<void>((r) => waiting.push(r));
    try { return await fn(); } finally { const next = waiting.shift(); if (next) next(); else active--; }
  };
}

const isUnc = (p: string) => /^\\\\/.test(p);

/**
 * Samples one root: breadth-first, a few folders at a time, until the budget, depth or caps stop it. Every fs
 * call goes through `io`: network roots share a small limiter so slow SMB calls can't fill libuv's thread pool
 * (4 threads) and starve the local disks walked at the same time.
 */
function walkRoot(root: string, budget: number, cap: number, io: Io, out: LocalEntry[]): Promise<Omit<LocalRootStatus, 'root' | 'ok' | 'error'>> {
  const t0 = Date.now();
  const deadline = t0 + budget;
  const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
  let qi = 0, active = 0, files = 0, dirs = 0, truncated = false, done = false;

  return new Promise((resolve) => {
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(hard);
      resolve({ files, dirs, ms: Date.now() - t0, truncated: truncated || qi < queue.length });
    };
    const hard = setTimeout(() => { truncated = true; finish(); }, budget + HARD_GRACE_MS);

    const readDir = async (dir: string, depth: number) => {
      const subdirs: string[] = [];
      const cands: { p: string; name: string; ext: string; kind: AssetKind }[] = [];
      let n = 0, hasPackage = false, unity = 0;
      await io(async () => {
        // Work still queued in the limiter at the deadline is dropped (the root folder is always read).
        if (done || (depth > 0 && Date.now() >= deadline)) { truncated = true; return; }
        const handle = await fsp.opendir(dir, { bufferSize: 128 });
        for await (const ent of handle) {
          if (done) break;
          if ((++n & 255) === 0 && Date.now() >= deadline) { truncated = true; break; }
          if (ent.isDirectory()) {
            if (ent.name === 'Assets' || ent.name === 'ProjectSettings') unity++;
            if (!skipDir(ent.name) && !skipPath(path.join(dir, ent.name), dir, ent.name)) subdirs.push(ent.name);
          } else if (ent.isFile()) {
            if (ent.name === 'package.json') hasPackage = true;
            if (cands.length >= PER_DIR) { truncated = true; continue; }
            const p = path.join(dir, ent.name);
            const kind = localKindOf(p);
            if (kind) cands.push({ p, name: ent.name, ext: path.extname(ent.name).slice(1).toLowerCase(), kind });
          }
          // Symlinks and junctions are never followed (loops, and links out of the root).
        }
      });
      const stats = await Promise.all(cands.map((c) => io(() => {
        if (done || (depth > 0 && Date.now() >= deadline)) { truncated = true; return Promise.resolve(null); }
        return fsp.stat(c.p).then((s) => s, () => null);
      })));
      if (done) return;
      cands.forEach((c, i) => {
        const s = stats[i];
        if (!s || !s.isFile() || s.size < minBytes(c.kind) || files >= cap) return;
        out.push({ path: c.p, name: c.name, ext: c.ext, kind: c.kind, bytes: s.size, mtime: Math.round(s.mtimeMs) });
        files++;
      });
      if (depth >= MAX_DEPTH) return;
      for (const s of subdirs) {
        if (hasPackage && NODE_PROJECT_JUNK.test(s)) continue;
        if (unity === 2 && UNITY_JUNK.test(s)) continue;
        queue.push({ dir: path.join(dir, s), depth: depth + 1 });
      }
    };

    const pump = () => {
      if (done) return;
      while (active < CONCURRENCY && qi < queue.length) {
        if (files >= cap) { truncated = true; break; }
        // The root folder itself is always read, even with a zero budget.
        if (dirs > 0 && Date.now() >= deadline) { truncated = true; break; }
        const job = queue[qi++];
        active++;
        dirs++;
        readDir(job.dir, job.depth).catch(() => {}).finally(() => { active--; pump(); });
      }
      if (active === 0) finish();
    };
    pump();
  });
}

function writeIndex(idx: LocalIndex) {
  const file = localIndexFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(idx));
  fs.renameSync(tmp, file);
}

let memo: { file: string; mtimeMs: number; idx: LocalIndex; byId?: Map<string, LocalEntry> } | null = null;

/** The cached index, or null when there is none (or it is unreadable / from another version). */
export function loadLocalIndex(): LocalIndex | null {
  const file = localIndexFile();
  let st: fs.Stats;
  try { st = fs.statSync(file); } catch { return null; }
  if (memo && memo.file === file && memo.mtimeMs === st.mtimeMs) return memo.idx;
  try {
    const idx = JSON.parse(fs.readFileSync(file, 'utf8')) as LocalIndex;
    if (idx.version !== INDEX_VERSION || !Array.isArray(idx.entries) || !Array.isArray(idx.roots)) return null;
    memo = { file, mtimeMs: st.mtimeMs, idx };
    return idx;
  } catch { return null; }
}

const ageMs = (idx: LocalIndex) => Date.now() - (Date.parse(idx.builtAt) || 0);
const isFresh = (idx: LocalIndex, roots: string[]) => ageMs(idx) < MAX_AGE_MS && sameRoots(idx.roots.map((r) => r.root), roots);

const inflight = new Map<string, Promise<LocalIndex>>();

/**
 * Builds (or returns the fresh cached) index of the asset files under the roots. `force` rebuilds even when the
 * cached one is fresh. `budgetSec` overrides AEC_LOCAL_INDEX_SEC (per root). Roots are sampled in parallel.
 */
export function buildLocalIndex(opts: { roots?: string[]; force?: boolean; budgetSec?: number } = {}): Promise<LocalIndex> {
  const roots = opts.roots ? [...new Set(opts.roots.map(normRoot).filter(Boolean))] : localRoots();
  if (!opts.force) {
    const cur = loadLocalIndex();
    if (cur && isFresh(cur, roots)) return Promise.resolve(cur);
  }
  const key = `${localIndexFile()}|${roots.join('|')}`;
  const running = inflight.get(key);
  if (running) return running;
  const p = (async () => {
    const budget = opts.budgetSec !== undefined ? Math.max(0, opts.budgetSec) * 1000 : budgetMs();
    const probes = await probeRoots(roots, ROOT_TIMEOUT_MS);
    // Each reachable root gets an equal share of the entry cap, so one fast local disk can't take it all.
    const cap = Math.ceil(MAX_ENTRIES / Math.max(1, roots.filter((r) => !probes.get(r)).length));
    const netIo = limiter(NET_OPS), localIo = limiter(LOCAL_OPS);
    const found: LocalEntry[][] = [];
    const status = await Promise.all(roots.map(async (root, i): Promise<LocalRootStatus> => {
      const err = probes.get(root);
      found[i] = [];
      if (err) return { root, ok: false, files: 0, dirs: 0, ms: 0, truncated: false, error: err };
      return { root, ok: true, ...(await walkRoot(root, budget, cap, isUnc(root) ? netIo : localIo, found[i])) };
    }));
    const idx: LocalIndex = { version: INDEX_VERSION, builtAt: new Date().toISOString(), roots: status, entries: found.flat() };
    writeIndex(idx);
    return loadLocalIndex() ?? idx;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** The index for a search: the cached one while fresh and for the same roots, else a rebuild. */
const ensureIndex = () => buildLocalIndex();

// ── Searching ─────────────────────────────────────────────────────────────────────────────────────────────────

const LICENSE: AssetLicense = { id: 'local', url: '', commercial: true, attribution: false };
const STOP = new Set(['a', 'an', 'the', 'of', 'and', 'with', 'for', 'in', 'on']);
const hashPath = (p: string) => crypto.createHash('sha1').update(p).digest('hex').slice(0, 12);

function rootOf(file: string, roots: LocalRootStatus[]): string | undefined {
  const low = file.toLowerCase();
  return roots.map((r) => r.root).filter((r) => low.startsWith(r.toLowerCase())).sort((a, b) => b.length - a.length)[0];
}

/** Folder names between the root and the file. */
function foldersOf(file: string, roots: LocalRootStatus[]): string[] {
  const root = rootOf(file, roots);
  const rel = root ? path.relative(root, path.dirname(file)) : path.dirname(file);
  return rel.split(/[\\/]+/).filter((s) => s && !/^[a-z]:$/i.test(s));
}

interface EntryWords { nt: string[]; squash: string; ft: string[] }
/** Name and folder tokens per entry, kept while the loaded index is (entries are the memo's objects). */
const wordCache = new WeakMap<LocalEntry, EntryWords>();
function wordsOf(e: LocalEntry, roots: LocalRootStatus[]): EntryWords {
  let w = wordCache.get(e);
  if (!w) {
    const nt = tokens(e.name.slice(0, e.name.length - e.ext.length - (e.ext ? 1 : 0)));
    w = { nt, squash: nt.join(''), ft: foldersOf(e.path, roots).flatMap(tokens) };
    wordCache.set(e, w);
  }
  return w;
}

function score(q: string[], { nt, squash, ft }: EntryWords): number {
  let s = 0, matched = 0;
  for (const t of q) {
    let v = 0;
    if (nt.includes(t)) v = 3;
    else if (t.length >= 2 && nt.some((n) => n.startsWith(t))) v = 2;
    else if (t.length >= 3 && squash.includes(t)) v = 1.5;
    else if (ft.includes(t)) v = 1;
    else if (t.length >= 3 && ft.some((f) => f.startsWith(t))) v = 0.5;
    if (v) matched++;
    s += v;
  }
  if (!matched) return 0;
  return matched === q.length ? s + 2 : s;
}

function toHit(e: LocalEntry, roots: LocalRootStatus[], extra?: string[]): AssetHit {
  const title = e.name;
  return {
    id: `local:${hashPath(e.path)}`,
    source: 'local',
    kind: e.kind,
    title,
    tags: foldersOf(e.path, roots),
    preview: THUMB_EXT.has(e.ext) ? e.path : '',
    license: { ...LICENSE },
    credit: creditLine({ source: 'local', title, page: e.path, license: LICENSE }),
    page: path.dirname(e.path),
    variants: [{ label: 'file', url: pathToFileURL(e.path).href, format: e.ext, bytes: e.bytes }],
    ...(extra?.length ? { notes: extra } : {}),
  };
}

/** Ranks the index for a query (exported for tests; `local.search` builds the index first). */
export function searchLocalIndex(idx: LocalIndex, q: SearchQuery): AssetHit[] {
  const limit = Math.max(1, q.limit ?? 12);
  const qt = tokens(q.query ?? '').filter((t) => !STOP.has(t));
  const ranked: { e: LocalEntry; s: number }[] = [];
  for (const e of idx.entries) {
    if (q.kind && e.kind !== q.kind) continue;
    const s = qt.length ? score(qt, wordsOf(e, idx.roots)) : 1;
    if (s > 0) ranked.push({ e, s });
  }
  ranked.sort((a, b) => b.s - a.s || b.e.mtime - a.e.mtime);
  // Numbered files in one folder (frames, takes, IMG_0001…) show once, with a count of the rest.
  const groups = new Map<string, { e: LocalEntry; more: number }>();
  const order: string[] = [];
  for (const { e } of ranked) {
    const key = /\d/.test(e.name) ? `${path.dirname(e.path).toLowerCase()}|${e.name.toLowerCase().replace(/\d+/g, '#')}` : `${e.path.toLowerCase()}|`;
    const g = groups.get(key);
    if (g) { g.more++; continue; }
    groups.set(key, { e, more: 0 });
    order.push(key);
  }
  return order.slice(0, limit).map((k) => {
    const g = groups.get(k)!;
    return toHit(g.e, idx.roots, g.more ? [`+${g.more} similarly numbered file${g.more > 1 ? 's' : ''} in this folder`] : undefined);
  });
}

function fmtAge(ms: number): string {
  const m = ms / 60e3;
  if (m < 1) return 'just built';
  if (m < 90) return `${Math.round(m)} min old`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h old`;
  return `${Math.round(m / 1440)} days old`;
}

export const local: Adapter = {
  id: 'local',
  kinds: [...ASSET_KINDS],

  async available() {
    const roots = localRoots();
    const idx = loadLocalIndex();
    if (!idx) return { ok: true, detail: `no index yet: sampled on the first search (≤${budgetMs() / 1000} s per root) from ${roots.join(', ')}` };
    const per = idx.roots.map((r) => (r.ok ? `${r.root} ${r.files} files${r.truncated ? ' (sampled)' : ''}` : `${r.root} offline (${r.error})`));
    const stale = !isFresh(idx, roots) ? (ageMs(idx) >= MAX_AGE_MS ? ', stale: rebuilt on the next search' : ', roots changed: rebuilt on the next search') : '';
    return { ok: idx.roots.some((r) => r.ok), detail: `index ${fmtAge(ageMs(idx))}, ${idx.entries.length} files${stale}: ${per.join('; ')}` };
  },

  async search(q) {
    return searchLocalIndex(await ensureIndex(), q);
  },

  async get(sourceId) {
    const id = sourceId.replace(/^local:/, '');
    const idx = loadLocalIndex();
    if (!idx) throw new Error(`local: no index yet (search first, or rebuild the index with buildLocalIndex)`);
    let byId = memo?.idx === idx ? memo.byId : undefined;
    if (!byId) {
      byId = new Map(idx.entries.map((e) => [hashPath(e.path), e]));
      if (memo?.idx === idx) memo.byId = byId;
    }
    const e = byId.get(id);
    if (!e) throw new Error(`local:${id} is not in the local index (it may be from an older index: rebuild the index and search again)`);
    let st: fs.Stats;
    try { st = await fsp.stat(e.path); } catch { throw new Error(`local:${id}: ${e.path} no longer exists (rebuild the index and search again)`); }
    return toHit({ ...e, bytes: st.size, mtime: Math.round(st.mtimeMs) }, idx.roots);
  },
};
