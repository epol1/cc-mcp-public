// Test helper for the asset adapters: a transport that answers from tests/fixtures/assets/ by URL pattern, a temp
// AEC_ASSET_HOME per test file, and a record of the URLs requested. Unknown URLs fail (unit tests never hit the network).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTransport } from '@cc-mcp/core/assets/http.ts';
import type { HttpResponse } from '@cc-mcp/core/assets/http.ts';

export const FIXTURES = path.resolve(__dirname, '../fixtures/assets');
export const fixture = (name: string) => fs.readFileSync(path.join(FIXTURES, name));

export type Route = [RegExp, string | Buffer | ((url: string) => HttpResponse | Buffer | string)];

/** Installs a fixture router; returns the list of requested URLs (with headers) for assertions. */
export function useFixtures(routes: Route[]): { urls: string[]; headers: Record<string, string>[] } {
  const seen = { urls: [] as string[], headers: [] as Record<string, string>[] };
  setTransport(async (url, headers) => {
    seen.urls.push(url);
    seen.headers.push(headers);
    for (const [re, ans] of routes) {
      if (!re.test(url)) continue;
      const v = typeof ans === 'function' ? ans(url) : ans;
      if (Buffer.isBuffer(v)) return { status: 200, headers: {}, body: v };
      if (typeof v === 'string') return { status: 200, headers: {}, body: /\.(json|svg|pb)$/.test(v) && fs.existsSync(path.join(FIXTURES, v)) ? fixture(v) : Buffer.from(v) };
      return v;
    }
    throw new Error(`no fixture route for ${url}`);
  });
  return seen;
}

/** A fresh asset home (cache + response cache) for a test file. */
export function tempAssetHome(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aec-assets-'));
  process.env.AEC_ASSET_HOME = d;
  return d;
}
