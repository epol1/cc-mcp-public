// MCP wiring for the recipe library (registered in src/mcp/server.ts): zod input shapes, descriptions and handlers
// for save_recipe, list_recipes and instantiate_recipe. Pure Node; nothing here talks to After Effects.
import path from 'node:path';
import { z } from 'zod';
import { findRecipe, formatRecipe, instantiateRecipe, listRecipes, recipeDirs, saveRecipe } from './index.ts';
import { PARAM_TYPES } from '@ae-mcp/core/templates/params.ts';

export const SAVE_RECIPE_DESCRIPTION = 'Save a finished scene .tsx as a reusable recipe: the scene plus the modules and assets it reaches by relative path (brand.ts, logos, CSVs; big footage is linked, not copied), a params schema inferred from config.params, its live controls and named scenes, and optional thumbnails (contact sheet paths). Give an intent sentence and tags so it can be found later. Saves to ~/.ae-compose/recipes unless `dir` is given.';
export const LIST_RECIPES_DESCRIPTION = 'Search the recipe library (shipped recipes plus saved ones) by intent, tags and name, e.g. "kinetic title", "lower third interview", "bar chart". Returns each recipe with its params (types and descriptions), controls, size, duration and thumbnails. Use instantiate_recipe to make a new scene from one.';
export const INSTANTIATE_RECIPE_DESCRIPTION = 'Make a new, editable scene file from a recipe: new params are baked in as the scene\'s config.params defaults, an optional brand.ts replaces the recipe\'s brand (tokens the recipe needs are checked), the comp gets its own name, and the recipe\'s modules/assets are copied next to it (deps: "link" references the library instead). The result is compiled to check it (no After Effects); then build_scene the returned file and refine it like any scene.';

export const saveRecipeInput = {
  sceneFile: z.string().describe('the finished scene .tsx'),
  name: z.string().describe('recipe name (becomes a kebab-case folder name)'),
  intent: z.string().describe('what it is for, in one sentence (searched first)'),
  tags: z.array(z.string()).optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  params: z.record(z.string(), z.union([z.string(), z.object({ type: z.enum(PARAM_TYPES as [string, ...string[]]).optional(), description: z.string().optional(), optional: z.boolean().optional(), min: z.number().optional(), max: z.number().optional(), options: z.array(z.string()).optional() })])).optional().describe('param descriptions (a string) or type fixes, by config.params key'),
  brand: z.string().optional().describe('the brand module the scene imports (default: detected)'),
  thumbnails: z.array(z.string()).optional().describe('contact sheet / still paths to keep with the recipe'),
  dir: z.string().optional().describe('library folder (default ~/.ae-compose/recipes)'),
  overwrite: z.boolean().optional(),
  cwd: z.string().optional().describe('base for relative paths (default: the server cwd)'),
};

export const listRecipesInput = {
  query: z.string().optional().describe('intent, tags or name words; empty lists everything'),
  limit: z.number().int().positive().optional(),
  dirs: z.array(z.string()).optional().describe('extra library folders to search first'),
};

export const instantiateRecipeInput = {
  name: z.string().describe('recipe name (from list_recipes)'),
  outFile: z.string().describe('where to write the new scene .tsx'),
  params: z.record(z.string(), z.any()).optional().describe('new param values (see the recipe\'s params)'),
  brand: z.string().optional().describe('a brand.ts to use instead of the recipe\'s'),
  sceneName: z.string().optional().describe('comp name of the new scene (default: from the file name)'),
  deps: z.enum(['copy', 'link']).optional().describe('copy the recipe\'s modules/assets next to the scene (default) or reference the library'),
  overwrite: z.boolean().optional(),
  cwd: z.string().optional().describe('base for relative paths (default: the server cwd)'),
  dirs: z.array(z.string()).optional(),
};

export async function saveRecipeTool(a: any): Promise<string> {
  const base = a.cwd ?? process.cwd();
  const abs = (p?: string) => (p ? path.resolve(base, p) : undefined);
  const r = await saveRecipe({ ...a, sceneFile: abs(a.sceneFile)!, brand: abs(a.brand), dir: abs(a.dir), thumbnails: (a.thumbnails ?? []).map((t: string) => abs(t)!) });
  const lines = [`saved recipe "${r.recipe.name}" → ${r.dir}`, formatRecipe({ ...r.recipe, dir: r.dir })];
  if (r.copied.length) lines.push(`copied: ${r.copied.join(', ')}`);
  if (r.linked.length) lines.push(`linked (absolute paths): ${r.linked.join(', ')}`);
  if (r.warnings.length) lines.push('warnings:', ...r.warnings.map((w) => `- ${w}`));
  return lines.join('\n');
}

export function listRecipesTool(a: { query?: string; limit?: number; dirs?: string[] }): string {
  const rs = listRecipes(a.query, { limit: a.limit ?? 20, dirs: a.dirs ? [...a.dirs, ...recipeDirs()] : undefined });
  if (!rs.length) return a.query ? `no recipe matches "${a.query}" (list_recipes without a query shows them all)` : 'the recipe library is empty';
  return [`${rs.length} recipe(s)${a.query ? ` for "${a.query}"` : ''}:`, ...rs.map((r) => `- ${formatRecipe(r)}`)].join('\n');
}

export async function instantiateRecipeTool(a: any): Promise<string> {
  const dirs = a.dirs ? [...a.dirs, ...recipeDirs()] : undefined;
  const r = await instantiateRecipe(a.name, { params: a.params, brand: a.brand, outFile: a.outFile, sceneName: a.sceneName, deps: a.deps, overwrite: a.overwrite, cwd: a.cwd, dirs });
  const recipe = findRecipe(r.recipe, dirs);
  const lines = [`new scene "${r.sceneName}" from recipe "${r.recipe}" → ${r.file}`];
  if (Object.keys(r.params).length) lines.push(`params: ${JSON.stringify(r.params)}`);
  if (r.copied.length) lines.push(`copied: ${r.copied.join(', ')}`);
  if (r.check) lines.push(r.check.ok ? `compiles: scenes ${r.check.scenes.join(', ') || '-'}; controls ${r.check.controls.join(', ') || '-'}${r.check.warnings.length ? `; compiler warnings: ${r.check.warnings.join('; ')}` : ''}` : `does NOT compile: ${r.check.error}`);
  if (r.warnings.length) lines.push('warnings:', ...r.warnings.map((w) => `- ${w}`));
  lines.push(`next: build_scene { file: "${r.file.replace(/\\/g, '/')}" } and look at the contact sheet (recipe intent: ${recipe.intent})`);
  return lines.join('\n');
}
