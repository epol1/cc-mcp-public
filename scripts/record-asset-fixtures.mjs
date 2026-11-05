#!/usr/bin/env node
// Records the API responses the asset adapters' unit tests parse (tests/fixtures/assets/), trimmed to a few
// entries each. One call per endpoint, with the ae-compose User-Agent. Keys come from ~/.ae-compose/keys.json and
// are never written: URLs are stored without them and responses are checked for the key before saving.
// Usage: node scripts/record-asset-fixtures.mjs [only-prefix]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'tests/fixtures/assets');
fs.mkdirSync(out, { recursive: true });
const version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
const UA = `ae-compose/${version} (motion design for After Effects)`;
let keys = {};
try { keys = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.ae-compose', 'keys.json'), 'utf8')); } catch { /* none */ }
const only = process.argv[2];

const pick = (obj, ids) => Object.fromEntries(ids.filter((k) => k in obj).map((k) => [k, obj[k]]));
const keepRes = (byRes, res = ['1k', '2k']) => pick(byRes, res);

const jobs = [
  ['iconify-search-rocket.json', 'https://api.iconify.design/search?query=rocket&limit=32'],
  ['iconify-collections.json', 'https://api.iconify.design/collections', (j) => pick(j, ['lucide', 'tabler', 'ph', 'mdi', 'material-symbols', 'simple-icons', 'logos', 'fa6-brands', 'icon-park-outline', 'fluent', 'pepicons-pop', 'ri', 'svg-spinners', 'game-icons', 'token-branded', 'bi', 'carbon', 'heroicons', 'iconoir', 'streamline', 'circle-flags', 'emojione', 'noto', 'openmoji', 'fxemoji', 'twemoji', 'eos-icons', 'zondicons'])],
  ['iconify-lucide-rocket.svg', 'https://api.iconify.design/lucide/rocket.svg'],
  ['polyhaven-hdris.json', 'https://api.polyhaven.com/assets?type=hdris', (j) => pick(j, Object.keys(j).filter((k) => /studio|sunset|night|forest|urban_street/.test(k)).slice(0, 14))],
  ['polyhaven-models.json', 'https://api.polyhaven.com/assets?type=models', (j) => pick(j, ['rubber_duck_toy', 'potted_plant_01', 'vintage_camera', 'wooden_crate_01', 'Camera_01', 'ceramic_vase_01', 'headphones_01', 'boombox'])],
  ['polyhaven-textures.json', 'https://api.polyhaven.com/assets?type=textures', (j) => pick(j, Object.keys(j).filter((k) => /paper|plaster|concrete|wood_table|fabric/.test(k)).slice(0, 12))],
  ['polyhaven-files-brown_photostudio_02.json', 'https://api.polyhaven.com/files/brown_photostudio_02', (j) => ({ hdri: keepRes(j.hdri), tonemapped: j.tonemapped })],
  ['polyhaven-files-rubber_duck_toy.json', 'https://api.polyhaven.com/files/rubber_duck_toy', (j) => ({ gltf: keepRes(j.gltf), Diffuse: keepRes(j.Diffuse, ['1k']) })],
  ['polyhaven-files-rough_plaster_brick.json', 'https://api.polyhaven.com/files/rough_plaster_brick', (j) => ({ Diffuse: keepRes(j.Diffuse), Rough: keepRes(j.Rough, ['1k']), nor_gl: keepRes(j.nor_gl, ['1k']) })],
  ['ambientcg-paper.json', 'https://ambientcg.com/api/v2/full_json?q=paper&type=Material&limit=5&include=downloadData,imageData,tagData,displayData'],
  ['fontsource-family-space-grotesk.json', 'https://api.fontsource.org/v1/fonts?family=Space%20Grotesk'],
  ['fontsource-space-grotesk.json', 'https://api.fontsource.org/v1/fonts/space-grotesk', (j) => ({ ...j, unicodeRange: pick(j.unicodeRange ?? {}, ['latin']) })],
  ['googlefonts-spacegrotesk-METADATA.pb', 'https://raw.githubusercontent.com/google/fonts/main/ofl/spacegrotesk/METADATA.pb'],
  ['openverse-images-paper.json', 'https://api.openverse.org/v1/images/?q=paper%20texture&license=cc0,pdm,by,by-sa&page_size=6'],
  ['openverse-audio-whoosh.json', 'https://api.openverse.org/v1/audio/?q=whoosh&license=cc0,pdm,by,by-sa&page_size=6', (j) => ({ ...j, results: j.results.map((r) => ({ ...r, waveform: undefined })) })],
];
if (keys.pixabay) {
  jobs.push(['pixabay-images-mountains.json', `https://pixabay.com/api/?key=${keys.pixabay}&q=mountain+lake&image_type=photo&per_page=5&safesearch=true`]);
  jobs.push(['pixabay-videos-ocean.json', `https://pixabay.com/api/videos/?key=${keys.pixabay}&q=ocean+waves&per_page=4&safesearch=true`]);
}
if (keys.unsplash) {
  jobs.push(['unsplash-search-desk.json', 'https://api.unsplash.com/search/photos?query=desk%20workspace&per_page=5', null, { Authorization: `Client-ID ${keys.unsplash}`, 'Accept-Version': 'v1' }]);
}

const secrets = Object.values(keys).filter((v) => typeof v === 'string' && v.length >= 6);
for (const [name, url, trim, headers] of jobs) {
  if (only && !name.startsWith(only)) continue;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, ...(headers ?? {}) } });
    let body = await r.text();
    if (!r.ok) { console.log(`${name}: HTTP ${r.status}`); continue; }
    if (name.endsWith('.json')) body = JSON.stringify(trim ? trim(JSON.parse(body)) : JSON.parse(body), null, 1);
    if (secrets.some((s) => body.includes(s))) { console.log(`${name}: contains a key, not saved`); continue; }
    fs.writeFileSync(path.join(out, name), body);
    console.log(`${name}: ${body.length} B`);
  } catch (e) { console.log(`${name}: ${e.message.replace(/key=[^&\s]+/g, 'key=***')}`); }
}
