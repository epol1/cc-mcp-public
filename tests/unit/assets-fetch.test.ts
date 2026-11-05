// The fetch pipeline end to end on fixtures (no network, no AE): download → content check → sanitize/unzip →
// cache (+ the stored record) → project footage folder → CREDITS.md, refusals (HTML pages, size caps, licenses),
// `asset:` resolution from the cache, and the build-time placement of `asset:` refs (IR rewrite + credits).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { beforeEach, describe, expect, it } from 'vitest';
import { fetchAsset, fromCache, toCache, MAX_BYTES, cachedHit, projectAssetDir } from '@ae-mcp/core/assets/fetch.ts';
import { resolveAssetRef, resolvedRefs, resetResolvedRefs, resolveSrc } from '@ae-mcp/core/assets/resolve.ts';
import { placeSceneAssets } from '@ae-mcp/core/assets/scene.ts';
import { creditedIds } from '@ae-mcp/core/assets/credits.ts';
import { tempAssetHome, useFixtures } from './assets-fixtures.ts';

/** A minimal stored (method 0) ZIP. */
function storedZip(entries: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [], cens: Buffer[] = [];
  let off = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name);
    const crc = zlib.crc32(e.data) >>> 0;
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt32LE(crc, 14); loc.writeUInt32LE(e.data.length, 18); loc.writeUInt32LE(e.data.length, 22); loc.writeUInt16LE(name.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(e.data.length, 20); cen.writeUInt32LE(e.data.length, 24); cen.writeUInt16LE(name.length, 28); cen.writeUInt32LE(off, 42);
    locals.push(loc, name, e.data); cens.push(cen, name);
    off += 30 + name.length + e.data.length;
  }
  const cd = Buffer.concat(cens), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}
const JPG = Buffer.concat([Buffer.from('ffd8ffe000104a464946', 'hex'), Buffer.alloc(64)]);
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(64)]);
const EVIL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" onload="alert(1)"><script>fetch("http://x")</script><g fill="none" stroke="currentColor"><path d="M4 4L20 20"/></g><image href="http://tracker/x.png"/></svg>';

const ICONIFY = [/api\.iconify\.design\/collections/, 'iconify-collections.json'] as const;

let home: string, project: string;
beforeEach(() => {
  home = tempAssetHome();
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'aec-proj-'));
  resetResolvedRefs();
});

describe('fetch pipeline', () => {
  it('an icon: sanitized SVG in the cache with its record, copied next to the project, credited, not imported', async () => {
    useFixtures([[...ICONIFY], [/api\.iconify\.design\/lucide\/rocket\.svg/, EVIL_SVG]]);
    let imported = 0;
    const r = await fetchAsset('iconify:lucide:rocket', { projectDir: project, importer: async () => { imported++; return { id: 1, name: 'x' }; } });
    expect(r.kind).toBe('icon');
    expect(imported).toBe(0);
    expect(r.inProject).toBe(true);
    expect(r.file.startsWith(projectAssetDir(project, 'iconify:lucide:rocket'))).toBe(true);
    const svg = fs.readFileSync(r.file, 'utf8');
    expect(svg).not.toMatch(/script|onload|tracker/);
    expect(svg).toContain('stroke="currentColor"');
    expect(creditedIds(path.join(project, 'CREDITS.md'))).toEqual(['iconify:lucide:rocket']);
    // The cache keeps the record next to the file, so `asset:` builds credit offline.
    const c = await toCache('iconify:lucide:rocket');
    expect(c.notes).toContain('from the cache');
    expect(cachedHit(c.main)?.license.id).toBe('ISC');
  });

  it('refuses an HTML page served instead of the file, and leaves nothing behind', async () => {
    useFixtures([[...ICONIFY], [/\.svg$/, '<!DOCTYPE html><html><body>Rate limited</body></html>']]);
    await expect(toCache('iconify:lucide:rocket')).rejects.toThrow(/HTML page/);
    expect(fs.existsSync(path.join(home, '_tmp')) ? fs.readdirSync(path.join(home, '_tmp')) : []).toEqual([]);
  });

  it('refuses icon sets off the license allowlist before downloading', async () => {
    const seen = useFixtures([[...ICONIFY]]);
    const gpl = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../fixtures/assets/iconify-collections.json'), 'utf8'));
    const prefix = Object.keys(gpl).find((k) => /GPL|NC/.test(gpl[k].license?.spdx ?? ''));
    if (!prefix) return; // the trimmed fixture has none: covered in assets-keyless
    await expect(toCache(`iconify:${prefix}:x`)).rejects.toThrow(/not fetched/);
    expect(seen.urls.some((u) => u.endsWith('.svg'))).toBe(false);
  });

  it('an ambientCG texture: ZIP unpacked, color map first, other maps kept, the preview render dropped', async () => {
    const zipBuf = storedZip([
      { name: 'Paper006_1K-JPG_Color.jpg', data: JPG },
      { name: 'Paper006_1K-JPG_Roughness.jpg', data: JPG },
      { name: 'Paper006.png', data: PNG },
      { name: 'Paper006_1K-JPG.usda', data: Buffer.from('#usda 1.0') },
    ]);
    useFixtures([[/ambientcg\.com\/api\/v2\/full_json/, 'ambientcg-paper.json'], [/ambientcg\.com\/get\?file=Paper006_1K-JPG\.zip/, zipBuf]]);
    const c = await toCache('ambientcg:Paper006', { variant: '1k-jpg' });
    expect(path.basename(c.main)).toBe('Paper006_1K-JPG_Color.jpg');
    expect(c.files.map((f) => path.basename(f))).toEqual(['Paper006_1K-JPG_Roughness.jpg']);
  });

  it('refuses a variant over the size cap for its kind', async () => {
    useFixtures([[/ambientcg\.com\/api\/v2\/full_json/, 'ambientcg-paper.json']]);
    const cap = MAX_BYTES.texture;
    MAX_BYTES.texture = 1000;
    try { await expect(toCache('ambientcg:Paper006', { variant: '1k-jpg' })).rejects.toThrow(/over the 0 MB cap|cap for texture/); }
    finally { MAX_BYTES.texture = cap; }
  });

  it('an unsaved project keeps the file in the cache, says so, and credits it in the unsaved folder', async () => {
    useFixtures([[...ICONIFY], [/\.svg$/, EVIL_SVG]]);
    const r = await fetchAsset('iconify:lucide:rocket', { projectDir: null });
    expect(r.inProject).toBe(false);
    expect(r.file.startsWith(home)).toBe(true);
    expect(r.notes.join(' ')).toMatch(/isn't saved/);
    expect(creditedIds(r.credits)).toContain('iconify:lucide:rocket');
  });
});

describe('asset: refs', () => {
  it('resolve from the cache without a child process, record each ref once, and pass plain paths through', async () => {
    useFixtures([[...ICONIFY], [/\.svg$/, EVIL_SVG]]);
    const c = await toCache('iconify:lucide:rocket');
    const a = resolveAssetRef('asset:iconify:lucide:rocket');
    const b = resolveAssetRef('asset:iconify:lucide:rocket');
    expect(a.main).toBe(c.main);
    expect(b).toBe(a);
    expect(resolvedRefs()).toHaveLength(1);
    expect(resolveSrc('logo.svg', 'E:/scene')).toBe(path.resolve('E:/scene', 'logo.svg'));
  });

  it('the build copies refs into the project, points the IR at the copies and credits next to project and scene', async () => {
    useFixtures([[...ICONIFY], [/\.svg$/, EVIL_SVG]]);
    const c = await toCache('iconify:lucide:rocket');
    const ref = resolveAssetRef('asset:iconify:lucide:rocket');
    const scene = fs.mkdtempSync(path.join(os.tmpdir(), 'aec-scene-'));
    const ir = { assets: [{ id: 'asset.rocket_svg', path: c.main.toUpperCase() }] }; // case and slashes differ on Windows
    const placed = placeSceneAssets([{ ir }], [ref, ref], { projectDir: project, sceneDir: scene });
    expect(placed.assets).toHaveLength(1);
    expect(placed.assets[0].inProject).toBe(true);
    if (process.platform === 'win32') expect(ir.assets[0].path).toBe(placed.assets[0].file);
    expect(creditedIds(path.join(project, 'CREDITS.md'))).toEqual(['iconify:lucide:rocket']);
    expect(creditedIds(path.join(scene, 'CREDITS.md'))).toEqual(['iconify:lucide:rocket']);
    const unsaved = placeSceneAssets([{ ir: { assets: [] } }], [ref], { projectDir: null });
    expect(unsaved.warnings.join(' ')).toMatch(/isn't saved/);
  });
});

describe('review fixes (Phase 6 reviewer)', () => {
  const TTF = Buffer.concat([Buffer.from('0001000000', 'hex'), Buffer.alloc(200)]);
  const fontRoutes = () => {
    const base = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../fixtures/assets/fontsource-space-grotesk.json'), 'utf8'));
    const meta = fs.readFileSync(path.resolve(__dirname, '../fixtures/assets/googlefonts-spacegrotesk-METADATA.pb'), 'utf8')
      .replace('date_added: "2020-10-07"\n', 'date_added: "2020-10-07"\nfonts {\n  name: "Space Grotesk"\n  style: "italic"\n  weight: 400\n  filename: "SpaceGrotesk-Italic[wght].ttf"\n  post_script_name: "SpaceGrotesk-LightItalic"\n}\n');
    return useFixtures([
      [/api\.fontsource\.org\/v1\/fonts\/space-grotesk$/, () => Buffer.from(JSON.stringify(base))],
      [/METADATA\.pb$/, () => Buffer.from(meta)],
      [/\.ttf$/, TTF],
    ]);
  };

  it('a multi-file variant (a font family) keeps every file, each checked by content', async () => {
    fontRoutes();
    const c = await toCache('fontsource:space-grotesk', { variant: 'full' });
    expect(path.extname(c.main)).toBe('.ttf');
    expect(c.files.map((f) => path.basename(f))).toEqual(['SpaceGrotesk-Italic[wght].ttf']);
    expect(fs.existsSync(c.files[0])).toBe(true);
  });

  it('cache lookups: loose spelling hits, and without a variant only the default does', async () => {
    fontRoutes();
    await toCache('fontsource:space-grotesk', { variant: '700' });
    expect(fromCache('FONTSOURCE:Space-Grotesk', '70')?.variant.label).toBe('700'); // case + prefix
    expect(fromCache('fontsource:space-grotesk')).toBeUndefined(); // the default ("full") isn't cached yet
    await toCache('fontsource:space-grotesk', { variant: 'full' });
    expect(fromCache('fontsource:space-grotesk')?.variant.label).toBe('full');
  });

  it('concurrent fetches of one asset share one download', async () => {
    const seen = fontRoutes();
    const [a, b] = await Promise.all([toCache('fontsource:space-grotesk', { variant: '700' }), toCache('fontsource:space-grotesk', { variant: '700' })]);
    expect(a.main).toBe(b.main);
    expect(seen.urls.filter((u) => /latin-700-normal\.ttf$/.test(u))).toHaveLength(1);
  });

  it('only the local source may hand in file: URLs', async () => {
    const { iconify } = await import('@ae-mcp/core/assets/adapters/iconify.ts');
    const real = iconify.get;
    iconify.get = async (id, ctx) => ({ ...(await real.call(iconify, id, ctx)), variants: [{ label: 'svg', format: 'svg', url: 'file://evil.host/share/x.svg' }] });
    try {
      useFixtures([[...ICONIFY]]);
      await expect(toCache('iconify:lucide:rocket')).rejects.toThrow(/file: URL from iconify/);
    } finally { iconify.get = real; }
  });

  it('fetch results carry the license and its flags; cc0 mode refuses local files; credit lines stay on one line', async () => {
    const { licenseRefusal, normalizeLicense } = await import('@ae-mcp/core/assets/license.ts');
    const { creditLine } = await import('@ae-mcp/core/assets/credits.ts');
    useFixtures([[...ICONIFY], [/\.svg$/, EVIL_SVG]]);
    const r = await fetchAsset('iconify:lucide:rocket', { projectDir: project });
    expect(r.license).toBe('ISC');
    expect(r.flags).toEqual([]);
    expect(licenseRefusal({ id: 'local', url: '', commercial: true, attribution: false }, 'cc0')).toMatch(/unknown license/);
    expect(creditLine({ title: 'Two\nlines', author: 'A\r\nB', source: 'openverse', license: normalizeLicense('cc0') })).not.toMatch(/\n/);
  });
});
