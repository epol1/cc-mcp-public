#!/usr/bin/env node
// Release checkpoint: bump VERSION (vX.XX.XXX), regenerate the status dashboard (recording a
// history point), commit "vX.XX.XXX <message>" to the current branch, and push to origin.
// Usage: node scripts/release.mjs "short description" [--minor|--major] [--no-push]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const message = args.find((a) => !a.startsWith('--'));
if (!message) { console.error('usage: node scripts/release.mjs "short description" [--minor|--major] [--no-push]'); process.exit(1); }
const vfile = path.join(root, 'VERSION');
const cur = fs.existsSync(vfile) ? fs.readFileSync(vfile, 'utf8').trim() : 'v0.00.000';
const m = /^v(\d+)\.(\d{2})\.(\d{3})$/.exec(cur);
if (!m) { console.error(`VERSION "${cur}" is not vX.XX.XXX`); process.exit(1); }
let [maj, min, pat] = [+m[1], +m[2], +m[3]];
if (args.includes('--major')) { maj++; min = 0; pat = 0; } else if (args.includes('--minor')) { min++; pat = 0; } else pat++;
const next = `v${maj}.${String(min).padStart(2, '0')}.${String(pat).padStart(3, '0')}`;
fs.writeFileSync(vfile, next + '\n');

const run = (cmd, a, opts = {}) => execFileSync(cmd, a, { cwd: root, stdio: 'inherit', ...opts });
// Gate: unit tests must pass when they exist.
const pkg = fs.existsSync(path.join(root, 'package.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) : {};
if (pkg.scripts && pkg.scripts['test:unit']) {
  try { run(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['run', '-s', 'test:unit'], { shell: process.platform === 'win32' }); }
  catch { fs.writeFileSync(vfile, cur + '\n'); console.error('unit tests failed, release aborted'); process.exit(1); }
}
run(process.execPath, [path.join(root, 'status/build.mjs'), '--record', next]);
run('git', ['add', '-A']);
run('git', ['commit', '-q', '-m', `${next} ${message}`, '-m', 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>']);
if (!args.includes('--no-push')) {
  const remotes = execFileSync('git', ['remote'], { cwd: root, encoding: 'utf8' }).trim();
  if (remotes.split('\n').includes('origin')) run('git', ['push', '-q', 'origin', 'HEAD']);
  else console.log('no origin remote; skipped push');
}
console.log(`released ${next}: ${message}`);
