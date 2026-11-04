// Requires After Effects + the CEP bridge (pnpm test:ae). Live-control rig + sticky controls.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';

describe('live controls (AE)', () => {
  it('rig follows controls exactly and survives rebuilds', () => {
    const out = execFileSync(process.execPath, ['--import', 'tsx', 'scratch/p3/livecontrols.ts'], { encoding: 'utf8', timeout: 240_000 });
    expect(out).not.toMatch(/FAIL/);
    expect(out).toMatch(/restoredControls=3/);
  }, 260_000);
});
