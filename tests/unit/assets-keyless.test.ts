// Keyless asset adapters (Phase 6): Iconify, Poly Haven, ambientCG and Fontsource parse the recorded API responses in
// tests/fixtures/assets/ (2026-11-05) into hits with ids, previews, licenses, credits and variants. No network.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { adapterContext } from '@ae-mcp/core/assets/context.ts';
import { setTransport } from '@ae-mcp/core/assets/http.ts';
import { licenseRefusal } from '@ae-mcp/core/assets/license.ts';
import { iconify } from '@ae-mcp/core/assets/adapters/iconify.ts';
import { polyhaven } from '@ae-mcp/core/assets/adapters/polyhaven.ts';
import { ambientcg } from '@ae-mcp/core/assets/adapters/ambientcg.ts';
import { fontsource } from '@ae-mcp/core/assets/adapters/fontsource.ts';
import { fixture, tempAssetHome, useFixtures } from './assets-fixtures.ts';
import type { Route } from './assets-fixtures.ts';

const ctx = adapterContext();
beforeEach(() => { tempAssetHome(); });
afterAll(() => { setTransport(null); });

const json = (name: string) => JSON.parse(fixture(name).toString('utf8'));
const labels = (vs: { label: string }[]) => vs.map((v) => v.label);

describe('iconify', () => {
  const routes: Route[] = [
    [/api\.iconify\.design\/search\?query=rocket&/, 'iconify-search-rocket.json'],
    [/api\.iconify\.design\/search\?query=wordpress&/, 'iconify-search-wordpress.json'],
    [/api\.iconify\.design\/collections$/, 'iconify-collections.json'],
  ];

  it('searches with the query and a limit of at least 32, using the sets the search describes', async () => {
    const seen = useFixtures(routes);
    const hits = await iconify.search({ query: 'rocket' }, ctx);
    expect(seen.urls).toHaveLength(1);
    const u = new URL(seen.urls[0]);
    expect(u.searchParams.get('query')).toBe('rocket');
    expect(Number(u.searchParams.get('limit'))).toBeGreaterThanOrEqual(32);
    expect(hits).toHaveLength(12);
    const h = hits[0];
    expect(h).toMatchObject({
      id: 'iconify:material-symbols:rocket', source: 'iconify', kind: 'icon', title: 'rocket (Material Symbols)',
      preview: 'https://api.iconify.design/material-symbols/rocket.svg', author: 'Google',
      page: 'https://icon-sets.iconify.design/material-symbols/?icon-filter=rocket',
      variants: [{ label: 'svg', format: 'svg', url: 'https://api.iconify.design/material-symbols/rocket.svg' }],
    });
    expect(h.license.id).toBe('Apache-2.0');
    expect(h.license.trademark).toBeUndefined();
    expect(h.credit).toBe('"rocket (Material Symbols)" by Google (https://github.com/google/material-design-icons), Iconify (https://icon-sets.iconify.design/material-symbols/?icon-filter=rocket), Apache-2.0 (https://github.com/google/material-design-icons/blob/master/LICENSE).');
    expect(h.tags).toContain('Material');
  });

  it('notes stroke sets as draw-on outlines and honours the limit', async () => {
    useFixtures(routes);
    const hits = await iconify.search({ query: 'rocket', limit: 40 }, ctx);
    expect(hits).toHaveLength(32);
    const tabler = hits.find((h) => h.id === 'iconify:tabler:rocket')!;
    expect(tabler.license.id).toBe('MIT');
    expect(tabler.notes).toContain('outline icon: draws on with `draw`');
    expect(hits.find((h) => h.id === 'iconify:mdi:rocket')!.notes).toBeUndefined();
  });

  it('puts GPL sets last, flags brand sets and brand-named icons as trademarks', async () => {
    useFixtures(routes);
    const hits = await iconify.search({ query: 'wordpress', limit: 32 }, ctx);
    expect(hits).toHaveLength(32);
    const gpl = hits.find((h) => h.id === 'iconify:wordpress:wordpress')!;
    expect(gpl.license.id).toBe('GPL-2.0-or-later');
    expect(licenseRefusal(gpl.license)).not.toBeNull();
    expect(hits[hits.length - 1]).toBe(gpl);
    expect(hits.slice(0, -1).every((h) => licenseRefusal(h.license) === null)).toBe(true);
    const si = hits.find((h) => h.id === 'iconify:simple-icons:wordpress')!;
    expect(si.license).toMatchObject({ id: 'CC0-1.0', trademark: true });
    expect(si.credit).toContain('CC0 1.0');
    for (const id of ['logos:wordpress', 'fa7-brands:wordpress', 'devicon:wordpress', 'mdi:wordpress', 'ri:wordpress-fill']) {
      expect(hits.find((h) => h.id === `iconify:${id}`)!.license.trademark, id).toBe(true);
    }
    expect(hits.find((h) => h.id === 'iconify:logos:wordpress')!.notes).toContain('multicolor: leave `color` unset to keep its colors');
  });

  it('get reads the collections map: ISC outline, CC BY-SA share-alike, CC0 + trademark, brand-named icons', async () => {
    const seen = useFixtures(routes);
    const lucide = await iconify.get('lucide:rocket', ctx);
    expect(seen.urls[0]).toBe('https://api.iconify.design/collections');
    expect(lucide).toMatchObject({ id: 'iconify:lucide:rocket', title: 'rocket (Lucide)', author: 'Lucide Contributors' });
    expect(lucide.license).toMatchObject({ id: 'ISC', url: 'https://github.com/lucide-icons/lucide/blob/main/LICENSE' });
    expect(lucide.notes).toContain('outline icon: draws on with `draw`');
    expect(lucide.variants).toEqual([{ label: 'svg', format: 'svg', url: 'https://api.iconify.design/lucide/rocket.svg' }]);
    const open = await iconify.get('openmoji:rocket', ctx);
    expect(open.license).toMatchObject({ id: 'CC-BY-SA-4.0', shareAlike: true });
    expect(licenseRefusal(open.license)).toBeNull();
    expect((await iconify.get('simple-icons:github', ctx)).license).toMatchObject({ id: 'CC0-1.0', trademark: true });
    expect((await iconify.get('tabler:brand-github', ctx)).license.trademark).toBe(true);
    expect((await iconify.get('ph:github-logo', ctx)).license.trademark).toBe(true);
    expect((await iconify.get('tabler:rocket', ctx)).license.trademark).toBeUndefined();
    await expect(iconify.get('nope:rocket', ctx)).rejects.toThrow(/unknown icon set/);
    await expect(iconify.get('lucide/rocket', ctx)).rejects.toThrow(/<set>:<icon>/);
  });

  it('refuses a NonCommercial set (PrestaShop Icons, recorded entry)', async () => {
    const ps = { name: 'PrestaShop Icons', total: 479, author: { name: 'PrestaShop', url: 'https://github.com/PrestaShop/prestashop-icon-font' }, license: { title: 'CC BY-NC 4.0', spdx: 'CC-BY-NC-4.0', url: 'https://creativecommons.org/licenses/by-nc/4.0/' }, palette: false, hidden: true };
    useFixtures([[/collections$/, () => Buffer.from(JSON.stringify({ ps }))]]);
    const h = await iconify.get('ps:bell', ctx);
    expect(h.license).toMatchObject({ id: 'CC-BY-NC-4.0', commercial: false });
    expect(licenseRefusal(h.license)).toMatch(/commercial/);
  });

  it('fills sets missing from the search response from /collections, and skips other kinds', async () => {
    const seen = useFixtures([
      [/search\?/, () => Buffer.from(JSON.stringify({ icons: ['lucide:rocket', 'zz-unknown:rocket'], total: 2, collections: {} }))],
      [/collections$/, 'iconify-collections.json'],
    ]);
    const hits = await iconify.search({ query: 'rocket' }, ctx);
    expect(hits.map((h) => h.id)).toEqual(['iconify:lucide:rocket']);
    expect(seen.urls[1]).toBe('https://api.iconify.design/collections');
    expect(await iconify.search({ query: 'rocket', kind: 'photo' }, ctx)).toEqual([]);
  });
});

describe('polyhaven', () => {
  const list = (type: string) => json(`polyhaven-${type}.json`);
  const routes: Route[] = [
    [/api\.polyhaven\.com\/assets\?type=hdris$/, 'polyhaven-hdris.json'],
    [/api\.polyhaven\.com\/assets\?type=textures$/, 'polyhaven-textures.json'],
    [/api\.polyhaven\.com\/assets\?type=models$/, 'polyhaven-models.json'],
    [/\/info\/rubber_duck_toy$/, 'polyhaven-info-rubber_duck_toy.json'],
    [/\/info\/rough_plaster_brick$/, 'polyhaven-info-rough_plaster_brick.json'],
    [/\/info\/brown_photostudio_02$/, () => Buffer.from(JSON.stringify(list('hdris').brown_photostudio_02))],
    [/\/files\/(\w+)$/, (url) => fixture(`polyhaven-files-${/\/files\/(\w+)$/.exec(url)![1]}.json`)],
  ];

  it('ranks the per-type lists locally: "studio" finds the studio HDRIs', async () => {
    const seen = useFixtures(routes);
    const hits = await polyhaven.search({ query: 'studio' }, ctx);
    expect(seen.urls.sort()).toEqual(['hdris', 'models', 'textures'].map((t) => `https://api.polyhaven.com/assets?type=${t}`));
    expect(hits.length).toBeGreaterThanOrEqual(5);
    expect(hits.every((h) => h.kind === 'hdri' && /studio/.test(h.id))).toBe(true);
    const h = hits.find((x) => x.id === 'polyhaven:brown_photostudio_02')!;
    expect(h).toMatchObject({ title: 'Brown Photostudio 02', page: 'https://polyhaven.com/a/brown_photostudio_02', variants: [] });
    expect(h.preview).toMatch(/^https:\/\/cdn\.polyhaven\.com\/asset_img\/thumbs\/brown_photostudio_02\.png/);
    expect(h.width! / h.height!).toBe(2);
    expect(h.license.id).toBe('CC0-1.0');
    expect(h.credit).toContain('Poly Haven (https://polyhaven.com/a/brown_photostudio_02)');
  });

  it('"duck" finds the duck model; kind narrows the lists fetched', async () => {
    const seen = useFixtures(routes);
    const [duck] = await polyhaven.search({ query: 'duck' }, ctx);
    expect(duck).toMatchObject({ id: 'polyhaven:rubber_duck_toy', kind: 'model', title: 'Rubber Duck Toy', author: 'Plat251' });
    expect(duck.credit).toBe('"Rubber Duck Toy" by Plat251, Poly Haven (https://polyhaven.com/a/rubber_duck_toy), CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/).');
    tempAssetHome(); // empty response cache
    seen.urls.length = 0;
    const hits = await polyhaven.search({ query: 'concrete', kind: 'texture', limit: 3 }, ctx);
    expect(seen.urls).toEqual(['https://api.polyhaven.com/assets?type=textures']);
    expect(hits).toHaveLength(3);
    expect(hits.every((h) => h.kind === 'texture')).toBe(true);
    // Exact tag/name words outrank substrings, then downloads break ties.
    const scores = hits.map((h) => list('textures')[h.id.slice(10)].download_count);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(await polyhaven.search({ query: 'duck', kind: 'photo' }, ctx)).toEqual([]);
  });

  it('get: HDRI variants hdr first, 2k default', async () => {
    useFixtures(routes);
    const h = await polyhaven.get('brown_photostudio_02', ctx);
    expect(h.kind).toBe('hdri');
    expect(labels(h.variants)).toEqual(['2k-hdr', '1k-hdr', '2k-exr', '1k-exr']);
    expect(h.variants[0]).toEqual({ label: '2k-hdr', format: 'hdr', url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/brown_photostudio_02_2k.hdr', width: 2048, height: 1024, bytes: 6492863 });
  });

  it('get: texture color map first (jpg, then png), other maps as extra variants', async () => {
    useFixtures(routes);
    const h = await polyhaven.get('rough_plaster_brick', ctx);
    expect(h).toMatchObject({ kind: 'texture', title: 'Rough Plaster Brick', author: 'Rob Tuytel' });
    expect(labels(h.variants)).toEqual(['2k-jpg', '1k-jpg', '2k-png', '1k-png', '1k-rough-jpg', '1k-normal-jpg']);
    expect(h.variants[0]).toMatchObject({ format: 'jpg', width: 2048, height: 2048, bytes: 3456196, url: expect.stringMatching(/rough_plaster_brick_diff_2k\.jpg$/) });
    expect(h.variants.find((v) => v.label === '1k-normal-jpg')!.url).toMatch(/_nor_gl_1k\.jpg$/);
  });

  it('get: model glTF variants carry their .bin and textures as files', async () => {
    useFixtures(routes);
    const h = await polyhaven.get('rubber_duck_toy', ctx);
    expect(h.kind).toBe('model');
    expect(labels(h.variants)).toEqual(['1k-gltf', '2k-gltf']);
    const v = h.variants[0];
    expect(v).toMatchObject({ format: 'gltf', bytes: 3180, url: 'https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/rubber_duck_toy/rubber_duck_toy_1k.gltf' });
    expect(v.files!.map((f) => f.path).sort()).toEqual(['rubber_duck_toy.bin', 'textures/rubber_duck_toy_arm_1k.jpg', 'textures/rubber_duck_toy_diff_1k.jpg', 'textures/rubber_duck_toy_nor_gl_1k.jpg']);
    expect(v.files!.find((f) => f.path === 'rubber_duck_toy.bin')).toEqual({ path: 'rubber_duck_toy.bin', url: 'https://dl.polyhaven.org/file/ph-assets/Models/gltf/4k/rubber_duck_toy/rubber_duck_toy.bin', bytes: 105376 });
    await expect(polyhaven.get('../etc', ctx)).rejects.toThrow(/not a Poly Haven asset id/);
  });
});

describe('ambientcg', () => {
  const routes: Route[] = [
    [/ambientcg\.com\/api\/v2\/full_json\?q=paper&/, 'ambientcg-paper.json'],
    [/ambientcg\.com\/api\/v2\/full_json\?q=sky&/, 'ambientcg-sky-hdri.json'],
    [/ambientcg\.com\/api\/v2\/full_json\?id=Paper\d+&/, 'ambientcg-paper.json'],
  ];

  it('searches materials, decals and atlases for textures; variants 2k-jpg first, PNG after JPG', async () => {
    const seen = useFixtures(routes);
    const hits = await ambientcg.search({ query: 'paper', kind: 'texture', limit: 5 }, ctx);
    const u = new URL(seen.urls[0]);
    expect(u.searchParams.get('q')).toBe('paper');
    expect(u.searchParams.get('type')).toBe('Material,Decal,Atlas');
    expect(u.searchParams.get('limit')).toBe('5');
    expect(u.searchParams.get('include')).toBe('downloadData,imageData,tagData,displayData');
    expect(hits.map((h) => h.id)).toEqual(['ambientcg:Paper006', 'ambientcg:Paper005', 'ambientcg:Paper001', 'ambientcg:Paper003', 'ambientcg:Cardboard002']);
    const h = hits[0];
    expect(h).toMatchObject({
      kind: 'texture', title: 'Paper 006', page: 'https://ambientcg.com/a/Paper006', author: 'ambientCG', width: 8192, height: 8192,
      preview: 'https://acg-media.struffelproductions.com/file/ambientCG-Web/media/thumbnail/256-PNG/Paper006.png',
    });
    expect(h.tags).toEqual(['Paper', 'beige', 'brown', 'paper']);
    expect(h.license.id).toBe('CC0-1.0');
    expect(h.credit).toBe('"Paper 006" by ambientCG, ambientCG (https://ambientcg.com/a/Paper006), CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/).');
    expect(labels(h.variants)).toEqual(['2k-jpg', '1k-jpg', '4k-jpg', '8k-jpg', '2k-png', '1k-png', '4k-png', '8k-png']);
    expect(h.variants[0]).toEqual({ label: '2k-jpg', format: 'zip', url: 'https://ambientcg.com/get?file=Paper006_2K-JPG.zip', width: 2048, bytes: 17884524 });
    expect(h.notes).toContain('a ZIP of PBR maps; fetch extracts the Color map');
  });

  it('HDRIs: zip variants by resolution, 2k first, 2:1', async () => {
    const seen = useFixtures(routes);
    const [h] = await ambientcg.search({ query: 'sky', kind: 'hdri', limit: 2 }, ctx);
    expect(new URL(seen.urls[0]).searchParams.get('type')).toBe('HDRI');
    expect(h).toMatchObject({ id: 'ambientcg:DaySkyHDRI069A', kind: 'hdri', title: 'Day Sky HDRI 069 A', width: 16384, height: 8192 });
    expect(labels(h.variants)).toEqual(['2k', '1k', '4k', '8k', '12k', '16k']);
    expect(h.variants.every((v) => v.format === 'zip')).toBe(true);
    expect(await ambientcg.search({ query: 'sky', kind: 'icon' }, ctx)).toEqual([]);
  });

  it('get asks by id and picks that asset', async () => {
    const seen = useFixtures(routes);
    const h = await ambientcg.get('Paper005', ctx);
    expect(seen.urls[0]).toBe('https://ambientcg.com/api/v2/full_json?id=Paper005&include=downloadData,imageData,tagData,displayData');
    expect(h.id).toBe('ambientcg:Paper005');
    expect(h.variants[0].label).toBe('2k-jpg');
    await expect(ambientcg.get('Paper999', ctx)).rejects.toThrow(/no asset "Paper999"/);
  });
});

describe('fontsource', () => {
  const META = 'https://raw.githubusercontent.com/google/fonts/main/ofl/spacegrotesk/METADATA.pb';
  const routes: Route[] = [
    [/api\.fontsource\.org\/v1\/fonts$/, 'fontsource-fonts.json'],
    [/api\.fontsource\.org\/v1\/fonts\/space-grotesk$/, 'fontsource-space-grotesk.json'],
    [/raw\.githubusercontent\.com\/google\/fonts\/main\/ofl\/spacegrotesk\/METADATA\.pb$/, 'googlefonts-spacegrotesk-METADATA.pb'],
  ];

  it('ranks the full list: exact family first, then word matches', async () => {
    const seen = useFixtures(routes);
    const hits = await fontsource.search({ query: 'Space Grotesk' }, ctx);
    expect(seen.urls).toEqual(['https://api.fontsource.org/v1/fonts']);
    expect(hits[0]).toMatchObject({ id: 'fontsource:space-grotesk', title: 'Space Grotesk', kind: 'font', preview: '', variants: [], page: 'https://fontsource.org/fonts/space-grotesk' });
    expect(hits[0].tags).toEqual(['sans-serif', 'google', 'latin', 'latin-ext', 'vietnamese']);
    expect(hits[0].license.id).toBe('OFL-1.1');
    expect(hits[0].credit).toBe('"Space Grotesk", Fontsource / Google Fonts (https://fontsource.org/fonts/space-grotesk), OFL-1.1 (https://openfontlicense.org).');
    expect(hits.map((h) => h.id)).toContain('fontsource:space-mono');
    const grot = await fontsource.search({ query: 'grotesk' }, ctx);
    expect(grot.map((h) => h.id).sort()).toEqual(['familjen-grotesk', 'hanken-grotesk', 'host-grotesk', 'schibsted-grotesk', 'space-grotesk'].map((i) => `fontsource:${i}`));
    const mono = await fontsource.search({ query: 'monospace', limit: 3 }, ctx);
    expect(mono.every((h) => h.tags[0] === 'monospace')).toBe(true);
    expect(await fontsource.search({ query: 'grotesk', kind: 'icon' }, ctx)).toEqual([]);
  });

  it('get: google/fonts files first (METADATA.pb), then Fontsource latin statics', async () => {
    const seen = useFixtures(routes);
    const h = await fontsource.get('space-grotesk', ctx);
    expect(seen.urls).toEqual(['https://api.fontsource.org/v1/fonts/space-grotesk', META]);
    expect(h.author).toBe('Florian Karsten');
    expect(h.credit).toContain('by Florian Karsten');
    expect(h.variants[0]).toEqual({ label: 'full', format: 'ttf', url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/spacegrotesk/SpaceGrotesk%5Bwght%5D.ttf' });
    expect(labels(h.variants)).toEqual(['full', '300', '400', '500', '600', '700']);
    expect(h.variants[1]).toEqual({ label: '300', format: 'ttf', url: 'https://cdn.jsdelivr.net/fontsource/fonts/space-grotesk@5.3.0/latin-300-normal.ttf' });
    expect(h.notes!.join('\n')).toMatch(/installs as SpaceGrotesk-Light; variable fonts list every named instance in AE/);
    expect(h.notes!.join('\n')).toMatch(/latin subset; static files cut from a variable font can carry the default instance's name \(D93\)/);
  });

  it('parses several fonts blocks, octal escapes and italics; non-Google families get statics only', async () => {
    const base = json('fontsource-space-grotesk.json');
    const italic = { ...base, styles: ['normal', 'italic'], variants: Object.fromEntries(Object.entries(base.variants).map(([w, v]: [string, any]) => [w, { ...v, italic: v.normal }])) };
    const meta = fixture('googlefonts-spacegrotesk-METADATA.pb').toString('utf8')
      .replace('designer: "Florian Karsten"', 'designer: "Jos\\303\\251 Sol\\303\\251"')
      .replace('date_added: "2020-10-07"\n', 'date_added: "2020-10-07"\nfonts {\n  name: "Space Grotesk"\n  style: "italic"\n  weight: 400\n  filename: "SpaceGrotesk-Italic[wght].ttf"\n  post_script_name: "SpaceGrotesk-LightItalic"\n}\n');
    let seen = useFixtures([
      [/v1\/fonts\/space-grotesk$/, () => Buffer.from(JSON.stringify(italic))],
      [/METADATA\.pb$/, () => Buffer.from(meta)],
    ]);
    const h = await fontsource.get('space-grotesk', ctx);
    expect(h.author).toBe('José Solé');
    expect(h.variants[0].files).toEqual([{ path: 'SpaceGrotesk-Italic[wght].ttf', url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/spacegrotesk/SpaceGrotesk-Italic%5Bwght%5D.ttf' }]);
    expect(h.variants[0].url).toMatch(/\/SpaceGrotesk%5Bwght%5D\.ttf$/); // the upright file leads although METADATA lists the italic first
    expect(h.notes!.join('\n')).toContain('installs as SpaceGrotesk-Light, SpaceGrotesk-LightItalic');
    expect(labels(h.variants).slice(0, 4)).toEqual(['full', '300', '300i', '400']);

    tempAssetHome();
    seen = useFixtures([[/v1\/fonts\/space-grotesk$/, () => Buffer.from(JSON.stringify({ ...base, type: 'other' }))]]);
    const other = await fontsource.get('space-grotesk', ctx);
    expect(seen.urls).toHaveLength(1);
    expect(labels(other.variants)).toEqual(['300', '400', '500', '600', '700']);
    expect(other.author).toBeUndefined();

    tempAssetHome();
    useFixtures([
      [/v1\/fonts\/space-grotesk$/, 'fontsource-space-grotesk.json'],
      [/METADATA\.pb$/, () => ({ status: 404, headers: {}, body: Buffer.from('404: Not Found') })],
    ]);
    const missing = await fontsource.get('space-grotesk', ctx);
    expect(labels(missing.variants)).toEqual(['300', '400', '500', '600', '700']);
    expect(missing.notes!.join('\n')).toMatch(/no google\/fonts METADATA\.pb/);
    await expect(fontsource.get('Space Grotesk', ctx)).rejects.toThrow(/not a Fontsource font id/);
  });
});
