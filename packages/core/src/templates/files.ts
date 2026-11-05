// File references inside templates (ae-compose recipes, pr-cut cut templates): which strings name media/data files,
// and how one file should reference another so a copied template still finds its assets.
import path from 'node:path';

export const ASSET_EXT = /\.(svg|png|jpe?g|gif|webp|tiff?|psd|ai|eps|pdf|mp4|mov|m4v|avi|webm|mkv|mxf|mp3|wav|aiff?|m4a|aac|flac|ogg|glb|gltf|obj|fbx|hdr|exr|csv|tsv|json|txt|srt|vtt|ttf|otf|mogrt|cube)$/i;

/** How `fromFile` should reference `target`: ./rel or ../rel with forward slashes, or an absolute path (other drive). */
export function relRef(fromFile: string, target: string): string {
  const rel = path.relative(path.dirname(path.resolve(fromFile)), path.resolve(target));
  if (!rel || path.isAbsolute(rel)) return path.resolve(target).replace(/\\/g, '/');
  const r = rel.replace(/\\/g, '/');
  return r.startsWith('.') ? r : `./${r}`;
}
