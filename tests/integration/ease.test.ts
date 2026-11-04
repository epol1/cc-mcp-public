// Requires After Effects + the CEP bridge. Run with: pnpm test:ae
import { describe, expect, it } from 'vitest';
import { runEaseVerification } from './ease-verify.ts';

describe('AE ease verification (valueAtTime vs reference curves)', () => {
  it('every curve matches within tolerance', async () => {
    const res = await runEaseVerification();
    for (const r of res) expect(r.maxErr, `${r.name}: ${r.maxErr} > ${r.tol}`).toBeLessThanOrEqual(r.tol);
  }, 120_000);
});
