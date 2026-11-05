// Pexels (ASSETS §2, D90): photos and videos under the Pexels License. Needs a key, sent as the `Authorization`
// header on api.pexels.com calls only (image and video files are plain CDN downloads). Pexels stopped issuing new
// keys (2026-11-05), so this adapter is written from the API documentation; its fixtures are synthesized from the
// doc examples. Terms: 200 requests/hour, 20,000/month; link back to Pexels and credit the photographer.
// Photos and videos are separate id spaces: "pexels:<id>" is a photo, "pexels:video:<id>" a video.
// Video search has no size or duration filter (min_width/min_duration exist only on /videos/popular), so
// `minWidth` / `minDuration` are applied locally.
import { licenseLabel, normalizeLicense } from '../license.ts';
import type { Adapter, AdapterContext, AssetHit, AssetKind, AssetLicense, AssetVariant, SearchQuery } from '../types.ts';

const API = 'https://api.pexels.com';
const KINDS: AssetKind[] = ['photo', 'video'];
const KEY_HELP = 'Pexels isn\'t issuing new API keys (2026-11-05); if you have one, add {"pexels": "…"} to ~/.ae-compose/keys.json (or set AEC_PEXELS_KEY)';

function needKey(ctx: AdapterContext): string {
  const k = ctx.key('pexels');
  if (!k) throw new Error(`pexels: no API key. ${KEY_HELP}.`);
  return k;
}

const auth = (key: string) => ({ Authorization: key });

const qs = (p: Record<string, string | number | undefined>) =>
  Object.entries(p).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');

function extOf(url: string, fallback: string): string {
  try {
    const m = /\.([a-z0-9]{2,5})$/i.exec(new URL(url).pathname);
    const e = m?.[1].toLowerCase();
    return e === 'jpeg' ? 'jpg' : e ?? fallback;
  } catch { return fallback; }
}

/** "https://www.pexels.com/video/video-of-forest-1448735/" → "Video of forest"; undefined when the slug is only the id. */
function slugTitle(url: unknown): string | undefined {
  try {
    const seg = new URL(String(url)).pathname.split('/').filter(Boolean).pop() ?? '';
    const words = seg.replace(/-?\d+$/, '').replace(/-/g, ' ').trim();
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : undefined;
  } catch { return undefined; }
}

function fitsOrientation(w: number | undefined, h: number | undefined, o: SearchQuery['orientation']): boolean {
  if (!o || !w || !h) return true;
  const r = w / h;
  return o === 'landscape' ? r >= 1.05 : o === 'portrait' ? r <= 0.95 : r >= 0.85 && r <= 1.18;
}

/** `"Title" by Photographer (profile) on Pexels (photo page), Pexels License (url).` Pexels asks for both links. */
function pexelsCredit(title: string, author: string | undefined, authorUrl: string | undefined, page: string, license: AssetLicense): string {
  const by = author ? ` by ${author}${authorUrl ? ` (${authorUrl})` : ''}` : '';
  return `"${title.replace(/"/g, "'")}"${by} on Pexels (${page}), ${licenseLabel(license)} (${license.url}).`;
}

function photoHit(p: any): AssetHit {
  const src = p.src ?? {};
  const W = Number(p.width) || 0, H = Number(p.height) || 0;
  const title = String(p.alt ?? '').trim() || slugTitle(p.url) || `Photo by ${p.photographer ?? 'unknown'}`;
  const page: string = p.url || `https://www.pexels.com/photo/${p.id}/`;
  const author: string | undefined = p.photographer || undefined;
  const authorUrl: string | undefined = p.photographer_url || undefined;
  const license = normalizeLicense('pexels');
  const format = src.original ? extOf(src.original, 'jpg') : 'jpg';
  const variants: AssetVariant[] = [];
  if (src.original) variants.push({ label: 'original', url: src.original, format, ...(W ? { width: W, height: H } : {}) });
  // large2x / large are resized by the CDN to fit 1880×1300 / 940×650 (exact size not given by the API).
  if (src.large2x) variants.push({ label: 'large2x', url: src.large2x, format });
  if (src.large) variants.push({ label: 'large', url: src.large, format });
  return {
    id: `pexels:${p.id}`, source: 'pexels', kind: 'photo', title, tags: [],
    preview: src.tiny || src.small || src.medium || '',
    ...(W ? { width: W, height: H } : {}),
    author, authorUrl, license, page,
    credit: pexelsCredit(title, author, authorUrl, page, license),
    variants,
  };
}

/**
 * MP4 files only (the "hls" entry claims video/mp4 but links an .m3u8 with no size). Labels by the short side
 * ("1080p", also for vertical video), with the frame rate added when two files share a size ("1080p30",
 * "1080p60"). Order: 1080p (frame rate nearest 30 first), else the closest size above, then larger, then smaller.
 */
function videoVariants(files: any[] | undefined): AssetVariant[] {
  const mp4 = (Array.isArray(files) ? files : []).filter((f) =>
    f && typeof f.link === 'string' && f.width > 0 && f.height > 0
    && /mp4/i.test(String(f.file_type ?? '')) && /\.mp4$/i.test(safePath(f.link)));
  const list = mp4.map((f) => {
    const short = Math.min(f.width, f.height);
    const fps = Number(f.fps) > 0 ? Number(f.fps) : undefined;
    return { short, fps, v: { label: `${short}p`, url: f.link as string, format: 'mp4', width: f.width as number, height: f.height as number } as AssetVariant };
  });
  for (const f of list) if (list.filter((g) => g.short === f.short).length > 1 && f.fps) f.v.label = `${f.short}p${Math.round(f.fps)}`;
  const seen = new Map<string, number>();
  for (const f of list) {
    const n = (seen.get(f.v.label) ?? 0) + 1;
    seen.set(f.v.label, n);
    if (n > 1) f.v.label += `-${n}`;
  }
  const fpsRank = (x: { fps?: number }) => (x.fps ? Math.abs(x.fps - 30) : 99);
  const exact = list.filter((f) => f.short === 1080).sort((a, b) => fpsRank(a) - fpsRank(b));
  const above = list.filter((f) => f.short > 1080).sort((a, b) => a.short - b.short || fpsRank(a) - fpsRank(b));
  const below = list.filter((f) => f.short < 1080).sort((a, b) => b.short - a.short || fpsRank(a) - fpsRank(b));
  return [...exact, ...above, ...below].map((f) => f.v);
}

function safePath(url: string): string {
  try { return new URL(url).pathname; } catch { return url; }
}

function videoHit(v: any): AssetHit {
  const author: string | undefined = v.user?.name || undefined;
  const authorUrl: string | undefined = v.user?.url || undefined;
  const title = slugTitle(v.url) || `Video by ${author ?? 'unknown'}`;
  const page: string = v.url || `https://www.pexels.com/video/${v.id}/`;
  const license = normalizeLicense('pexels');
  const W = Number(v.width) || 0, H = Number(v.height) || 0;
  return {
    id: `pexels:video:${v.id}`, source: 'pexels', kind: 'video', title,
    tags: Array.isArray(v.tags) ? v.tags.map((t: any) => String(t?.title ?? t?.name ?? t)).filter(Boolean) : [],
    preview: v.image || v.video_pictures?.[0]?.picture || '',
    ...(W ? { width: W, height: H } : {}),
    ...(Number(v.duration) > 0 ? { duration: Number(v.duration) } : {}),
    author, authorUrl, license, page,
    credit: pexelsCredit(title, author, authorUrl, page, license),
    variants: videoVariants(v.video_files),
  };
}

async function searchKind(kind: 'photo' | 'video', q: SearchQuery, key: string, limit: number, ctx: AdapterContext): Promise<AssetHit[]> {
  const local = !!(q.minWidth || (kind === 'video' && q.minDuration));
  const params = {
    query: q.query.trim(),
    per_page: Math.max(1, Math.min(80, local ? limit * 3 : limit)), // Pexels: per_page ≤ 80
    ...(q.orientation ? { orientation: q.orientation } : {}), // landscape | portrait | square
  };
  const url = kind === 'video' ? `${API}/videos/search?${qs(params)}` : `${API}/v1/search?${qs(params)}`;
  const j = await ctx.getJson(url, { source: 'pexels', headers: auth(key) });
  const hits: AssetHit[] = kind === 'video'
    ? (Array.isArray(j?.videos) ? j.videos : []).map(videoHit)
    : (Array.isArray(j?.photos) ? j.photos : []).map(photoHit);
  return hits.filter((h) =>
    h.variants.length > 0
    && fitsOrientation(h.width, h.height, q.orientation)
    && (!q.minWidth || !h.width || h.width >= q.minWidth)
    && (!q.minDuration || kind !== 'video' || (h.duration ?? 0) >= q.minDuration),
  ).slice(0, limit);
}

function interleave<T>(lists: T[][], limit: number): T[] {
  const out: T[] = [];
  for (let i = 0; out.length < limit && lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length && out.length < limit) out.push(l[i]);
  return out;
}

export const pexels: Adapter = {
  id: 'pexels',
  kinds: KINDS,
  key: 'required',
  keyHelp: KEY_HELP,
  async search(q, ctx) {
    const key = needKey(ctx);
    const kinds = (q.kind ? KINDS.filter((k) => k === q.kind) : KINDS) as ('photo' | 'video')[];
    // The Pexels License isn't public domain: the 'cc0' filter would refuse every hit, so don't spend requests.
    if (!kinds.length || !q.query.trim() || q.license === 'cc0') return [];
    const limit = Math.max(1, Math.min(80, q.limit ?? 12));
    return interleave(await Promise.all(kinds.map((k) => searchKind(k, q, key, limit, ctx))), limit);
  },
  async get(sourceId, ctx) {
    const key = needKey(ctx);
    const m = /^(video:)?(\d+)$/.exec(sourceId.trim());
    if (!m) throw new Error(`pexels: bad id "${sourceId}" (expected "<number>" for a photo or "video:<number>")`);
    if (m[1]) return videoHit(await ctx.getJson(`${API}/videos/videos/${m[2]}`, { source: 'pexels', headers: auth(key) }));
    return photoHit(await ctx.getJson(`${API}/v1/photos/${m[2]}`, { source: 'pexels', headers: auth(key) }));
  },
  // Files come from images.pexels.com / the video CDN: no Authorization header there.
  downloadHeaders: () => ({}),
};
