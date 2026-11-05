// Local folders adapter: the sampled index (kinds, junk folders, depth, per-folder cap, unreachable roots, budget),
// index reuse and rebuilds, ranking (file name over folder names), hit shape and get(). Runs on a temp folder tree.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tempAssetHome } from './assets-fixtures.ts';
import { buildLocalIndex, loadLocalIndex, local, localIndexFile, localKindOf, localRoots, searchLocalIndex, tokens } from '../../src/assets/adapters/local.ts';
import type { AdapterContext } from '../../src/assets/types.ts';

const ctx: AdapterContext = { getJson: async () => { throw new Error('no network'); }, getText: async () => { throw new Error('no network'); }, key: () => undefined };

let home: string;
let root: string;
let missing: string;
const savedRoots = process.env.AEC_ASSET_ROOTS;

function put(rel: string, bytes = 2048, mtime?: number) {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, Buffer.alloc(bytes, 7));
  if (mtime) fs.utimesSync(f, mtime / 1000, mtime / 1000);
  return f;
}

beforeAll(() => {
  home = tempAssetHome();
  // No separator before mkdtemp's random suffix, so it can't form a path word ("tex", "env…") that changes kinds.
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aeclocalroot'));
  missing = path.join(os.tmpdir(), `aecmissing${Date.now()}`);
  const old = Date.now() - 30 * 86400e3;
  put('models/Rubber Duck.glb', 4096);
  put('Photos/duck/pond.jpg', 4096);
  put('Photos/beach sunset.jpg', 4096, old);
  put('Photos/beach-sunset-2.jpg', 4096);
  put('Textures/wood_planks_diff_1k.jpg');
  put('paper scans/crumpled.png');
  put('HDRI/studio_small.exr');
  put('renders/beauty.exr');
  put('env/sky.hdr');
  put('Fonts/Inter-Bold.ttf');
  put('Audio/whoosh_01.wav');
  put('Video/clip.mp4');
  put('Brand/logos/rocket-logo.svg', 400);
  put('Brand/logos/tiny.svg', 60);
  put('readme.txt');
  put('tiny.png', 100);
  put('node_modules/pkg/duck.png');
  put('.hidden/duck.png');
  put('Adobe After Effects Disk Cache/duck.png');
  put('proj/Auto-Save/duck.png');
  put('web/package.json', 50);
  put('web/out/duck-render.png');
  put('web/assets/duck-icon.png', 2048, old);
  put('a/b/c/d/e/f/deep6.png');
  put('a/b/c/d/e/f/g/deep7.png');
  for (let i = 0; i < 305; i++) put(`frames/shot_${String(i).padStart(4, '0')}.png`, 1100);
  process.env.AEC_ASSET_ROOTS = `${root};${missing}`;
});

afterAll(() => {
  if (savedRoots === undefined) delete process.env.AEC_ASSET_ROOTS; else process.env.AEC_ASSET_ROOTS = savedRoots;
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

describe('classification', () => {
  it('maps extensions and path words to kinds', () => {
    expect(localKindOf('E:\\x\\photo.JPG')).toBe('photo');
    expect(localKindOf('E:\\x\\Textures\\wood.jpg')).toBe('texture');
    expect(localKindOf('E:\\x\\pbr\\wood.png')).toBe('texture');
    expect(localKindOf('E:\\x\\context\\shot.png')).toBe('photo'); // "context" isn't "tex"
    expect(localKindOf('E:\\x\\HDRIs\\studio.exr')).toBe('hdri');
    expect(localKindOf('E:\\x\\renders\\beauty.exr')).toBe('texture');
    expect(localKindOf('E:\\x\\sky.hdr')).toBe('hdri');
    expect(localKindOf('E:\\x\\duck.gltf')).toBe('model');
    expect(localKindOf('E:\\x\\comp.psd')).toBe('photo');
    expect(localKindOf('E:\\x\\Wood049_1K-JPG_NormalGL.jpg')).toBe('texture');
    expect(localKindOf('E:\\x\\duck\\rubber_duck_toy_diff_1k.jpg')).toBe('texture');
    expect(localKindOf('E:\\x\\color.png')).toBe('photo');
    expect(localKindOf('E:\\x\\aTex12\\shot.png')).toBe('photo');
    expect(localKindOf('E:\\x\\icon.svg')).toBe('icon');
    expect(localKindOf('E:\\x\\song.flac')).toBe('audio');
    expect(localKindOf('E:\\x\\clip.mxf')).toBe('video');
    expect(localKindOf('E:\\x\\notes.txt')).toBeNull();
    expect(localKindOf('E:\\x\\logo.ai')).toBeNull();
  });
  it('tokenizes names, camelCase and letter→digit runs', () => {
    expect(tokens('Wood049_1K-JPG_NormalGL')).toEqual(['wood', '049', '1k', 'jpg', 'normal', 'gl']);
    expect(tokens('Rubber Duck')).toEqual(['rubber', 'duck']);
  });
});

describe('index', () => {
  it('samples the roots and records an unreachable root without failing', async () => {
    expect(localRoots()).toEqual([path.resolve(root), path.resolve(missing)]);
    const idx = await buildLocalIndex({ force: true });
    expect(fs.existsSync(localIndexFile())).toBe(true);
    expect(localIndexFile().startsWith(home)).toBe(true);
    const [r, m] = idx.roots;
    expect(r).toMatchObject({ root: path.resolve(root), ok: true, truncated: true }); // the 300-per-folder cap
    expect(m.ok).toBe(false);
    expect(m.error).toMatch(/ENOENT/);
    const names = idx.entries.map((e) => e.name);
    for (const n of ['Rubber Duck.glb', 'pond.jpg', 'Inter-Bold.ttf', 'whoosh_01.wav', 'clip.mp4', 'rocket-logo.svg', 'deep6.png', 'duck-icon.png']) expect(names).toContain(n);
    for (const n of ['readme.txt', 'tiny.png', 'tiny.svg', 'deep7.png', 'duck.png', 'duck-render.png']) expect(names).not.toContain(n);
    expect(idx.entries.filter((e) => e.name.startsWith('shot_')).length).toBe(300);
    const kind = (n: string) => idx.entries.find((e) => e.name === n)!.kind;
    expect(kind('wood_planks_diff_1k.jpg')).toBe('texture');
    expect(kind('crumpled.png')).toBe('texture');
    expect(kind('studio_small.exr')).toBe('hdri');
    expect(kind('beauty.exr')).toBe('texture');
    expect(kind('sky.hdr')).toBe('hdri');
    const duck = idx.entries.find((e) => e.name === 'Rubber Duck.glb')!;
    expect(duck).toMatchObject({ ext: 'glb', kind: 'model', bytes: 4096 });
    expect(duck.mtime).toBeGreaterThan(Date.now() - 3600e3);
  });

  it('reuses a fresh index, rebuilds a stale one or on force', async () => {
    const a = loadLocalIndex()!;
    const b = await buildLocalIndex();
    expect(b.builtAt).toBe(a.builtAt);
    // Older than 7 days: the next search rebuilds.
    const stale = { ...a, builtAt: new Date(Date.now() - 8 * 86400e3).toISOString() };
    fs.writeFileSync(localIndexFile(), JSON.stringify(stale));
    expect((await local.available!(ctx)).detail).toMatch(/stale/);
    await local.search({ query: 'duck' }, ctx);
    const c = loadLocalIndex()!;
    expect(Date.parse(c.builtAt)).toBeGreaterThan(Date.now() - 60e3);
    // Roots changed: rebuilt too.
    process.env.AEC_ASSET_ROOTS = root;
    try {
      expect((await local.available!(ctx)).detail).toMatch(/roots changed/);
      await local.search({ query: 'duck' }, ctx);
      expect(loadLocalIndex()!.roots.length).toBe(1);
    } finally { process.env.AEC_ASSET_ROOTS = `${root};${missing}`; }
  });

  it('stops at the time budget (the root folder is still read)', async () => {
    const idx = await buildLocalIndex({ roots: [root], force: true, budgetSec: 0 });
    expect(idx.roots[0].truncated).toBe(true);
    expect(idx.roots[0].dirs).toBe(1);
    expect(idx.entries.length).toBe(0); // the root holds only readme.txt and tiny.png
    await buildLocalIndex({ force: true });
  });
});

describe('search', () => {
  it('ranks file-name matches over folder matches and fills the hit', async () => {
    const hits = await local.search({ query: 'duck' }, ctx);
    expect(hits[0].title).toBe('Rubber Duck.glb');
    expect(hits.map((h) => h.title)).toEqual(expect.arrayContaining(['duck-icon.png', 'pond.jpg']));
    expect(hits.findIndex((h) => h.title === 'duck-icon.png')).toBeLessThan(hits.findIndex((h) => h.title === 'pond.jpg'));
    const duck = hits[0];
    const file = path.join(root, 'models', 'Rubber Duck.glb');
    expect(duck.id).toMatch(/^local:[0-9a-f]{12}$/);
    expect(duck).toMatchObject({ source: 'local', kind: 'model', preview: '', page: path.join(root, 'models'), tags: ['models'] });
    expect(duck.license).toEqual({ id: 'local', url: '', commercial: true, attribution: false });
    expect(duck.credit).toContain('local library');
    expect(duck.credit).toContain(file);
    expect(duck.variants).toEqual([{ label: 'file', url: pathToFileURL(file).href, format: 'glb', bytes: 4096 }]);
    const pond = hits.find((h) => h.title === 'pond.jpg')!;
    expect(pond.preview).toBe(path.join(root, 'Photos', 'duck', 'pond.jpg'));
    expect(pond.tags).toEqual(['Photos', 'duck']);
  });

  it('filters by kind, prefers all words, breaks ties by recency, honors limit', async () => {
    expect((await local.search({ query: 'duck', kind: 'photo' }, ctx)).every((h) => h.kind === 'photo')).toBe(true);
    const beach = await local.search({ query: 'beach sunset' }, ctx);
    expect(beach.map((h) => h.title)).toEqual(['beach-sunset-2.jpg', 'beach sunset.jpg']);
    const fonts = await local.search({ query: '', kind: 'font' }, ctx);
    expect(fonts.map((h) => h.title)).toEqual(['Inter-Bold.ttf']);
    expect((await local.search({ query: 'logo', kind: 'icon' }, ctx))[0].preview).toMatch(/rocket-logo\.svg$/);
    expect((await local.search({ query: 'duck', limit: 2 }, ctx)).length).toBe(2);
    expect(await local.search({ query: 'zebra' }, ctx)).toEqual([]);
  });

  it('shows a numbered sequence once', async () => {
    const hits = await local.search({ query: 'shot' }, ctx);
    expect(hits.length).toBe(1);
    expect(hits[0].notes?.[0]).toMatch(/\+299 similarly numbered files/);
  });

  it('get() returns the hit by id and explains missing ids', async () => {
    const [hit] = await local.search({ query: 'whoosh' }, ctx);
    const again = await local.get(hit.id.slice('local:'.length), ctx);
    expect(again).toMatchObject({ id: hit.id, title: 'whoosh_01.wav', kind: 'audio' });
    expect((await local.get(hit.id, ctx)).id).toBe(hit.id);
    await expect(local.get('000000000000', ctx)).rejects.toThrow(/rebuild the index/);
    fs.rmSync(path.join(root, 'Audio', 'whoosh_01.wav'));
    await expect(local.get(hit.id, ctx)).rejects.toThrow(/no longer exists/);
  });

  it('available() reports index age and root status in one line', async () => {
    const a = await local.available!(ctx);
    expect(a.ok).toBe(true);
    expect(a.detail).toMatch(/^index just built, \d+ files: /);
    expect(a.detail).toContain('offline');
    expect(a.detail).not.toContain('\n');
  });

  it('searches without touching the folders once indexed', () => {
    const idx = loadLocalIndex()!;
    const hits = searchLocalIndex({ ...idx, entries: [...idx.entries, { path: path.join(root, 'ghost', 'ghost duck.png'), name: 'ghost duck.png', ext: 'png', kind: 'photo', bytes: 5000, mtime: Date.now() }] }, { query: 'ghost' });
    expect(hits[0].title).toBe('ghost duck.png');
  });
});
