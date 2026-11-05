// Premiere integration checks (pnpm test:pr; needs Premiere Pro with the pr-cut bridge). Each script works in a
// throwaway test project (scratch/pr/tests/pr-cut-tests.prproj), never the user's, and prints PASS/FAIL lines.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';

const run = (file: string, timeout: number) => execFileSync(process.execPath, ['--import', 'tsx', file], { encoding: 'utf8', timeout });
const SCRIPTS: [string, number][] = [
  ['tests/premiere/roundtrip.ts', 600_000], // every supported frame rate
  ['tests/premiere/build.ts', 600_000],
  ['tests/premiere/edits.ts', 600_000],
  ['tests/premiere/finish.ts', 1_200_000],
];

describe('pr-cut (Premiere)', () => {
  for (const [file, timeout] of SCRIPTS) {
    it(file.split('/').pop()!, () => {
      const out = run(file, timeout);
      expect(out).not.toMatch(/^FAIL /m);
      expect(out).toMatch(/all checks passed/);
    }, timeout + 20_000);
  }
});
