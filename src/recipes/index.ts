// Recipe library (Phase 5 A6, docs/TOOLKIT.md §6): save a finished scene as a recipe (the scene file plus the
// modules and assets it reaches by relative path, a params schema, its controls and scenes, thumbnails), search
// recipes by intent, tags and name, and instantiate one with new params and an optional new brand as a plain,
// editable scene file ready for build_scene. Libraries: the shipped `recipes/` folder of this repo, the user's
// `~/.ae-compose/recipes` (where saves go by default) and AEC_RECIPES (path-delimited). No After Effects needed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyEdits, configEdits, relRef, scanRefs } from './source.ts';
import type { Edit } from './source.ts';
import { coerceParams, inferParams } from '@cc-mcp/core/templates/params.ts';
import type { ParamSpec } from '@cc-mcp/core/templates/params.ts';
import { brandTokensUsed, readBrand } from '../plan/brand.ts';

export type { ParamSpec, ParamType } from '@cc-mcp/core/templates/params.ts';
export { PARAM_TYPES, inferParam, inferParams, coerceParams } from '@cc-mcp/core/templates/params.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/** Recipes shipped with ae-compose. */
export const SHIPPED_RECIPES = path.join(ROOT, 'recipes');
/** The user's recipe library (saveRecipe's default). */
export const USER_RECIPES = path.join(os.homedir(), '.ae-compose', 'recipes');
export const MANIFEST = 'recipe.json';

export interface RecipeManifest {
  version: 1;
  /** Folder name and handle (kebab-case). */
  name: string;
  title: string;
  /** What it's for, in a sentence: searched first. */
  intent: string;
  description?: string;
  tags: string[];
  /** The scene file, relative to the recipe folder. */
  scene: string;
  /** config.name of the scene (the comp name prefix). */
  sceneName: string;
  width: number; height: number; fps: number; duration: number;
  params: Record<string, ParamSpec>;
  /** Live controls the scene creates (names as in AE). */
  controls: string[];
  /** Named beats (scene markers). */
  scenes: string[];
  /** The brand module, relative to the recipe folder, when the scene uses one. */
  brand?: string;
  /** Files copied with the scene (relative). */
  files: string[];
  /** Files referenced by absolute path (too large to copy). */
  linked?: string[];
  thumbnails: string[];
  /** Where it was saved from. */
  source?: string;
  created: string;
}

export interface RecipeInfo extends RecipeManifest { dir: string; score?: number }

export function recipeDirs(extra: string[] = []): string[] {
  const env = (process.env.AEC_RECIPES ?? '').split(path.delimiter).filter(Boolean);
  return [...new Set([...extra, SHIPPED_RECIPES, USER_RECIPES, ...env].map((d) => path.resolve(d)))];
}

export const slugify = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'recipe';
const pascal = (s: string) => s.replace(/\.[^.]+$/, '').split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('') || 'Scene';

/** Load + compile a scene file (no AE): its config and what the compiler reports. */
async function inspectScene(file: string) {
  const { loadScene } = await import('../scene/load.ts');
  const { compileScene } = await import('../compile/compile.ts');
  const { def, file: f } = await loadScene({ file });
  const r = compileScene(def, { sceneFile: f });
  const main = r.ir.comps.find((c: any) => c.id === r.ir.main) ?? r.ir.comps[r.ir.comps.length - 1];
  const controls: string[] = [];
  for (const L of main.layers) if (/\.controls$/.test(L.id ?? '')) for (const g of L.groups ?? []) for (const it of g.items ?? []) if (it.name) controls.push(it.name);
  return { def, main, warnings: r.warnings, controls, scenes: (main.markers ?? []).filter((m: any) => m.dur).map((m: any) => String(m.comment)) };
}

export interface RecipeMeta {
  name?: string; title?: string; intent?: string; description?: string; tags?: string[];
  /** Param descriptions or type fixes (a string is a description). */
  params?: Record<string, Partial<ParamSpec> | string>;
  brand?: string; thumbnails?: string[]; files?: string[]; linked?: string[]; source?: string;
}

/**
 * Write (or refresh) recipe.json for a recipe folder: loads and compiles its scene, infers the params schema and
 * lists controls and scenes. Fields not in `meta` are kept from an existing recipe.json.
 */
export async function indexRecipe(dir: string, meta: RecipeMeta = {}): Promise<RecipeManifest> {
  const prev: Partial<RecipeManifest> = (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), 'utf8')); } catch { return {}; } })();
  const scene = prev.scene ?? (['scene.tsx', 'scene.ts'].find((f) => fs.existsSync(path.join(dir, f))) ?? 'scene.tsx');
  const file = path.join(dir, scene);
  const { def, main, controls, scenes } = await inspectScene(file);
  const cfg = def.config;
  const prevDescr = Object.fromEntries(Object.entries(prev.params ?? {}).map(([k, v]) => [k, { description: v.description, optional: v.optional, min: v.min, max: v.max, options: v.options, ...(v.type === 'file' ? { type: v.type } : {}) }]));
  const overrides = { ...prevDescr, ...(meta.params ?? {}) } as Record<string, Partial<ParamSpec> | string>;
  for (const k of Object.keys(overrides)) if (!(k in (cfg.params ?? {}))) delete overrides[k];
  const params = inferParams(cfg.params as any, dir, overrides);
  for (const p of Object.values(params)) for (const k of Object.keys(p) as (keyof ParamSpec)[]) if (p[k] === undefined) delete p[k];
  const name = meta.name ? slugify(meta.name) : prev.name ?? path.basename(dir);
  const m: RecipeManifest = {
    version: 1, name,
    title: meta.title ?? prev.title ?? cfg.name,
    intent: meta.intent ?? prev.intent ?? '',
    ...(meta.description ?? prev.description ? { description: meta.description ?? prev.description } : {}),
    tags: [...new Set((meta.tags ?? prev.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))],
    scene, sceneName: cfg.name, width: main.w, height: main.h, fps: main.fps, duration: main.dur,
    params, controls, scenes,
    ...(meta.brand ?? prev.brand ? { brand: meta.brand ?? prev.brand } : {}),
    files: meta.files ?? prev.files ?? [],
    ...((meta.linked ?? prev.linked)?.length ? { linked: meta.linked ?? prev.linked } : {}),
    thumbnails: meta.thumbnails ?? prev.thumbnails ?? [],
    ...(meta.source ?? prev.source ? { source: meta.source ?? prev.source } : {}),
    created: prev.created ?? new Date().toISOString(),
  };
  if (!m.intent) throw new Error(`recipe "${name}": an intent is required (what the recipe is for, in a sentence)`);
  fs.writeFileSync(path.join(dir, MANIFEST), JSON.stringify(m, null, 2) + '\n');
  return m;
}

export interface SaveRecipeOptions {
  /** The finished scene file to save. */
  sceneFile: string;
  name: string;
  intent: string;
  tags?: string[];
  title?: string;
  description?: string;
  /** Param descriptions or type fixes (types are inferred from config.params). */
  params?: Record<string, Partial<ParamSpec> | string>;
  /** The brand module the scene imports (default: detected among its relative imports). */
  brand?: string;
  /** Contact sheets or stills to keep with the recipe. */
  thumbnails?: string[];
  /** Library folder (default ~/.ae-compose/recipes). */
  dir?: string;
  overwrite?: boolean;
  /** Assets bigger than this stay where they are and are referenced by absolute path (default 50 MB). */
  maxCopyBytes?: number;
}

export interface SaveRecipeResult { dir: string; recipe: RecipeManifest; copied: string[]; linked: string[]; warnings: string[] }

const isBrandModule = (file: string) => { try { return /\bbrand\s*\(/.test(fs.readFileSync(file, 'utf8')) && /from\s*['"]ae-compose['"]/.test(fs.readFileSync(file, 'utf8')); } catch { return false; } };

/** Save a scene as a recipe: copies it with what it reaches by relative path, rewrites those paths, writes recipe.json. */
export async function saveRecipe(o: SaveRecipeOptions): Promise<SaveRecipeResult> {
  const scene = path.resolve(o.sceneFile);
  if (!fs.existsSync(scene)) throw new Error(`saveRecipe: scene file not found: ${scene}`);
  if (!o.intent?.trim()) throw new Error('saveRecipe: intent is required (what the recipe is for, in a sentence)');
  const name = slugify(o.name);
  const root = path.resolve(o.dir ?? USER_RECIPES);
  const dir = path.join(root, name);
  if (fs.existsSync(dir)) {
    if (!o.overwrite) throw new Error(`saveRecipe: recipe "${name}" already exists in ${root}; pass overwrite: true to replace it`);
    if (!fs.existsSync(path.join(dir, MANIFEST))) throw new Error(`saveRecipe: ${dir} exists and is not a recipe; not replacing it`);
  }
  // Load first: a scene that doesn't compile is not a recipe.
  await inspectScene(scene);
  const maxBytes = o.maxCopyBytes ?? 50 * 1024 * 1024;
  const warnings: string[] = [];

  // Walk the scene and its relative modules; collect assets.
  const texts = new Map<string, string>(); // abs → source
  const refsOf = new Map<string, ReturnType<typeof scanRefs>>();
  const queue = [scene];
  while (queue.length) {
    const f = queue.shift()!;
    if (texts.has(f)) continue;
    const src = fs.readFileSync(f, 'utf8');
    texts.set(f, src);
    const refs = scanRefs(src, f);
    refsOf.set(f, refs);
    for (const r of refs) if (r.kind === 'import' && !texts.has(r.abs)) queue.push(r.abs);
  }
  const assets = new Set<string>();
  for (const refs of refsOf.values()) for (const r of refs) if (r.kind === 'asset' && !texts.has(r.abs)) assets.add(r.abs);

  // New locations: scene.tsx, modules at the root, assets under assets/.
  const where = new Map<string, string | null>(); // abs → recipe-relative path, or null = linked
  const used = new Set<string>();
  const place = (abs: string, sub: string, fixed?: string) => {
    let rel = fixed ?? path.posix.join(sub, path.basename(abs));
    for (let i = 2; used.has(rel.toLowerCase()); i++) rel = path.posix.join(sub, `${path.basename(abs, path.extname(abs))}-${i}${path.extname(abs)}`);
    used.add(rel.toLowerCase());
    where.set(abs, rel);
  };
  place(scene, '', /\.tsx$/i.test(scene) ? 'scene.tsx' : 'scene.ts');
  for (const f of texts.keys()) if (f !== scene) place(f, '');
  const linked: string[] = [];
  for (const a of assets) {
    if (fs.statSync(a).size > maxBytes) { where.set(a, null); linked.push(a); warnings.push(`${path.basename(a)} (${Math.round(fs.statSync(a).size / 1048576)} MB) is linked by absolute path, not copied`); }
    else place(a, 'assets');
  }

  const tmp = `${dir}.tmp-${process.pid}`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  try {
    for (const [f, src] of texts) {
      const out = path.join(tmp, where.get(f)!);
      const edits: Edit[] = refsOf.get(f)!.map((r) => {
        const target = where.get(r.abs);
        const text = target === null || target === undefined ? r.abs.replace(/\\/g, '/') : relRef(out, path.join(tmp, target));
        return { start: r.start, end: r.end, text };
      });
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, applyEdits(src, edits));
    }
    for (const a of assets) {
      const rel = where.get(a);
      if (!rel) continue;
      fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
      fs.copyFileSync(a, path.join(tmp, rel));
    }
    const thumbs: string[] = [];
    for (const t of o.thumbnails ?? []) {
      if (!fs.existsSync(t)) { warnings.push(`thumbnail not found: ${t}`); continue; }
      const rel = path.posix.join('thumbs', path.basename(t));
      fs.mkdirSync(path.join(tmp, 'thumbs'), { recursive: true });
      fs.copyFileSync(t, path.join(tmp, rel));
      thumbs.push(rel);
    }
    let brand: string | undefined;
    if (o.brand) {
      const b = path.resolve(o.brand);
      brand = where.get(b) ?? undefined;
      if (!brand) warnings.push(`brand ${b} is not imported by the scene; not recorded`);
    } else {
      const direct = refsOf.get(scene)!.filter((r) => r.kind === 'import' && isBrandModule(r.abs));
      if (direct.length) brand = where.get(direct[0].abs) ?? undefined;
    }
    const files = [...where.entries()].filter(([f, rel]) => rel && f !== scene).map(([, rel]) => rel!);
    const recipe = await indexRecipe(tmp, { name, title: o.title ?? o.name, intent: o.intent, description: o.description, tags: o.tags ?? [], params: o.params, brand, thumbnails: thumbs, files, linked: linked.map((l) => l.replace(/\\/g, '/')), source: scene.replace(/\\/g, '/') });
    fs.rmSync(dir, { recursive: true, force: true });
    await moveDir(tmp, dir);
    return { dir, recipe, copied: files, linked, warnings };
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
}

/**
 * Renames a freshly written folder into place. Windows briefly locks new files (Defender, the indexer), so a
 * rename can fail with EPERM/EBUSY: retry for about a second, then copy and remove instead.
 */
async function moveDir(from: string, to: string): Promise<void> {
  for (let i = 0; i < 8; i++) {
    try { fs.renameSync(from, to); return; } catch (e: any) {
      if (e.code !== 'EPERM' && e.code !== 'EBUSY' && e.code !== 'EACCES') throw e;
      await new Promise((r) => setTimeout(r, 50 * (i + 1)));
    }
  }
  fs.cpSync(from, to, { recursive: true });
  fs.rmSync(from, { recursive: true, force: true });
}

/** Every recipe in the libraries (first library wins on a name clash). */
export function allRecipes(dirs?: string[]): RecipeInfo[] {
  const seen = new Set<string>();
  const out: RecipeInfo[] = [];
  for (const root of dirs ?? recipeDirs()) {
    let entries: string[] = [];
    try { entries = fs.readdirSync(root); } catch { continue; }
    for (const e of entries.sort()) {
      const dir = path.join(root, e);
      let m: RecipeManifest;
      try { m = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), 'utf8')); } catch { continue; }
      if (seen.has(m.name)) continue;
      seen.add(m.name);
      out.push({ ...m, dir });
    }
  }
  return out;
}

const STOP = new Set(['a', 'an', 'the', 'for', 'with', 'and', 'or', 'of', 'to', 'in', 'on', 'like', 'one', 'another', 'make', 'me', 'some', 'my', 'our', 'that', 'this', 'it', 'is', 'from', 'by']);
const stem = (w: string) => (w.length > 4 ? w.replace(/(ings?|ed|es|s)$/, '') : w);
const tokens = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w)).map(stem);

/** Search by intent, tags and name. No query: everything, by name. Results carry a `score`. */
export function listRecipes(query?: string, opts: { dirs?: string[]; limit?: number } = {}): RecipeInfo[] {
  const all = allRecipes(opts.dirs);
  if (!query?.trim()) return all.sort((a, b) => a.name.localeCompare(b.name)).slice(0, opts.limit ?? Infinity);
  const q = tokens(query);
  const scored = all.map((r) => {
    const name = tokens(`${r.name} ${r.title}`), tags = r.tags.flatMap(tokens), intent = tokens(r.intent), rest = tokens(`${r.description ?? ''} ${Object.keys(r.params).join(' ')} ${r.controls.join(' ')} ${r.scenes.join(' ')}`);
    let score = 0;
    for (const t of q) {
      if (name.includes(t)) score += 5; else if (name.some((n) => n.startsWith(t) || t.startsWith(n) && n.length >= 4)) score += 2.5;
      if (tags.includes(t)) score += 4; else if (tags.some((n) => n.startsWith(t) || (t.startsWith(n) && n.length >= 4))) score += 2;
      if (intent.includes(t)) score += 1.5; else if (intent.some((n) => n.length >= 4 && (n.startsWith(t) || t.startsWith(n)))) score += 0.75;
      if (rest.includes(t)) score += 0.5;
    }
    if (r.intent.toLowerCase().includes(query.trim().toLowerCase())) score += 3;
    return { ...r, score: Math.round(score * 100) / 100 };
  });
  return scored.filter((r) => r.score > 0).sort((a, b) => b.score! - a.score! || a.name.localeCompare(b.name)).slice(0, opts.limit ?? Infinity);
}

/** A recipe by name (folder name, slug of a title, or title), or an error listing close matches. */
export function findRecipe(name: string, dirs?: string[]): RecipeInfo {
  const all = allRecipes(dirs);
  const s = slugify(name);
  const hit = all.find((r) => r.name === name || r.name === s || r.title.toLowerCase() === name.toLowerCase());
  if (hit) return hit;
  const near = listRecipes(name, { dirs, limit: 3 }).map((r) => r.name);
  throw new Error(`no recipe "${name}"${near.length ? `; did you mean ${near.map((n) => `"${n}"`).join(', ')}?` : ''} (list_recipes shows them all)`);
}

export interface InstantiateOptions {
  /** New param values (checked against the recipe's schema). */
  params?: Record<string, unknown>;
  /** A brand.ts to use instead of the recipe's own (its export is aliased to the name the scene imports). */
  brand?: string;
  /** Where to write the new scene (.tsx). */
  outFile: string;
  /** config.name of the new scene (default: from the file name), so building it doesn't replace the recipe's comp. */
  sceneName?: string;
  /** Base for relative paths in params and brand (default process.cwd()). */
  cwd?: string;
  /**
   * 'copy' (default): the recipe's modules and assets are copied next to the new scene into `<recipe-name>/`, so the
   * new scene owns them. 'link': the new scene references the recipe library's files.
   */
  deps?: 'copy' | 'link';
  overwrite?: boolean;
  /** Recipe libraries to search (default recipeDirs()). */
  dirs?: string[];
  /** Compile the new scene to check it (default true). */
  check?: boolean;
}

export interface InstantiateResult {
  file: string;
  recipe: string;
  sceneName: string;
  /** The params as baked into the new scene's config.params (only the changed ones). */
  params: Record<string, unknown>;
  copied: string[];
  warnings: string[];
  check?: { ok: boolean; error?: string; warnings: string[]; scenes: string[]; controls: string[] };
}

/** Write a new, editable scene from a recipe with new params (baked as config.params defaults) and an optional brand. */
export async function instantiateRecipe(name: string, o: InstantiateOptions): Promise<InstantiateResult> {
  const r = findRecipe(name, o.dirs);
  const cwd = o.cwd ?? process.cwd();
  const outFile = path.resolve(cwd, o.outFile);
  if (fs.existsSync(outFile) && !o.overwrite) throw new Error(`instantiateRecipe: ${outFile} exists; pass overwrite: true to replace it`);
  const sceneFile = path.join(r.dir, r.scene);
  const src = fs.readFileSync(sceneFile, 'utf8');
  const warnings: string[] = [];

  const { values, warnings: pw, errors } = coerceParams(r.params, o.params ?? {}, { cwd, outFile });
  if (errors.length) throw new Error(`instantiateRecipe "${r.name}": bad params:\n- ${errors.join('\n- ')}`);
  warnings.push(...pw);

  // Brand swap: the import of the recipe's brand module points at the new brand, aliased if its export differs.
  let brandAbs: string | undefined;
  const recipeBrand = r.brand ? path.join(r.dir, r.brand) : undefined;
  if (o.brand) {
    brandAbs = path.resolve(cwd, o.brand);
    if (!fs.existsSync(brandAbs)) throw new Error(`instantiateRecipe: brand not found: ${brandAbs}`);
    if (!recipeBrand) warnings.push(`recipe "${r.name}" doesn't use a brand module; the brand is ignored (set colors through params)`);
  }
  const refs = scanRefs(src, sceneFile);
  const edits: Edit[] = [];
  const copied: string[] = [];
  const mode = o.deps ?? 'copy';
  const depDir = path.join(path.dirname(outFile), r.name);
  for (const ref of refs) {
    const isBrand = !!(brandAbs && recipeBrand && path.resolve(ref.abs) === path.resolve(recipeBrand) && ref.kind === 'import');
    if (isBrand) {
      edits.push({ start: ref.start, end: ref.end, text: relRef(outFile, brandAbs!) });
      const info = readBrand(brandAbs!);
      const before = src.slice(Math.max(0, ref.start - 300), ref.start);
      const clause = /import\s*\{([^}]*)\}\s*from\s*['"]$/.exec(before);
      if (!info) warnings.push(`brand ${brandAbs} has no \`export const X = brand({...})\``);
      else if (clause) {
        const names = clause[1].split(',').map((x) => x.trim()).filter(Boolean);
        const clauseStart = ref.start - before.length + clause.index + clause[0].indexOf('{') + 1;
        const fixed = names.map((n) => {
          const [imported, local] = n.split(/\s+as\s+/);
          if (info.exports.includes(imported)) return n;
          if (info.exports.length === 1) return `${info.exportName} as ${local ?? imported}`;
          warnings.push(`brand ${path.basename(brandAbs!)} exports ${info.exports.join(', ')}, not "${imported}": fix the import`);
          return n;
        });
        edits.push({ start: clauseStart, end: clauseStart + clause[1].length, text: ` ${fixed.join(', ')} ` });
        const local = (names[0]?.split(/\s+as\s+/)[1] ?? names[0]?.split(/\s+as\s+/)[0] ?? 'BRAND').trim();
        const usedTokens = brandTokensUsed(src, local);
        const missing = [...usedTokens.colors.filter((c) => !info.colors.includes(c)).map((c) => `colors.${c}`), ...usedTokens.fonts.filter((c) => !info.fonts.includes(c)).map((c) => `fonts.${c}`), ...usedTokens.sizes.filter((c) => !info.sizes.includes(c)).map((c) => `sizes.${c}`)];
        if (missing.length) warnings.push(`the new brand lacks tokens the recipe uses: ${missing.join(', ')} (add them to ${path.basename(brandAbs!)} or edit the scene)`);
      }
      continue;
    }
    const inRecipe = path.relative(r.dir, ref.abs);
    const outside = inRecipe.startsWith('..') || path.isAbsolute(inRecipe);
    if (mode === 'link' || outside) { edits.push({ start: ref.start, end: ref.end, text: relRef(outFile, ref.abs) }); continue; }
    const dest = path.join(depDir, inRecipe);
    copyTree(ref.abs, dest, r.dir, depDir, copied);
    edits.push({ start: ref.start, end: ref.end, text: relRef(outFile, dest) });
  }
  let out = applyEdits(src, edits);
  const sceneName = o.sceneName ?? pascal(path.basename(outFile));
  if (sceneName === r.sceneName) warnings.push(`the new scene is named "${sceneName}" like the recipe's: building it replaces a comp built from the recipe; pass sceneName to keep both`);
  out = applyEdits(out, configEdits(out, { name: sceneName, params: values }));
  out = `// From recipe "${r.name}" (${r.title}): ${r.intent.replace(/\s*[\r\n]+\s*/g, ' ')}\n${out}`;
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, out);

  const res: InstantiateResult = { file: outFile, recipe: r.name, sceneName, params: values, copied, warnings };
  if (o.check !== false) {
    try {
      const s = await inspectScene(outFile);
      res.check = { ok: true, warnings: s.warnings, scenes: s.scenes, controls: s.controls };
    } catch (e: any) {
      res.check = { ok: false, error: String(e?.message ?? e), warnings: [], scenes: [], controls: [] };
    }
  }
  return res;
}

/** Copy a recipe file (and, for modules, what they reach inside the recipe) keeping the recipe's layout. */
function copyTree(abs: string, dest: string, recipeDir: string, depDir: string, copied: string[]): void {
  if (copied.includes(dest)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(abs, dest);
  copied.push(dest);
  if (!/\.(m?[jt]sx?)$/i.test(abs)) return;
  for (const ref of scanRefs(fs.readFileSync(abs, 'utf8'), abs)) {
    const rel = path.relative(recipeDir, ref.abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) continue; // absolute links keep working
    copyTree(ref.abs, path.join(depDir, rel), recipeDir, depDir, copied);
  }
}

/** One line per recipe for an agent. */
export function formatRecipe(r: RecipeInfo): string {
  const params = Object.entries(r.params).map(([k, p]) => `${k}: ${p.type}${p.description ? ` (${p.description})` : ''}`).join('; ');
  return `${r.name}${r.score !== undefined ? ` [${r.score}]` : ''}: ${r.intent} | tags: ${r.tags.join(', ') || '-'} | ${r.width}×${r.height}, ${r.duration}s | params: ${params || 'none'} | controls: ${r.controls.join(', ') || 'none'}${r.thumbnails.length ? ` | thumbnails: ${r.thumbnails.map((t) => path.join(r.dir, t)).join(', ')}` : ''}`;
}
