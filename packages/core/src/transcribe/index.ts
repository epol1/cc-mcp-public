// Transcription for the media library and both tools: an engine behind an interface (local faster-whisper today;
// Premiere's own Speech to Text when its API is reachable), cached by content hash under ~/.ae-compose/transcripts,
// then fillers/repeats flagged, sentences and pauses derived, and word boundaries snapped to the audio.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { flagFillers, pauses, sentences } from './analyze.ts';
import { decodePcm16k, envelope, refineWords, type Envelope } from './refine.ts';
import type { Transcript, Word } from './types.ts';

export type { Transcript, Word, Sentence, Pause } from './types.ts';

export const AEC_HOME = path.join(os.homedir(), '.ae-compose');
export const TRANSCRIPTS = path.join(AEC_HOME, 'transcripts');
export const WHISPER_PY = path.join(AEC_HOME, 'whisper-venv', 'Scripts', 'python.exe');
const WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'whisper_worker.py');

/**
 * Identity of a media file that survives renames and moves: SHA-1 of its size plus three 1 MB samples (head,
 * middle, tail). Reading whole files would take minutes on long camera originals.
 */
export function mediaHash(file: string): string {
  const st = fs.statSync(file);
  const h = crypto.createHash('sha1').update(String(st.size));
  const fd = fs.openSync(file, 'r');
  try {
    const n = Math.min(1 << 20, st.size);
    const buf = Buffer.alloc(n);
    for (const off of [0, Math.max(0, Math.floor(st.size / 2) - n / 2), Math.max(0, st.size - n)]) {
      const r = fs.readSync(fd, buf, 0, n, off);
      h.update(buf.subarray(0, r));
    }
  } finally { fs.closeSync(fd); }
  return h.digest('hex').slice(0, 20);
}

export interface RawWords { engine: string; model?: string; language?: string; duration: number; words: { text: string; start: number; end: number; p: number; speaker?: string }[] }

export interface TranscribeEngine {
  name: string;
  available(): Promise<{ ok: boolean; detail: string }>;
  run(file: string, opts: { language?: string; onProgress?: (done: number, total: number) => void }): Promise<RawWords>;
}

export const whisperEngine: TranscribeEngine = {
  name: 'faster-whisper',
  async available() {
    if (!fs.existsSync(WHISPER_PY)) return { ok: false, detail: `no venv at ${path.dirname(path.dirname(WHISPER_PY))} (uv venv --python 3.12 … && uv pip install faster-whisper nvidia-cublas-cu12 nvidia-cudnn-cu12)` };
    return { ok: true, detail: `faster-whisper large-v3-turbo (${WHISPER_PY})` };
  },
  run(file, opts) {
    return new Promise((resolve, reject) => {
      fs.mkdirSync(TRANSCRIPTS, { recursive: true });
      const out = path.join(TRANSCRIPTS, `tmp-${process.pid}-${Date.now()}.json`);
      const args = [WORKER, file, out, ...(opts.language ? ['--language', opts.language] : [])];
      const p = spawn(WHISPER_PY, args, { windowsHide: true });
      let err = '';
      p.stderr.on('data', (d: Buffer) => {
        const s = d.toString();
        err += s;
        for (const m of s.matchAll(/progress ([\d.]+) ([\d.]+)/g)) opts.onProgress?.(+m[1], +m[2]);
      });
      p.on('error', reject);
      p.on('close', (code) => {
        if (code !== 0 || !fs.existsSync(out)) return reject(new Error(`whisper failed (${code}): ${err.slice(-600)}`));
        const j = JSON.parse(fs.readFileSync(out, 'utf8'));
        fs.rmSync(out, { force: true });
        resolve({ engine: j.engine, model: j.model, language: j.language, duration: j.duration, words: j.words });
      });
    });
  },
};

/**
 * One long-lived Whisper process for many files (the library worker): the model loads once instead of per file
 * (~3.5 s each). Jobs are queued; close() ends the process.
 */
export function whisperServer(): TranscribeEngine & { close(): void } {
  let proc: ReturnType<typeof spawn> | null = null;
  let ready: Promise<void> | null = null;
  const waiting = new Map<string, { resolve: () => void; reject: (e: Error) => void }>();
  let chain: Promise<unknown> = Promise.resolve();
  const start = () => {
    if (ready) return ready;
    proc = spawn(WHISPER_PY, [WORKER, '--serve'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    ready = new Promise<void>((res, rej) => {
      let buf = '';
      proc!.stdout!.on('data', (d: Buffer) => {
        buf += d.toString();
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (line === 'ready') { res(); continue; }
          const m = /^(done|error) (\S+)(?: (.*))?$/.exec(line);
          if (!m) continue;
          const w = waiting.get(m[2]);
          if (!w) continue;
          waiting.delete(m[2]);
          if (m[1] === 'done') w.resolve(); else w.reject(new Error(`whisper: ${m[3]}`));
        }
      });
      proc!.on('error', rej);
      proc!.on('close', (code) => { rej(new Error(`whisper server exited (${code})`)); for (const w of waiting.values()) w.reject(new Error('whisper server exited')); waiting.clear(); ready = null; proc = null; });
    });
    return ready;
  };
  return {
    name: 'faster-whisper (served)',
    available: whisperEngine.available,
    run(file, opts) {
      const job = async (): Promise<RawWords> => {
        await start();
        fs.mkdirSync(TRANSCRIPTS, { recursive: true });
        const out = path.join(TRANSCRIPTS, `tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`);
        await new Promise<void>((resolve, reject) => {
          waiting.set(out, { resolve, reject });
          proc!.stdin!.write(JSON.stringify({ media: file, out, language: opts.language }) + '\n');
        });
        const j = JSON.parse(fs.readFileSync(out, 'utf8'));
        fs.rmSync(out, { force: true });
        return { engine: j.engine, model: j.model, language: j.language, duration: j.duration, words: j.words };
      };
      const p = chain.then(job, job);
      chain = p.catch(() => {});
      return p;
    },
    close() { try { proc?.stdin?.end(); } catch { /* gone */ } },
  };
}

export interface TranscribeOptions {
  engine?: TranscribeEngine;
  language?: string;
  /** Ignore the cache and transcribe again. */
  force?: boolean;
  /** Snap word boundaries to the audio (default true). */
  refine?: boolean;
  onProgress?: (done: number, total: number) => void;
}

export function cachedTranscript(file: string): Transcript | null {
  try {
    const p = path.join(TRANSCRIPTS, `${mediaHash(file)}.json`);
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { return null; }
}

/** Build a Transcript from recognizer words (flags, sentences, pauses; refined when an envelope is given). */
export function buildTranscript(media: string, hash: string, raw: RawWords, env?: Envelope): Transcript {
  let words: Word[] = raw.words.filter((w) => w.text.trim()).map((w, i) => ({ i, text: w.text.trim(), start: w.start, end: w.end, p: w.p, ...(w.speaker ? { speaker: w.speaker } : {}) }));
  if (env) words = refineWords(words, env);
  flagFillers(words);
  return {
    media, hash, duration: raw.duration, engine: raw.engine, model: raw.model, language: raw.language,
    words, sentences: sentences(words), pauses: pauses(words), refined: !!env, createdAt: new Date().toISOString(),
  };
}

export async function transcribe(file: string, opts: TranscribeOptions = {}): Promise<Transcript> {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new Error(`no such media file: ${abs}`);
  const hash = mediaHash(abs);
  const cacheFile = path.join(TRANSCRIPTS, `${hash}.json`);
  if (!opts.force && fs.existsSync(cacheFile)) {
    const t: Transcript = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    return { ...t, media: abs };
  }
  const engine = opts.engine ?? whisperEngine;
  const av = await engine.available();
  if (!av.ok) throw new Error(`transcription engine ${engine.name} unavailable: ${av.detail}`);
  const raw = await engine.run(abs, { language: opts.language, onProgress: opts.onProgress });
  const env = opts.refine === false ? undefined : envelope(await decodePcm16k(abs));
  const t = buildTranscript(abs, hash, raw, env);
  fs.mkdirSync(TRANSCRIPTS, { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(t));
  return t;
}

/** A compact readable view for agents: one line per sentence with its id, word range and time, fillers marked. */
export function transcriptView(t: Transcript, opts: { from?: number; to?: number; maxChars?: number } = {}): string {
  const lines: string[] = [];
  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
  for (const s of t.sentences) {
    if (opts.from !== undefined && s.end < opts.from) continue;
    if (opts.to !== undefined && s.start > opts.to) break;
    const text = t.words.slice(s.from, s.to + 1).map((w) => (w.filler ? `(${w.text})` : w.text)).join(' ');
    lines.push(`${s.id} [${fmt(s.start)}–${fmt(s.end)}] w${s.from}–${s.to}${s.speaker ? ` ${s.speaker}` : ''}: ${text}`);
  }
  let out = lines.join('\n');
  if (opts.maxChars && out.length > opts.maxChars) out = out.slice(0, opts.maxChars) + `\n… (${lines.length} sentences; narrow with from/to)`;
  return out;
}
