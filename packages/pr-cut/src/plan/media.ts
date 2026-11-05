// Resolves edit-plan sources (aliases, paths, library ids) to probed media and transcripts, cached per process.
import fs from 'node:fs';
import path from 'node:path';
import { probe, type MediaInfo } from '@ae-mcp/core/media/probe.ts';
import { cachedTranscript, transcribe, type Transcript } from '@ae-mcp/core/transcribe/index.ts';

const probes = new Map<string, Promise<MediaInfo>>();

export interface MediaResolver {
  /** Absolute path for a plan source. */
  path(src: string): string;
  info(src: string): Promise<MediaInfo>;
  /** The transcript, transcribing on demand (cached by content hash). */
  transcript(src: string): Promise<Transcript>;
  /** Stable key for the timeline's media table. */
  key(src: string): string;
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
  return {
    path: resolvePath,
    key: (src) => {
      const p = resolvePath(src);
      return Object.entries(aliases).find(([, v]) => path.resolve(base, v) === p)?.[0] ?? path.basename(p).replace(/[^\w.-]+/g, '_');
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
  };
}
