// AE disk-cache guard. Every snapshot/contact sheet renders frames and AE caches them on disk; with a high
// "Maximum Disk Cache Size" a working session filled a 930 GB C: drive twice (68 GB of cache in ~40 minutes,
// D62). After render-producing calls we check the cache and purge it (app.purge(PurgeTarget.ALL_CACHES), the same
// as Edit > Purge > All Memory & Disk Cache; verified to empty the disk cache) when it gets large or the drive
// gets low. Purging drops cached frames (AE re-renders them on demand) and, as AE does for Purge > All Memory &
// Disk Cache, also its undo history, which is why it only runs when space is really tight (D65). The runtime records
// the purge so `undo` reports what can no longer be undone.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { callRuntime } from '../bridge/index.ts';

const LIMIT_BYTES = Number(process.env.AEC_CACHE_LIMIT_GB ?? 30) * 1e9;
const MIN_FREE_BYTES = 15e9;

function cacheDir(): string | null {
  const base = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'Temp', 'Adobe', 'After Effects');
  if (!fs.existsSync(base)) return null;
  // Newest AE version folder that has a Disk Cache directory.
  const versions = fs.readdirSync(base).filter((v) => /^\d+\.\d+/.test(v)).sort((a, b) => parseFloat(b) - parseFloat(a));
  for (const v of versions) {
    const d = fs.readdirSync(path.join(base, v)).find((n) => n.startsWith('Disk Cache'));
    if (d) return path.join(base, v, d);
  }
  return null;
}

function dirBytes(d: string): number {
  let n = 0;
  const walk = (x: string) => { for (const e of fs.readdirSync(x, { withFileTypes: true })) { const p = path.join(x, e.name); if (e.isDirectory()) walk(p); else { try { n += fs.statSync(p).size; } catch { /* in use */ } } } };
  try { walk(d); } catch { /* best-effort */ }
  return n;
}

function freeBytes(d: string): number {
  try { const s = (fs as any).statfsSync(path.parse(d).root); return s.bavail * s.bsize; } catch { return Infinity; }
}

/** Call after a render-producing operation. Returns a note when it purged (for build/edit reports). */
export async function guardDiskCache(): Promise<string | undefined> {
  if (process.env.AEC_NO_CACHE_PURGE === '1') return undefined;
  const dir = cacheDir();
  if (!dir) return undefined; // unknown cache location: never purge blind (it also clears undo)
  const size = dirBytes(dir);
  const free = freeBytes(dir);
  if (!(size > LIMIT_BYTES || free < MIN_FREE_BYTES)) return undefined;
  try { await callRuntime('purgeCaches', [], { timeoutMs: 120_000 }); } catch (e: any) { return `could not purge AE's disk cache: ${e.message}`; }
  return `purged AE's disk cache (${(size / 1e9).toFixed(1)} GB; ${(free / 1e9).toFixed(1)} GB free on ${path.parse(dir).root}). AE clears its undo history with it: earlier steps can no longer be undone`;
}
