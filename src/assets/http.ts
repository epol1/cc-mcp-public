// Polite HTTP for the asset APIs (ASSETS §5): our User-Agent on every request, a 24 h response cache (Pixabay
// requires one), a per-source request budget, one back-off retry on 429/503 and a capped, streamed download.
// Tests never reach the network: under vitest the transport refuses unless a test installs its own (fixtures)
// or AEC_LIVE=1 (`pnpm test:live`).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { apiKey, assetHome, redact, userAgent } from './config.ts';

export interface HttpResponse { status: number; headers: Record<string, string>; body: Buffer }
export type Transport = (url: string, headers: Record<string, string>) => Promise<HttpResponse>;

/** Redirects may not leave https (a provider URL that 302s to http:// or an intranet host). */
function checkFinal(requested: string, final: string): void {
  if (/^https:/i.test(requested) && !/^https:/i.test(final)) throw new Error(`redirected from https to a non-https URL (${redact(final).slice(0, 80)})`);
}

const networkTransport: Transport = async (url, headers) => {
  const r = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(60_000) });
  checkFinal(url, r.url || url);
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
/** Daily caps kept on disk (anonymous Openverse: 200 a day; a token lifts it). */
const DAILY: Record<string, number> = { openverse: 190 };
function daily(source: string): void {
  if (!(source in DAILY) || apiKey(source)) return;
  const f = path.join(assetHome(), '_budget.json');
  const day = new Date().toISOString().slice(0, 10);
  let j: { day: string; n: Record<string, number> } = { day, n: {} };
  try { const r = JSON.parse(fs.readFileSync(f, 'utf8')); if (r.day === day) j = r; } catch { /* new day */ }
  if ((j.n[source] ?? 0) >= DAILY[source]) throw new Error(`${source}: today's anonymous request limit is used up (${DAILY[source]}); add a token to ~/.ae-compose/keys.json or try tomorrow`);
  j.n[source] = (j.n[source] ?? 0) + 1;
  try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(j)); } catch { /* best effort */ }
}

const sent = new Map<string, number[]>();
async function budget(source: string, noWait = false): Promise<void> {
  daily(source);
  const b = BUDGET[source];
  if (!b) return;
  const now = Date.now();
  const list = (sent.get(source) ?? []).filter((t) => now - t < b.ms);
  if (list.length >= b.n) {
    const wait = b.ms - (now - list[0]);
    if (noWait || wait > 20_000) throw new Error(`${source}: request budget used up (${b.n} per ${b.ms / 60_000} min); try again in ${Math.ceil(wait / 1000)} s`);
    await new Promise((r) => setTimeout(r, wait));
  }
  list.push(Date.now());
  sent.set(source, list);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET with the UA header, the source's budget and one retry after a 429/503 (Retry-After, at most 30 s). */
export async function request(url: string, opts: { source: string; headers?: Record<string, string>; retry?: boolean; noWait?: boolean }): Promise<HttpResponse> {
  const headers = { 'User-Agent': userAgent(), Accept: '*/*', ...(opts.headers ?? {}) };
  for (let attempt = opts.retry === false ? 1 : 0; ; attempt++) {
    await budget(opts.source, opts.noWait);
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
 * Streams a file to `dest` via a .part file: refused past `maxBytes` (Content-Length first, then while receiving,
 * so a chunked reply can't fill memory), aborted after 60 s without data (a big file on a slow line still
 * finishes), https all the way through redirects. No blind retry.
 */
async function streamDownload(url: string, dest: string, opts: { source: string; maxBytes: number; headers?: Record<string, string> }): Promise<number> {
  const ctrl = new AbortController();
  let idle: NodeJS.Timeout | undefined;
  const arm = () => { clearTimeout(idle); idle = setTimeout(() => ctrl.abort(new Error('no data for 60 s')), 60_000); };
  arm();
  const part = dest + '.part';
  try {
    const r = await fetch(url, { headers: { 'User-Agent': userAgent(), Accept: '*/*', ...(opts.headers ?? {}) }, redirect: 'follow', signal: ctrl.signal });
    checkFinal(url, r.url || url);
    if (r.status === 429) throw new Error(`${opts.source}: rate limited (HTTP 429); wait a minute and try again`);
    if (r.status >= 400) throw new Error(`${opts.source}: HTTP ${r.status} for ${redact(url)}`);
    const len = Number(r.headers.get('content-length'));
    if (Number.isFinite(len) && len > opts.maxBytes) throw new Error(`${opts.source}: file is ${(len / 1e6).toFixed(1)} MB, over the ${(opts.maxBytes / 1e6).toFixed(0)} MB cap for this kind`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const fh = await fs.promises.open(part, 'w');
    let n = 0;
    try {
      for await (const chunk of r.body as any as AsyncIterable<Uint8Array>) {
        n += chunk.length;
        if (n > opts.maxBytes) { ctrl.abort(); throw new Error(`${opts.source}: file is over the ${(opts.maxBytes / 1e6).toFixed(0)} MB cap for this kind`); }
        await fh.write(chunk);
        arm();
      }
    } finally { await fh.close(); }
    fs.renameSync(part, dest);
    return n;
  } catch (e: any) {
    fs.rmSync(part, { force: true });
    throw new Error(redact(String(e?.message ?? e)));
  } finally { clearTimeout(idle); }
}

/**
 * Downloads a file to `dest` (via a .part file), refusing more than `maxBytes`. Streamed over the network; tests
 * that install a fixture transport get the buffered path. Not cached here: the download cache (cache.ts) decides
 * where files live.
 */
export async function download(url: string, dest: string, opts: { source: string; maxBytes: number; headers?: Record<string, string> }): Promise<number> {
  if (transport === networkTransport) return streamDownload(url, dest, opts);
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
