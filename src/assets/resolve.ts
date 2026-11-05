// `asset:` sources in scenes (ASSETS §3): `src="asset:pixabay:video:123"`, `src="asset:iconify:lucide:rocket"`,
// optionally with a variant (`asset:polyhaven:brown_photostudio_02@1k-hdr`). They resolve at compile time,
// synchronously like beatsOf: from the download cache, or by running the fetch in a child process. Every resolved
// ref is recorded so the build can copy it into the project's footage folder and credit it.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { absEntry, lookup, lookupAny } from './cache.ts';

export interface AssetRef { ref: string; id: string; variant?: string; main: string; files: string[] }

export const isAssetRef = (s: unknown): s is string => typeof s === 'string' && s.startsWith('asset:');

/** "asset:polyhaven:x@2k-hdr" → { id: "polyhaven:x", variant: "2k-hdr" }. */
export function parseAssetRef(ref: string): { id: string; variant?: string } {
  const body = ref.slice('asset:'.length).trim();
  const at = body.lastIndexOf('@');
  const id = at > 0 ? body.slice(0, at) : body;
  if (!/^[a-z]+:.+/.test(id)) throw new Error(`"${ref}": an asset source is "asset:<source>:<id>", e.g. "asset:iconify:lucide:rocket" (find ids with find_assets)`);
  return { id, variant: at > 0 ? body.slice(at + 1) : undefined };
}

const REFS_KEY = '__AEC_ASSET_REFS__';
/** Refs resolved since the last reset (the compiler resets per build; the build credits and copies them). */
export function resolvedRefs(): AssetRef[] { return ((globalThis as any)[REFS_KEY] ??= []) as AssetRef[]; }
export function resetResolvedRefs(): void { (globalThis as any)[REFS_KEY] = []; }

const cli = () => path.join((globalThis as any).__AEC_ROOT__ ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'), 'src', 'assets', 'cli.ts');

/** The cached file for an `asset:` ref, fetching it first when needed. Records the ref for the build. */
export function resolveAssetRef(ref: string): AssetRef {
  const { id, variant } = parseAssetRef(ref);
  const known = resolvedRefs().find((r) => r.ref === ref);
  if (known && fs.existsSync(known.main)) return known;
  let main: string | undefined, files: string[] = [];
  const e = variant ? lookup(id, variant) : lookupAny(id);
  if (e) { const a = absEntry(e); main = a.main; files = a.files; }
  else {
    let out: string;
    try {
      out = execFileSync(process.execPath, ['--import', 'tsx', cli(), 'cache', id, variant ?? ''], { encoding: 'utf8', maxBuffer: 16 << 20, timeout: 20 * 60_000, windowsHide: true, cwd: (globalThis as any).__AEC_ROOT__ ?? process.cwd() });
    } catch (err: any) {
      const msg = String(err.stderr || err.message).trim().split('\n').filter(Boolean).pop();
      throw new Error(`${ref}: ${msg}`);
    }
    const j = JSON.parse(out.trim().split('\n').pop()!);
    main = j.main; files = j.files;
  }
  const r: AssetRef = { ref, id, variant, main: main!, files };
  resolvedRefs().push(r);
  return r;
}

/** A src prop as a file path: `asset:` refs resolve to the cached file, anything else resolves from `dir`. */
export function resolveSrc(src: string, dir: string): string {
  if (isAssetRef(src)) return resolveAssetRef(src).main;
  return path.isAbsolute(src) ? src : path.resolve(dir, src);
}
