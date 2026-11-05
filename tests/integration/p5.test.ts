// Phase 5 AE integration checks (pnpm test:ae): each script builds or edits in AE, confirms the result through the
// inspector or AE values, checks that one undo restores the comp, and runs lint. Each prints PASS/FAIL lines.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';

const run = (file: string, timeout: number) => execFileSync(process.execPath, ['--import', 'tsx', file], { encoding: 'utf8', timeout });
const SCRIPTS: [string, number][] = [
  ['tests/integration/p5/aeclib.ts', 300_000],
  ['tests/integration/p5/foundations.ts', 600_000],
  ['tests/integration/p5/cloner.ts', 600_000],
  ['tests/integration/p5/distributions.ts', 600_000],
  ['tests/integration/p5/motion.ts', 600_000],
  ['tests/integration/p5/beats.ts', 600_000],
  ['tests/integration/p5/kits.ts', 3_600_000], // typography, backgrounds, data viz, UI, transitions, paths
  ['tests/integration/p5/agenttools.ts', 900_000], // plan_scene scaffold, recipe instance
  // Renders clear AE's undo history (delivery): keep it last.
  ['tests/integration/p5/reframe.ts', 1_500_000],
];

describe('Phase 5 toolkit (AE)', () => {
  for (const [file, timeout] of SCRIPTS) {
    it(file.split('/').pop()!, () => {
      const out = run(file, timeout);
      expect(out).not.toMatch(/^FAIL /m);
      expect(out).toMatch(/all checks passed/);
    }, timeout + 20_000);
  }
});
