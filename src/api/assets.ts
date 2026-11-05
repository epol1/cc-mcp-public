// find_assets / fetch_asset for the MCP server and CLI (ASSETS §3): search with a numbered thumbnail grid, and
// fetch = download → project footage folder → import (one undo step) → CREDITS.md, plus the font install path.
import path from 'node:path';
import { callRuntime, evalAE } from '../bridge/index.ts';
import { findAssets, hitLines } from '@ae-mcp/core/assets/find.ts';
import { thumbnailGrid } from '@ae-mcp/core/assets/grid.ts';
import { fetchAsset } from '@ae-mcp/core/assets/fetch.ts';
import type { FetchResult } from '@ae-mcp/core/assets/fetch.ts';
import { aeFontCheckScript, installFonts } from '@ae-mcp/core/assets/fonts.ts';
import { cacheStats } from '@ae-mcp/core/assets/cache.ts';
import { sourceStatus } from '@ae-mcp/core/assets/registry.ts';
import { OUT_ROOT } from './build.ts';
import type { SearchQuery } from '@ae-mcp/core/assets/types.ts';

export async function findAssetsTool(q: SearchQuery & { sources?: string[] }): Promise<{ text: string; grid?: string }> {
  const r = await findAssets(q);
  const lines = [`${r.hits.length} result(s) for "${q.query}"${q.kind ? ` (${q.kind})` : ''}:`, ...hitLines(r.hits)];
  if (!r.hits.length) lines.push('nothing found: try other words, another kind, or drop filters');
  const refused = Object.entries(r.refused);
  if (refused.length) lines.push(`left out by the license allowlist: ${refused.map(([why, n]) => `${n}× ${why}`).join('; ')}`);
  for (const s of r.skipped) lines.push(`not searched: ${s.source}: ${s.reason}`);
  for (const e of r.errors) lines.push(`failed: ${e.source}: ${e.error}`);
  lines.push('Fetch one with fetch_asset { id } (or use it in a scene as src="asset:<id>"). Icons come back as an .svg for <Svg src> (native shapes); fonts need { install: true } and the user\'s OK.');
  let grid: string | undefined;
  if (r.hits.length) {
    try { grid = await thumbnailGrid(r.hits, path.join(OUT_ROOT, '_assets', `find_${Date.now()}.png`), `find_assets "${q.query}"`); }
    catch (e: any) { lines.push(`(no thumbnail grid: ${e.message})`); }
  }
  return { text: lines.join('\n'), grid };
}

export interface FetchToolResult extends FetchResult { fonts?: { file: string; postScript: string[]; already: boolean }[]; aeSees?: string[]; aeMissing?: string[] }

export async function fetchAssetTool(a: { id: string; variant?: string; import?: boolean; folder?: string; install?: boolean; credits?: string }): Promise<FetchToolResult> {
  // The saved project's folder decides where files go; without AE, files stay in the cache.
  const p = await callRuntime('ping', [], { timeoutMs: 20_000 }).catch(() => null);
  const projectDir = p?.project ? path.dirname(p.project) : null;
  const importer = a.import === false || !p ? undefined : async (file: string, folder: string) => {
    const r = await callRuntime('importAssets', [[{ path: file.replace(/\\/g, '/'), folder, id: a.id }]], { timeoutMs: 120_000 });
    if (!r.ok) throw new Error(r.error);
    return { id: r.items[0].id, name: r.items[0].name };
  };
  const r: FetchToolResult = await fetchAsset(a.id, { variant: a.variant, projectDir, importer, folder: a.folder, creditsDir: a.credits });
  if (!p && a.import !== false && r.kind !== 'icon' && r.kind !== 'font') r.notes.push('After Effects is not reachable, so nothing was imported');
  if (r.kind === 'font') {
    const files = [r.file, ...r.files].filter((f) => /\.(ttf|otf)$/i.test(f));
    if (!a.install) r.notes.push(`downloaded only; installing changes the user's system: ask them, then fetch again with { install: true }`);
    else {
      const inst = installFonts(files);
      r.fonts = inst.map((i) => ({ file: i.file, postScript: i.names.instances.length ? i.names.instances : [i.names.postScript], already: i.already }));
      const want = r.fonts.flatMap((f) => f.postScript);
      if (p) {
        const c = await evalAE(aeFontCheckScript(want), { timeoutMs: 30_000 });
        if (c.ok) { const [ok, miss] = String(c.result).split('|'); r.aeSees = ok ? ok.split(',') : []; r.aeMissing = miss ? miss.split(',') : []; }
      }
      if (r.aeMissing?.length) r.notes.push(`After Effects doesn't list these yet; check the PostScript names (variable fonts list their named instances), and if they are right, ask the user to restart AE (never restart it yourself); until then text in this font renders as a substitute`);
    }
  }
  return r;
}

export function fetchSummary(r: FetchToolResult): string {
  const lines = [`OK: ${r.id} (${r.kind}, ${r.variant}) "${r.title}" · ${r.license}`, ...r.flags.map((f) => `FLAG: ${f} (tell the user)`), `file: ${r.file}${r.inProject ? ' (in the project\'s footage folder)' : ''}`];
  if (r.files.length) lines.push(`with: ${r.files.map((f) => path.basename(f)).join(', ')}`);
  if (r.imported) lines.push(`imported: "${r.imported.name}" #${r.imported.itemId} in ${r.imported.folder} (one undo step)`);
  if (r.kind === 'icon') lines.push(`use it as <Svg src="${r.file.replace(/\\/g, '/')}" … /> or src="asset:${r.id}" (native shape layers; draw={tween(...)} for a draw-on)`);
  if (r.kind === 'model') lines.push(`use it as <Model src="asset:${r.id}" /> (Advanced 3D)`);
  if (r.kind === 'hdri') lines.push(`use it as <Light kind="environment" hdri="asset:${r.id}" />`);
  if (r.fonts) for (const f of r.fonts) lines.push(`font ${f.already ? 'already installed' : 'installed'}: ${path.basename(f.file)} → font="${f.postScript.join('" | "')}"`);
  if (r.aeSees?.length) lines.push(`After Effects sees: ${r.aeSees.join(', ')}`);
  if (r.aeMissing?.length) lines.push(`After Effects does not see yet: ${r.aeMissing.join(', ')}`);
  lines.push(`credited in ${r.credits}`);
  for (const n of r.notes) lines.push(`note: ${n}`);
  return lines.join('\n');
}

/** doctor lines: one per source (on/off and why) and one for the download cache. */
export async function assetDoctorLines(): Promise<{ name: string; ok: boolean; warn?: boolean; detail: string; fix?: string }[]> {
  const out: { name: string; ok: boolean; warn?: boolean; detail: string; fix?: string }[] = [];
  for (const s of await sourceStatus()) out.push({ name: `asset source ${s.id} (${s.kinds.join(', ')})`, ok: s.on, warn: true, detail: s.detail, fix: s.on ? undefined : s.detail });
  const c = cacheStats();
  out.push({ name: 'asset download cache', ok: c.bytes < c.cap, warn: true, detail: `${(c.bytes / 1e9).toFixed(2)} GB in ${c.entries} file set(s) of ${(c.cap / 1e9).toFixed(0)} GB at ${c.root}`, fix: 'it evicts least-recently-used files itself; raise AEC_ASSET_CACHE_GB to keep more' });
  return out;
}
