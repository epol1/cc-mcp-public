// CREDITS.md next to the project (ASSETS §3): one line per fetched asset, written when it is fetched and kept
// with the project; `deliver` copies it next to the renders. Lines are keyed by the asset id, so fetching the
// same asset again (another variant, another scene) doesn't add a duplicate.
import fs from 'node:fs';
import path from 'node:path';
import { licenseFlags, licenseLabel } from './license.ts';
import type { AssetHit } from './types.ts';

export const CREDITS_FILE = 'CREDITS.md';

const HEADER = `# Credits

Assets fetched by ae-compose (find_assets / fetch_asset / \`asset:\` sources). Keep this file with the project and next to its renders.

`;

/** Source display names for credit lines. */
const SOURCE_NAME: Record<string, string> = {
  iconify: 'Iconify', polyhaven: 'Poly Haven', ambientcg: 'ambientCG', pexels: 'Pexels', pixabay: 'Pixabay',
  unsplash: 'Unsplash', openverse: 'Openverse', fontsource: 'Fontsource / Google Fonts', local: 'local library',
};
export const sourceName = (id: string) => SOURCE_NAME[id] ?? id;

/**
 * The credit sentence an adapter puts in `hit.credit`:
 * `"Title" by Author (author url), Source (page), License (license url).`
 */
export function creditLine(p: { title: string; author?: string; authorUrl?: string; source: string; page?: string; license: AssetHit['license']; via?: string }): string {
  // One line per asset: titles and names from APIs can hold newlines, which would split the entry from its [id].
  const one = (s?: string) => (s ?? '').replace(/\s+/g, ' ').trim();
  p = { ...p, title: one(p.title), author: one(p.author) || undefined };
  const by = p.author ? ` by ${p.author}${p.authorUrl ? ` (${p.authorUrl})` : ''}` : '';
  const src = `${sourceName(p.source)}${p.via ? ` via ${p.via}` : ''}${p.page ? ` (${p.page})` : ''}`;
  const lic = p.license.id === 'local' ? 'license unknown (your own library: check the rights before publishing)' : `${licenseLabel(p.license)}${p.license.url ? ` (${p.license.url})` : ''}`;
  return `"${p.title.replace(/"/g, "'")}"${by}, ${src}, ${lic}.`;
}

/**
 * The full CREDITS.md line for a fetched asset: credit, license flags (ShareAlike, trademark), the files in the
 * project, and the id tag. Search hints from the adapters (hit.notes) stay out: credits are for people.
 */
export function creditEntry(hit: AssetHit, files: string[]): string {
  const flags = licenseFlags(hit.license).map((n) => n.replace(/\s+/g, ' '));
  return `- ${hit.credit.replace(/\s+/g, ' ')}${flags.length ? ` ${flags.map((n) => `**${n}.**`).join(' ')}` : ''}${files.length ? ` Files: ${files.map((f) => `\`${f.replace(/\\/g, '/')}\``).join(', ')}.` : ''} [${hit.id}]`;
}

/** The file list of an existing entry (only the "Files: …" part: notes can hold backticks too). */
const entryFiles = (line: string): string[] => {
  const m = / Files: (.*)\. \[[^\]]+\]\s*$/.exec(line);
  return m ? [...m[1].matchAll(/`([^`]+)`/g)].map((x) => x[1]) : [];
};

/**
 * Appends the asset's line to `<dir>/CREDITS.md` (creating it with a header), or updates the file list of an
 * existing line for the same id. Returns the file and whether it changed.
 */
export function appendCredit(dir: string, hit: AssetHit, files: string[]): { file: string; added: boolean } {
  const file = path.join(dir, CREDITS_FILE);
  fs.mkdirSync(dir, { recursive: true });
  const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : HEADER;
  const tag = `[${hit.id}]`;
  const lines = cur.split(/\r?\n/);
  const at = lines.findIndex((l) => l.startsWith('- ') && l.endsWith(tag));
  if (at >= 0) {
    // Merge file lists: same asset, maybe another variant.
    const merged = [...new Set([...entryFiles(lines[at]), ...files.map((f) => f.replace(/\\/g, '/'))])];
    const next = creditEntry(hit, merged);
    if (next === lines[at]) return { file, added: false };
    lines[at] = next;
    fs.writeFileSync(file, lines.join('\n'));
    return { file, added: false };
  }
  // A blank line between the header and the first entry, none between entries.
  fs.writeFileSync(file, cur.replace(/\s*$/, /\n- /.test(cur) ? '\n' : '\n\n') + creditEntry(hit, files) + '\n');
  return { file, added: true };
}

/** Asset ids listed in a CREDITS.md (to check that every fetched asset is credited). */
export function creditedIds(file: string): string[] {
  if (!fs.existsSync(file)) return [];
  return [...fs.readFileSync(file, 'utf8').matchAll(/^- .*\[([^\]]+)\]\s*$/gm)].map((m) => m[1]);
}
