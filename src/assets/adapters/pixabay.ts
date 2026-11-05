// Pixabay (ASSETS §2, D90): photos and videos under the Pixabay Content License. Needs a free key, which goes in
// the query string (`key=`) of API calls only; http.ts redacts it from cache keys and errors. Their terms: 100
// requests/60 s, cache responses 24 h (http.ts does), download files instead of hotlinking, no mass downloads.
// Photos and videos are separate id spaces: "pixabay:<id>" is a photo, "pixabay:video:<id>" a video.
// Photo URLs on pixabay.com/get/… expire after about 24 h, so `get` re-reads an id more often than search.
import { creditLine } from '../credits.ts';
import { normalizeLicense } from '../license.ts';
import type { Adapter, AdapterContext, AssetHit, AssetKind, AssetVariant, SearchQuery } from '../types.ts';

const API = 'https://pixabay.com/api/';
const KINDS: AssetKind[] = ['photo', 'video'];
const KEY_HELP = 'get a free key at https://pixabay.com/api/docs/ (sign in; it is shown under "Parameters") and put it in ~/.ae-compose/keys.json as {"pixabay": "…"} (or set AEC_PIXABAY_KEY)';
/** `get` cache: shorter than the 24 h search cache because pixabay.com/get/… image URLs expire after ~24 h. */
const GET_TTL = 12 * 3600_000;

function needKey(ctx: AdapterContext): string {
  const k = ctx.key('pixabay');
  if (!k) throw new Error(`pixabay: no API key. To use Pixabay, ${KEY_HELP}.`);
  return k;
}

/** Query string with readable commas (encodeURIComponent would turn them into %2C). */
const qs = (p: Record<string, string | number | undefined>) =>
  Object.entries(p).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v)).replace(/%2C/gi, ',')}`).join('&');

/** File extension of a URL's path ("jpg", "png", "mp4"), jpeg → jpg; `fallback` when there is none. */
function extOf(url: string, fallback: string): string {
  try {
    const m = /\.([a-z0-9]{2,5})$/i.exec(new URL(url).pathname);
    const e = m?.[1].toLowerCase();
    return e === 'jpeg' ? 'jpg' : e ?? fallback;
  } catch { return fallback; }
}

/** Size of an image scaled to fit `max` px on its longest side (never enlarged). */
function fit(w: number, h: number, max: number): { width?: number; height?: number } {
  if (!(w > 0 && h > 0)) return {};
  const s = Math.min(1, max / Math.max(w, h));
  return { width: Math.round(w * s), height: Math.round(h * s) };
}

function splitTags(s: unknown): string[] {
  return [...new Set(String(s ?? '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))];
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function titleOf(h: any, kind: 'photo' | 'video'): string {
  const t = String(h.heading || h.description || '').trim().replace(/\s+(photo|video|image)$/i, '');
  if (t) return t.length > 100 ? t.slice(0, 99) + '…' : t;
  const tags = splitTags(h.name || h.tags).slice(0, 3);
  return tags.length ? cap(tags.join(', ')) : `Pixabay ${kind} ${h.id}`;
}

function fitsOrientation(w: number | undefined, h: number | undefined, o: SearchQuery['orientation']): boolean {
  if (!o || !w || !h) return true;
  const r = w / h;
  return o === 'landscape' ? r >= 1.05 : o === 'portrait' ? r <= 0.95 : r >= 0.85 && r <= 1.18;
}

function common(h: any, kind: 'photo' | 'video') {
  const title = titleOf(h, kind);
  const author: string | undefined = h.user || undefined;
  const authorUrl: string | undefined = h.userURL || (h.user && h.user_id ? `https://pixabay.com/users/${h.user}-${h.user_id}/` : undefined);
  const page: string = h.pageURL || `https://pixabay.com/${kind === 'video' ? 'videos' : 'photos'}/id-${h.id}/`;
  const license = normalizeLicense('pixabay');
  return { title, author, authorUrl, page, license, tags: splitTags(h.tags), credit: creditLine({ title, author, authorUrl, source: 'pixabay', page, license }) };
}

function photoHit(h: any): AssetHit {
  const W = Number(h.imageWidth) || 0, H = Number(h.imageHeight) || 0;
  const variants: AssetVariant[] = [];
  // imageURL / fullHDURL only come with full API access (approved accounts).
  if (h.imageURL) variants.push({ label: 'full', url: h.imageURL, format: extOf(h.imageURL, 'jpg'), ...(W ? { width: W, height: H } : {}), ...(h.imageSize ? { bytes: h.imageSize } : {}) });
  if (h.fullHDURL) variants.push({ label: 'hd', url: h.fullHDURL, format: extOf(h.fullHDURL, 'jpg'), ...fit(W, H, 1920) });
  if (h.largeImageURL) variants.push({ label: 'large', url: h.largeImageURL, format: extOf(h.largeImageURL, 'jpg'), ...fit(W, H, 1280) });
  if (h.webformatURL) variants.push({ label: 'web', url: h.webformatURL, format: extOf(h.webformatURL, 'jpg'), ...(h.webformatWidth ? { width: h.webformatWidth, height: h.webformatHeight } : fit(W, H, 640)) });
  return {
    id: `pixabay:${h.id}`, source: 'pixabay', kind: 'photo', ...common(h, 'photo'),
    preview: h.previewURL || h.webformatURL || '',
    ...(W ? { width: W, height: H } : {}),
    variants,
  };
}

/** Video sizes, labelled by the short side ("1080p"); default = the largest ≤ 1080p, then larger, then smaller. */
function videoVariants(videos: Record<string, any> | undefined): AssetVariant[] {
  const files = Object.entries(videos ?? {})
    .filter(([, v]) => v && typeof v.url === 'string' && v.url && v.width > 0 && v.height > 0)
    .map(([size, v]) => ({ size, short: Math.min(v.width, v.height), v: { label: `${Math.min(v.width, v.height)}p`, url: v.url as string, format: extOf(v.url, 'mp4'), width: v.width as number, height: v.height as number, ...(v.size > 0 ? { bytes: v.size as number } : {}) } }));
  for (const f of files) if (files.filter((g) => g.v.label === f.v.label).length > 1) f.v.label += `-${f.size}`;
  const le = files.filter((f) => f.short <= 1080).sort((a, b) => b.short - a.short || b.v.width - a.v.width);
  const gt = files.filter((f) => f.short > 1080).sort((a, b) => a.short - b.short);
  return [...le.slice(0, 1), ...gt, ...le.slice(1)].map((f) => f.v);
}

function videoHit(h: any): AssetHit {
  const variants = videoVariants(h.videos);
  const biggest = [...variants].sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0))[0];
  const v = h.videos ?? {};
  const preview = v.tiny?.thumbnail || v.small?.thumbnail || v.medium?.thumbnail || v.large?.thumbnail || (h.picture_id ? `https://i.vimeocdn.com/video/${h.picture_id}_640x360.jpg` : '');
  return {
    id: `pixabay:video:${h.id}`, source: 'pixabay', kind: 'video', ...common(h, 'video'),
    preview,
    ...(biggest ? { width: biggest.width, height: biggest.height } : {}),
    ...(Number(h.duration) > 0 ? { duration: Number(h.duration) } : {}),
    variants,
  };
}

async function searchKind(kind: 'photo' | 'video', q: SearchQuery, key: string, limit: number, ctx: AdapterContext): Promise<AssetHit[]> {
  // Square photos and all video orientations / durations have no API parameter: filter locally, so ask for more.
  const local = kind === 'video' ? !!(q.orientation || q.minDuration) : q.orientation === 'square';
  const perPage = Math.max(3, Math.min(200, local ? limit * 3 : limit)); // Pixabay: per_page 3…200
  const params = {
    key, q: q.query.trim().slice(0, 100),
    ...(kind === 'photo' ? { image_type: 'photo' } : {}),
    per_page: perPage, safesearch: 'true',
    ...(kind === 'photo' && q.orientation === 'landscape' ? { orientation: 'horizontal' } : {}),
    ...(kind === 'photo' && q.orientation === 'portrait' ? { orientation: 'vertical' } : {}),
    ...(q.minWidth ? { min_width: Math.round(q.minWidth) } : {}),
  };
  const j = await ctx.getJson(`${API}${kind === 'video' ? 'videos/' : ''}?${qs(params)}`, { source: 'pixabay' });
  const hits = (Array.isArray(j?.hits) ? j.hits : []).map((h: any) => (kind === 'video' ? videoHit(h) : photoHit(h))) as AssetHit[];
  return hits.filter((h) =>
    h.variants.length > 0
    && fitsOrientation(h.width, h.height, q.orientation)
    && (!q.minWidth || !h.width || h.width >= q.minWidth)
    && (!q.minDuration || kind !== 'video' || (h.duration ?? 0) >= q.minDuration),
  ).slice(0, limit);
}

/** Alternates between lists (photos, videos) so one kind doesn't fill the page. */
function interleave<T>(lists: T[][], limit: number): T[] {
  const out: T[] = [];
  for (let i = 0; out.length < limit && lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length && out.length < limit) out.push(l[i]);
  return out;
}

export const pixabay: Adapter = {
  id: 'pixabay',
  kinds: KINDS,
  key: 'required',
  keyHelp: KEY_HELP,
  async search(q, ctx) {
    const key = needKey(ctx);
    const kinds = (q.kind ? KINDS.filter((k) => k === q.kind) : KINDS) as ('photo' | 'video')[];
    // Nothing on Pixabay is public domain: the 'cc0' filter would refuse every hit, so don't spend requests.
    if (!kinds.length || !q.query.trim() || q.license === 'cc0') return [];
    const limit = Math.max(1, Math.min(200, q.limit ?? 12));
    const lists = await Promise.all(kinds.map((k) => searchKind(k, q, key, limit, ctx)));
    return interleave(lists, limit);
  },
  async get(sourceId, ctx) {
    const key = needKey(ctx);
    const m = /^(video:)?(\d+)$/.exec(sourceId.trim());
    if (!m) throw new Error(`pixabay: bad id "${sourceId}" (expected "<number>" for a photo or "video:<number>")`);
    const video = !!m[1];
    const j = await ctx.getJson(`${API}${video ? 'videos/' : ''}?${qs({ key, id: m[2] })}`, { source: 'pixabay', ttlMs: GET_TTL });
    const h = (Array.isArray(j?.hits) ? j.hits : []).find((x: any) => String(x.id) === m[2]);
    if (!h) throw new Error(`pixabay: no ${video ? 'video' : 'photo'} with id ${m[2]}`);
    return video ? videoHit(h) : photoHit(h);
  },
};
