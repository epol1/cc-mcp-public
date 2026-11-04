// Effect name resolution (display name or matchName → matchName) with did-you-mean suggestions.
// Only vanilla AE effects are known (D2/D19); anything else must be given by exact matchName.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { levenshtein } from '../shared/easing.ts';

interface Entry { mn: string; name: string; cat: string }
let ENTRIES: Entry[] | null = null;

function entries(): Entry[] {
  if (ENTRIES) return ENTRIES;
  const f = path.join(path.dirname(fileURLToPath(import.meta.url)), 'effects.json');
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  ENTRIES = (j.effects as [string, string, string][]).map(([mn, name, cat]) => ({ mn, name, cat }));
  return ENTRIES;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Common aliases designers and other tools use. */
const ALIASES: Record<string, string> = {
  glow: 'ADBE Glo2', blur: 'ADBE Gaussian Blur 2', gaussianblur: 'ADBE Gaussian Blur 2', fastblur: 'ADBE Fast Box Blur',
  directionalblur: 'ADBE Motion Blur', dropshadow: 'ADBE Drop Shadow', fill: 'ADBE Fill', tint: 'ADBE Tint',
  gradientramp: 'ADBE Ramp', ramp: 'ADBE Ramp', fractalnoise: 'ADBE Fractal Noise', turbulentdisplace: 'ADBE Turbulent Displace',
  curves: 'ADBE CurvesCustom', levels: 'ADBE Easy Levels2', huesaturation: 'ADBE HUE SATURATION', exposure: 'ADBE Exposure2',
  particleworld: 'CC Particle World', particlesystemsii: 'CC Particle Systems II', particleplayground: 'ADBE Playgnd',
  starburst: 'CC Star Burst', rainfall: 'CSRainfall', snowfall: 'CSSnowfall', pixelpolly: 'CC Pixel Polly',
  shatter: 'APC Shatter', carddance: 'APC CardDanceCam', lensflare: 'ADBE Lens Flare', vignette: 'CS Vignette',
};

export function resolveEffect(name: string): { mn: string; name: string } {
  const all = entries();
  const exact = all.find((e) => e.mn === name) ?? all.find((e) => e.name === name);
  if (exact) return { mn: exact.mn, name: exact.name };
  const alias = ALIASES[norm(name)];
  if (alias) { const e = all.find((x) => x.mn === alias); if (e) return { mn: e.mn, name: e.name }; }
  const n = norm(name);
  const ci = all.find((e) => norm(e.name) === n || norm(e.mn) === n);
  if (ci) return { mn: ci.mn, name: ci.name };
  const scored = all.map((e) => ({ e, d: Math.min(levenshtein(norm(e.name), n), norm(e.name).includes(n) || n.includes(norm(e.name)) ? 1 : 99) })).sort((a, b) => a.d - b.d).slice(0, 5);
  throw new Error(`unknown effect "${name}". Did you mean: ${scored.map((s) => `"${s.e.name}" (${s.e.mn})`).join(', ')}? (vanilla AE effects only)`);
}

export function searchEffects(query: string, limit = 25): { mn: string; name: string; category: string }[] {
  const q = norm(query);
  return entries().filter((e) => !q || norm(e.name).includes(q) || norm(e.mn).includes(q) || norm(e.cat).includes(q)).slice(0, limit).map((e) => ({ mn: e.mn, name: e.name, category: e.cat }));
}
