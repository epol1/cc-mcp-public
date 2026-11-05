// ambientCG (ASSETS §2, D91): CC0 PBR materials, decals, leaf/atlas sets and HDRIs, keyless. One person runs it and
// the docs warn it isn't enterprise-stable, so responses are cached (24 h). Every download is a ZIP holding all maps
// of one resolution (or the HDRI); fetch extracts the file AE needs. Sizes climb fast: 8K-PNG sets pass 300 MB.
import { creditLine } from '../credits.ts';
import { normalizeLicense } from '../license.ts';
import type { Adapter, AssetHit, AssetVariant } from '../types.ts';

const API = 'https://ambientcg.com/api/v2/full_json';
const INCLUDE = 'include=downloadData,imageData,tagData,displayData';
/** dataType lists per kind (the API takes comma lists; checked live 2026-11-05). */
const TYPES: Record<string, string> = { texture: 'Material,Decal,Atlas', hdri: 'HDRI' };

interface AcgDownload { downloadLink: string; fileName?: string; size?: number; filetype?: string; attribute: string }
interface AcgAsset {
  assetId: string;
  dataType: string;
  displayName?: string;
  displayCategory?: string;
  tags?: string[];
  shortLink?: string;
  maps?: string[];
  dimensionX?: number;
  dimensionY?: number;
  previewImage?: Record<string, string>;
  downloadFolders?: Record<string, { downloadFiletypeCategories?: Record<string, { downloads?: AcgDownload[] }> }>;
}

/** "2K-JPG" → 2k first, then ascending; JPG (or no format: HDRIs) before PNG before anything else. */
function rank(label: string): number {
  const res = parseInt(label) || 99;
  const fmt = /-jpg$|^\d+k$/.test(label) ? 0 : /-png$/.test(label) ? 1 : 2;
  return fmt * 1000 + (res === 2 ? 0 : res);
}

function variants(a: AcgAsset): AssetVariant[] {
  const folders = a.downloadFolders ?? {};
  const cats = (folders.default ?? Object.values(folders)[0])?.downloadFiletypeCategories ?? {};
  return Object.values(cats).flatMap((c) => c.downloads ?? []).filter((d) => d.downloadLink && d.attribute)
    .map((d): AssetVariant => {
      const k = parseInt(d.attribute);
      return {
        label: d.attribute.toLowerCase(), url: d.downloadLink,
        format: (d.filetype || /\.(\w+)$/.exec(d.fileName ?? '')?.[1] || 'zip').toLowerCase(),
        ...(k ? { width: k * 1024 } : {}), ...(d.size ? { bytes: d.size } : {}),
      };
    })
    .sort((x, y) => rank(x.label) - rank(y.label));
}

function hit(a: AcgAsset): AssetHit {
  const hdri = a.dataType === 'HDRI';
  const license = normalizeLicense('CC0');
  const title = a.displayName || a.assetId;
  const page = a.shortLink || `https://ambientcg.com/view?id=${a.assetId}`;
  const v = variants(a);
  const w = Math.max(0, ...v.map((x) => x.width ?? 0));
  const h = hdri ? w / 2 : a.dataType === 'Material' ? w : a.dimensionX && a.dimensionY ? Math.round((w * a.dimensionY) / a.dimensionX) : 0;
  const img = a.previewImage ?? {};
  const notes: string[] = [];
  if (v.some((x) => x.format === 'zip')) notes.push(hdri ? 'a ZIP holding the HDRI; fetch extracts the .exr' : 'a ZIP of PBR maps; fetch extracts the Color map');
  if (a.maps?.includes('opacity')) notes.push('cut-out: the ZIP has an Opacity map for the alpha');
  return {
    id: `ambientcg:${a.assetId}`, source: 'ambientcg', kind: hdri ? 'hdri' : 'texture', title,
    tags: [...new Set([a.displayCategory, ...(a.tags ?? []).filter((t) => !/^\d+$/.test(t))].filter((t): t is string => !!t))],
    preview: img['256-PNG'] ?? Object.entries(img).find(([k]) => /-PNG$/.test(k))?.[1] ?? Object.values(img)[0] ?? '',
    ...(w ? { width: w } : {}), ...(h ? { height: h } : {}),
    author: 'ambientCG', license, credit: creditLine({ title, author: 'ambientCG', source: 'ambientcg', page, license }), page,
    variants: v, ...(notes.length ? { notes } : {}),
  };
}

export const ambientcg: Adapter = {
  id: 'ambientcg',
  kinds: ['texture', 'hdri'],
  async search(q, ctx) {
    const types = q.kind ? TYPES[q.kind] : `${TYPES.texture},${TYPES.hdri}`;
    if (!types) return [];
    const limit = q.limit ?? 12;
    const r = await ctx.getJson<{ foundAssets?: AcgAsset[] }>(`${API}?q=${encodeURIComponent(q.query.trim())}&type=${types}&limit=${limit}&${INCLUDE}`, { source: 'ambientcg' });
    return (r.foundAssets ?? []).slice(0, limit).map(hit);
  },
  async get(sourceId, ctx) {
    if (!/^[A-Za-z0-9_-]+$/.test(sourceId)) throw new Error(`ambientcg: "${sourceId}" is not an ambientCG asset id (e.g. "Paper006")`);
    const r = await ctx.getJson<{ foundAssets?: AcgAsset[] }>(`${API}?id=${sourceId}&${INCLUDE}`, { source: 'ambientcg' });
    const a = (r.foundAssets ?? []).find((x) => x.assetId.toLowerCase() === sourceId.toLowerCase());
    if (!a) throw new Error(`ambientcg: no asset "${sourceId}"`);
    return hit(a);
  },
};
