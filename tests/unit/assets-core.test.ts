// Asset core (Phase 6): license allowlist, credit lines and CREDITS.md, the LRU download cache, type checks on
// downloads, SVG sanitizing, `asset:` refs, key redaction and the polite HTTP layer. No network.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeLicense, licenseRefusal, licenseLabel, licenseFlags } from '../../src/assets/license.ts';
import { appendCredit, creditLine, creditedIds, creditEntry } from '../../src/assets/credits.ts';
import { cacheStats, evict, lookup, lookupAny, record, entryDir } from '../../src/assets/cache.ts';
import { sniff, sameFamily, sanitizeSvg } from '../../src/assets/sniff.ts';
import { parseAssetRef, isAssetRef } from '../../src/assets/resolve.ts';
import { redact, apiKey } from '../../src/assets/config.ts';
import { getJson, request, setTransport } from '../../src/assets/http.ts';
import { fontNames } from '../../src/assets/fonts.ts';
import { tempAssetHome, useFixtures } from './assets-fixtures.ts';
import type { AssetHit } from '../../src/assets/types.ts';

const hit = (o: Partial<AssetHit> = {}): AssetHit => ({
  id: 'polyhaven:rubber_duck_toy', source: 'polyhaven', kind: 'model', title: 'Rubber Duck Toy', tags: [], preview: '', page: 'https://polyhaven.com/a/rubber_duck_toy',
  license: normalizeLicense('cc0'), credit: '"Rubber Duck Toy" by Plat251, Poly Haven (https://polyhaven.com/a/rubber_duck_toy), CC0 1.0.', variants: [], ...o,
});

describe('license allowlist', () => {
  it('normalizes the spellings sources use', () => {
    expect(normalizeLicense('by-sa', '2.0').id).toBe('CC-BY-SA-2.0');
    expect(normalizeLicense('CC-BY-4.0').id).toBe('CC-BY-4.0');
    expect(normalizeLicense('cc0').id).toBe('CC0-1.0');
    expect(normalizeLicense('OFL').id).toBe('OFL-1.1');
    expect(normalizeLicense('Apache-2.0').id).toBe('Apache-2.0');
    expect(normalizeLicense('pdm').id).toBe('PDM');
    expect(normalizeLicense('by-nc-sa', '4.0').id).toBe('CC-BY-NC-SA-4.0');
  });
  it('allows CC0, PD, MIT, ISC, Apache, OFL, CC BY, Pexels, Pixabay, Unsplash; refuses NC, ND, GPL', () => {
    for (const ok of ['cc0', 'pdm', 'MIT', 'ISC', 'Apache-2.0', 'OFL-1.1', 'CC-BY-4.0', 'by-sa', 'pexels', 'pixabay', 'unsplash']) expect(licenseRefusal(normalizeLicense(ok)), ok).toBeNull();
    expect(licenseRefusal(normalizeLicense('CC-BY-NC-4.0'))).toMatch(/commercial/);
    expect(licenseRefusal(normalizeLicense('by-nd', '4.0'))).toMatch(/NoDerivatives/);
    expect(licenseRefusal(normalizeLicense('GPL-3.0'))).toMatch(/allowlist/);
    expect(licenseRefusal(normalizeLicense('MPL-2.0'))).toMatch(/allowlist/);
  });
  it("'cc0' mode keeps only public domain", () => {
    expect(licenseRefusal(normalizeLicense('cc0'), 'cc0')).toBeNull();
    expect(licenseRefusal(normalizeLicense('MIT'), 'cc0')).toMatch(/public domain/);
    expect(licenseRefusal(normalizeLicense('pexels'), 'cc0')).toMatch(/public domain/);
  });
  it('flags ShareAlike and trademarks', () => {
    const sa = normalizeLicense('by-sa', '4.0');
    expect(sa.shareAlike).toBe(true);
    expect(licenseFlags(sa)[0]).toMatch(/ShareAlike/);
    expect(licenseFlags({ ...normalizeLicense('cc0'), trademark: true })[0]).toMatch(/Trademark/);
    expect(licenseLabel(sa)).toBe('CC BY-SA 4.0');
  });
});

describe('credits', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aec-credits-')); });
  it('formats a credit line', () => {
    expect(creditLine({ title: 'Deep "Whoosh"', author: 'Kinoton', source: 'freesound', via: 'Openverse', page: 'https://freesound.org/s/1', license: normalizeLicense('cc0') }))
      .toBe(`"Deep 'Whoosh'" by Kinoton, freesound via Openverse (https://freesound.org/s/1), CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/).`);
  });
  it('appends one line per asset id, merging file lists, and lists the ids', () => {
    const a = appendCredit(dir, hit(), ['footage/polyhaven/rubber_duck_toy/rubber_duck_toy_1k.glb']);
    expect(a.added).toBe(true);
    const b = appendCredit(dir, hit(), ['footage/polyhaven/rubber_duck_toy/rubber_duck_toy_2k.glb']);
    expect(b.added).toBe(false);
    appendCredit(dir, hit({ id: 'iconify:lucide:rocket', license: { ...normalizeLicense('ISC'), trademark: false } }), []);
    const text = fs.readFileSync(path.join(dir, 'CREDITS.md'), 'utf8');
    expect(text.startsWith('# Credits')).toBe(true);
    expect(text.match(/\[polyhaven:rubber_duck_toy\]/g)).toHaveLength(1);
    expect(text).toContain('rubber_duck_toy_1k.glb');
    expect(text).toContain('rubber_duck_toy_2k.glb');
    expect(creditedIds(path.join(dir, 'CREDITS.md'))).toEqual(['polyhaven:rubber_duck_toy', 'iconify:lucide:rocket']);
  });
  it('writes the flags into the line', () => {
    expect(creditEntry(hit({ license: normalizeLicense('by-sa', '2.0') }), [])).toMatch(/\*\*ShareAlike/);
  });
  it('keeps adapter hints out, and backticks in them out of the merged file list', () => {
    const h = hit({ notes: ['outline icon: draws on with `draw`'] });
    expect(creditEntry(h, ['a.glb'])).not.toMatch(/draws on/);
    appendCredit(dir, h, ['footage/a.glb']);
    appendCredit(dir, h, ['footage/b.glb']);
    const line = fs.readFileSync(path.join(dir, 'CREDITS.md'), 'utf8').split('\n').find((l) => l.endsWith('[polyhaven:rubber_duck_toy]'))!;
    expect(line).toMatch(/Files: `footage\/a\.glb`, `footage\/b\.glb`\. \[/);
    expect(fs.readFileSync(path.join(dir, 'CREDITS.md'), 'utf8')).toMatch(/\.\n\n- /); // a blank line after the header
  });
});

describe('download cache (LRU, cap)', () => {
  let home: string;
  beforeEach(() => { home = tempAssetHome(); });
  const put = (id: string, bytes: number, used: number) => {
    const d = path.join(home, entryDir(id, 'v'));
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'f.bin'), Buffer.alloc(bytes));
    const e = record(id, 'v', 'f.bin', [], 'x');
    const ix = JSON.parse(fs.readFileSync(path.join(home, 'index.json'), 'utf8'));
    ix.entries[e.key].lastUsed = used;
    fs.writeFileSync(path.join(home, 'index.json'), JSON.stringify(ix));
    return d;
  };
  it('evicts least recently used entries first, only inside the cache, never the kept one', () => {
    const outside = path.join(os.tmpdir(), 'aec-outside-' + Date.now());
    fs.writeFileSync(outside, 'keep me');
    const a = put('t:a', 4000, 1), b = put('t:b', 4000, 3), c = put('t:c', 4000, 2);
    // A forged entry pointing outside the cache root must never be deleted.
    const ix = JSON.parse(fs.readFileSync(path.join(home, 'index.json'), 'utf8'));
    ix.entries['t:x@v'] = { key: 't:x@v', dir: path.relative(home, path.dirname(outside)), main: path.basename(outside), files: [], bytes: 1, sha256: '', fetchedAt: 0, lastUsed: 0 };
    fs.writeFileSync(path.join(home, 'index.json'), JSON.stringify(ix));
    const out = evict(['t:a@v'], 8500);
    expect(out).toEqual(['t:c@v']);
    expect(fs.existsSync(a)).toBe(true);
    expect(fs.existsSync(b)).toBe(true);
    expect(fs.existsSync(c)).toBe(false);
    expect(fs.existsSync(outside)).toBe(true);
    expect(cacheStats().entries).toBe(2);
    fs.rmSync(outside);
  });
  it('lookup touches entries and drops ones whose files vanished', () => {
    const d = put('t:a', 10, 1);
    expect(lookup('t:a', 'v')?.lastUsed).toBeGreaterThan(1);
    expect(lookupAny('t:a')?.key).toBe('t:a@v');
    fs.rmSync(d, { recursive: true });
    expect(lookup('t:a', 'v')).toBeUndefined();
  });
});

describe('type checks on downloads', () => {
  const b = (hex: string, tail = '') => Buffer.concat([Buffer.from(hex, 'hex'), Buffer.from(tail)]);
  it('recognizes formats by content', () => {
    expect(sniff(b('ffd8ffe000104a46')).format).toBe('jpg');
    expect(sniff(b('89504e470d0a1a0a')).format).toBe('png');
    expect(sniff(Buffer.from('#?RADIANCE\nFORMAT=32-bit_rle_rgbe')).format).toBe('hdr');
    expect(sniff(b('762f3101')).format).toBe('exr');
    expect(sniff(b('000000206674797069736f6d')).format).toBe('mp4');
    expect(sniff(b('0000001c667479706176696600')).format).toBe('avif');
    expect(sniff(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')).format).toBe('webp');
    expect(sniff(Buffer.from('ID3\x04\0\0')).format).toBe('mp3');
    expect(sniff(Buffer.from('OggS\0\x02')).format).toBe('ogg');
    expect(sniff(Buffer.from('fLaC\0\0')).format).toBe('flac');
    expect(sniff(Buffer.from('glTF\x02\0\0\0')).format).toBe('glb');
    expect(sniff(Buffer.from('{\n  "asset": {"version": "2.0"}}')).format).toBe('gltf');
    expect(sniff(b('504b0304')).format).toBe('zip');
    expect(sniff(b('00010000000f0080')).format).toBe('ttf');
    expect(sniff(Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>')).format).toBe('svg');
  });
  it('refuses executables, scripts and HTML pages', () => {
    expect(sniff(Buffer.from('MZ\x90\0\x03')).refused).toMatch(/executable/);
    expect(sniff(Buffer.from('\x7fELF\x02\x01')).refused).toMatch(/ELF/);
    expect(sniff(Buffer.from('#!/bin/sh\nrm -rf /')).refused).toMatch(/script/);
    expect(sniff(Buffer.from('<!DOCTYPE html><html><body>Sign in</body></html>')).refused).toMatch(/HTML/);
    expect(sniff(Buffer.from('random bytes here')).refused).toMatch(/unknown/);
  });
  it('matches the promised format by family', () => {
    expect(sameFamily('jpeg', 'jpg')).toBe(true);
    expect(sameFamily('mp4', 'mov')).toBe(true);
    expect(sameFamily('hdr', 'jpg')).toBe(false);
    expect(sameFamily('mp4', 'webm')).toBe(false);
  });
  it('strips active content from SVGs but keeps geometry and local refs', () => {
    const s = sanitizeSvg('<svg onload="x()"><script>alert(1)</script><a href="https://evil"><path d="M0 0L1 1" fill="url(#g)"/></a><use href="#p"/><image href="http://x/y.png"/><foreignObject><div/></foreignObject><rect style="fill:url(http://x/a.svg#q)"/></svg>');
    expect(s).not.toMatch(/script|onload|evil|foreignObject|http:/);
    expect(s).toContain('<path d="M0 0L1 1" fill="url(#g)"/>');
    expect(s).toContain('<use href="#p"/>');
  });
});

describe('asset: refs', () => {
  it('parses ids and variants', () => {
    expect(isAssetRef('asset:pexels:12345')).toBe(true);
    expect(isAssetRef('footage/a.mp4')).toBe(false);
    expect(parseAssetRef('asset:iconify:lucide:rocket')).toEqual({ id: 'iconify:lucide:rocket', variant: undefined });
    expect(parseAssetRef('asset:polyhaven:brown_photostudio_02@1k-hdr')).toEqual({ id: 'polyhaven:brown_photostudio_02', variant: '1k-hdr' });
    expect(parseAssetRef('asset:pixabay:video:123@720p')).toEqual({ id: 'pixabay:video:123', variant: '720p' });
    expect(() => parseAssetRef('asset:rocket')).toThrow(/asset:<source>:<id>/);
  });
});

describe('keys and HTTP', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; setTransport(null); });
  it('reads keys from the environment and redacts them everywhere', () => {
    process.env.AEC_KEYS_FILE = path.join(os.tmpdir(), 'no-such-keys.json');
    process.env.AEC_PIXABAY_KEY = 'pxb-secret-123456';
    expect(apiKey('pixabay')).toBe('pxb-secret-123456');
    expect(redact('https://pixabay.com/api/?key=pxb-secret-123456&q=x failed')).toBe('https://pixabay.com/api/?key=***&q=x failed');
    expect(redact('Authorization pxb-secret-123456')).toBe('Authorization ***');
    expect(redact('https://api.x/?access_token=abc&q=1')).toBe('https://api.x/?access_token=***&q=1');
  });
  it('reads keys.json', () => {
    const f = path.join(os.tmpdir(), `keys-${Date.now()}.json`);
    fs.writeFileSync(f, JSON.stringify({ unsplash: '  us-key-abcdef ', pexels: '' }));
    process.env.AEC_KEYS_FILE = f;
    delete process.env.AEC_UNSPLASH_KEY; delete process.env.UNSPLASH_ACCESS_KEY; delete process.env.AEC_PEXELS_KEY; delete process.env.PEXELS_API_KEY;
    expect(apiKey('unsplash')).toBe('us-key-abcdef');
    expect(apiKey('pexels')).toBeUndefined();
    fs.rmSync(f);
  });
  it('refuses the network in unit tests', async () => {
    setTransport(null);
    await expect(request('https://api.iconify.design/collections', { source: 'iconify' })).rejects.toThrow(/network disabled/);
  });
  it('sends the ae-compose User-Agent, caches responses for 24 h, never stores the key, retries a 429 once', async () => {
    const home = tempAssetHome();
    process.env.AEC_PIXABAY_KEY = 'pxb-secret-123456';
    let n = 0;
    const seen = useFixtures([[/pixabay\.com\/api/, (u) => (n++ === 0 ? { status: 429, headers: { 'retry-after': '0.01' }, body: Buffer.from('') } : 'pixabay-images-mountains.json')]]);
    const url = 'https://pixabay.com/api/?key=pxb-secret-123456&q=mountain';
    const a = await getJson(url, { source: 'pixabay' });
    const b = await getJson(url, { source: 'pixabay' });
    expect(a.hits.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
    expect(seen.urls).toHaveLength(2); // the 429, the retry; then the cache
    expect(seen.headers[0]['User-Agent']).toMatch(/^ae-compose\/v?\d/);
    const stored = fs.readdirSync(path.join(home, '_responses', 'pixabay'));
    expect(stored).toHaveLength(1);
    expect(JSON.stringify(stored)).not.toContain('pxb-secret');
  });
  it('turns errors into messages without keys', async () => {
    tempAssetHome();
    process.env.AEC_PIXABAY_KEY = 'pxb-secret-123456';
    useFixtures([[/./, () => ({ status: 500, headers: {}, body: Buffer.from('') })]]);
    await expect(request('https://pixabay.com/api/?key=pxb-secret-123456&q=x', { source: 'pixabay' })).rejects.toThrow(/key=\*\*\*/);
  });
});

describe('font names', () => {
  it('reads name and fvar tables from a font file when one is available', () => {
    const f = path.resolve(__dirname, '../../scratch/p6-probe/files/SpaceGrotesk-VF.ttf');
    if (!fs.existsSync(f)) return; // the variable font is downloaded by the Phase 6 probe, not committed
    const n = fontNames(fs.readFileSync(f));
    expect(n.family).toBe('Space Grotesk');
    expect(n.instances).toContain('SpaceGrotesk-Bold');
  });
});
