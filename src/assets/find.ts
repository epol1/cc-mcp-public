// find_assets (ASSETS §3): local folders first, then the APIs that serve the kind, in parallel. Hits outside the
// license allowlist are dropped (and counted); sources without a key are listed with how to get one. Results
// alternate between sources so one API doesn't fill the page.
import { ADAPTERS, sourceStatus } from './registry.ts';
import { adapterContext } from './context.ts';
import { housekeeping } from './cache.ts';
import { licenseRefusal, licenseFlags, licenseLabel } from './license.ts';
import type { AdapterContext, AssetHit, SearchQuery } from './types.ts';

export interface FindResult {
  hits: AssetHit[];
  /** Sources not searched, with the reason (no key, offline, kind not served). */
  skipped: { source: string; reason: string }[];
  /** Sources that failed this time. */
  errors: { source: string; error: string }[];
  /** Hits dropped by the license allowlist, per reason. */
  refused: Record<string, number>;
}

export async function findAssets(q: SearchQuery & { sources?: string[] }, ctx: AdapterContext = adapterContext()): Promise<FindResult> {
  housekeeping();
  const limit = Math.max(1, Math.min(48, q.limit ?? 12));
  const wanted = ADAPTERS.filter((a) => (!q.sources || q.sources.includes(a.id)) && (!q.kind || a.kinds.includes(q.kind)));
  const status = await sourceStatus(ctx, wanted.map((a) => a.id));
  const skipped: FindResult['skipped'] = status.filter((s) => !s.on).map((s) => ({ source: s.id, reason: s.detail }));
  const live = wanted.filter((a) => status.find((s) => s.id === a.id)?.on);
  const per = Math.max(limit, 8);
  const settled = await Promise.allSettled(live.map((a) => a.search({ ...q, limit: per }, ctx)));
  const errors: FindResult['errors'] = [];
  const refused: Record<string, number> = {};
  const lists: AssetHit[][] = [];
  settled.forEach((r, i) => {
    if (r.status === 'rejected') { errors.push({ source: live[i].id, error: String(r.reason?.message ?? r.reason) }); return; }
    lists.push(r.value.filter((h) => {
      const why = licenseRefusal(h.license, q.license ?? 'commercial');
      if (why) { refused[why] = (refused[why] ?? 0) + 1; return false; }
      if (q.kind && h.kind !== q.kind) return false;
      if (q.minWidth && h.width && h.width < q.minWidth) return false;
      if (q.minDuration && h.duration !== undefined && h.duration < q.minDuration) return false;
      if (q.orientation && h.width && h.height) {
        const r = h.width / h.height;
        if (q.orientation === 'landscape' && r < 1.05) return false;
        if (q.orientation === 'portrait' && r > 0.95) return false;
        if (q.orientation === 'square' && (r < 0.85 || r > 1.18)) return false;
      }
      return true;
    }));
  });
  // Round-robin across sources (local first, as listed), so the page shows each source's best.
  const hits: AssetHit[] = [];
  for (let i = 0; hits.length < limit && lists.some((l) => i < l.length); i++) {
    for (const l of lists) if (i < l.length && hits.length < limit) hits.push(l[i]);
  }
  return { hits, skipped, errors, refused };
}

/** The text part of find_assets: one numbered line per hit (numbers match the grid image). */
export function hitLines(hits: AssetHit[]): string[] {
  return hits.map((h, i) => {
    const size = h.width && h.height ? ` ${h.width}×${h.height}` : '';
    const dur = h.duration ? ` ${h.duration.toFixed(1)} s` : '';
    const flags = licenseFlags(h.license).map((f) => f.split(':')[0].toUpperCase());
    const v = h.variants.length ? ` variants: ${h.variants.slice(0, 5).map((x) => x.label).join(', ')}${h.variants.length > 5 ? '…' : ''}` : '';
    return `${i + 1}. ${h.id} [${h.kind}] "${h.title}"${size}${dur} · ${licenseLabel(h.license)}${flags.length ? ` · ${flags.join(' · ')}` : ''}${h.author ? ` · by ${h.author}` : ''}${v}${h.notes?.length ? ` · ${h.notes.join('; ')}` : ''}`;
  });
}
