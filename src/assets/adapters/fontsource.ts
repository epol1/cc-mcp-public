// Fontsource (ASSETS §2, §6, D91, D93): ~2,100 open-licensed families (most from Google Fonts), keyless. Search ranks
// the full list (cached 7 days) locally. `get` lists install variants: the google/fonts files first ("full"; METADATA.pb
// names the files and their PostScript names), because Fontsource's static TTFs of variable families carry the default
// instance's name (D93); then Fontsource's per-weight statics (latin subset), the only option for non-Google families.
import { creditLine } from '../credits.ts';
import { normalizeLicense } from '../license.ts';
import type { Adapter, AssetHit, AssetVariant } from '../types.ts';

const API = 'https://api.fontsource.org/v1/fonts';
const GF = 'https://raw.githubusercontent.com/google/fonts/main';
const WEEK = 7 * 24 * 3600_000;
/** google/fonts top-level folder per license. */
const LIC_DIR: Record<string, string> = { 'OFL-1.1': 'ofl', 'Apache-2.0': 'apache', 'UFL-1.0': 'ufl' };

type FsSubset = { url?: { ttf?: string; woff2?: string; woff?: string } };
interface FsFont {
  id: string;
  family: string;
  subsets?: string[];
  weights?: number[];
  styles?: string[];
  defSubset?: string;
  variable?: boolean;
  category?: string;
  license?: string;
  type?: string;
  variants?: Record<string, Record<string, Record<string, FsSubset>>>;
}
export interface GfFont { name?: string; style?: string; weight?: number; filename?: string; postScriptName?: string; fullName?: string }

/** Protobuf text strings: backslash escapes, with octal byte runs decoded as UTF-8. */
function unquote(s: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const oct = s[i] === '\\' ? /^[0-7]{3}/.exec(s.slice(i + 1)) : null;
    if (oct) { bytes.push(parseInt(oct[0], 8)); i += 3; continue; }
    if (s[i] === '\\') i++;
    const cp = s.codePointAt(i) ?? 0;
    if (cp > 0xffff) i++;
    bytes.push(...Buffer.from(String.fromCodePoint(cp), 'utf8'));
  }
  return Buffer.from(bytes).toString('utf8');
}

/** The parts of a google/fonts METADATA.pb that installs need: designer and the `fonts { }` entries. */
export function parseMetadata(pb: string): { designer?: string; fonts: GfFont[] } {
  const field = (text: string, key: string, top = false) => {
    const m = new RegExp(`^${top ? '' : '\\s*'}${key}:\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|([^\\s]+))`, 'm').exec(text);
    return m ? (m[1] !== undefined ? unquote(m[1]) : m[2]) : undefined;
  };
  const fonts = [...pb.matchAll(/^fonts\s*\{([^}]*)\}/gm)].map(([, b]): GfFont => {
    const weight = Number(field(b, 'weight'));
    return {
      name: field(b, 'name'), style: field(b, 'style'), ...(Number.isFinite(weight) ? { weight } : {}),
      filename: field(b, 'filename'), postScriptName: field(b, 'post_script_name'), fullName: field(b, 'full_name'),
    };
  });
  return { designer: field(pb, 'designer', true), fonts };
}

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** Exact family/id 100; per token: whole family/id word 3, substring 1, category 1; 0 = nothing matched. */
function score(f: FsFont, query: string, tokens: string[]): number {
  if (f.family.toLowerCase() === query || f.id === query) return 100;
  const own = new Set([...words(f.family), ...words(f.id)]);
  const hay = `${f.family} ${f.id}`.toLowerCase();
  const cat = (f.category ?? '').toLowerCase();
  let s = 0;
  for (const t of tokens) s += own.has(t) ? 3 : hay.includes(t) ? 1 : 0;
  if (cat && (cat === query || tokens.includes(cat) || cat === tokens.join('-'))) s += 1;
  return s;
}

function hit(f: FsFont, extra: { author?: string; variants?: AssetVariant[]; notes?: string[] } = {}): AssetHit {
  const license = normalizeLicense(f.license ?? 'unknown');
  const page = `https://fontsource.org/fonts/${f.id}`;
  const weights = f.weights ?? [];
  const about = `weights ${weights.join(', ')}${f.styles?.includes('italic') ? ' + italics' : ''}${f.variable ? ' (variable family)' : ''}`;
  return {
    id: `fontsource:${f.id}`, source: 'fontsource', kind: 'font', title: f.family,
    tags: [...new Set([f.category, f.type, ...(f.subsets ?? [])].filter((t): t is string => !!t))],
    preview: '', ...(extra.author ? { author: extra.author } : {}), license,
    credit: creditLine({ title: f.family, author: extra.author, source: 'fontsource', page, license }), page,
    variants: extra.variants ?? [], notes: [about, ...(extra.notes ?? [])],
  };
}

export const fontsource: Adapter = {
  id: 'fontsource',
  kinds: ['font'],
  async search(q, ctx) {
    const query = q.query.trim().toLowerCase();
    const tokens = words(query);
    if ((q.kind && q.kind !== 'font') || !tokens.length) return [];
    const list = await ctx.getJson<FsFont[]>(API, { source: 'fontsource', ttlMs: WEEK });
    return list.map((f, i) => ({ f, i, s: score(f, query, tokens) }))
      .filter((x) => x.s > 0)
      .sort((x, y) => y.s - x.s || Number(y.f.type === 'google') - Number(x.f.type === 'google') || x.i - y.i)
      .slice(0, q.limit ?? 12)
      .map((x) => hit(x.f));
  },
  async get(sourceId, ctx) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(sourceId)) throw new Error(`fontsource: "${sourceId}" is not a Fontsource font id (e.g. "space-grotesk")`);
    const f = await ctx.getJson<FsFont>(`${API}/${sourceId}`, { source: 'fontsource' });
    const variants: AssetVariant[] = [];
    const notes: string[] = [];
    let author: string | undefined;
    const licDir = LIC_DIR[normalizeLicense(f.license ?? '').id];
    if (f.type === 'google' && licDir) {
      const base = `${GF}/${licDir}/${f.family.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      try {
        const meta = parseMetadata(await ctx.getText(`${base}/METADATA.pb`, { source: 'fontsource', ttlMs: WEEK }));
        author = meta.designer;
        const upright = [...meta.fonts].sort((x, y) => Number(x.style === 'italic') - Number(y.style === 'italic'));
        const files = [...new Set(upright.map((x) => x.filename).filter((x): x is string => !!x))];
        if (files.length) {
          const url = (fn: string) => `${base}/${encodeURIComponent(fn)}`;
          variants.push({
            label: 'full', url: url(files[0]), format: /\.(\w+)$/.exec(files[0])?.[1]?.toLowerCase() ?? 'ttf',
            ...(files.length > 1 ? { files: files.slice(1).map((fn) => ({ path: fn, url: url(fn) })) } : {}),
          });
          const ps = [...new Set(upright.map((x) => x.postScriptName).filter(Boolean))];
          notes.push(`full: the google/fonts files (${files.join(', ')}); installs as ${ps.join(', ')}${files.some((fn) => fn.includes('[')) ? '; variable fonts list every named instance in AE' : ''}`);
        }
      } catch (e: any) {
        notes.push(`no google/fonts METADATA.pb at ${base} (${e.message}): only Fontsource statics`);
      }
    }
    const before = variants.length;
    for (const w of f.weights ?? []) for (const st of f.styles ?? ['normal']) {
      const subs = f.variants?.[String(w)]?.[st];
      const ttf = (subs?.latin ?? (f.defSubset ? subs?.[f.defSubset] : undefined) ?? Object.values(subs ?? {})[0])?.url?.ttf;
      if (ttf) variants.push({ label: `${w}${st === 'italic' ? 'i' : ''}`, url: ttf, format: 'ttf' });
    }
    if (variants.length > before) notes.push(`${variants.slice(before).map((v) => v.label).join(', ')}: Fontsource statics, latin subset; static files cut from a variable font can carry the default instance's name (D93)`);
    return hit(f, { author, variants, notes });
  },
};
