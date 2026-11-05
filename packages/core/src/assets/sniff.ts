// Downloads are untrusted (GOAL-PHASE6 §2): a file's type comes from its bytes, never its extension or the
// server's Content-Type. Executables, scripts and HTML pages are refused outright; a format that doesn't match
// what the source promised is an error; formats vanilla AE can't import are marked for conversion (convert.ts).
export type SniffedFormat =
  | 'jpg' | 'png' | 'gif' | 'webp' | 'avif' | 'heic' | 'tiff' | 'psd' | 'exr' | 'hdr' | 'bmp'
  | 'mp4' | 'mov' | 'm4a' | 'webm' | 'avi'
  | 'mp3' | 'wav' | 'aiff' | 'ogg' | 'flac' | 'aac'
  | 'svg' | 'gltf' | 'glb' | 'obj' | 'zip' | 'ttf' | 'otf' | 'woff' | 'woff2';

export interface Sniff { format?: SniffedFormat; refused?: string }

/** Formats vanilla AE 26.5 imports directly (D92); others are converted first. */
export const AE_NATIVE = new Set<SniffedFormat>(['jpg', 'png', 'gif', 'tiff', 'psd', 'exr', 'hdr', 'bmp', 'mp4', 'mov', 'm4a', 'avi', 'mp3', 'wav', 'aiff', 'aac', 'gltf', 'glb', 'obj']);
/** What each convertible format becomes. */
export const CONVERT_TO: Partial<Record<SniffedFormat, SniffedFormat>> = { webp: 'png', avif: 'png', heic: 'jpg', ogg: 'wav', flac: 'wav', webm: 'mp4' };

const ascii = (b: Buffer, at: number, n: number) => b.toString('latin1', at, at + n);

export function sniff(b: Buffer): Sniff {
  if (b.length < 4) return { refused: 'empty or truncated file' };
  // Refuse anything executable or scriptable first.
  if (b[0] === 0x4d && b[1] === 0x5a) return { refused: 'Windows executable (MZ)' };
  if (ascii(b, 0, 4) === '\x7fELF') return { refused: 'ELF executable' };
  if (b.readUInt32BE(0) === 0xcafebabe || b.readUInt32BE(0) === 0xfeedface || b.readUInt32BE(0) === 0xfeedfacf || b.readUInt32LE(0) === 0xfeedfacf) return { refused: 'Mach-O / Java class file' };
  if (ascii(b, 0, 2) === '#!') return { refused: 'script (#!)' };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { format: 'jpg' };
  if (b.readUInt32BE(0) === 0x89504e47) return { format: 'png' };
  if (ascii(b, 0, 4) === 'GIF8') return { format: 'gif' };
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return { format: 'webp' };
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WAVE') return { format: 'wav' };
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'AVI ') return { format: 'avi' };
  if (ascii(b, 0, 4) === 'FORM' && /^AIF[FC]$/.test(ascii(b, 8, 4))) return { format: 'aiff' };
  if (ascii(b, 0, 4) === 'II*\0' || ascii(b, 0, 4) === 'MM\0*') return { format: 'tiff' };
  if (ascii(b, 0, 4) === '8BPS') return { format: 'psd' };
  if (ascii(b, 0, 2) === 'BM' && b.length > 26) return { format: 'bmp' };
  if (b.readUInt32LE(0) === 0x01312f76) return { format: 'exr' };
  if (ascii(b, 0, 10) === '#?RADIANCE' || ascii(b, 0, 6) === '#?RGBE') return { format: 'hdr' };
  if (ascii(b, 4, 4) === 'ftyp') {
    const brand = ascii(b, 8, 4);
    if (/^(avif|avis)$/.test(brand)) return { format: 'avif' };
    if (/^(heic|heix|hevc|mif1|msf1)$/.test(brand)) return { format: 'heic' };
    if (/^qt  $/.test(brand)) return { format: 'mov' };
    if (/^(M4A |M4B )$/.test(brand)) return { format: 'm4a' };
    return { format: 'mp4' };
  }
  if (b.readUInt32BE(0) === 0x1a45dfa3) return { format: 'webm' };
  if (ascii(b, 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe6) === 0xe2)) return { format: 'mp3' };
  if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return { format: 'aac' };
  if (ascii(b, 0, 4) === 'OggS') return { format: 'ogg' };
  if (ascii(b, 0, 4) === 'fLaC') return { format: 'flac' };
  if (ascii(b, 0, 4) === 'glTF') return { format: 'glb' };
  if (b.readUInt32BE(0) === 0x504b0304 || b.readUInt32BE(0) === 0x504b0506) return { format: 'zip' };
  if (b.readUInt32BE(0) === 0x00010000 || ascii(b, 0, 4) === 'true') return { format: 'ttf' };
  if (ascii(b, 0, 4) === 'OTTO') return { format: 'otf' };
  if (ascii(b, 0, 4) === 'wOFF') return { format: 'woff' };
  if (ascii(b, 0, 4) === 'wOF2') return { format: 'woff2' };
  // Text formats: look at the start, skipping a BOM and whitespace.
  const head = b.toString('utf8', 0, Math.min(b.length, 2048)).replace(/^﻿/, '').trimStart();
  if (/^<!doctype html|^<html|<head[\s>]|<body[\s>]/i.test(head)) return { refused: 'an HTML page (an error or login page, not the file)' };
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!doctype svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return { format: 'svg' };
  if (head.startsWith('{') && /"asset"\s*:/.test(b.toString('utf8', 0, Math.min(b.length, 64_000)))) return { format: 'gltf' };
  if (/^(#.*\n|\s)*(v|o|g|mtllib|vn|vt)\s/m.test(head) && /^v\s+-?[\d.]/m.test(head)) return { format: 'obj' };
  return { refused: `unknown file type (starts ${b.subarray(0, 8).toString('hex')})` };
}

/** Same family? A source promising "jpeg" may deliver "jpg"; "mp4" may be "mov"; "m4a" counts as audio mp4. */
export function sameFamily(expected: string, got: SniffedFormat): boolean {
  const raw = expected.toLowerCase().replace(/^\./, '');
  const e = ({ jpeg: 'jpg', tif: 'tiff', aif: 'aiff', m4v: 'mp4' } as Record<string, string>)[raw] ?? raw;
  if (e === got) return true;
  const groups = [['mp4', 'mov', 'm4a', 'm4v'], ['ttf', 'otf'], ['gltf', 'glb'], ['jpg', 'png', 'webp', 'avif', 'heic', 'gif', 'tiff', 'bmp']];
  return groups.some((g) => g.includes(e) && g.includes(got));
}

/**
 * Removes anything active from an SVG before it is stored: scripts, event handlers, foreignObject, and references
 * to anything outside the file (`<Svg>` parses geometry only, so nothing is lost for drawing).
 */
export function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script[^>]*\/>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(?:xlink:)?href\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*')/gi, '')
    .replace(/<!ENTITY[^>]*>/gi, '')
    .replace(/url\(\s*(['"]?)(?!#)[^)]*\1\s*\)/gi, 'none');
}
