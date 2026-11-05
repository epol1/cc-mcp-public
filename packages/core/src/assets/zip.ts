// A minimal ZIP reader for downloaded archives (ambientCG ships its texture maps as one ZIP). Downloads are
// untrusted: entry names are validated before anything is written (no absolute paths, drive letters, ".."
// segments, backslashes, NTFS streams or reserved device names; one bad name refuses the whole archive), symlink
// entries are skipped, sizes and compression ratios are capped against zip bombs, every file's CRC-32 is checked,
// and files are written under a temporary name and renamed. Stored (0) and deflate (8) only; no ZIP64, no encryption.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export interface ZipEntry {
  name: string;
  /** 0 = stored, 8 = deflate; others are listed but not extracted. */
  method: number;
  compressedSize: number;
  size: number;
  crc32: number;
  flags: number;
  /** Offset of the local file header. */
  offset: number;
  isDir: boolean;
  isSymlink: boolean;
  encrypted: boolean;
}

export interface ExtractOptions {
  /** Extract only the entries this returns true for (gets the entry name). */
  filter?(name: string): boolean;
  /** At most this many files (default 64). */
  maxFiles?: number;
  /** At most this many uncompressed bytes in all (default 1.5 GB). */
  maxTotalBytes?: number;
  /** Uncompressed/compressed ratio cap for entries over 1 MiB and for the whole archive (default 200). */
  maxRatio?: number;
}

/** The written files (absolute paths), plus the entries skipped and why. */
export type ExtractResult = string[] & { skipped: { name: string; reason: string }[] };

const SIG_EOCD = 0x06054b50, SIG_CEN = 0x02014b50, SIG_LOC = 0x04034b50, SIG_Z64_LOCATOR = 0x07064b50;
const RATIO_MIN_BYTES = 1 << 20;
const utf8 = new TextDecoder('utf-8', { fatal: true });

function decodeName(b: Buffer, utf8Flag: boolean): string {
  if (utf8Flag) return b.toString('utf8');
  try { return utf8.decode(b); } catch { return b.toString('latin1'); }
}

/** Lists the archive's entries from its central directory. Throws on anything that isn't a plain ZIP. */
export function listZip(buf: Buffer): ZipEntry[] {
  if (buf.length < 22) throw new Error('not a ZIP archive (too short)');
  // The end-of-central-directory record sits in the last 22 + 65535 (comment) bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a ZIP archive (no end of central directory)');
  const disk = buf.readUInt16LE(eocd + 4), cdDisk = buf.readUInt16LE(eocd + 6);
  const countDisk = buf.readUInt16LE(eocd + 8), count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12), cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || countDisk === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff
    || (eocd >= 20 && buf.readUInt32LE(eocd - 20) === SIG_Z64_LOCATOR)) {
    throw new Error('ZIP64 archives are not supported (over 65,535 entries or 4 GB)');
  }
  if (disk !== 0 || cdDisk !== 0 || countDisk !== count) throw new Error('multi-part (spanned) ZIP archives are not supported');
  if (cdOffset + cdSize > eocd) throw new Error('corrupt ZIP: central directory outside the archive');

  const out: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CEN) throw new Error(`corrupt ZIP: bad central directory entry ${i}`);
    const madeBy = buf.readUInt16LE(p + 4);
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc32 = buf.readUInt32LE(p + 16);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const ext = buf.readUInt32LE(p + 38);
    const offset = buf.readUInt32LE(p + 42);
    if (compressedSize === 0xffffffff || size === 0xffffffff || offset === 0xffffffff) throw new Error('ZIP64 archives are not supported (an entry over 4 GB)');
    if (p + 46 + nameLen > buf.length) throw new Error(`corrupt ZIP: entry ${i} name outside the archive`);
    const name = decodeName(buf.subarray(p + 46, p + 46 + nameLen), (flags & 0x800) !== 0);
    const host = madeBy >> 8;
    const mode = ext >>> 16;
    // Unix-made entries carry the file mode in the high 16 bits; DOS attributes in the low byte (0x400 = reparse point).
    const isSymlink = (host === 3 && (mode & 0o170000) === 0o120000) || (ext & 0x400) !== 0;
    const isDir = name.endsWith('/') || (host === 3 && (mode & 0o170000) === 0o040000) || (host === 0 && (ext & 0x10) !== 0);
    out.push({ name, method, compressedSize, size, crc32, flags, offset, isDir, isSymlink, encrypted: (flags & 1) !== 0 });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

/** Why an entry name is unsafe to write under a folder, or null when it is fine. */
export function unsafeZipName(name: string): string | null {
  if (!name) return 'empty name';
  if (name.includes('\0')) return 'NUL in name';
  if (name.includes('\\')) return 'backslash in name';
  if (name.startsWith('/')) return 'absolute path';
  if (/^[a-z]:/i.test(name)) return 'drive letter';
  const segs = name.replace(/\/+$/, '').split('/');
  for (const s of segs) {
    if (s === '..') return '".." segment';
    if (s.includes(':')) return 'colon in name (drive or NTFS stream)';
    if (s !== '' && s !== '.' && /[ .]$/.test(s)) return 'name ends with a dot or space';
    if (RESERVED.test(s)) return `reserved device name "${s}"`;
    if (/[\x00-\x1f<>"|?*]/.test(s)) return 'character not allowed in Windows file names';
  }
  return null;
}

const inside = (root: string, p: string) => {
  const rel = path.relative(root, p);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

/** The entry's raw (compressed) bytes, from its local header. */
function rawData(buf: Buffer, e: ZipEntry): Buffer {
  if (e.offset + 30 > buf.length || buf.readUInt32LE(e.offset) !== SIG_LOC) throw new Error(`corrupt ZIP: no local header for "${e.name}"`);
  const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
  if (start + e.compressedSize > buf.length) throw new Error(`corrupt ZIP: data of "${e.name}" outside the archive`);
  return buf.subarray(start, start + e.compressedSize);
}

/**
 * Extracts files into `destDir` (created). Unsafe names refuse the whole archive before anything is written;
 * unsupported entries (symlinks, encryption, other methods) are skipped with a reason; caps are checked up front
 * from the declared sizes and again while inflating. On a CRC or size mismatch every file written by this call
 * is removed and the error is thrown.
 */
export function extractZip(buf: Buffer, destDir: string, opts: ExtractOptions = {}): ExtractResult {
  const maxFiles = opts.maxFiles ?? 64;
  const maxTotal = opts.maxTotalBytes ?? 1.5e9;
  const maxRatio = opts.maxRatio ?? 200;
  const entries = listZip(buf);
  const skipped: ExtractResult['skipped'] = [];
  const todo: ZipEntry[] = [];
  const seen = new Set<string>();

  for (const e of entries) {
    const bad = unsafeZipName(e.name);
    if (bad) throw new Error(`refusing ZIP: unsafe entry "${e.name}" (${bad})`);
    if (e.isDir) continue;
    if (opts.filter && !opts.filter(e.name)) continue;
    if (e.isSymlink) { skipped.push({ name: e.name, reason: 'symbolic link' }); continue; }
    if (e.encrypted) { skipped.push({ name: e.name, reason: 'encrypted' }); continue; }
    if (e.method !== 0 && e.method !== 8) { skipped.push({ name: e.name, reason: `compression method ${e.method} not supported (stored and deflate only)` }); continue; }
    if (e.method === 0 && e.compressedSize !== e.size) throw new Error(`corrupt ZIP: stored entry "${e.name}" has mismatched sizes`);
    const key = path.posix.normalize(e.name).toLowerCase();
    if (seen.has(key)) { skipped.push({ name: e.name, reason: 'duplicate name' }); continue; }
    seen.add(key);
    if (e.size > RATIO_MIN_BYTES && e.size / Math.max(1, e.compressedSize) > maxRatio) {
      throw new Error(`refusing ZIP: "${e.name}" expands ${Math.round(e.size / Math.max(1, e.compressedSize))}× (cap ${maxRatio}×; a zip bomb?)`);
    }
    todo.push(e);
  }
  if (todo.length > maxFiles) throw new Error(`refusing ZIP: ${todo.length} files to extract (cap ${maxFiles})`);
  const total = todo.reduce((s, e) => s + e.size, 0);
  if (total > maxTotal) throw new Error(`refusing ZIP: ${(total / 1e6).toFixed(1)} MB uncompressed (cap ${(maxTotal / 1e6).toFixed(1)} MB)`);
  const packed = todo.reduce((s, e) => s + e.compressedSize, 0);
  if (total > RATIO_MIN_BYTES && total / Math.max(1, packed) > maxRatio) throw new Error(`refusing ZIP: expands ${Math.round(total / Math.max(1, packed))}× in all (cap ${maxRatio}×; a zip bomb?)`);

  fs.mkdirSync(destDir, { recursive: true });
  const root = fs.realpathSync(destDir);
  const written: string[] = [];
  let budget = maxTotal;
  try {
    for (const e of todo) {
      const target = path.resolve(root, ...e.name.split('/').filter((s) => s && s !== '.'));
      if (!inside(root, target)) throw new Error(`refusing ZIP: "${e.name}" resolves outside the folder`);
      const raw = rawData(buf, e);
      let data: Buffer;
      if (e.method === 0) data = Buffer.from(raw);
      else {
        const cap = Math.min(e.size, budget);
        try { data = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(1, cap) }); }
        catch (err: any) {
          if (err?.code === 'ERR_BUFFER_TOO_LARGE' || err instanceof RangeError) throw new Error(`refusing ZIP: "${e.name}" inflates past its declared ${e.size} bytes`);
          throw new Error(`corrupt ZIP: "${e.name}" does not inflate (${err?.message ?? err})`);
        }
      }
      if (data.length !== e.size) throw new Error(`corrupt ZIP: "${e.name}" is ${data.length} bytes, declared ${e.size}`);
      budget -= data.length;
      if (budget < 0) throw new Error(`refusing ZIP: over ${(maxTotal / 1e6).toFixed(1)} MB uncompressed`);
      const crc = zlib.crc32(data) >>> 0;
      if (crc !== e.crc32) throw new Error(`corrupt ZIP: CRC-32 mismatch in "${e.name}"`);
      const dir = path.dirname(target);
      fs.mkdirSync(dir, { recursive: true });
      // A link planted in the destination must not carry the write elsewhere.
      const realDir = fs.realpathSync(dir);
      if (realDir !== root && !inside(root, realDir)) throw new Error(`refusing ZIP: "${e.name}" would be written outside the folder (through a link)`);
      const tmp = `${target}.${process.pid}.${Date.now().toString(36)}.part`;
      fs.writeFileSync(tmp, data, { flag: 'wx' });
      try { fs.renameSync(tmp, target); } catch (err) { fs.rmSync(tmp, { force: true }); throw err; }
      written.push(target);
    }
  } catch (err) {
    for (const f of written) fs.rmSync(f, { force: true });
    throw err;
  }
  return Object.assign(written, { skipped });
}
