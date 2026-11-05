// The keyed and Creative Commons asset adapters (Pixabay, Pexels, Unsplash, Openverse) against recorded responses
// (Pixabay, Openverse, Unsplash search) and responses synthesized from the API docs (Pexels, Unsplash get). Keys
// are fake and must only reach the API request (query or header), never hits, variants or credits.
// Note: http.ts budgets requests per source (Openverse: 18/min) even in tests; keep this file under that.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adapterContext } from '../../src/assets/context.ts';
import { setTransport } from '../../src/assets/http.ts';
import { pixabay } from '../../src/assets/adapters/pixabay.ts';
import { pexels } from '../../src/assets/adapters/pexels.ts';
import { unsplash } from '../../src/assets/adapters/unsplash.ts';
import { openverse } from '../../src/assets/adapters/openverse.ts';
import type { AdapterContext, AssetHit } from '../../src/assets/types.ts';
import { fixture, tempAssetHome, useFixtures } from './assets-fixtures.ts';

const FAKE = 'test-key-123456';
const UTM = 'utm_source=ae-compose&utm_medium=referral';
const ENV = ['AEC_PIXABAY_KEY', 'PIXABAY_API_KEY', 'AEC_PEXELS_KEY', 'PEXELS_API_KEY', 'AEC_UNSPLASH_KEY', 'UNSPLASH_ACCESS_KEY', 'AEC_OPENVERSE_TOKEN', 'OPENVERSE_TOKEN', 'AEC_KEYS_FILE', 'AEC_ASSET_HOME'];

let saved: Record<string, string | undefined> = {};
let home = '';
let ctx: AdapterContext;

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  home = tempAssetHome();
  process.env.AEC_KEYS_FILE = path.join(home, 'no-keys.json'); // never the user's real ~/.ae-compose/keys.json
  ctx = adapterContext();
});

afterEach(() => {
  setTransport(null);
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  fs.rmSync(home, { recursive: true, force: true });
});

const json = (name: string) => JSON.parse(fixture(name).toString('utf8'));
const body = (o: unknown) => Buffer.from(JSON.stringify(o));
const labels = (h: AssetHit) => h.variants.map((v) => v.label);
const noKey = (x: unknown) => expect(JSON.stringify(x)).not.toContain(FAKE);

describe('pixabay', () => {
  it('parses photos; the key goes only into the API query', async () => {
    process.env.AEC_PIXABAY_KEY = FAKE;
    const seen = useFixtures([[/^https:\/\/pixabay\.com\/api\/\?/, 'pixabay-images-mountains.json']]);
    const hits = await pixabay.search({ query: 'mountains', kind: 'photo', limit: 5 }, ctx);
    expect(hits.map((h) => h.id)).toEqual(['pixabay:1681485', 'pixabay:2534484', 'pixabay:2297204', 'pixabay:8095996', 'pixabay:4961709']);
    const h = hits[0];
    expect(h).toMatchObject({
      source: 'pixabay', kind: 'photo', title: 'Oeschinen Lake and Alpine hut', width: 5472, height: 3648,
      author: 'TeeFarm', authorUrl: 'https://pixabay.com/users/199315/',
      page: 'https://pixabay.com/photos/lake-mountains-hut-mountain-lake-1681485/',
      preview: 'https://cdn.pixabay.com/photo/2016/09/19/22/46/lake-1681485_150.jpg',
    });
    expect(h.license).toMatchObject({ id: 'Pixabay', commercial: true });
    expect(h.tags.filter((t) => t === 'switzerland')).toHaveLength(1);
    expect(labels(h)).toEqual(['large', 'web']); // no imageURL / fullHDURL without full API access
    expect(h.variants[0]).toMatchObject({ format: 'jpg', width: 1280, height: 853 });
    expect(h.variants[1]).toMatchObject({ format: 'jpg', width: 640, height: 426 });
    expect(h.credit).toBe('"Oeschinen Lake and Alpine hut" by TeeFarm (https://pixabay.com/users/199315/), Pixabay (https://pixabay.com/photos/lake-mountains-hut-mountain-lake-1681485/), Pixabay Content License (https://pixabay.com/service/license-summary/).');
    expect(seen.urls).toEqual([`https://pixabay.com/api/?key=${FAKE}&q=mountains&image_type=photo&per_page=5&safesearch=true`]);
    expect(seen.headers[0].Authorization).toBeUndefined();
    noKey(hits);
  });

  it('puts full and hd first when the account has full API access', async () => {
    process.env.AEC_PIXABAY_KEY = FAKE;
    const j = json('pixabay-images-mountains.json');
    Object.assign(j.hits[0], { imageURL: 'https://pixabay.com/get/full-1681485.jpg', fullHDURL: 'https://pixabay.com/get/hd-1681485_1920.jpg' });
    const seen = useFixtures([[/pixabay\.com\/api\/\?/, body(j)]]);
    const [h] = await pixabay.search({ query: 'mountains', kind: 'photo', limit: 1 }, ctx);
    expect(labels(h)).toEqual(['full', 'hd', 'large', 'web']);
    expect(h.variants[0]).toMatchObject({ width: 5472, height: 3648, bytes: 7405589 });
    expect(h.variants[1]).toMatchObject({ width: 1920, height: 1280 });
    expect(seen.urls[0]).toContain('per_page=3'); // Pixabay's minimum
  });

  it('parses videos: sizes labelled by the short side, the largest up to 1080p first, then larger', async () => {
    process.env.AEC_PIXABAY_KEY = FAKE;
    const seen = useFixtures([[/^https:\/\/pixabay\.com\/api\/videos\/\?/, 'pixabay-videos-ocean.json']]);
    const hits = await pixabay.search({ query: 'ocean', kind: 'video', limit: 4 }, ctx);
    expect(hits.map((h) => h.id)).toEqual(['pixabay:video:283533', 'pixabay:video:4006', 'pixabay:video:19368', 'pixabay:video:233867']);
    const [a, , c] = hits;
    expect(a).toMatchObject({
      kind: 'video', duration: 40, width: 1920, height: 1080, title: 'Wave, breaking, sea', author: 'BlenderTimer',
      preview: 'https://cdn.pixabay.com/video/2025/06/03/283533_tiny.jpg', page: 'https://pixabay.com/videos/id-283533/',
    });
    expect(labels(a)).toEqual(['1080p', '720p', '540p', '360p']);
    expect(a.variants[0]).toEqual({ label: '1080p', url: 'https://cdn.pixabay.com/video/2025/06/03/283533_large.mp4', format: 'mp4', width: 1920, height: 1080, bytes: 38263129 });
    expect(c).toMatchObject({ width: 3840, height: 2160 });
    expect(labels(c)).toEqual(['1080p', '1440p', '2160p', '720p']);
    expect(seen.urls).toEqual([`https://pixabay.com/api/videos/?key=${FAKE}&q=ocean&per_page=4&safesearch=true`]);
    noKey(hits);
  });

  it('searches photos and videos when no kind is given; other kinds and cc0 cost no request', async () => {
    process.env.AEC_PIXABAY_KEY = FAKE;
    const seen = useFixtures([[/pixabay\.com\/api\/videos\//, 'pixabay-videos-ocean.json'], [/pixabay\.com\/api\/\?/, 'pixabay-images-mountains.json']]);
    const hits = await pixabay.search({ query: 'sea', limit: 2 }, ctx);
    expect(hits.map((h) => h.kind)).toEqual(['photo', 'video']);
    expect(seen.urls).toHaveLength(2);
    expect(await pixabay.search({ query: 'sea', kind: 'audio' }, ctx)).toEqual([]);
    expect(await pixabay.search({ query: 'sea', license: 'cc0' }, ctx)).toEqual([]);
    expect(seen.urls).toHaveLength(2);
  });

  it('passes orientation and min_width to the API; square photos and video duration are filtered locally', async () => {
    process.env.AEC_PIXABAY_KEY = FAKE;
    const seen = useFixtures([[/pixabay\.com\/api\/videos\//, 'pixabay-videos-ocean.json'], [/pixabay\.com\/api\/\?/, 'pixabay-images-mountains.json']]);
    const tall = await pixabay.search({ query: 'mountains', kind: 'photo', orientation: 'portrait', minWidth: 1920 }, ctx);
    expect(seen.urls[0]).toContain('&orientation=vertical&min_width=1920');
    expect(tall.map((h) => h.id)).toEqual(['pixabay:4961709']); // the recorded list wasn't filtered by the API
    const square = await pixabay.search({ query: 'mountains', kind: 'photo', orientation: 'square', limit: 4 }, ctx);
    expect(seen.urls[1]).not.toContain('orientation=');
    expect(seen.urls[1]).toContain('per_page=12'); // 3× the limit to survive the local filter
    expect(square).toEqual([]);
    await pixabay.search({ query: 'mountains', kind: 'photo', orientation: 'landscape' }, ctx);
    expect(seen.urls[2]).toContain('orientation=horizontal');
    const long = await pixabay.search({ query: 'ocean', kind: 'video', minDuration: 41 }, ctx);
    expect(long.map((h) => h.id)).toEqual(['pixabay:video:19368']);
    expect(seen.urls[3]).toContain('per_page=36');
  });

  it('get reads one id from the photo or video endpoint', async () => {
    process.env.AEC_PIXABAY_KEY = FAKE;
    const photos = json('pixabay-images-mountains.json'), videos = json('pixabay-videos-ocean.json');
    const seen = useFixtures([
      [/pixabay\.com\/api\/videos\/\?.*id=19368/, body({ total: 1, totalHits: 1, hits: [videos.hits[2]] })],
      [/pixabay\.com\/api\/\?.*id=2297204/, body({ total: 1, totalHits: 1, hits: [photos.hits[2]] })],
    ]);
    expect(await pixabay.get('2297204', ctx)).toMatchObject({ id: 'pixabay:2297204', kind: 'photo', title: 'Moraine Lake at sunrise in Banff' });
    expect(await pixabay.get('video:19368', ctx)).toMatchObject({ id: 'pixabay:video:19368', kind: 'video', duration: 46 });
    expect(seen.urls).toEqual([`https://pixabay.com/api/?key=${FAKE}&id=2297204`, `https://pixabay.com/api/videos/?key=${FAKE}&id=19368`]);
    await expect(pixabay.get('photo:12', ctx)).rejects.toThrow(/bad id/);
  });

  it('without a key, search and get throw saying how to get one, and send nothing', async () => {
    const seen = useFixtures([]);
    await expect(pixabay.search({ query: 'x' }, ctx)).rejects.toThrow(/no API key.*https:\/\/pixabay\.com\/api\/docs\/.*keys\.json/);
    await expect(pixabay.get('1', ctx)).rejects.toThrow(/no API key/);
    expect(seen.urls).toEqual([]);
    expect(pixabay.key).toBe('required');
  });
});

describe('pexels (fixtures synthesized from the API docs)', () => {
  it('parses photos; the key goes only into the Authorization header of API calls', async () => {
    process.env.AEC_PEXELS_KEY = FAKE;
    const seen = useFixtures([[/^https:\/\/api\.pexels\.com\/v1\/search\?/, 'pexels-search-nature.json']]);
    const hits = await pexels.search({ query: 'nature', kind: 'photo', orientation: 'portrait' }, ctx);
    expect(hits).toHaveLength(1);
    const h = hits[0];
    expect(h).toMatchObject({
      id: 'pexels:3573351', source: 'pexels', kind: 'photo', title: 'Brown Rocks During Golden Hour', width: 3066, height: 3968,
      author: 'Lukas Rodriguez', authorUrl: 'https://www.pexels.com/@lukas-rodriguez-1845331', page: 'https://www.pexels.com/photo/trees-during-day-3573351/',
    });
    expect(h.preview).toContain('fit=crop&h=200&w=280');
    expect(labels(h)).toEqual(['original', 'large2x', 'large']);
    expect(h.variants[0]).toEqual({ label: 'original', url: 'https://images.pexels.com/photos/3573351/pexels-photo-3573351.png', format: 'png', width: 3066, height: 3968 });
    expect(h.license.id).toBe('Pexels');
    expect(h.credit).toBe('"Brown Rocks During Golden Hour" by Lukas Rodriguez (https://www.pexels.com/@lukas-rodriguez-1845331) on Pexels (https://www.pexels.com/photo/trees-during-day-3573351/), Pexels License (https://www.pexels.com/license/).');
    expect(seen.urls).toEqual(['https://api.pexels.com/v1/search?query=nature&per_page=12&orientation=portrait']);
    expect(seen.headers[0].Authorization).toBe(FAKE);
    expect(pexels.downloadHeaders?.(ctx) ?? {}).toEqual({}); // CDN files: no key
    noKey(hits);
  });

  it('parses videos: MP4 files only, labelled by the short side, 1080p first; duration filtered locally', async () => {
    process.env.AEC_PEXELS_KEY = FAKE;
    const seen = useFixtures([[/^https:\/\/api\.pexels\.com\/videos\/search\?/, 'pexels-videos-search-nature.json']]);
    const [v] = await pexels.search({ query: 'nature', kind: 'video', orientation: 'landscape' }, ctx);
    expect(v).toMatchObject({
      id: 'pexels:video:1448735', kind: 'video', title: 'Video of forest', duration: 32, width: 4096, height: 2160,
      author: 'Ruvim Miksanskiy', authorUrl: 'https://www.pexels.com/@digitech',
      preview: 'https://images.pexels.com/videos/1448735/free-video-1448735.jpg?fit=crop&w=1200&h=630&auto=compress&cs=tinysrgb',
    });
    expect(labels(v)).toEqual(['1080p', '1440p', '2160p', '720p', '506p', '338p']); // the .m3u8 "hls" entry is gone
    expect(v.variants[0]).toMatchObject({ width: 2048, height: 1080, format: 'mp4' });
    expect(v.variants.some((x) => /m3u8/.test(x.url))).toBe(false);
    expect(v.credit).toContain('"Video of forest" by Ruvim Miksanskiy (https://www.pexels.com/@digitech) on Pexels (https://www.pexels.com/video/video-of-forest-1448735/)');
    expect(seen.urls[0]).toBe('https://api.pexels.com/videos/search?query=nature&per_page=12&orientation=landscape');
    expect(seen.headers[0].Authorization).toBe(FAKE);
    expect(await pexels.search({ query: 'nature', kind: 'video', minDuration: 40 }, ctx)).toEqual([]);
    expect(seen.urls[1]).toBe('https://api.pexels.com/videos/search?query=nature&per_page=36');
    noKey(v);
  });

  it('get: photo and video endpoints; the frame rate joins the label when two files share a size', async () => {
    process.env.AEC_PEXELS_KEY = FAKE;
    const video = json('pexels-video-2499611.json');
    video.video_files.push({ ...video.video_files[0], id: 999, fps: 59.94, link: 'https://player.vimeo.com/external/342571552.hd.mp4?s=x&profile_id=999' });
    const seen = useFixtures([
      [/^https:\/\/api\.pexels\.com\/v1\/photos\/2014422$/, 'pexels-photo-2014422.json'],
      [/^https:\/\/api\.pexels\.com\/videos\/videos\/2499611$/, body(video)],
    ]);
    const p = await pexels.get('2014422', ctx);
    expect(p).toMatchObject({ id: 'pexels:2014422', title: 'Brown Rocks During Golden Hour', width: 3024, height: 3024, author: 'Joey Farina', authorUrl: 'https://www.pexels.com/@joey' });
    expect(p.variants[0]).toMatchObject({ label: 'original', format: 'jpg' });
    const v = await pexels.get('video:2499611', ctx);
    expect(v).toMatchObject({ id: 'pexels:video:2499611', title: 'Video by Joey Farina', width: 1080, height: 1920, duration: 22, tags: [] });
    expect(labels(v)).toEqual(['1080p24', '1080p60', '720p', '540p', '360p', '240p']);
    expect(seen.urls).toHaveLength(2);
    expect(seen.headers.every((h) => h.Authorization === FAKE)).toBe(true);
    noKey([p, v]);
  });

  it('without a key, search throws saying Pexels is not issuing keys', async () => {
    useFixtures([]);
    await expect(pexels.search({ query: 'x' }, ctx)).rejects.toThrow(/no API key.*isn't issuing new API keys.*keys\.json/);
  });
});

describe('unsplash', () => {
  it('parses the recorded search; key in the Client-ID header only; credits link back with UTM', async () => {
    process.env.AEC_UNSPLASH_KEY = FAKE;
    const seen = useFixtures([[/^https:\/\/api\.unsplash\.com\/search\/photos\?/, 'unsplash-search-desk.json']]);
    const hits = await unsplash.search({ query: 'desk workspace', limit: 5 }, ctx);
    expect(hits.map((h) => h.id)).toEqual(['unsplash:cckf4TsHAuw', 'unsplash:wJ7yGwz2-00', 'unsplash:9l_326FISzk', 'unsplash:MNd-Rka1o0Q', 'unsplash:IisDPFNUS4k']);
    const s = json('unsplash-search-desk.json').results[0];
    const h = hits[0];
    expect(h).toMatchObject({
      source: 'unsplash', kind: 'photo', title: 'MacBook Pro, white ceramic mug,and black smartphone on table', width: 6000, height: 4000,
      author: 'Andrew Neel', authorUrl: `https://unsplash.com/@andrewtneel?${UTM}`, page: `${s.links.html}?${UTM}`, preview: s.urls.small, tags: [],
    });
    expect(h.license.id).toBe('Unsplash');
    expect(labels(h)).toEqual(['full', '4k', 'regular']);
    expect(h.variants[0]).toEqual({ label: 'full', url: s.urls.full, format: 'jpg', width: 6000, height: 4000 });
    expect(h.variants[1]).toEqual({ label: '4k', url: `${s.urls.raw}&w=3840&fm=jpg&q=85`, format: 'jpg', width: 3840, height: 2560 });
    expect(h.variants[1].url).toContain('ixid='); // the guidelines want ixid kept
    expect(h.variants[2]).toEqual({ label: 'regular', url: s.urls.regular, format: 'jpg', width: 1080, height: 720 });
    expect(labels(hits[1])).toEqual(['full', 'regular']); // 2831 px wide: no 4k
    expect(hits[1].variants[1]).toMatchObject({ width: 1080, height: 1348 });
    expect(h.credit.startsWith(`Photo by Andrew Neel (https://unsplash.com/@andrewtneel?${UTM}) on Unsplash (https://unsplash.com/?${UTM})`)).toBe(true);
    expect(seen.urls).toEqual(['https://api.unsplash.com/search/photos?query=desk%20workspace&per_page=5&content_filter=high']);
    expect(seen.headers[0]).toMatchObject({ Authorization: `Client-ID ${FAKE}`, 'Accept-Version': 'v1' });
    noKey(hits);
  });

  it('maps orientation (square → squarish); other kinds cost no request', async () => {
    process.env.AEC_UNSPLASH_KEY = FAKE;
    const seen = useFixtures([[/api\.unsplash\.com\/search\/photos/, 'unsplash-search-desk.json']]);
    const wide = await unsplash.search({ query: 'desk', orientation: 'landscape' }, ctx);
    expect(seen.urls[0]).toContain('orientation=landscape');
    expect(wide.map((h) => h.id)).not.toContain('unsplash:wJ7yGwz2-00'); // portrait
    await unsplash.search({ query: 'desk', orientation: 'square' }, ctx);
    expect(seen.urls[1]).toContain('orientation=squarish');
    expect(await unsplash.search({ query: 'desk', kind: 'video' }, ctx)).toEqual([]);
    expect(seen.urls).toHaveLength(2);
  });

  it('onFetch pings download_location with the auth header on every fetch', async () => {
    process.env.AEC_UNSPLASH_KEY = FAKE;
    const seen = useFixtures([
      [/^https:\/\/api\.unsplash\.com\/search\/photos/, 'unsplash-search-desk.json'],
      [/^https:\/\/api\.unsplash\.com\/photos\/[^/]+\/download/, '{"url":"https://images.unsplash.com/photo-x"}'],
    ]);
    const [h] = await unsplash.search({ query: 'desk', limit: 1 }, ctx);
    const loc = json('unsplash-search-desk.json').results[0].links.download_location;
    await unsplash.onFetch!(h, h.variants[0], ctx);
    await unsplash.onFetch!(h, h.variants[1], ctx);
    const pings = seen.urls.map((u, i) => ({ u, h: seen.headers[i] })).filter((x) => x.u === loc);
    expect(pings).toHaveLength(2); // not served from the response cache
    for (const p of pings) expect(p.h).toMatchObject({ Authorization: `Client-ID ${FAKE}`, 'Accept-Version': 'v1' });
    expect(unsplash.downloadHeaders?.(ctx) ?? {}).toEqual({});
  });

  it('get parses the documented photo; onFetch for a hit it has not seen looks its download_location up', async () => {
    process.env.AEC_UNSPLASH_KEY = FAKE;
    const doc = json('unsplash-photo-Dwu85P9SOIk.json');
    const big = { ...doc, id: 'abcDEF123', width: 5000, height: 3000, links: { ...doc.links, download_location: 'https://api.unsplash.com/photos/abcDEF123/download?ixid=test' } };
    const seen = useFixtures([
      [/^https:\/\/api\.unsplash\.com\/photos\/Dwu85P9SOIk$/, 'unsplash-photo-Dwu85P9SOIk.json'],
      [/^https:\/\/api\.unsplash\.com\/photos\/abcDEF123$/, body(big)],
      [/^https:\/\/api\.unsplash\.com\/photos\/[^/]+\/download/, '{"url":"x"}'],
    ]);
    const h = await unsplash.get('Dwu85P9SOIk', ctx);
    expect(h).toMatchObject({
      id: 'unsplash:Dwu85P9SOIk', title: 'Man in black crew neck t-shirt drinking coffee', tags: ['man', 'drinking', 'coffee'],
      width: 2448, height: 3264, author: 'Joe Example', authorUrl: `https://unsplash.com/exampleuser?${UTM}`, page: `https://unsplash.com/photos/Dwu85P9SOIk?${UTM}`,
    });
    expect(labels(h)).toEqual(['full', 'regular']);
    expect(h.variants[1]).toMatchObject({ width: 1080, height: 1440 });
    const unseen = { ...h, id: 'unsplash:abcDEF123' };
    await unsplash.onFetch!(unseen, unseen.variants[0], ctx);
    expect(seen.urls.slice(-2)).toEqual(['https://api.unsplash.com/photos/abcDEF123', 'https://api.unsplash.com/photos/abcDEF123/download?ixid=test']);
    const b = await unsplash.get('abcDEF123', ctx); // cached
    expect(b.variants[1]).toMatchObject({ label: '4k', url: 'https://images.unsplash.com/photo-1417325384643-aac51acc9e5d?w=3840&fm=jpg&q=85', height: 2304 });
    noKey([h, b]);
  });

  it('without a key, search throws naming the Access Key', async () => {
    useFixtures([]);
    await expect(unsplash.search({ query: 'x' }, ctx)).rejects.toThrow(/no API key.*Access Key \(not the Secret key\).*keys\.json/);
  });
});

describe('openverse', () => {
  it('parses images anonymously: explicit license list, by-sa flagged, credit via Openverse', async () => {
    const seen = useFixtures([[/^https:\/\/api\.openverse\.org\/v1\/images\/\?/, 'openverse-images-paper.json']]);
    const hits = await openverse.search({ query: 'paper', kind: 'photo', limit: 6 }, ctx);
    expect(hits).toHaveLength(6);
    const h = hits[0];
    expect(h).toMatchObject({
      id: 'openverse:37b116dd-5747-4d7f-b6f2-6185bff39e7a', source: 'openverse', kind: 'photo', title: 'paper-texture-14', width: 744, height: 1024,
      author: 'designshard', authorUrl: 'https://www.flickr.com/photos/28920179@N03', page: 'https://www.flickr.com/photos/28920179@N03/7585538284',
      preview: 'https://api.openverse.org/v1/images/37b116dd-5747-4d7f-b6f2-6185bff39e7a/thumb/',
    });
    expect(h.license).toMatchObject({ id: 'CC-BY-2.0', url: 'https://creativecommons.org/licenses/by/2.0/', attribution: true });
    expect(h.license.shareAlike).toBeUndefined();
    expect(h.variants).toEqual([{ label: 'original', url: 'https://live.staticflickr.com/8423/7585538284_4a5282633b_b.jpg', format: 'jpg', width: 744, height: 1024, bytes: 708723 }]);
    expect(h.tags).toContain('paper');
    expect(h.tags.filter((t) => t === 'texture')).toHaveLength(1);
    expect(h.credit).toBe('"paper-texture-14" by designshard (https://www.flickr.com/photos/28920179@N03), Flickr via Openverse (https://www.flickr.com/photos/28920179@N03/7585538284), CC BY 2.0 (https://creativecommons.org/licenses/by/2.0/).');
    expect(hits.find((x) => x.id === 'openverse:3911f7af-da12-42dc-8f20-f546786dd04a')!.license).toMatchObject({ id: 'CC-BY-SA-2.0', shareAlike: true });
    expect(seen.urls).toEqual(['https://api.openverse.org/v1/images/?q=paper&license=cc0,pdm,by,by-sa&page_size=6']);
    expect(seen.headers[0].Authorization).toBeUndefined();
  });

  it('drops NonCommercial and NoDerivatives results even when the API returns them', async () => {
    const j = json('openverse-images-paper.json');
    const nd = { ...j.results[0], id: '11111111-1111-4111-8111-111111111111', title: 'no derivatives', license: 'by-nd', license_version: '4.0', license_url: 'https://creativecommons.org/licenses/by-nd/4.0/' };
    const nc = { ...j.results[0], id: '22222222-2222-4222-8222-222222222222', title: 'non commercial', license: 'by-nc', license_version: '2.0', license_url: 'https://creativecommons.org/licenses/by-nc/2.0/' };
    j.results.push(nd, nc);
    useFixtures([[/\/v1\/images\/\?/, body(j)], [/\/v1\/images\/11111111-1111-4111-8111-111111111111\/$/, body(nd)]]);
    const hits = await openverse.search({ query: 'paper', kind: 'photo', limit: 20 }, ctx);
    expect(hits).toHaveLength(6);
    expect(hits.map((h) => h.title)).not.toContain('no derivatives');
    expect(hits.map((h) => h.title)).not.toContain('non commercial');
    await expect(openverse.get(nd.id, ctx)).rejects.toThrow(/NoDerivatives/);
  });

  it('maps orientation to aspect_ratio and a large minWidth to size=large, then checks the width locally', async () => {
    const seen = useFixtures([[/\/v1\/images\/\?/, 'openverse-images-paper.json']]);
    const hits = await openverse.search({ query: 'paper', kind: 'photo', orientation: 'landscape', minWidth: 1000 }, ctx);
    expect(seen.urls[0]).toBe('https://api.openverse.org/v1/images/?q=paper&license=cc0,pdm,by,by-sa&page_size=20&aspect_ratio=wide&size=large');
    expect(hits.map((h) => h.width)).toEqual([1024, 1024, 1024]);
    await openverse.search({ query: 'paper', kind: 'photo', orientation: 'portrait' }, ctx);
    await openverse.search({ query: 'paper', kind: 'photo', orientation: 'square' }, ctx);
    expect(seen.urls[1]).toContain('aspect_ratio=tall');
    expect(seen.urls[2]).toContain('aspect_ratio=square');
  });

  it('parses audio: the Freesound preview MP3 with a note, seconds, never alt_files', async () => {
    const seen = useFixtures([[/^https:\/\/api\.openverse\.org\/v1\/audio\/\?/, 'openverse-audio-whoosh.json']]);
    const hits = await openverse.search({ query: 'whoosh', kind: 'audio', limit: 6 }, ctx);
    expect(hits).toHaveLength(6);
    const h = hits[0];
    expect(h).toMatchObject({
      id: 'openverse:audio:eab8a6e2-0ac8-4615-9e0d-ebde30523783', kind: 'audio', title: 'Deep Whoosh #1', duration: 3.155,
      author: 'Kinoton', page: 'https://freesound.org/people/Kinoton/sounds/351256', preview: '',
    });
    expect(h.license).toMatchObject({ id: 'CC0-1.0', attribution: false });
    expect(h.variants).toEqual([{ label: 'original', url: 'https://cdn.freesound.org/previews/351/351256_2247456-hq.mp3', format: 'mp3', bytes: 69196 }]);
    expect(h.notes).toEqual(['Freesound preview MP3 (128 kbps); the original needs a Freesound login']);
    expect(h.credit).toContain('Freesound via Openverse (https://freesound.org/people/Kinoton/sounds/351256)');
    expect(JSON.stringify(hits)).not.toContain('apiv2'); // alt_files: the OAuth-only original
    expect(seen.urls[0]).toBe('https://api.openverse.org/v1/audio/?q=whoosh&license=cc0,pdm,by,by-sa&page_size=6');
    const long = await openverse.search({ query: 'whoosh', kind: 'audio', minDuration: 5 }, ctx);
    expect(long.map((x) => x.title)).toEqual(['whoosh motron very low.wav']);
    expect(seen.urls[1]).toContain('page_size=20'); // anonymous maximum
  });

  it('sends an optional token as a Bearer header, never in URLs or hits', async () => {
    process.env.AEC_OPENVERSE_TOKEN = FAKE;
    const seen = useFixtures([[/\/v1\/images\/\?/, 'openverse-images-paper.json']]);
    const hits = await openverse.search({ query: 'paper', kind: 'photo' }, ctx);
    expect(seen.headers[0].Authorization).toBe(`Bearer ${FAKE}`);
    expect(seen.urls[0]).not.toContain(FAKE);
    noKey(hits);
  });

  it("license 'cc0' asks for cc0,pdm only; no kind searches images and audio; get by uuid", async () => {
    const img = json('openverse-images-paper.json'), aud = json('openverse-audio-whoosh.json');
    const seen = useFixtures([
      [/\/v1\/images\/\?/, 'openverse-images-paper.json'],
      [/\/v1\/audio\/\?/, 'openverse-audio-whoosh.json'],
      [/\/v1\/audio\/eab8a6e2-0ac8-4615-9e0d-ebde30523783\/$/, body(aud.results[0])],
      [/\/v1\/images\/3911f7af-da12-42dc-8f20-f546786dd04a\/$/, body(img.results[1])],
    ]);
    const hits = await openverse.search({ query: 'paper', license: 'cc0' }, ctx);
    expect(seen.urls.map((u) => new URL(u).pathname).sort()).toEqual(['/v1/audio/', '/v1/images/']);
    for (const u of seen.urls) expect(u).toContain('&license=cc0,pdm&');
    expect(hits).toHaveLength(4); // the recorded images are all CC BY / BY-SA: refused in cc0 mode
    expect(hits.every((h) => h.kind === 'audio' && h.license.id === 'CC0-1.0')).toBe(true);
    expect((await openverse.get('audio:eab8a6e2-0ac8-4615-9e0d-ebde30523783', ctx)).id).toBe('openverse:audio:eab8a6e2-0ac8-4615-9e0d-ebde30523783');
    expect((await openverse.get('3911f7af-da12-42dc-8f20-f546786dd04a', ctx)).license.shareAlike).toBe(true);
    expect(seen.urls.slice(-2)).toEqual(['https://api.openverse.org/v1/audio/eab8a6e2-0ac8-4615-9e0d-ebde30523783/', 'https://api.openverse.org/v1/images/3911f7af-da12-42dc-8f20-f546786dd04a/']);
    await expect(openverse.get('nope', ctx)).rejects.toThrow(/bad id/);
  });
});
