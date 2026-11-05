// Packs a .gltf with external .bin and image files (how Poly Haven ships models) into one self-contained .glb, so
// the model is a single file in the project: After Effects' Collect Files and moved project folders keep it whole.
// The .gltf and its files are untrusted downloads: URIs must be relative and stay inside the .gltf's folder
// (or be data: URIs); http(s), file: and absolute paths are refused.
import fs from 'node:fs';
import path from 'node:path';

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const CHUNK_BIN = 0x004e4942; // "BIN\0"

export interface PackResult {
  file: string;
  bytes: number;
  jsonBytes: number;
  binBytes: number;
  buffers: number;
  images: number;
}

const pad4 = (n: number) => (n + 3) & ~3;

/** "image/png" etc. from the first bytes, or null. */
export function imageMime(b: Buffer): string | null {
  if (b.length >= 8 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (b.length >= 12 && b.subarray(0, 12).equals(Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/ktx2';
  return null;
}

function dataUri(uri: string): Buffer {
  const m = /^data:([^,]*?),(.*)$/s.exec(uri);
  if (!m) throw new Error('malformed data: URI');
  return /;base64$/i.test(m[1]) ? Buffer.from(m[2], 'base64') : Buffer.from(decodeURIComponent(m[2]), 'latin1');
}

/**
 * Loads a buffer or image URI relative to `dir`. Refuses remote and absolute URIs and anything resolving outside
 * `dir` (also through links). `budget` caps the bytes read.
 */
function loadUri(uri: string, dir: string, realDir: string, what: string, budget: number): { bytes: Buffer; file?: string } {
  if (/^data:/i.test(uri)) return { bytes: dataUri(uri) };
  if (/^[a-z][a-z0-9+.-]*:/i.test(uri) && !/^[a-z]:[\\/]/i.test(uri)) throw new Error(`${what}: refusing URI "${uri}" (only relative paths and data: URIs)`);
  let rel: string;
  try { rel = decodeURIComponent(uri.split(/[?#]/)[0]); } catch { rel = uri; }
  if (path.isAbsolute(rel) || /^[a-z]:/i.test(rel) || /^[\\/]/.test(rel)) throw new Error(`${what}: refusing absolute path "${uri}"`);
  const file = path.resolve(dir, rel);
  const r = path.relative(dir, file);
  if (!r || r.startsWith('..') || path.isAbsolute(r)) throw new Error(`${what}: "${uri}" is outside the glTF's folder`);
  const real = fs.realpathSync(file);
  const rr = path.relative(realDir, real);
  if (!rr || rr.startsWith('..') || path.isAbsolute(rr)) throw new Error(`${what}: "${uri}" links outside the glTF's folder`);
  const st = fs.statSync(real);
  if (!st.isFile()) throw new Error(`${what}: "${uri}" is not a file`);
  if (st.size > budget) throw new Error(`${what}: "${uri}" is ${(st.size / 1e6).toFixed(1)} MB, over the size cap`);
  return { bytes: fs.readFileSync(real), file: real };
}

/**
 * Packs `gltfFile` (with its external buffers and images) into one `.glb` at `outFile`: every buffer and image
 * goes into a single BIN chunk (4-byte aligned pieces), bufferViews are shifted onto it, images become bufferViews
 * with a sniffed mimeType. Throws when the result would exceed `maxBytes` (default 500 MB).
 */
export function packGltf(gltfFile: string, outFile: string, opts: { maxBytes?: number } = {}): PackResult {
  const maxBytes = opts.maxBytes ?? 500e6;
  const dir = path.dirname(path.resolve(gltfFile));
  const realDir = fs.realpathSync(dir);
  const gltf = JSON.parse(fs.readFileSync(gltfFile, 'utf8').replace(/^﻿/, ''));
  if (typeof gltf !== 'object' || !gltf || String(gltf.asset?.version ?? '').split('.')[0] !== '2') throw new Error('not a glTF 2.0 file (asset.version)');
  if ((gltf.extensionsUsed ?? []).includes('EXT_meshopt_compression')) throw new Error('EXT_meshopt_compression is not supported (its fallback buffers have no data)');

  const pieces: Buffer[] = [];
  let binLen = 0;
  const add = (b: Buffer) => {
    const at = binLen;
    pieces.push(b);
    const padded = pad4(b.length);
    if (padded > b.length) pieces.push(Buffer.alloc(padded - b.length));
    binLen += padded;
    if (binLen > maxBytes) throw new Error(`packed model would exceed ${(maxBytes / 1e6).toFixed(0)} MB`);
    return at;
  };

  // Buffers, in order: each one's start in the BIN chunk.
  const buffers: any[] = gltf.buffers ?? [];
  const starts = buffers.map((b, i) => {
    if (typeof b.uri !== 'string') throw new Error(`buffers[${i}] has no uri (a .gltf's buffers must point at data)`);
    const { bytes } = loadUri(b.uri, dir, realDir, `buffers[${i}]`, maxBytes);
    const n = Number(b.byteLength);
    if (!Number.isInteger(n) || n < 0) throw new Error(`buffers[${i}]: bad byteLength`);
    if (bytes.length < n) throw new Error(`buffers[${i}]: "${String(b.uri).slice(0, 60)}" has ${bytes.length} bytes, byteLength says ${n}`);
    return add(bytes.subarray(0, n));
  });

  const views: any[] = gltf.bufferViews ?? [];
  for (const [i, v] of views.entries()) {
    if (!Number.isInteger(v.buffer) || v.buffer < 0 || v.buffer >= starts.length) throw new Error(`bufferViews[${i}]: bad buffer index`);
    const off = v.byteOffset ?? 0;
    if (off + v.byteLength > Number(buffers[v.buffer].byteLength)) throw new Error(`bufferViews[${i}] runs past its buffer`);
    v.byteOffset = starts[v.buffer] + off;
    v.buffer = 0;
  }

  // Images with a uri become bufferViews (one per distinct file).
  const images: any[] = gltf.images ?? [];
  const viewOf = new Map<string, { view: number; mime: string }>();
  let packedImages = 0;
  images.forEach((img, i) => {
    if (typeof img.uri !== 'string') return; // already in a bufferView
    const { bytes, file } = loadUri(img.uri, dir, realDir, `images[${i}]`, maxBytes);
    const key = file ?? `data:${i}`;
    let hit = viewOf.get(key);
    if (!hit) {
      const mime = imageMime(bytes) ?? (typeof img.mimeType === 'string' ? img.mimeType : null);
      if (!mime) throw new Error(`images[${i}]: "${String(img.uri).slice(0, 60)}" is not PNG, JPEG, WebP or KTX2`);
      const at = add(bytes);
      views.push({ buffer: 0, byteOffset: at, byteLength: bytes.length });
      hit = { view: views.length - 1, mime };
      viewOf.set(key, hit);
    }
    images[i] = { bufferView: hit.view, mimeType: hit.mime, ...(img.name !== undefined ? { name: img.name } : {}), ...(img.extensions ? { extensions: img.extensions } : {}), ...(img.extras !== undefined ? { extras: img.extras } : {}) };
    packedImages++;
  });
  if (views.length) gltf.bufferViews = views;
  if (images.length) gltf.images = images;
  if (binLen > 0) gltf.buffers = [{ byteLength: binLen }];
  else delete gltf.buffers;

  const json = Buffer.from(JSON.stringify(gltf), 'utf8');
  const jsonPadded = pad4(json.length);
  const total = 12 + 8 + jsonPadded + (binLen > 0 ? 8 + binLen : 0);
  if (total > maxBytes) throw new Error(`packed model would be ${(total / 1e6).toFixed(1)} MB, over ${(maxBytes / 1e6).toFixed(0)} MB`);

  const head = Buffer.alloc(12 + 8);
  head.writeUInt32LE(GLB_MAGIC, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(total, 8);
  head.writeUInt32LE(jsonPadded, 12);
  head.writeUInt32LE(CHUNK_JSON, 16);
  const parts: Buffer[] = [head, json, Buffer.alloc(jsonPadded - json.length, 0x20)];
  if (binLen > 0) {
    const binHead = Buffer.alloc(8);
    binHead.writeUInt32LE(binLen, 0);
    binHead.writeUInt32LE(CHUNK_BIN, 4);
    parts.push(binHead, ...pieces);
  }
  const out = Buffer.concat(parts, total);
  const dest = path.resolve(outFile);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.${Date.now().toString(36)}.part`;
  fs.writeFileSync(tmp, out);
  try { fs.renameSync(tmp, dest); } catch (err) { fs.rmSync(tmp, { force: true }); throw err; }
  return { file: dest, bytes: total, jsonBytes: jsonPadded, binBytes: binLen, buffers: buffers.length, images: packedImages };
}

/** Parses a GLB: header checks, the JSON chunk and the BIN chunk (if any). */
export function readGlb(buf: Buffer): { json: any; bin?: Buffer; version: number; length: number } {
  if (buf.length < 20 || buf.readUInt32LE(0) !== GLB_MAGIC) throw new Error('not a GLB (no glTF magic)');
  const version = buf.readUInt32LE(4);
  const length = buf.readUInt32LE(8);
  if (version !== 2) throw new Error(`GLB version ${version} (only 2)`);
  if (length > buf.length) throw new Error(`GLB says ${length} bytes, file has ${buf.length}`);
  const jsonLen = buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== CHUNK_JSON || 20 + jsonLen > length) throw new Error('GLB: first chunk is not JSON');
  const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen).replace(/[\s\0]+$/, ''));
  let bin: Buffer | undefined;
  const at = 20 + jsonLen;
  if (at + 8 <= length) {
    const binLen = buf.readUInt32LE(at);
    if (buf.readUInt32LE(at + 4) === CHUNK_BIN) {
      if (at + 8 + binLen > length) throw new Error('GLB: BIN chunk runs past the end');
      bin = buf.subarray(at + 8, at + 8 + binLen);
    }
  }
  return { json, bin, version, length };
}

/** The JSON of a GLB. */
export const readGlbJson = (buf: Buffer): any => readGlb(buf).json;

/** URIs a .gltf/.glb still needs from outside the file (data: URIs don't count). */
export function externalUris(file: string): string[] {
  const buf = fs.readFileSync(file);
  const json = buf.length >= 4 && buf.readUInt32LE(0) === GLB_MAGIC ? readGlbJson(buf) : JSON.parse(buf.toString('utf8').replace(/^﻿/, ''));
  return [...(json.buffers ?? []), ...(json.images ?? [])]
    .map((x: any) => x?.uri)
    .filter((u: unknown): u is string => typeof u === 'string' && !/^data:/i.test(u));
}

/** True when the model is one file: a GLB (or glTF) whose buffers and images are all embedded. */
export const isSelfContained = (file: string): boolean => externalUris(file).length === 0;
