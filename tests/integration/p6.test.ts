// Phase 6 AE integration check (pnpm test:ae): fetch one asset of each kind, import, build an `asset:` scene, one
// undo restores it exactly, Collect Files keeps every fetched file, a moved project folder finds them. Needs AE,
// network access and the Pixabay/Unsplash keys (tests/integration/p6/assets.ts prints PASS/FAIL lines).
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';

describe('Phase 6 asset sources (AE)', () => {
  it('assets.ts', () => {
    const out = execFileSync(process.execPath, ['--import', 'tsx', 'tests/integration/p6/assets.ts'], { encoding: 'utf8', timeout: 1_800_000 });
    expect(out).not.toMatch(/^FAIL /m);
    expect(out).toMatch(/all checks passed/);
  }, 1_830_000);
});
