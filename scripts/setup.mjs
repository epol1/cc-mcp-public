#!/usr/bin/env node
// One-step setup of both tools from this checkout (run after `pnpm install`, and again after moving the folder):
//   - links the CEP bridges into %APPDATA%\Adobe\CEP\extensions: com.aecompose (After Effects) and com.prcut (Premiere);
//     an existing link that points elsewhere (an old location) is re-pointed;
//   - writes the ae-compose and pr-cut MCP servers into .mcp.json with this checkout's path (other servers are kept);
//   - says what is left to do by hand (CEP debug mode is a per-user setting you enable yourself).
//
//   node scripts/setup.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fwd = (p) => p.split(path.sep).join('/');

for (const args of [[], ['--pr']]) execFileSync(process.execPath, [path.join(repo, 'scripts', 'install-cep.mjs'), ...args], { stdio: 'inherit' });

const mcpFile = path.join(repo, '.mcp.json');
let mcp = { mcpServers: {} };
try { mcp = JSON.parse(fs.readFileSync(mcpFile, 'utf8')); } catch { /* new file */ }
mcp.mcpServers ??= {};
mcp.mcpServers['ae-compose'] = { command: 'node', args: [fwd(path.join(repo, 'bin', 'aec-mcp.mjs'))] };
mcp.mcpServers['pr-cut'] = { command: 'node', args: [fwd(path.join(repo, 'bin', 'prc-mcp.mjs'))] };
fs.writeFileSync(mcpFile, JSON.stringify(mcp, null, 2) + '\n');
console.log(`\n.mcp.json: ae-compose and pr-cut servers → ${fwd(repo)}/bin`);

console.log(`
Next:
  1. Restart After Effects and Premiere Pro (they load the bridges at start).
  2. node bin/aec.mjs doctor   and   node bin/prc.mjs doctor
  3. Restart Claude Code in this folder so it picks up .mcp.json (or register the servers elsewhere:
     claude mcp add ae-compose -- node "${fwd(path.join(repo, 'bin', 'aec-mcp.mjs'))}"
     claude mcp add pr-cut -- node "${fwd(path.join(repo, 'bin', 'prc-mcp.mjs'))}")`);
