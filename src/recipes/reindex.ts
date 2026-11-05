// Refresh recipe.json for every recipe in a library folder (default: the shipped recipes/), keeping titles, intents,
// tags and param descriptions, after a recipe's scene changed. Usage: npx tsx src/recipes/reindex.ts [dir]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { indexRecipe, MANIFEST, SHIPPED_RECIPES } from './index.ts';

export async function reindexLibrary(root = SHIPPED_RECIPES): Promise<string[]> {
  const out: string[] = [];
  for (const e of fs.readdirSync(root).sort()) {
    const dir = path.join(root, e);
    if (!fs.existsSync(path.join(dir, MANIFEST))) continue;
    const m = await indexRecipe(dir);
    out.push(`${m.name}: ${Object.keys(m.params).length} params, controls ${m.controls.join(', ') || '-'}`);
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  reindexLibrary(process.argv[2] ? path.resolve(process.argv[2]) : undefined).then((l) => console.log(l.join('\n')), (e) => { console.error(e?.message ?? e); process.exit(1); });
}
