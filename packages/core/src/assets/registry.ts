// Every asset source, in search order (local folders first: the user's standing rule), and per-source status for
// `doctor` and `find_assets` (on, off and why, how to get a key).
import { local } from './adapters/local.ts';
import { iconify } from './adapters/iconify.ts';
import { polyhaven } from './adapters/polyhaven.ts';
import { ambientcg } from './adapters/ambientcg.ts';
import { pixabay } from './adapters/pixabay.ts';
import { pexels } from './adapters/pexels.ts';
import { unsplash } from './adapters/unsplash.ts';
import { openverse } from './adapters/openverse.ts';
import { fontsource } from './adapters/fontsource.ts';
import { adapterContext } from './context.ts';
import type { Adapter, AdapterContext, AssetKind } from './types.ts';

export const ADAPTERS: Adapter[] = [local, iconify, polyhaven, ambientcg, pixabay, pexels, unsplash, openverse, fontsource];

/** "pexels:video:123" → the pexels adapter and "video:123". */
export function adapterFor(id: string): { adapter: Adapter; sourceId: string } {
  const i = id.indexOf(':');
  const src = i < 0 ? id : id.slice(0, i);
  const adapter = ADAPTERS.find((a) => a.id === src);
  if (!adapter) throw new Error(`unknown asset source "${src}" in "${id}" (sources: ${ADAPTERS.map((a) => a.id).join(', ')})`);
  if (i < 0 || i === id.length - 1) throw new Error(`asset id "${id}" needs "<source>:<id>", e.g. "iconify:lucide:rocket"`);
  return { adapter, sourceId: id.slice(i + 1) };
}

export interface SourceStatus { id: string; kinds: AssetKind[]; on: boolean; detail: string }

/** Whether each source can be used now, and why not. Cheap: no network calls except the adapter's own check. */
export async function sourceStatus(ctx: AdapterContext = adapterContext(), only?: string[]): Promise<SourceStatus[]> {
  const out: SourceStatus[] = [];
  for (const a of ADAPTERS) {
    if (only && !only.includes(a.id)) continue;
    if (a.key === 'required' && !ctx.key(a.id)) { out.push({ id: a.id, kinds: a.kinds, on: false, detail: `no API key: ${a.keyHelp ?? 'add one to ~/.ae-compose/keys.json'}` }); continue; }
    if (a.available) {
      try { const r = await a.available(ctx); out.push({ id: a.id, kinds: a.kinds, on: r.ok, detail: r.detail }); } catch (e: any) { out.push({ id: a.id, kinds: a.kinds, on: false, detail: e.message }); }
      continue;
    }
    out.push({ id: a.id, kinds: a.kinds, on: true, detail: a.key === 'optional' ? (ctx.key(a.id) ? 'key set' : 'anonymous (lower rate limits)') : a.key === 'required' ? 'key set' : 'keyless' });
  }
  return out;
}
