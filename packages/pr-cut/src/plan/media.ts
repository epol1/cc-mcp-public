// Resolves edit-plan sources (aliases, paths, library ids) to probed media and transcripts, cached per process.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { probe, type MediaInfo } from '@cc-mcp/core/media/probe.ts';
import { cachedTranscript, transcribe, type Transcript } from '@cc-mcp/core/transcribe/index.ts';
import { cameraProbe, type CameraProbe } from './cameras.ts';

const probes = new Map<string, Promise<MediaInfo>>();

export interface MediaResolver {
  /** Absolute path for a plan source. */
  path(src: string): string;
  info(src: string): Promise<MediaInfo>;
  /** The transcript, transcribing on demand (cached by content hash). */
  transcript(src: string): Promise<Transcript>;
  /** Stable key for the timeline's media table. */
  key(src: string): string;
  /** Camera awareness for a video source (switched programs); absent in resolvers that can't decode. */
  cameras?(src: string): CameraProbe;
}

export function mediaResolver(aliases: Record<string, string> = {}, opts: { baseDir?: string; libraryPath?: (id: string) => string | null; transcribeMissing?: boolean } = {}): MediaResolver {
  const base = opts.baseDir ?? process.cwd();
  const resolvePath = (src: string): string => {
    if (aliases[src]) return resolvePath(aliases[src]);
    if (src.startsWith('lib:')) {
      const p = opts.libraryPath?.(src.slice(4));
      if (!p) throw new Error(`media "${src}" is not in the media library`);
      return p;
    }
    const p = path.isAbsolute(src) ? src : path.resolve(base, src);
    if (!fs.existsSync(p)) throw new Error(`media "${src}" not found (${p})${Object.keys(aliases).length ? `; aliases: ${Object.keys(aliases).join(', ')}` : ''}`);
    return path.resolve(p);
  };
  const transcripts = new Map<string, Promise<Transcript>>();
  const cams = new Map<string, CameraProbe>();
  return {
    path: resolvePath,
    // The alias when there is one for this file; otherwise the file name plus a hash of its path, because camera
    // cards repeat names (A-cam and B-cam both have C0001.MP4) and two files must never share a key.
    key: (src) => {
      const p = resolvePath(src);
      const alias = Object.entries(aliases).find(([, v]) => !v.startsWith('lib:') && path.resolve(base, v) === p)?.[0] ?? (aliases[src] ? src : undefined);
      return alias ?? `${path.basename(p).replace(/[^\w.-]+/g, '_')}~${crypto.createHash('sha1').update(p.toLowerCase()).digest('hex').slice(0, 6)}`;
    },
    info(src) {
      const p = resolvePath(src);
      if (!probes.has(p)) probes.set(p, probe(p));
      return probes.get(p)!;
    },
    transcript(src) {
      const p = resolvePath(src);
      if (!transcripts.has(p)) {
        transcripts.set(p, (async () => {
          const c = cachedTranscript(p);
          if (c) return { ...c, media: p };
          if (opts.transcribeMissing === false) throw new Error(`no transcript for ${path.basename(p)} yet: run transcribe first`);
          return transcribe(p);
        })());
      }
      return transcripts.get(p)!;
    },
    cameras: (src) => {
      const p = resolvePath(src);
      if (!cams.has(p)) cams.set(p, cameraProbe(p));
      return cams.get(p)!;
    },
  };
}
