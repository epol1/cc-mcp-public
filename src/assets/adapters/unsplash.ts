// Unsplash (ASSETS §2): photos under the Unsplash License. Needs an Access Key (not the Secret key), sent as
// `Authorization: Client-ID <key>` with `Accept-Version: v1` on api.unsplash.com calls only; image files come from
// images.unsplash.com without it. Demo apps get 50 requests/hour.
// API guidelines this adapter follows: every fetch pings the photo's `links.download_location` (onFetch, never
// cached); credits read "Photo by <name> on Unsplash" with links to the photographer and to Unsplash, both
// carrying `utm_source=ae-compose&utm_medium=referral`; image URLs keep their `ixid` parameter.
import { licenseLabel, normalizeLicense } from '../license.ts';
import type { Adapter, AdapterContext, AssetHit, AssetVariant } from '../types.ts';

const API = 'https://api.unsplash.com';
const KEY_HELP = 'create an app at https://unsplash.com/developers and put its Access Key (not the Secret key) in ~/.ae-compose/keys.json as {"unsplash": "…"} (or set AEC_UNSPLASH_KEY); demo apps get 50 requests/hour';
const UTM = 'utm_source=ae-compose&utm_medium=referral';

function needKey(ctx: AdapterContext): string {
  const k = ctx.key('unsplash');
  if (!k) throw new Error(`unsplash: no API key. To use Unsplash, ${KEY_HELP}.`);
  return k;
}

const auth = (key: string) => ({ Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' });
const withUtm = (url: string) => `${url}${url.includes('?') ? '&' : '?'}${UTM}`;

const qs = (p: Record<string, string | number | undefined>) =>
  Object.entries(p).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');

/** Image format of an imgix URL: its `fm` parameter, else the path extension, else jpg. */
function formatOf(url: string): string {
  try {
    const u = new URL(url);
    const fm = u.searchParams.get('fm') ?? /\.([a-z0-9]{2,5})$/i.exec(u.pathname)?.[1];
    const f = (fm ?? 'jpg').toLowerCase();
    return f === 'jpeg' ? 'jpg' : f;
  } catch { return 'jpg'; }
}

/** download_location per hit id, kept from search/get so onFetch pings the URL with the API's tracking `ixid`. */
const downloadLocations = new Map<string, string>();
const isApiUrl = (u: unknown): u is string => typeof u === 'string' && u.startsWith(`${API}/`);

function cleanTitle(s: unknown): string {
  const t = String(s ?? '').split(/\r?\n/)[0].trim();
  if (!t) return '';
  const c = t.charAt(0).toUpperCase() + t.slice(1);
  return c.length > 100 ? c.slice(0, 99) + '…' : c;
}

function photoHit(p: any): AssetHit {
  const id = `unsplash:${p.id}`;
  const name: string = p.user?.name || p.user?.username || 'an Unsplash photographer';
  const profile: string | undefined = p.user?.links?.html || (p.user?.username ? `https://unsplash.com/@${p.user.username}` : undefined);
  const authorUrl = profile ? withUtm(profile) : undefined;
  const page = withUtm(p.links?.html || `https://unsplash.com/photos/${p.id}`);
  const title = cleanTitle(p.alt_description) || cleanTitle(p.description) || `Photo by ${name}`;
  const license = normalizeLicense('unsplash');
  const W = Number(p.width) || 0, H = Number(p.height) || 0;
  const urls = p.urls ?? {};
  const variants: AssetVariant[] = [];
  if (urls.full) variants.push({ label: 'full', url: urls.full, format: formatOf(urls.full), ...(W ? { width: W, height: H } : {}) });
  if (urls.raw && W > 3840) {
    const url = `${urls.raw}${urls.raw.includes('?') ? '&' : '?'}w=3840&fm=jpg&q=85`;
    variants.push({ label: '4k', url, format: 'jpg', width: 3840, height: Math.round((3840 * H) / W) });
  }
  if (urls.regular) variants.push({ label: 'regular', url: urls.regular, format: formatOf(urls.regular), ...(W ? { width: Math.min(W, 1080), height: Math.round((Math.min(W, 1080) * H) / W) } : {}) });
  const dl = p.links?.download_location;
  if (isApiUrl(dl)) downloadLocations.set(id, dl);
  return {
    id, source: 'unsplash', kind: 'photo', title,
    tags: Array.isArray(p.tags) ? [...new Set(p.tags.map((t: any) => String(t?.title ?? t).toLowerCase()).filter(Boolean))] as string[] : [],
    preview: urls.small || urls.thumb || urls.regular || '',
    ...(W ? { width: W, height: H } : {}),
    author: name, ...(authorUrl ? { authorUrl } : {}), license, page,
    credit: `Photo by ${name}${authorUrl ? ` (${authorUrl})` : ''} on Unsplash (${withUtm('https://unsplash.com/')}): "${title.replace(/"/g, "'")}" (${page}), ${licenseLabel(license)} (${license.url}).`,
    variants,
  };
}

function fitsOrientation(w: number | undefined, h: number | undefined, o: 'landscape' | 'portrait' | 'square' | undefined): boolean {
  if (!o || !w || !h) return true;
  const r = w / h;
  return o === 'landscape' ? r >= 1.05 : o === 'portrait' ? r <= 0.95 : r >= 0.85 && r <= 1.18;
}

async function getPhoto(sourceId: string, ctx: AdapterContext): Promise<AssetHit> {
  const key = needKey(ctx);
  const id = sourceId.trim();
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`unsplash: bad id "${sourceId}" (expected the photo id, e.g. "Dwu85P9SOIk")`);
  return photoHit(await ctx.getJson(`${API}/photos/${id}`, { source: 'unsplash', headers: auth(key) }));
}

export const unsplash: Adapter = {
  id: 'unsplash',
  kinds: ['photo'],
  key: 'required',
  keyHelp: KEY_HELP,
  async search(q, ctx) {
    const key = needKey(ctx);
    // The Unsplash License isn't public domain: the 'cc0' filter would refuse every hit, so don't spend requests.
    if ((q.kind && q.kind !== 'photo') || !q.query.trim() || q.license === 'cc0') return [];
    const limit = Math.max(1, Math.min(30, q.limit ?? 12));
    const params = {
      query: q.query.trim(),
      per_page: Math.min(30, q.minWidth ? limit * 2 : limit), // Unsplash: per_page ≤ 30
      ...(q.orientation ? { orientation: q.orientation === 'square' ? 'squarish' : q.orientation } : {}),
      content_filter: 'high',
    };
    const j = await ctx.getJson(`${API}/search/photos?${qs(params)}`, { source: 'unsplash', headers: auth(key) });
    return (Array.isArray(j?.results) ? j.results : []).map(photoHit)
      .filter((h: AssetHit) => h.variants.length > 0 && (!q.minWidth || !h.width || h.width >= q.minWidth) && fitsOrientation(h.width, h.height, q.orientation))
      .slice(0, limit);
  },
  get: getPhoto,
  /** Unsplash guideline: tell the API about every download (GET download_location; the response is ignored). */
  async onFetch(hit, _variant, ctx) {
    const key = needKey(ctx);
    const id = hit.id.replace(/^unsplash:/, '');
    let loc = downloadLocations.get(hit.id);
    if (!loc) { try { await getPhoto(id, ctx); loc = downloadLocations.get(hit.id); } catch { /* fall back below */ } }
    loc ??= `${API}/photos/${encodeURIComponent(id)}/download`;
    // Never cached: each fetch counts once. Best effort: a failed ping doesn't stop the download.
    try { await ctx.getJson(loc, { source: 'unsplash', ttlMs: 0, headers: auth(key) }); } catch { /* ignored */ }
  },
  // Files come from images.unsplash.com: no Authorization header there.
  downloadHeaders: () => ({}),
};
