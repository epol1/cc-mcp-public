// Reads a brand.ts (the `brand({ colors, fonts, sizes, live })` tokens of src/dsl/brand.ts) as text, without
// running it: the export name and the token keys, and which keys play which role (background, text, muted,
// accent; display and body fonts). The planner writes its scaffold against these; recipes check that a new
// brand has the tokens a recipe uses.
import fs from 'node:fs';

export interface BrandInfo {
  file: string;
  /** `export const <name> = brand(...)`. */
  exportName: string;
  /** Every `export const X = brand(...)` in the file. */
  exports: string[];
  colors: string[];
  fonts: string[];
  sizes: string[];
  live: string[];
  /** Token keys by role (undefined when the brand has no matching key). */
  roles: { bg?: string; fg?: string; muted?: string; accent?: string; display?: string; body?: string; bold?: string };
}

/** Keys of the object literal after `<field>:` (one level, no nesting). */
function keysOf(src: string, field: string): string[] {
  const m = new RegExp(`\\b${field}\\s*:\\s*\\{([^}]*)\\}`).exec(src);
  if (!m) return [];
  return [...m[1].matchAll(/(?:^|[,{\s])(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*:/g)].map((x) => x[1] ?? x[2] ?? x[3]);
}

const pick = (keys: string[], candidates: string[]) => candidates.find((c) => keys.includes(c)) ?? keys.find((k) => candidates.some((c) => k.toLowerCase().includes(c)));

export function readBrand(file: string): BrandInfo | null {
  let src: string;
  try { src = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const exports = [...src.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*brand\s*\(/g)].map((m) => m[1]);
  if (!exports.length) return null;
  const colors = keysOf(src, 'colors'), fonts = keysOf(src, 'fonts'), sizes = keysOf(src, 'sizes');
  const lm = /\blive\s*:\s*\[([^\]]*)\]/.exec(src);
  const live = lm ? [...lm[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]) : [];
  return {
    file, exportName: exports[0], exports, colors, fonts, sizes, live,
    roles: {
      bg: pick(colors, ['ink', 'bg', 'background', 'dark', 'black', 'base', 'night']),
      fg: pick(colors, ['white', 'fg', 'text', 'light', 'paper', 'foreground', 'cream']),
      muted: pick(colors, ['muted', 'gray', 'grey', 'secondary', 'subtle', 'dim']),
      accent: pick(colors, ['accent', 'primary', 'brand', 'highlight', 'pop', 'main']),
      display: pick(fonts, ['display', 'heading', 'headline', 'title', 'hero', 'black', 'bold']),
      body: pick(fonts, ['body', 'text', 'regular', 'copy', 'sub', 'medium']),
      bold: pick(fonts, ['bold', 'semibold', 'strong', 'display']),
    },
  };
}

/** Tokens a source uses through `<name>.colors.x`, `<name>.value('x')`, `<name>.fonts.x`, `<name>.sizes.x`. */
export function brandTokensUsed(src: string, name: string): { colors: string[]; fonts: string[]; sizes: string[] } {
  const n = name.replace(/\$/g, '\\$');
  const uniq = (a: string[]) => [...new Set(a)];
  return {
    colors: uniq([...src.matchAll(new RegExp(`\\b${n}\\.colors\\.([A-Za-z_$][\\w$]*)`, 'g'))].map((m) => m[1])
      .concat([...src.matchAll(new RegExp(`\\b${n}\\.value\\(\\s*['"]([^'"]+)['"]\\s*\\)`, 'g'))].map((m) => m[1]))),
    fonts: uniq([...src.matchAll(new RegExp(`\\b${n}\\.fonts\\.([A-Za-z_$][\\w$]*)`, 'g'))].map((m) => m[1])),
    sizes: uniq([...src.matchAll(new RegExp(`\\b${n}\\.sizes\\.([A-Za-z_$][\\w$]*)`, 'g'))].map((m) => m[1])),
  };
}
