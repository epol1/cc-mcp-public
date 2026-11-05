// Iconify (ASSETS §2, D91): 200k+ open icons in ~280 sets, keyless. Search returns "prefix:name" ids plus each set's
// name, author and license; `/collections` (cached 7 days) fills sets the search didn't describe and serves `get`.
// Icons come back as SVG for `<Svg>` (native shape layers, D92). Brand/logo sets and logo-named icons are flagged
// as trademarks; sets outside the license allowlist sort last (find_assets drops them).
import { creditLine } from '../credits.ts';
import { licenseRefusal, normalizeLicense } from '../license.ts';
import type { Adapter, AdapterContext, AssetHit } from '../types.ts';

const API = 'https://api.iconify.design';
const WEEK = 7 * 24 * 3600_000;

interface IconSet {
  name: string;
  author?: { name?: string; url?: string };
  license?: { title?: string; spdx?: string; url?: string };
  category?: string;
  tags?: string[];
  palette?: boolean;
}

const BRAND_SETS = /(^|-)(brands?|logos)$|^(simple-icons|devicon|devicon-plain|skill-icons|cib|bxl|token|token-branded|thesvg|thesvg-color|selfhst|brandico|entypo-social|cryptocurrency|cryptocurrency-color)$/;
const BRAND_NAME = new RegExp('(^|-)logos?(-|$)|^brand-|^apple(-|$)|(^|-)(' + [
  'github', 'gitlab', 'bitbucket', 'twitter', 'facebook', 'instagram', 'youtube', 'linkedin', 'tiktok', 'discord', 'slack',
  'spotify', 'whatsapp', 'telegram', 'reddit', 'pinterest', 'snapchat', 'twitch', 'dribbble', 'behance', 'figma', 'google',
  'microsoft', 'android', 'amazon', 'paypal', 'netflix', 'adobe', 'wordpress', 'docker', 'npm', 'openai', 'mastodon',
  'bluesky', 'patreon', 'vimeo', 'soundcloud', 'xbox', 'playstation', 'nintendo', 'shopify', 'dropbox', 'trello', 'skype',
  'wechat', 'stripe',
].join('|') + ')(-|$)');
const ID = /^([a-z0-9]+(?:-[a-z0-9]+)*):([a-z0-9]+(?:[-_][a-z0-9]+)*)$/;

const collections = (ctx: AdapterContext) => ctx.getJson<Record<string, IconSet>>(`${API}/collections`, { source: 'iconify', ttlMs: WEEK });

function hit(prefix: string, name: string, set: IconSet): AssetHit {
  const l = set.license ?? {};
  const license = normalizeLicense(l.spdx || l.title || 'unknown', undefined, l.url);
  if (set.category === 'Logos' || /brand/i.test(set.category ?? '') || BRAND_SETS.test(prefix) || BRAND_NAME.test(name)) license.trademark = true;
  const title = `${name} (${set.name})`;
  const page = `https://icon-sets.iconify.design/${prefix}/?icon-filter=${encodeURIComponent(name)}`;
  const svg = `${API}/${prefix}/${name}.svg`;
  const notes: string[] = [];
  if (set.tags?.includes('Uses Stroke')) notes.push('outline icon: draws on with `draw`');
  if (set.palette) notes.push('multicolor: leave `color` unset to keep its colors');
  if (set.tags?.includes('Contains Animations')) notes.push('animated SVG: AE gets the static shapes only');
  const author = set.author?.name, authorUrl = set.author?.url;
  return {
    id: `iconify:${prefix}:${name}`, source: 'iconify', kind: 'icon', title,
    tags: [...new Set([set.category, ...(set.tags ?? [])].filter((t): t is string => !!t))],
    preview: svg, author, authorUrl, license,
    credit: creditLine({ title, author, authorUrl, source: 'iconify', page, license }),
    page, variants: [{ label: 'svg', url: svg, format: 'svg' }],
    ...(notes.length ? { notes } : {}),
  };
}

export const iconify: Adapter = {
  id: 'iconify',
  kinds: ['icon'],
  async search(q, ctx) {
    const query = q.query.trim();
    if ((q.kind && q.kind !== 'icon') || !query) return [];
    const limit = q.limit ?? 12;
    const r = await ctx.getJson<{ icons?: string[]; collections?: Record<string, IconSet> }>(
      `${API}/search?query=${encodeURIComponent(query)}&limit=${Math.min(999, Math.max(32, limit * 3))}`, { source: 'iconify' });
    const ids = (r.icons ?? []).map((s) => ID.exec(s)).filter((m): m is RegExpExecArray => !!m);
    let sets = r.collections ?? {};
    if (ids.some((m) => !sets[m[1]])) sets = { ...(await collections(ctx)), ...sets };
    const all = ids.filter((m) => sets[m[1]]).map((m) => hit(m[1], m[2], sets[m[1]]));
    // One icon per set in turn (the API lists a set's -outline/-rounded variants together), so a page shows choices.
    const bySet = new Map<string, AssetHit[]>();
    for (const h of all) { const p = h.id.split(':')[1]; bySet.set(p, [...(bySet.get(p) ?? []), h]); }
    const hits: AssetHit[] = [];
    for (let i = 0; hits.length < all.length; i++) for (const l of bySet.values()) if (i < l.length) hits.push(l[i]);
    const ok = (h: AssetHit) => licenseRefusal(h.license, q.license ?? 'commercial') === null;
    return [...hits.filter(ok), ...hits.filter((h) => !ok(h))].slice(0, limit);
  },
  async get(sourceId, ctx) {
    const m = ID.exec(sourceId);
    if (!m) throw new Error(`iconify: "${sourceId}" is not "<set>:<icon>" (e.g. "lucide:rocket")`);
    const set = (await collections(ctx))[m[1]];
    if (!set) throw new Error(`iconify: unknown icon set "${m[1]}" (browse https://icon-sets.iconify.design)`);
    return hit(m[1], m[2], set);
  },
};
