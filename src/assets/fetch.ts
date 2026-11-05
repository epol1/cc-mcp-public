// fetch_asset (ASSETS §3): resolve the hit, check its license, download the chosen variant into the cache
// (sniffed, size-capped, converted or packed for AE), copy it into the footage folder next to the saved project
// (so Collect Files and a moved project folder keep it), import it, and add its line to CREDITS.md.
// `toCache` is the AE-free half used by `asset:` sources at compile time; `toProject` the project half.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { adapterFor } from './registry.ts';
import { adapterContext } from './context.ts';
import { licenseFlags, licenseLabel, licenseRefusal } from './license.ts';
import { download } from './http.ts';
import { assetHome } from './config.ts';
import { absEntry, cachedHit, entryDir, findCached, HIT_FILE, housekeeping, lookup, record } from './cache.ts';
import type { CacheEntry } from './cache.ts';
import { AE_NATIVE, CONVERT_TO, sameFamily, sanitizeSvg, sniff } from './sniff.ts';
import type { SniffedFormat } from './sniff.ts';
import { convertForAE } from './convert.ts';
import { extractZip } from './zip.ts';
import { packGltf } from './glb.ts';
import { appendCredit } from './credits.ts';
import { insideLocalRoots } from './adapters/local.ts';
import type { AdapterContext, AssetHit, AssetKind, AssetVariant } from './types.ts';

/** Size caps per kind (bytes): bigger downloads are refused (pick a smaller variant). */
export const MAX_BYTES: Record<AssetKind, number> = {
  icon: 5e6, photo: 120e6, texture: 400e6, hdri: 400e6, model: 400e6, video: 2e9, audio: 300e6, font: 40e6,
};

export interface CachedAsset { hit: AssetHit; variant: AssetVariant; entry: CacheEntry; main: string; files: string[]; notes: string[] }

export { HIT_FILE, cachedHit } from './cache.ts';

/** Picks a variant by label (exact, then prefix match: "2k" → "2k-hdr"), else the adapter's default (first). */
export function pickVariant(hit: AssetHit, label?: string): AssetVariant {
  if (!hit.variants.length) throw new Error(`${hit.id}: the source returned no downloadable files`);
  if (!label) return hit.variants[0];
  const l = label.toLowerCase();
  const v = hit.variants.find((x) => x.label.toLowerCase() === l) ?? hit.variants.find((x) => x.label.toLowerCase().startsWith(l));
  if (!v) throw new Error(`${hit.id}: no variant "${label}" (variants: ${hit.variants.map((x) => x.label).join(', ')})`);
  return v;
}

const safeName = (s: string) => s.replace(/[^A-Za-z0-9._ -]+/g, '_').replace(/^[ .]+/, '_').slice(0, 100) || 'file';

/**
 * Fetches the bytes of one URL to `dest`: an https download, or a copy for the local source's file:// variants. No
 * other source may hand in a file: URL (a file://host/share URL would open SMB to that host; a local path could
 * smuggle the user's files into a project).
 */
async function getFile(url: string, dest: string, source: string, maxBytes: number, headers?: Record<string, string>): Promise<void> {
  if (url.startsWith('file:')) {
    if (source !== 'local') throw new Error(`refusing a file: URL from ${source}`);
    const src = fileURLToPath(url);
    if (!insideLocalRoots(src)) throw new Error(`refusing ${src}: not inside a configured local folder (AEC_ASSET_ROOTS)`);
    const st = fs.statSync(src);
    if (st.size > maxBytes) throw new Error(`${path.basename(src)} is ${(st.size / 1e6).toFixed(0)} MB, over the cap for this kind`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    return;
  }
  if (!/^https:\/\//i.test(url)) throw new Error(`refusing a non-https download URL from ${source}`);
  await download(url, dest, { source, maxBytes, headers });
}

/** Checks a downloaded file by content and makes it importable. Returns the final path and its format. */
async function vet(file: string, expected: string, notes: string[]): Promise<{ file: string; format: SniffedFormat }> {
  const head = Buffer.alloc(65536); // a .gltf's "asset" key can come after its first 4 KB
  const fd = fs.openSync(file, 'r');
  const n = fs.readSync(fd, head, 0, head.length, 0);
  fs.closeSync(fd);
  const s = sniff(head.subarray(0, n));
  if (!s.format) { fs.rmSync(file, { force: true }); throw new Error(`refused ${path.basename(file)}: ${s.refused}`); }
  if (expected && !sameFamily(expected, s.format)) { fs.rmSync(file, { force: true }); throw new Error(`refused ${path.basename(file)}: expected ${expected}, got ${s.format}`); }
  let out = file;
  // The extension follows the content.
  const ext = '.' + s.format;
  if (path.extname(out).toLowerCase() !== ext) { const re = out.slice(0, out.length - path.extname(out).length) + ext; fs.renameSync(out, re); out = re; }
  if (s.format === 'svg') fs.writeFileSync(out, sanitizeSvg(fs.readFileSync(out, 'utf8')));
  if (CONVERT_TO[s.format]) {
    const c = await convertForAE(out, s.format);
    notes.push(`converted ${c.from} → ${c.to} for After Effects`);
    return { file: c.file, format: c.to };
  }
  return { file: out, format: s.format };
}

/**
 * A cached copy of an asset, from the cache alone (no network, no key): the id and variant may be spelled
 * loosely (case, a variant prefix like "2k"); without a variant, only the source's default variant matches.
 */
export function fromCache(id: string, wanted?: string): CachedAsset | undefined {
  const e = findCached(id, wanted, (dir) => cachedHit(path.join(dir, 'x'))?.variants?.[0]?.label);
  if (!e) return undefined;
  const a = absEntry(e);
  const hit = cachedHit(a.main);
  if (!hit || licenseRefusal(hit.license)) return undefined;
  const label = e.key.slice(e.key.lastIndexOf('@') + 1);
  const variant = hit.variants.find((v) => v.label === label) ?? { label, url: '', format: path.extname(a.main).slice(1) };
  return { hit, variant, entry: e, main: a.main, files: a.files, notes: ['from the cache'] };
}

const inflight = new Map<string, Promise<CachedAsset>>();

/**
 * Downloads (or finds in the cache) one variant of an asset. No After Effects needed. Concurrent calls for the
 * same asset in this process share one download.
 */
export async function toCache(id: string, opts: { variant?: string; ctx?: AdapterContext } = {}): Promise<CachedAsset> {
  housekeeping();
  const hitInCache = fromCache(id, opts.variant);
  if (hitInCache) return hitInCache;
  const key = `${id.toLowerCase()}@${(opts.variant ?? '').toLowerCase()}`;
  const running = inflight.get(key);
  if (running) return running;
  const p = download1(id, opts).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function download1(id: string, opts: { variant?: string; ctx?: AdapterContext }): Promise<CachedAsset> {
  const ctx = opts.ctx ?? adapterContext();
  const { adapter, sourceId } = adapterFor(id);
  const hit = await adapter.get(sourceId, ctx);
  const refusal = licenseRefusal(hit.license);
  if (refusal) throw new Error(`${hit.id}: not fetched: ${refusal}`);
  const variant = pickVariant(hit, opts.variant);
  const notes: string[] = [];
  const cached = lookup(hit.id, variant.label);
  if (cached) { const a = absEntry(cached); return { hit, variant, entry: cached, main: a.main, files: a.files, notes: ['from the cache'] }; }

  const max = MAX_BYTES[hit.kind];
  if (variant.bytes && variant.bytes > max) throw new Error(`${hit.id} ${variant.label}: ${(variant.bytes / 1e6).toFixed(0)} MB is over the ${(max / 1e6).toFixed(0)} MB cap for ${hit.kind}; pick a smaller variant`);
  await adapter.onFetch?.(hit, variant, ctx);
  const tmp = path.join(assetHome(), '_tmp', crypto.randomBytes(6).toString('hex'));
  fs.mkdirSync(tmp, { recursive: true });
  try {
    const headers = adapter.downloadHeaders?.(ctx);
    // ambientCG names the file in a query parameter (get?file=X.zip); Fontsource/google URLs are percent-encoded.
    const u = new URL(variant.url);
    const named = u.searchParams.get('file') ?? decodeURIComponent(path.basename(u.pathname));
    const base = safeName(named && /\.[a-z0-9]{2,5}$/i.test(named) ? named : `${named || sourceId}.${variant.format}`);
    let main = path.join(tmp, base);
    await getFile(variant.url, main, hit.source, max, headers);
    // Extra files (a glTF's .bin and textures) keep their relative paths, which must stay inside the folder.
    let total = fs.statSync(main).size;
    for (const f of variant.files ?? []) {
      const rel = path.normalize(f.path);
      if (path.isAbsolute(rel) || rel.startsWith('..') || /^[a-z]:/i.test(rel)) throw new Error(`refused file path "${f.path}" from ${hit.source}`);
      const dest = path.join(tmp, rel);
      await getFile(f.url, dest, hit.source, max - total, headers);
      total += fs.statSync(dest).size;
      if (total > max) throw new Error(`${hit.id}: files add up past the ${(max / 1e6).toFixed(0)} MB cap`);
    }
    let fmt: SniffedFormat;
    ({ file: main, format: fmt } = await vet(main, variant.format, notes));
    let files: string[] = [];
    if (fmt === 'zip') {
      // ambientCG: a ZIP of PBR maps. Keep the images; the color map is the main file.
      const written = extractZip(fs.readFileSync(main), path.join(tmp, 'maps'), { filter: (n) => /\.(jpe?g|png|exr|hdr|tiff?)$/i.test(n) });
      fs.rmSync(main, { force: true });
      if (!written.length) throw new Error(`${hit.id}: the ZIP held no image maps`);
      const imgs: string[] = [];
      // ambientCG also packs a preview render named after the asset (Paper006.png): not a map.
      for (const w of written) {
        if (new RegExp(`^${sourceId.replace(/[^A-Za-z0-9]/g, '.')}\\.(png|jpe?g)$`, 'i').test(path.basename(w)) && written.length > 1) { fs.rmSync(w, { force: true }); continue; }
        imgs.push((await vet(w, '', notes)).file);
      }
      // HDRIs (ambientCG ships them zipped too): the .exr/.hdr, not the tonemapped preview JPG.
      const color = (hit.kind === 'hdri' ? imgs.find((f) => /\.(exr|hdr)$/i.test(f)) : undefined)
        ?? imgs.find((f) => /_(color|diffuse|albedo|basecolor)\.[a-z]+$/i.test(f)) ?? imgs.find((f) => !/(normal|rough|disp|ao|ambientocclusion|metal|opacity|height)/i.test(path.basename(f))) ?? imgs[0];
      main = color;
      files = imgs.filter((f) => f !== color);
      notes.push(`maps: ${imgs.map((f) => path.basename(f)).join(', ')}`);
    } else if (fmt === 'gltf') {
      // One self-contained .glb, so the model survives Collect Files and a moved project folder (D94).
      // Textures must be images (checked, not renamed: the .gltf refers to them by name); .bin files are raw
      // buffers the packer only copies. A local .gltf is packed from its own folder (its sidecars live there).
      for (const f of variant.files ?? []) {
        const p = path.join(tmp, path.normalize(f.path));
        if (/\.bin$/i.test(p)) continue;
        const s = sniff(fs.readFileSync(p).subarray(0, 4096));
        if (!s.format || !/^(jpg|png|webp)$/.test(s.format)) throw new Error(`refused ${f.path}: ${s.refused ?? `not a texture image (${s.format})`}`);
      }
      const glb = main.replace(/\.gltf$/i, '.glb');
      packGltf(hit.source === 'local' && variant.url.startsWith('file:') ? fileURLToPath(variant.url) : main, glb);
      main = glb;
      notes.push('packed the glTF, its .bin and textures into one .glb');
    } else {
      if (fmt !== 'svg' && !AE_NATIVE.has(fmt) && !/^(ttf|otf)$/.test(fmt)) throw new Error(`${hit.id}: ${fmt} can't be imported into After Effects`);
      // Multi-file variants (a font family's upright and italic files): each one checked like the main file.
      for (const f of variant.files ?? []) files.push((await vet(path.join(tmp, path.normalize(f.path)), variant.format, notes)).file);
    }
    // Final files go into a fresh folder that is renamed into place in one step, so a concurrent fetch (another
    // process) either sees the whole entry or none of it.
    const ready = path.join(tmp, '__entry');
    fs.mkdirSync(ready, { recursive: true });
    const put = (f: string) => { const n = path.basename(f); fs.renameSync(f, path.join(ready, n)); return n; };
    const mainRel = put(main);
    const rels = files.map(put);
    // The record travels with the files: builds credit `asset:` refs without asking the API again.
    fs.writeFileSync(path.join(ready, HIT_FILE), JSON.stringify({ ...hit, fetchedVariant: variant.label, notes: [...(hit.notes ?? [])] }));
    const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(ready, mainRel))).digest('hex');
    const dir = path.join(assetHome(), entryDir(hit.id, variant.label));
    const won = lookup(hit.id, variant.label);
    if (won) { const a = absEntry(won); return { hit, variant, entry: won, main: a.main, files: a.files, notes: [...notes, 'fetched in parallel; using the copy that landed first'] }; }
    fs.rmSync(dir, { recursive: true, force: true }); // a stale, unindexed folder
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    fs.renameSync(ready, dir);
    const entry = record(hit.id, variant.label, mainRel, rels, sha);
    const a = absEntry(entry);
    return { hit, variant, entry, main: a.main, files: a.files, notes };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** `<project folder>/footage/<source>/<asset>/`: next to the .aep, so Collect Files and moving the folder keep it. */
export function projectAssetDir(projectDir: string, id: string): string {
  const [source, ...rest] = id.split(':');
  return path.join(projectDir, 'footage', safeName(source), safeName(rest.join('_')));
}

/** Copies a cached asset into the project's footage folder (same bytes are not copied twice). */
export function toProject(c: CachedAsset, projectDir: string): { main: string; files: string[] } {
  const dir = projectAssetDir(projectDir, c.hit.id);
  fs.mkdirSync(dir, { recursive: true });
  const copy = (f: string) => {
    const d = path.join(dir, path.basename(f));
    if (!fs.existsSync(d) || fs.statSync(d).size !== fs.statSync(f).size) fs.copyFileSync(f, d);
    return d;
  };
  return { main: copy(c.main), files: c.files.map(copy) };
}

/** Where credits go when the project isn't saved yet. */
export const unsavedCreditsDir = () => path.join(assetHome(), '_unsaved');

export interface FetchResult {
  id: string; kind: AssetKind; title: string; variant: string;
  /** The file to use: an .svg for <Svg src>, a font file, or the imported footage file. */
  file: string;
  files: string[];
  inProject: boolean;
  imported?: { itemId: number; name: string; folder: string };
  credits: string;
  /** License label and its flags (ShareAlike, trademark): tell the user about the flags. */
  license: string;
  flags: string[];
  notes: string[];
}

/**
 * The whole fetch: cache → project footage folder (when `projectDir`, the saved project's folder, is known) →
 * credit → optional import via `importer` (the bridge's importFile; icons and fonts are never imported).
 */
export async function fetchAsset(id: string, opts: { variant?: string; projectDir?: string | null; creditsDir?: string; importer?: (file: string, folder: string) => Promise<{ id: number; name: string }>; folder?: string; ctx?: AdapterContext } = {}): Promise<FetchResult> {
  const c = await toCache(id, { variant: opts.variant, ctx: opts.ctx });
  const notes = [...c.notes];
  let main = c.main, files = c.files, inProject = false;
  if (opts.projectDir) { ({ main, files } = toProject(c, opts.projectDir)); inProject = true; }
  else notes.push(`the project isn't saved, so the file stays in the cache (${c.main}); save the project and fetch again to copy it into its footage folder`);
  const creditsDir = opts.creditsDir ?? opts.projectDir ?? unsavedCreditsDir();
  const rel = (f: string) => path.relative(creditsDir, f).replace(/\\/g, '/');
  const cr = appendCredit(creditsDir, c.hit, [main, ...files].map((f) => (path.relative(creditsDir, f).startsWith('..') ? f.replace(os.homedir(), '~') : rel(f))));
  const r: FetchResult = { id: c.hit.id, kind: c.hit.kind, title: c.hit.title, variant: c.variant.label, file: main, files, inProject, credits: cr.file, license: licenseLabel(c.hit.license), flags: licenseFlags(c.hit.license), notes };
  if (opts.importer && c.hit.kind !== 'icon' && c.hit.kind !== 'font') {
    const folder = opts.folder ?? `ae-compose/Assets/${c.hit.source}`;
    const it = await opts.importer(main, folder);
    r.imported = { itemId: it.id, name: it.name, folder };
  }
  return r;
}
