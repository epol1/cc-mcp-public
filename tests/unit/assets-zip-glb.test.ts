// ZIP reader (stored/deflate, CRC, unsafe names, symlinks, caps against zip bombs, ZIP64 refused) and the glTF → GLB
// packer (one BIN chunk, shifted bufferViews, embedded images, refused URIs). Archives and models are built here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { extractZip, listZip, unsafeZipName } from '@cc-mcp/core/assets/zip.ts';
import { externalUris, imageMime, isSelfContained, packGltf, readGlb, readGlbJson } from '@cc-mcp/core/assets/glb.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aec-zipglb-'));
let n = 0;
const fresh = () => { const d = path.join(tmp, `d${n++}`); fs.mkdirSync(d); return d; };
const listFiles = (d: string): string[] => fs.readdirSync(d, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.relative(d, path.join(e.parentPath, e.name)).replace(/\\/g, '/')).sort();
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

// ── A tiny ZIP writer ────────────────────────────────────────────────────────────────────────────────────────

interface E { name: string; data?: Buffer; method?: number; madeBy?: number; ext?: number; crc?: number; size?: number; raw?: Buffer }
function zip(entries: E[], opts: { zip64?: boolean } = {}): Buffer {
  const locals: Buffer[] = [], cens: Buffer[] = [];
  let off = 0;
  for (const e of entries) {
    const data = e.data ?? Buffer.alloc(0);
    const method = e.method ?? 8;
    const comp = e.raw ?? (method === 8 ? zlib.deflateRawSync(data) : data);
    const crc = e.crc ?? zlib.crc32(data);
    const size = e.size ?? data.length;
    const name = Buffer.from(e.name, 'utf8');
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(0x800, 6); loc.writeUInt16LE(method, 8);
    loc.writeUInt32LE(crc >>> 0, 14); loc.writeUInt32LE(comp.length, 18); loc.writeUInt32LE(size, 22); loc.writeUInt16LE(name.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(e.madeBy ?? 20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x800, 8); cen.writeUInt16LE(method, 10);
    cen.writeUInt32LE(crc >>> 0, 16); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(size, 24); cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE((e.ext ?? 0) >>> 0, 38); cen.writeUInt32LE(off, 42);
    locals.push(loc, name, comp);
    cens.push(cen, name);
    off += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(cens);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(opts.zip64 ? 0xffff : entries.length, 8); end.writeUInt16LE(opts.zip64 ? 0xffff : entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}

const color = Buffer.from('fake jpeg bytes '.repeat(200));
const normal = Buffer.from(Array.from({ length: 3000 }, (_, i) => (i * 31) % 251));

describe('listZip / extractZip', () => {
  it('lists and extracts stored and deflated files into subfolders', () => {
    const buf = zip([
      { name: 'Wood049_1K-JPG/', data: Buffer.alloc(0), method: 0 },
      { name: 'Wood049_1K-JPG/Wood049_1K-JPG_Color.jpg', data: color, method: 8 },
      { name: 'Wood049_1K-JPG/Wood049_1K-JPG_NormalGL.jpg', data: normal, method: 0 },
      { name: 'Wood049.png', data: Buffer.from('preview'), method: 0 },
    ]);
    const list = listZip(buf);
    expect(list.map((e) => [e.name, e.method, e.size, e.isDir])).toEqual([
      ['Wood049_1K-JPG/', 0, 0, true],
      ['Wood049_1K-JPG/Wood049_1K-JPG_Color.jpg', 8, color.length, false],
      ['Wood049_1K-JPG/Wood049_1K-JPG_NormalGL.jpg', 0, normal.length, false],
      ['Wood049.png', 0, 7, false],
    ]);
    expect(list[1].compressedSize).toBeLessThan(color.length);
    const d = fresh();
    const out = extractZip(buf, d);
    expect(out.length).toBe(3);
    expect(out.skipped).toEqual([]);
    expect(out.every((p) => path.isAbsolute(p) && fs.existsSync(p))).toBe(true);
    expect(fs.readFileSync(path.join(d, 'Wood049_1K-JPG', 'Wood049_1K-JPG_Color.jpg')).equals(color)).toBe(true);
    expect(fs.readFileSync(path.join(d, 'Wood049_1K-JPG', 'Wood049_1K-JPG_NormalGL.jpg')).equals(normal)).toBe(true);
    expect(listFiles(d)).toEqual(['Wood049.png', 'Wood049_1K-JPG/Wood049_1K-JPG_Color.jpg', 'Wood049_1K-JPG/Wood049_1K-JPG_NormalGL.jpg']); // no .part left
  });

  it('extracts only what the filter keeps', () => {
    const buf = zip([{ name: 'a/Color.jpg', data: color }, { name: 'a/Normal.jpg', data: normal }]);
    const d = fresh();
    const out = extractZip(buf, d, { filter: (name) => /Color/.test(name) });
    expect(out.map((p) => path.basename(p))).toEqual(['Color.jpg']);
    expect(listFiles(d)).toEqual(['a/Color.jpg']);
  });

  it('refuses the whole archive for an unsafe name, before writing anything', () => {
    for (const bad of ['../evil.txt', 'ok/../../evil.txt', '/abs.txt', 'C:/Windows/evil.txt', 'c:evil.txt', 'a\\..\\..\\evil.txt', 'a/file.txt:stream', 'a/CON.txt', 'a/trail. ']) {
      const d = fresh();
      expect(() => extractZip(zip([{ name: 'fine.txt', data: color }, { name: bad, data: color }]), d), bad).toThrow(/unsafe entry/);
      expect(listFiles(d), bad).toEqual([]);
    }
    expect(unsafeZipName('textures/wood_diff_1k.jpg')).toBeNull();
    expect(unsafeZipName('./a/b.jpg')).toBeNull();
  });

  it('skips symlinks, encrypted entries and unsupported methods with a reason', () => {
    const buf = zip([
      { name: 'link', data: Buffer.from('/etc/passwd'), method: 0, madeBy: (3 << 8) | 20, ext: (0o120777 << 16) >>> 0 },
      { name: 'bz.bin', data: color, method: 12, raw: Buffer.from('BZh9...') },
      { name: 'ok.jpg', data: color },
    ]);
    const d = fresh();
    const out = extractZip(buf, d);
    expect(out.map((p) => path.basename(p))).toEqual(['ok.jpg']);
    expect(out.skipped).toEqual([
      { name: 'link', reason: 'symbolic link' },
      { name: 'bz.bin', reason: expect.stringMatching(/method 12 not supported/) },
    ]);
    expect(listFiles(d)).toEqual(['ok.jpg']);
  });

  it('checks CRC-32 and removes what it wrote on failure', () => {
    const d = fresh();
    expect(() => extractZip(zip([{ name: 'good.jpg', data: color }, { name: 'bad.jpg', data: normal, crc: 12345 }]), d)).toThrow(/CRC-32 mismatch in "bad.jpg"/);
    expect(listFiles(d)).toEqual([]);
  });

  it('stops zip bombs: ratio, total size, file count, lying sizes', () => {
    const zeros = Buffer.alloc(5 << 20);
    expect(() => extractZip(zip([{ name: 'bomb.bin', data: zeros }]), fresh())).toThrow(/expands \d+× .*zip bomb/);
    expect(() => extractZip(zip([{ name: 'a.jpg', data: color }, { name: 'b.jpg', data: normal }]), fresh(), { maxTotalBytes: 4000 })).toThrow(/uncompressed \(cap/);
    expect(() => extractZip(zip(Array.from({ length: 5 }, (_, i) => ({ name: `f${i}.jpg`, data: color }))), fresh(), { maxFiles: 4 })).toThrow(/5 files .*cap 4/);
    // Declares 100 bytes but inflates to 3,200: inflation stops at the declared size.
    const d = fresh();
    expect(() => extractZip(zip([{ name: 'liar.jpg', data: color, size: 100 }]), d)).toThrow(/inflates past its declared 100 bytes/);
    expect(listFiles(d)).toEqual([]);
    // Within the ratio cap it extracts fine.
    expect(extractZip(zip([{ name: 'zeros.bin', data: Buffer.alloc(4096) }]), fresh()).length).toBe(1);
  });

  it('refuses ZIP64 and non-ZIP data', () => {
    expect(() => listZip(zip([{ name: 'a', data: color }], { zip64: true }))).toThrow(/ZIP64/);
    expect(() => listZip(Buffer.from('definitely not a zip file, just text'))).toThrow(/not a ZIP/);
    expect(() => listZip(Buffer.alloc(4))).toThrow(/not a ZIP/);
  });
});

// ── glTF → GLB ───────────────────────────────────────────────────────────────────────────────────────────────

const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
const indices = new Uint16Array([0, 1, 2]);
const uvs = new Float32Array([0, 0, 1, 0, 0, 1]);

/** A one-triangle glTF: positions + indices in tri.bin, UVs in a data: URI buffer, a 1×1 PNG texture in textures/. */
function makeGltf(dir: string, over: { bufferUri?: string; imageUri?: string } = {}): string {
  const bin = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(indices.buffer), Buffer.alloc(2)]); // 36 + 6 + 2 pad
  fs.writeFileSync(path.join(dir, 'tri.bin'), bin);
  fs.mkdirSync(path.join(dir, 'textures'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'textures', 'px.png'), PNG_1x1);
  const uvData = `data:application/octet-stream;base64,${Buffer.from(uvs.buffer).toString('base64')}`;
  const gltf = {
    asset: { version: '2.0', generator: 'ae-compose test' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'tri' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 2 }, indices: 1, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    textures: [{ source: 0, sampler: 0 }], samplers: [{}],
    images: [{ uri: over.imageUri ?? 'textures/px.png', name: 'px' }],
    buffers: [{ uri: over.bufferUri ?? 'tri.bin', byteLength: 44 }, { uri: uvData, byteLength: 24 }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 },
      { buffer: 0, byteOffset: 36, byteLength: 6, target: 34963 },
      { buffer: 1, byteLength: 24, target: 34962 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
      { bufferView: 2, componentType: 5126, count: 3, type: 'VEC2' },
    ],
  };
  const f = path.join(dir, 'tri.gltf');
  fs.writeFileSync(f, JSON.stringify(gltf, null, 2));
  return f;
}

/** The bytes an accessor reads (tightly packed views only). */
function accessorBytes(json: any, bin: Buffer, i: number): Buffer {
  const a = json.accessors[i];
  const v = json.bufferViews[a.bufferView];
  const comp = { 5126: 4, 5123: 2, 5125: 4 }[a.componentType as 5126]!;
  const width = { SCALAR: 1, VEC2: 2, VEC3: 3 }[a.type as 'VEC2'];
  return bin.subarray(v.byteOffset + (a.byteOffset ?? 0), v.byteOffset + (a.byteOffset ?? 0) + a.count * comp * width);
}

describe('packGltf', () => {
  it('packs buffers and images into one self-contained GLB that parses back identically', () => {
    const d = fresh();
    const src = makeGltf(d);
    expect(isSelfContained(src)).toBe(false);
    expect(externalUris(src)).toEqual(['tri.bin', 'textures/px.png']);
    const out = path.join(d, 'tri.glb');
    const r = packGltf(src, out);
    const buf = fs.readFileSync(out);
    expect(r).toMatchObject({ file: out, bytes: buf.length, buffers: 2, images: 1 });
    // Header and chunks.
    expect(buf.toString('latin1', 0, 4)).toBe('glTF');
    expect(buf.readUInt32LE(4)).toBe(2);
    expect(buf.readUInt32LE(8)).toBe(buf.length);
    const jsonLen = buf.readUInt32LE(12);
    expect(buf.toString('latin1', 16, 20)).toBe('JSON');
    expect(jsonLen % 4).toBe(0);
    const binLen = buf.readUInt32LE(20 + jsonLen);
    expect(buf.toString('latin1', 24 + jsonLen, 28 + jsonLen)).toBe('BIN\0');
    expect(binLen % 4).toBe(0);
    expect(28 + jsonLen + binLen).toBe(buf.length);
    expect(buf.length % 4).toBe(0);
    // JSON: one buffer without uri, every view on it, the image a bufferView.
    const { json, bin } = readGlb(buf);
    expect(readGlbJson(buf)).toEqual(json);
    expect(json.buffers).toEqual([{ byteLength: binLen }]);
    expect(json.bufferViews.every((v: any) => v.buffer === 0 && v.byteOffset % 4 === 0)).toBe(true);
    expect(json.images).toEqual([{ bufferView: 3, mimeType: 'image/png', name: 'px' }]);
    expect(json.bufferViews[1].target).toBe(34963);
    // Data identical.
    expect(accessorBytes(json, bin!, 0).equals(Buffer.from(positions.buffer))).toBe(true);
    expect(accessorBytes(json, bin!, 1).equals(Buffer.from(indices.buffer))).toBe(true);
    expect(accessorBytes(json, bin!, 2).equals(Buffer.from(uvs.buffer))).toBe(true);
    const iv = json.bufferViews[3];
    expect(bin!.subarray(iv.byteOffset, iv.byteOffset + iv.byteLength).equals(PNG_1x1)).toBe(true);
    expect(json.materials[0].pbrMetallicRoughness.baseColorTexture.index).toBe(0);
    expect(isSelfContained(out)).toBe(true);
    expect(fs.readdirSync(d).filter((f) => f.endsWith('.part'))).toEqual([]);
  });

  it('refuses URIs outside the folder, remote and absolute ones', () => {
    const cases: [object, RegExp][] = [
      [{ bufferUri: '../evil.bin' }, /outside the glTF's folder/],
      [{ bufferUri: 'textures/../../evil.bin' }, /outside the glTF's folder/],
      [{ imageUri: 'http://example.com/x.png' }, /refusing URI/],
      [{ imageUri: 'https://example.com/x.png' }, /refusing URI/],
      [{ bufferUri: 'file:///C:/Windows/win.ini' }, /refusing URI/],
      [{ bufferUri: 'C:/Windows/win.ini' }, /refusing absolute path/],
      [{ bufferUri: '/etc/passwd' }, /refusing absolute path/],
      [{ bufferUri: '%2E%2E/evil.bin' }, /outside the glTF's folder/],
    ];
    for (const [over, re] of cases) {
      const d = path.join(fresh(), 'model');
      fs.mkdirSync(d);
      fs.writeFileSync(path.join(d, '..', 'evil.bin'), Buffer.alloc(64));
      const src = makeGltf(d, over);
      expect(() => packGltf(src, path.join(d, 'out.glb')), JSON.stringify(over)).toThrow(re);
      expect(fs.existsSync(path.join(d, 'out.glb'))).toBe(false);
    }
  });

  it('caps the size and checks byteLength', () => {
    const d = fresh();
    const src = makeGltf(d);
    expect(() => packGltf(src, path.join(d, 'o.glb'), { maxBytes: 64 })).toThrow(/exceed|over/);
    const j = JSON.parse(fs.readFileSync(src, 'utf8'));
    j.buffers[0].byteLength = 4000;
    fs.writeFileSync(src, JSON.stringify(j));
    expect(() => packGltf(src, path.join(d, 'o.glb'))).toThrow(/byteLength says 4000/);
  });

  it('sniffs image types', () => {
    expect(imageMime(PNG_1x1)).toBe('image/png');
    expect(imageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('image/jpeg');
    expect(imageMime(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1'))).toBe('image/webp');
    expect(imageMime(Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/ktx2');
    expect(imageMime(Buffer.from('GIF89a'))).toBeNull();
  });
});
