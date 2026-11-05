// `asset:` refs at build time: the compiler resolved them to cached files (resolve.ts); here they are copied into
// the footage folder next to the saved project, the IR is pointed at the copies, and each one is credited in
// CREDITS.md next to the project and next to the scene file (so a scene folder carries its credits). With an
// unsaved project the IR keeps the cache paths and the report says so.
import fs from 'node:fs';
import path from 'node:path';
import { cachedHit, projectAssetDir, unsavedCreditsDir } from './fetch.ts';
import { appendCredit } from './credits.ts';
import { licenseFlags } from './license.ts';
import type { AssetRef } from './resolve.ts';

export interface PlacedAsset { id: string; ref: string; file: string; inProject: boolean }
export interface PlaceResult { assets: PlacedAsset[]; credits: string[]; warnings: string[] }

const norm = (p: string) => path.resolve(p).replace(/\\/g, '/').toLowerCase();

export function placeSceneAssets(irs: { ir: any }[], refs: AssetRef[], o: { projectDir?: string | null; sceneDir?: string }): PlaceResult {
  const out: PlaceResult = { assets: [], credits: [], warnings: [] };
  const seen = new Set<string>();
  for (const r of refs) {
    if (seen.has(r.ref)) continue;
    seen.add(r.ref);
    const hit = cachedHit(r.main);
    let file = r.main, files = r.files, inProject = false;
    if (o.projectDir) {
      const dir = projectAssetDir(o.projectDir, r.id);
      fs.mkdirSync(dir, { recursive: true });
      const copy = (f: string) => { const d = path.join(dir, path.basename(f)); if (!fs.existsSync(d) || fs.statSync(d).size !== fs.statSync(f).size) fs.copyFileSync(f, d); return d; };
      file = copy(r.main);
      files = r.files.map(copy);
      inProject = true;
      // Footage, models and HDRIs in the IR now point at the project copy.
      for (const { ir } of irs) for (const a of ir.assets ?? []) if (a.path && norm(a.path) === norm(r.main)) a.path = file;
    }
    out.assets.push({ id: r.id, ref: r.ref, file, inProject });
    if (!hit) { out.warnings.push(`${r.ref}: no stored record to credit (fetch it again with fetch_asset)`); continue; }
    // ShareAlike and trademark flags reach the build report, not only CREDITS.md (tell the user).
    for (const f of licenseFlags(hit.license)) out.warnings.push(`${r.ref}: ${f}`);
    for (const d of [o.projectDir ?? unsavedCreditsDir(), o.sceneDir].filter(Boolean) as string[]) {
      // Paths relative to the folder holding this CREDITS.md, else to the project (footage/…), never a machine path.
      const rel = (f: string) => {
        for (const base of [d, o.projectDir]) {
          if (!base) continue;
          const x = path.relative(base, f);
          if (!x.startsWith('..') && !path.isAbsolute(x)) return x.replace(/\\/g, '/');
        }
        return path.basename(f);
      };
      const c = appendCredit(d, hit, [file, ...files].map(rel));
      if (!out.credits.includes(c.file)) out.credits.push(c.file);
    }
  }
  if (refs.length && !o.projectDir) out.warnings.push(`the project isn't saved: ${seen.size} asset(s) were imported from the download cache (${path.dirname(path.dirname(path.dirname(refs[0].main)))}); save the project and rebuild to copy them into its footage folder`);
  return out;
}
