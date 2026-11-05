// `pnpm test:live`: calls each asset API once (search only, no downloads) to catch response-shape changes.
// Opt-in and never part of `test:unit`. Key-based sources are skipped (and say so) when their key isn't set.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { setTransport } from '../../src/assets/http.ts';
import { adapterContext } from '../../src/assets/context.ts';
import { ADAPTERS } from '../../src/assets/registry.ts';
import { licenseRefusal } from '../../src/assets/license.ts';
import type { AssetKind } from '../../src/assets/types.ts';

beforeAll(() => {
  process.env.AEC_LIVE = '1';
  setTransport(null); // the real network
  process.env.AEC_ASSET_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aec-live-')); // no cached responses
});

const CASES: Record<string, { query: string; kind?: AssetKind }> = {
  iconify: { query: 'rocket', kind: 'icon' },
  polyhaven: { query: 'studio', kind: 'hdri' },
  ambientcg: { query: 'paper', kind: 'texture' },
  pixabay: { query: 'ocean waves', kind: 'video' },
  pexels: { query: 'city night', kind: 'photo' },
  unsplash: { query: 'desk', kind: 'photo' },
  openverse: { query: 'whoosh', kind: 'audio' },
  fontsource: { query: 'grotesk', kind: 'font' },
};

describe('asset APIs, live (one call each)', () => {
  const ctx = adapterContext();
  for (const a of ADAPTERS.filter((x) => x.id !== 'local')) {
    it(a.id, async (t) => {
      if (a.key === 'required' && !ctx.key(a.id)) { t.skip(); return; }
      const c = CASES[a.id];
      const hits = await a.search({ query: c.query, kind: c.kind, limit: 3 }, ctx);
      expect(hits.length, `${a.id} returned no hits for "${c.query}"`).toBeGreaterThan(0);
      for (const h of hits) {
        expect(h.id.startsWith(a.id + ':')).toBe(true);
        expect(h.credit.length).toBeGreaterThan(10);
        expect(licenseRefusal(h.license)).toBeNull();
      }
    }, 60_000);
  }
});
