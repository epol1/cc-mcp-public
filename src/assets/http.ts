// Polite HTTP for the asset APIs (ASSETS §5): our User-Agent on every request, a 24 h response cache (Pixabay
// requires one), a per-source request budget, one back-off retry on 429/503 and a capped, streamed download.
// Tests never reach the network: under vitest the transport refuses unless a test installs its own (fixtures)
// or AEC_LIVE=1 (`pnpm test:live`).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { assetHome, redact, userAgent } from './config.ts';

export interface HttpResponse { status: number; headers: Record<string, string>; body: Buffer }
export type Transport = (url: string, headers: Record<string, string>) => Promise<HttpResponse>;

const networkTransport: Transport = async (url, headers) => {
  const r = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(60_000) });
  const h: Record<string, string> = {};
  r.headers.forEach((v, k) => { h[k] = v; });
  return { status: r.status, headers: h, body: Buffer.from(await r.arrayBuffer()) };
};

const offline: Transport = async (url) => { throw new Error(`network disabled in unit tests (no fixture for ${redact(url)})`); };
let transport: Transport = process.env.VITEST && process.env.AEC_LIVE !== '1' ? offline : networkTransport;

/** Replace the transport (tests: a fixture router). Returns the previous one. */
export function setTransport(t: Transport | null): Transport {
  const prev = transport;
  transport = t ?? (process.env.VITEST && process.env.AEC_LIVE !== '1' ? offline : networkTransport);
  return prev;
}

/** Requests per window per source, from each API's published limits (with headroom). */
const BUDGET: Record<string, { n: number; ms: number }> = {
  pexels: { n: 180, ms: 3600_000 },
  pixabay: { n: 90, ms: 60_000 },
  unsplash: { n: 45, ms: 3600_000 }, // demo apps: 50/hour

  openverse: { n: 18, ms: 60_000 },
  iconify: { n: 120, ms: 60_000 },
  polyhaven: { n: 60, ms: 60_000 },
  ambientcg: { n: 30, ms: 60_000 },
  fontsource: { n: 60, ms: 60_000 },
  // Grid thumbnails have their own budget, so a page of previews doesn't use up a source's search budget.
  thumbs: { n: 120, ms: 60_000 },
};
const sent = new Map<string, number[]>();
async function budget(source: string): Promise<void> {
  const b = BUDGET[source];
  if (!b) return;
  const now = Date.now();
  const list = (sent.get(source) ?? []).filter((t) => now - t < b.ms);
  if (list.length >= b.n) {
    const wait = b.ms - (now - list[0]);
    if (wait > 20_000) throw new Error(`${source}: request budget used up (${b.n} per ${b.ms / 60_000} min); try again in ${Math.ceil(wait / 1000)} s`);
    await new Promise((r) => setTimeout(r, wait));
  }
  list.push(Date.now());
  sent.set(source, list);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET with the UA header, the source's budget and one retry after a 429/503 (Retry-After, at most 30 s). */
export async function request(url: string, opts: { source: string; headers?: Record<string, string>; retry?: boolean }): Promise<HttpResponse> {
  const headers = { 'User-Agent': userAgent(), Accept: '*/*', ...(opts.headers ?? {}) };
  for (let attempt = opts.retry === false ? 1 : 0; ; attempt++) {
    await budget(opts.source);
    let r: HttpResponse;
    try { r = await transport(url, headers); } catch (e: any) {
      if (attempt === 0 && !/disabled in unit tests/.test(e.message)) { await sleep(1500); continue; }
      throw new Error(`${opts.source}: request failed: ${redact(String(e.message ?? e))}`);
    }
    if ((r.status === 429 || r.status === 503 || r.status === 502 || r.status === 504) && attempt === 0) {
      const ra = Number(r.headers['retry-after']);
      const wait = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 3000;
      if (wait > 30_000) throw new Error(`${opts.source}: rate limited (HTTP ${r.status}); retry after ${Math.ceil(wait / 1000)} s`);
      await sleep(wait);
      continue;
    }
    if (r.status === 429) throw new Error(`${opts.source}: rate limited (HTTP 429) twice; wait a minute and try again`);
    if (r.status === 401 || r.status === 403) throw new Error(`${opts.source}: HTTP ${r.status} (the API key is missing, wrong or not allowed for this request)`);
    if (r.status >= 400) throw new Error(`${opts.source}: HTTP ${r.status} for ${redact(url)}`);
    return r;
  }
}

const respDir = () => path.join(assetHome(), '_responses');
const DAY = 24 * 3600_000;

/** Cached GET (default 24 h). The cache key is the URL without its key, so keys never land on disk. */
async function cachedBody(url: string, opts: { source: string; ttlMs?: number; headers?: Record<string, string> }): Promise<Buffer> {
  const ttl = opts.ttlMs ?? DAY;
  const safeUrl = redact(url);
  const f = path.join(respDir(), opts.source, crypto.createHash('sha1').update(safeUrl).digest('hex').slice(0, 20) + '.bin');
  if (ttl > 0) {
    try { const st = fs.statSync(f); if (Date.now() - st.mtimeMs < ttl) return fs.readFileSync(f); } catch { /* miss */ }
  }
  const r = await request(url, opts);
  if (ttl > 0) {
    try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, r.body); } catch { /* read-only: fine */ }
  }
  return r.body;
}

export async function getJson<T = any>(url: string, opts: { source: string; ttlMs?: number; headers?: Record<string, string> }): Promise<T> {
  const body = await cachedBody(url, opts);
  try { return JSON.parse(body.toString('utf8')) as T; } catch { throw new Error(`${opts.source}: response is not JSON (${redact(url)})`); }
}

export async function getText(url: string, opts: { source: string; ttlMs?: number; headers?: Record<string, string> }): Promise<string> {
  return (await cachedBody(url, opts)).toString('utf8');
}

/** Drops cached API responses older than `maxAgeMs` (default 7 days). */
export function pruneResponses(maxAgeMs = 7 * DAY): number {
  let n = 0;
  const walk = (d: string) => {
    for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (Date.now() - fs.statSync(p).mtimeMs > maxAgeMs) { fs.rmSync(p, { force: true }); n++; }
    }
  };
  walk(respDir());
  return n;
}

/**
 * Downloads a file to `dest` (via a .part file), refusing more than `maxBytes` (Content-Length and while
 * streaming). Not cached here: the download cache (cache.ts) decides where files live.
 */
export async function download(url: string, dest: string, opts: { source: string; maxBytes: number; headers?: Record<string, string> }): Promise<number> {
  const r = await request(url, opts);
  const len = Number(r.headers['content-length']);
  if (Number.isFinite(len) && len > opts.maxBytes) throw new Error(`${opts.source}: file is ${(len / 1e6).toFixed(1)} MB, over the ${(opts.maxBytes / 1e6).toFixed(0)} MB cap for this kind`);
  if (r.body.length > opts.maxBytes) throw new Error(`${opts.source}: file is over the ${(opts.maxBytes / 1e6).toFixed(0)} MB cap for this kind`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const part = dest + '.part';
  fs.writeFileSync(part, r.body);
  fs.renameSync(part, dest);
  return r.body.length;
}
