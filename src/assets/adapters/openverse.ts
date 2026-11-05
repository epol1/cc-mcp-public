// Openverse (ASSETS §2, D91): Creative Commons images (Flickr, Wikimedia…) and audio (mostly Freesound). Works
// anonymously (20 requests/min, 200/day); an optional token ({"openverse": "…"} or AEC_OPENVERSE_TOKEN) goes in
// `Authorization: Bearer` on api.openverse.org calls and raises the limits.
// Licenses: `license_type=commercial` still lets NoDerivatives through (D91), so the query names the allowed
// licenses (cc0, pdm, by, by-sa) and every result is checked again with licenseRefusal; by-sa hits are flagged.
// Freesound audio is the 128 kbps preview MP3 on cdn.freesound.org; `alt_files` (the Freesound API original)
// need a per-user OAuth login and are never used.
import { creditLine } from '../credits.ts';
import { licenseRefusal, normalizeLicense } from '../license.ts';
import type { Adapter, AdapterContext, AssetHit, AssetKind, SearchQuery } from '../types.ts';

const API = 'https://api.openverse.org/v1';
const KINDS: AssetKind[] = ['photo', 'audio'];
const KEY_HELP = 'works without a key (20 requests/min, 200/day); for higher limits register an app ("Register and Authenticate" at https://api.openverse.org/v1/) and put its access token in ~/.ae-compose/keys.json as {"openverse": "…"} (or set AEC_OPENVERSE_TOKEN)';
const FREESOUND_NOTE = 'Freesound preview MP3 (128 kbps); the original needs a Freesound login';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const headers = (ctx: AdapterContext): Record<string, string> | undefined => {
  const t = ctx.key('openverse');
  return t ? { Authorization: `Bearer ${t}` } : undefined;
};

/** Query string with readable commas ("license=cc0,pdm,by,by-sa"). */
const qs = (p: Record<string, string | number | undefined>) =>
  Object.entries(p).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v)).replace(/%2C/gi, ',')}`).join('&');

/** Display names for Openverse sources/providers in credit lines ("Flickr via Openverse"). */
const SOURCE_NAMES: Record<string, string> = {
  flickr: 'Flickr', freesound: 'Freesound', wikimedia: 'Wikimedia Commons', wikimedia_audio: 'Wikimedia Commons',
  jamendo: 'Jamendo', ccmixter: 'ccMixter', stocksnap: 'StockSnap', rawpixel: 'rawpixel', nappy: 'nappy',
  met: 'The Metropolitan Museum of Art', nasa: 'NASA', europeana: 'Europeana', smithsonian: 'Smithsonian',
};
function sourceDisplay(r: any): string {
  const s = String(r.source || r.provider || 'openverse');
  return SOURCE_NAMES[s] ?? s.split(/[_\s]+/).map((w) => (w.length > 2 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ');
}

function formatOf(filetype: unknown, url: string, fallback: string): string {
  let f = typeof filetype === 'string' && filetype ? filetype.toLowerCase() : undefined;
  if (!f) { try { f = /\.([a-z0-9]{2,5})$/i.exec(new URL(url).pathname)?.[1]?.toLowerCase(); } catch { /* no extension */ } }
  return f === 'jpeg' ? 'jpg' : f ?? fallback;
}

const host = (url: string) => { try { return new URL(url).hostname; } catch { return ''; } };

/** A normalized hit, or the reason the license is refused. */
function toHit(r: any, kind: 'photo' | 'audio', mode: 'cc0' | 'commercial'): AssetHit | { refused: string } {
  const license = normalizeLicense(r.license, r.license_version ?? undefined, r.license_url ?? undefined);
  const why = licenseRefusal(license, mode);
  if (why) return { refused: why };
  const audio = kind === 'audio';
  const source = sourceDisplay(r);
  const title = String(r.title ?? '').trim() || `Untitled ${audio ? 'sound' : 'image'} from ${source}`;
  const author: string | undefined = String(r.creator ?? '').trim() || undefined;
  const authorUrl: string | undefined = String(r.creator_url ?? '').trim() || undefined;
  const page: string = r.foreign_landing_url || r.detail_url || `${API}/${audio ? 'audio' : 'images'}/${r.id}/`;
  const url = String(r.url ?? '');
  const W = Number(r.width) || 0, H = Number(r.height) || 0;
  const freesoundPreview = audio && /(^|\.)freesound\.org$/.test(host(url));
  const tags = [...new Set((Array.isArray(r.tags) ? r.tags : []).map((t: any) => String(t?.name ?? '').trim().toLowerCase()).filter(Boolean))] as string[];
  return {
    id: audio ? `openverse:audio:${r.id}` : `openverse:${r.id}`,
    source: 'openverse', kind, title, tags,
    // Images: Openverse's thumbnail endpoint. Audio: its cover art if any, else none (no image to show).
    preview: r.thumbnail || (audio ? '' : url),
    ...(W ? { width: W, height: H } : {}),
    ...(audio && Number(r.duration) > 0 ? { duration: Number(r.duration) / 1000 } : {}), // Openverse: milliseconds
    ...(author ? { author } : {}), ...(authorUrl ? { authorUrl } : {}),
    license, page,
    credit: creditLine({ title, author, authorUrl, source, page, license, via: 'Openverse' }),
    variants: url ? [{ label: 'original', url, format: formatOf(r.filetype, url, audio ? 'mp3' : 'jpg'), ...(W ? { width: W, height: H } : {}), ...(Number(r.filesize) > 0 ? { bytes: Number(r.filesize) } : {}) }] : [],
    ...(freesoundPreview ? { notes: [FREESOUND_NOTE] } : {}),
  };
}

const isHit = (x: AssetHit | { refused: string }): x is AssetHit => !('refused' in x);

async function searchKind(kind: 'photo' | 'audio', q: SearchQuery, limit: number, ctx: AdapterContext): Promise<AssetHit[]> {
  const mode = q.license ?? 'commercial';
  const h = headers(ctx);
  const local = kind === 'audio' ? !!q.minDuration : !!q.minWidth;
  // Anonymous requests may ask for at most 20 per page.
  const pageSize = Math.max(1, Math.min(h ? 50 : 20, local ? limit * 3 : limit));
  const params: Record<string, string | number | undefined> = {
    q: q.query.trim(),
    license: mode === 'cc0' ? 'cc0,pdm' : 'cc0,pdm,by,by-sa',
    page_size: pageSize,
  };
  if (kind === 'photo') {
    if (q.orientation) params.aspect_ratio = q.orientation === 'landscape' ? 'wide' : q.orientation === 'portrait' ? 'tall' : 'square';
    if ((q.minWidth ?? 0) >= 1000) params.size = 'large';
  }
  const j = await ctx.getJson(`${API}/${kind === 'audio' ? 'audio' : 'images'}/?${qs(params)}`, { source: 'openverse', headers: h });
  return (Array.isArray(j?.results) ? j.results : [])
    .map((r: any) => toHit(r, kind, mode))
    .filter(isHit)
    .filter((x: AssetHit) => x.variants.length > 0
      && (kind !== 'photo' || !q.minWidth || !x.width || x.width >= q.minWidth)
      && (kind !== 'audio' || !q.minDuration || (x.duration ?? 0) >= q.minDuration))
    .slice(0, limit);
}

function interleave<T>(lists: T[][], limit: number): T[] {
  const out: T[] = [];
  for (let i = 0; out.length < limit && lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length && out.length < limit) out.push(l[i]);
  return out;
}

export const openverse: Adapter = {
  id: 'openverse',
  kinds: KINDS,
  key: 'optional',
  keyHelp: KEY_HELP,
  async search(q, ctx) {
    const kinds = (q.kind ? KINDS.filter((k) => k === q.kind) : KINDS) as ('photo' | 'audio')[];
    if (!kinds.length || !q.query.trim()) return [];
    const limit = Math.max(1, Math.min(50, q.limit ?? 12));
    return interleave(await Promise.all(kinds.map((k) => searchKind(k, q, limit, ctx))), limit);
  },
  async get(sourceId, ctx) {
    const m = /^(audio:)?(.+)$/.exec(sourceId.trim());
    const uuid = m?.[2] ?? '';
    if (!UUID.test(uuid)) throw new Error(`openverse: bad id "${sourceId}" (expected "<uuid>" for an image or "audio:<uuid>")`);
    const kind = m?.[1] ? 'audio' : 'photo';
    const r = await ctx.getJson(`${API}/${kind === 'audio' ? 'audio' : 'images'}/${uuid.toLowerCase()}/`, { source: 'openverse', headers: headers(ctx) });
    const hit = toHit(r, kind, 'commercial');
    if (!isHit(hit)) throw new Error(`openverse: ${sourceId} is refused by the license allowlist (${hit.refused})`);
    return hit;
  },
};
