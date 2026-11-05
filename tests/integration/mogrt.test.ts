// export_mogrt AE integration check (pnpm test:ae): tests/integration/mogrt/mogrt.ts prints PASS/FAIL lines.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';

describe('export_mogrt (AE)', () => {
  it('mogrt.ts', () => {
    const out = execFileSync(process.execPath, ['--import', 'tsx', 'tests/integration/mogrt/mogrt.ts'], { encoding: 'utf8', timeout: 600_000 });
    expect(out).not.toMatch(/^FAIL /m);
    expect(out).toMatch(/all checks passed/);
  }, 630_000);
});
