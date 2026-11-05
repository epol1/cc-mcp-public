#!/usr/bin/env node
// Installs the ae-compose CEP bridge for After Effects (Windows): links
// %APPDATA%\Adobe\CEP\extensions\com.aecompose → packages/bridge-cep/extension (a directory junction, so edits to
// the repo are live; the bridge hot-reloads its server code).
//
//   node scripts/install-cep.mjs            create the junction (idempotent)
//   node scripts/install-cep.mjs --remove   remove it
//   --pr                                    the pr-cut bridge for Premiere Pro instead
//                                           (com.prcut → packages/bridge-cep-pr/extension)
//
// Unsigned extensions also need CEP debug mode, a per-user setting you enable once yourself:
//   reg add "HKCU\Software\Adobe\CSXS.12" /v PlayerDebugMode /t REG_SZ /d 1 /f
// Then restart After Effects (or Premiere). `aec doctor` / `prc doctor` check both.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pr = process.argv.includes('--pr');
const src = path.join(repo, 'packages', pr ? 'bridge-cep-pr' : 'bridge-cep', 'extension');
const appName = pr ? 'Premiere Pro' : 'After Effects';
if (process.platform !== 'win32') {
  console.error('ae-compose bridge install is Windows-only for now (macOS: symlink the folder into ~/Library/Application Support/Adobe/CEP/extensions).');
  process.exit(1);
}
const dir = path.join(process.env.APPDATA ?? '', 'Adobe', 'CEP', 'extensions');
const dst = path.join(dir, pr ? 'com.prcut' : 'com.aecompose');

if (process.argv.includes('--remove')) {
  if (fs.existsSync(dst)) { fs.rmSync(dst, { recursive: false, force: true }); console.log('removed', dst); }
  else console.log('not installed');
  process.exit(0);
}
if (!fs.existsSync(path.join(src, 'CSXS', 'manifest.xml'))) { console.error('extension not found at', src); process.exit(1); }
fs.mkdirSync(dir, { recursive: true });
// An existing junction: keep it when it points here; re-point it when it points elsewhere or nowhere (the repo moved).
// Only a junction is ever replaced (rmdir removes the link, never its target); a real folder there is left alone.
let link = null;
try { link = fs.lstatSync(dst); } catch { /* not there */ }
if (link) {
  let real = null;
  try { real = fs.realpathSync(dst); } catch { /* dangling */ }
  if (real && path.resolve(real) === path.resolve(src)) { console.log('already installed:', dst, '→', src); process.exit(0); }
  if (!link.isSymbolicLink()) { console.error(`${dst} is a real folder, not a link; move it away first`); process.exit(1); }
  execFileSync('cmd', ['/c', 'rmdir', dst]);
  console.log(`re-pointing ${dst} (was ${real ?? 'a missing folder'})`);
}
execFileSync('cmd', ['/c', 'mklink', '/J', dst, src], { stdio: 'inherit' });
console.log('installed:', dst, '→', src);
let dbg = null;
try { dbg = execFileSync('reg', ['query', 'HKCU\\Software\\Adobe\\CSXS.12', '/v', 'PlayerDebugMode'], { encoding: 'utf8' }).match(/REG_SZ\s+(\S+)/)?.[1] ?? null; } catch { /* unset */ }
if (dbg !== '1') console.log(`\nCEP debug mode is not enabled yet. Enable it once (per user), then restart ${appName}:\n  reg add "HKCU\\Software\\Adobe\\CSXS.12" /v PlayerDebugMode /t REG_SZ /d 1 /f`);
else console.log(`CEP debug mode: on. Restart ${appName}, then run: ${pr ? 'prc' : 'aec'} doctor`);
