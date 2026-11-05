// Poly Haven (ASSETS §2, D91): CC0 HDRIs, PBR textures and glTF models, keyless. The API has no text search, so the
// per-type lists (cached 24 h) are ranked locally; `get` reads /info and /files for the variants. Their API terms ask
// products to show the assets come from Poly Haven: every credit line names it (creditLine's source).
import { creditLine } from '../credits.ts';
import { normalizeLicense } from '../license.ts';
import type { Adapter, AssetHit, AssetKind, AssetVariant } from '../types.ts';

const API = 'https://api.polyhaven.com';
const KINDS = ['hdri', 'texture', 'model'] as const; // index = record.type
type PhKind = (typeof KINDS)[number];
const LIST: Record<PhKind, string> = { hdri: 'hdris', texture: 'textures', model: 'models' };

interface PhAsset {
  name: string;
  type: 0 | 1 | 2;
  tags?: string[];
  categories?: string[];
  authors?: Record<string, string>;
  max_resolution?: [number, number];
  download_count?: number;
  thumbnail_url?: string;
  nsfw?: boolean;
}
interface PhFile { url: string; size?: number; include?: Record<string, { url: string; size?: number }> }
type ResMap = Record<string, Record<string, PhFile>>; // "2k" → { jpg | png | exr | hdr | gltf → file }

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const stem = (t: string) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t);

/** Exact id/name/tag word 3, category word 2, substring anywhere 1, per query token; 0 = no token matched. */
function score(id: string, a: PhAsset, tokens: string[]): number {
  const strong = new Set([...words(id), ...words(a.name), ...(a.tags ?? []).flatMap(words)]);
  const cats = new Set((a.categories ?? []).flatMap(words));
  const hay = [id, a.name, ...(a.tags ?? []), ...(a.categories ?? [])].join(' ').toLowerCase();
  let s = 0;
  for (const t of tokens) s += strong.has(t) || strong.has(stem(t)) ? 3 : cats.has(t) || cats.has(stem(t)) ? 2 : hay.includes(stem(t)) ? 1 : 0;
  return s;
}

const NOTES: Record<PhKind, string> = {
  hdri: 'equirectangular HDRI: light a 3D comp with it (Environment light, Advanced 3D)',
  texture: 'PBR set: the default variants are the color map; rough/normal/… maps are extra variants',
  model: 'glTF with its .bin and textures/ (fetched together); imports as 3D footage (Advanced 3D)',
};

function hit(id: string, a: PhAsset): AssetHit {
  const kind = KINDS[a.type] ?? 'texture';
  const license = normalizeLicense('CC0');
  const author = Object.keys(a.authors ?? {}).join(', ') || undefined;
  const page = `https://polyhaven.com/a/${id}`;
  const [w, h] = kind === 'model' ? [] : a.max_resolution ?? [];
  const tags = [...new Set([...(a.categories ?? []), ...(a.tags ?? [])].map((t) => t.trim()).filter(Boolean))];
  return {
    id: `polyhaven:${id}`, source: 'polyhaven', kind, title: a.name, tags, preview: a.thumbnail_url ?? '',
    ...(w && h ? { width: w, height: h } : {}),
    author, license, credit: creditLine({ title: a.name, author, source: 'polyhaven', page, license }), page,
    variants: [], notes: [NOTES[kind], ...(a.nsfw ? ['flagged NSFW by Poly Haven'] : [])],
  };
}

/** Resolution keys ("1k", "2k"…) with `first` leading, the rest ascending. */
const resKeys = (m: ResMap | undefined, first: string) =>
  Object.keys(m ?? {}).filter((k) => /^\d+k$/.test(k)).sort((a, b) => (a === first ? -1 : b === first ? 1 : parseInt(a) - parseInt(b)));

const MAP_LABEL: Record<string, string> = { Rough: 'rough', nor_gl: 'normal', AO: 'ao', arm: 'arm', Displacement: 'disp', Bump: 'bump', Metal: 'metal', Specular: 'spec', Spec: 'spec' };
const isMap = (m: unknown): m is ResMap => !!m && typeof m === 'object' && Object.values(m as ResMap).some((r) => r && typeof r === 'object' && ('jpg' in r || 'png' in r));

function variants(kind: PhKind, files: Record<string, unknown>, a: PhAsset): AssetVariant[] {
  const out: AssetVariant[] = [];
  const size = (res: string) => {
    const w = parseInt(res) * 1024, mr = a.max_resolution;
    return { width: w, ...(mr?.[0] ? { height: Math.round((w * mr[1]) / mr[0]) } : {}) };
  };
  const push = (label: string, f: PhFile | undefined, format: string, res: string) => {
    if (f?.url) out.push({ label, url: f.url, format, ...size(res), ...(f.size ? { bytes: f.size } : {}) });
  };
  if (kind === 'hdri') {
    const m = files.hdri as ResMap | undefined;
    for (const fmt of ['hdr', 'exr']) for (const r of resKeys(m, '2k')) push(`${r}-${fmt}`, m![r][fmt], fmt, r);
  } else if (kind === 'texture') {
    const maps = Object.keys(files).filter((k) => k !== 'nor_dx' && isMap(files[k])).sort((x, y) => (x === 'Diffuse' ? -1 : y === 'Diffuse' ? 1 : 0));
    for (const map of maps) {
      const m = files[map] as ResMap;
      const suffix = map === 'Diffuse' ? '' : `-${MAP_LABEL[map] ?? map.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      for (const fmt of map === 'Diffuse' ? ['jpg', 'png'] : ['jpg']) for (const r of resKeys(m, '2k')) push(`${r}${suffix}-${fmt}`, m[r][fmt], fmt, r);
    }
  } else {
    const m = files.gltf as ResMap | undefined;
    for (const r of resKeys(m, '1k')) {
      const g = m![r].gltf;
      if (!g?.url) continue;
      out.push({
        label: `${r}-gltf`, url: g.url, format: 'gltf', ...(g.size ? { bytes: g.size } : {}),
        files: Object.entries(g.include ?? {}).map(([path, f]) => ({ path, url: f.url, ...(f.size ? { bytes: f.size } : {}) })),
      });
    }
  }
  return out;
}

export const polyhaven: Adapter = {
  id: 'polyhaven',
  kinds: ['hdri', 'texture', 'model'],
  async search(q, ctx) {
    const kinds: PhKind[] = q.kind ? (KINDS as readonly AssetKind[]).includes(q.kind) ? [q.kind as PhKind] : [] : [...KINDS];
    const tokens = words(q.query);
    const lists = await Promise.all(kinds.map((k) => ctx.getJson<Record<string, PhAsset>>(`${API}/assets?type=${LIST[k]}`, { source: 'polyhaven' })));
    return lists.flatMap((l) => Object.entries(l))
      .map(([id, a]) => ({ id, a, s: tokens.length ? score(id, a, tokens) : 1 }))
      .filter((x) => x.s > 0)
      .sort((x, y) => y.s - x.s || (y.a.download_count ?? 0) - (x.a.download_count ?? 0))
      .slice(0, q.limit ?? 12)
      .map((x) => hit(x.id, x.a));
  },
  async get(sourceId, ctx) {
    if (!/^[A-Za-z0-9_.-]+$/.test(sourceId)) throw new Error(`polyhaven: "${sourceId}" is not a Poly Haven asset id (e.g. "brown_photostudio_02")`);
    const [a, files] = await Promise.all([
      ctx.getJson<PhAsset>(`${API}/info/${sourceId}`, { source: 'polyhaven' }),
      ctx.getJson<Record<string, unknown>>(`${API}/files/${sourceId}`, { source: 'polyhaven' }),
    ]);
    const h = hit(sourceId, a);
    h.variants = variants(h.kind as PhKind, files, a);
    return h;
  },
};
