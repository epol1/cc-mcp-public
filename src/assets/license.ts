// License allowlist (ASSETS §5): CC0, public domain, MIT, ISC, Apache-2.0, OFL, CC BY (any version), and the
// Pexels and Pixabay licenses. NonCommercial and NoDerivatives are never allowed; ShareAlike is allowed and
// flagged; brand logos are flagged as trademarks whatever their license. `license: 'cc0'` narrows to public domain.
import type { AssetHit, AssetLicense } from './types.ts';

const CC_URL = (kind: string, ver: string) => `https://creativecommons.org/licenses/${kind}/${ver}/`;

/** Normalizes the many spellings sources use ("by-sa" + "2.0", "CC BY 4.0", "OFL", "cc0") into an AssetLicense. */
export function normalizeLicense(raw: string, version?: string, url?: string): AssetLicense {
  const s = String(raw ?? '').trim();
  const low = s.toLowerCase().replace(/_/g, '-');
  const ver = (version ?? /(\d\.\d)/.exec(low)?.[1] ?? '4.0').trim();
  if (/^(cc0|cc0-1\.0|cc0 1\.0|cc-0)/.test(low) || low === 'cc0') return { id: 'CC0-1.0', url: url ?? 'https://creativecommons.org/publicdomain/zero/1.0/', commercial: true, attribution: false };
  if (low === 'pdm' || /public ?domain/.test(low) || low === 'unlicense') return { id: low === 'unlicense' ? 'Unlicense' : 'PDM', url: url ?? 'https://creativecommons.org/publicdomain/mark/1.0/', commercial: true, attribution: false };
  if (low === 'pexels') return { id: 'Pexels', url: url ?? 'https://www.pexels.com/license/', commercial: true, attribution: false };
  if (low === 'pixabay') return { id: 'Pixabay', url: url ?? 'https://pixabay.com/service/license-summary/', commercial: true, attribution: false };
  if (low === 'unsplash') return { id: 'Unsplash', url: url ?? 'https://unsplash.com/license', commercial: true, attribution: true };
  if (low === 'mit') return { id: 'MIT', url: url ?? 'https://opensource.org/license/mit', commercial: true, attribution: true };
  if (low === 'isc') return { id: 'ISC', url: url ?? 'https://opensource.org/license/isc-license-txt', commercial: true, attribution: true };
  if (/^apache/.test(low)) return { id: 'Apache-2.0', url: url ?? 'https://www.apache.org/licenses/LICENSE-2.0', commercial: true, attribution: true };
  if (/^(ofl|sil open font)/.test(low)) return { id: 'OFL-1.1', url: url ?? 'https://openfontlicense.org', commercial: true, attribution: true };
  if (low === 'ufl' || /ubuntu font/.test(low)) return { id: 'UFL-1.0', url: url ?? 'https://ubuntu.com/legal/font-licence', commercial: true, attribution: true };
  // Creative Commons: "by", "by-sa", "cc-by-nc-4.0", "CC BY-ND 3.0"…
  const cc = /^(?:cc[- ]?)?(by(?:[- ](?:nc|nd|sa))*)(?:[- ]?(\d\.\d))?/.exec(low.replace(/\s+/g, '-'));
  if (cc) {
    const parts = cc[1].split('-');
    const v = cc[2] ?? ver;
    const id = `CC-${parts.map((p) => p.toUpperCase()).join('-')}-${v}`;
    return {
      id, url: url ?? CC_URL(parts.join('-'), v),
      commercial: !parts.includes('nc'), attribution: true,
      ...(parts.includes('sa') ? { shareAlike: true } : {}),
      ...(parts.includes('nd') ? { noDerivatives: true } as any : {}),
    };
  }
  return { id: s || 'unknown', url: url ?? '', commercial: false, attribution: true };
}

const ALLOWED = [/^CC0-1\.0$/, /^PDM$/, /^Unlicense$/, /^MIT$/, /^ISC$/, /^Apache-2\.0$/, /^OFL-1\.1$/, /^CC-BY-\d\.\d$/, /^CC-BY-SA-\d\.\d$/, /^Pexels$/, /^Pixabay$/, /^Unsplash$/, /^local$/];
const PUBLIC_DOMAIN = /^(CC0-1\.0|PDM|Unlicense)$/;

/** Why a license is refused, or null when the allowlist permits it ('cc0' mode: public domain only). */
export function licenseRefusal(l: AssetLicense, mode: 'cc0' | 'commercial' = 'commercial'): string | null {
  if (/-NC-|-NC$|NonCommercial/i.test(l.id)) return `${l.id}: not licensed for commercial use`;
  if (/-ND-|-ND$|NoDerivatives/i.test(l.id) || (l as any).noDerivatives) return `${l.id}: NoDerivatives (no edits allowed)`;
  if (!ALLOWED.some((r) => r.test(l.id))) return `${l.id}: not on the license allowlist (ASSETS §5)`;
  if (!l.commercial) return `${l.id}: not licensed for commercial use`;
  if (mode === 'cc0' && !PUBLIC_DOMAIN.test(l.id)) return l.id === 'local' ? `a local file of unknown license (license: 'cc0' asked for)` : `${l.id}: not public domain (license: 'cc0' asked for)`;
  return null;
}

export const allowed = (h: AssetHit, mode: 'cc0' | 'commercial' = 'commercial') => licenseRefusal(h.license, mode) === null;

/** Short flags for a hit: shown in results and written into its credit line. */
export function licenseFlags(l: AssetLicense): string[] {
  const f: string[] = [];
  if (l.shareAlike) f.push('ShareAlike: anything adapted from it must be shared under the same license');
  if (l.trademark) f.push('Trademark: a brand logo; use it only to refer to that brand');
  return f;
}

/** "CC BY 4.0", "CC0 1.0", "MIT"… for credit lines. */
export function licenseLabel(l: AssetLicense): string {
  const m = /^CC-(BY(?:-SA)?)-(\d\.\d)$/.exec(l.id);
  if (m) return `CC ${m[1]} ${m[2]}`;
  if (l.id === 'CC0-1.0') return 'CC0 1.0';
  if (l.id === 'PDM') return 'Public Domain Mark';
  if (l.id === 'Pexels') return 'Pexels License';
  if (l.id === 'Pixabay') return 'Pixabay Content License';
  if (l.id === 'Unsplash') return 'Unsplash License';
  return l.id;
}
