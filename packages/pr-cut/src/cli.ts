// prc: the pr-cut command line. Same engine as the MCP tools, for scripts and quick checks.
//   prc doctor
//   prc transcribe <media> [--force]
//   prc build <plan.json> [--dry]
//   prc inspect [sequence]
//   prc edit <sequence> <edits.json>
//   prc tighten <sequence> [--apply]
//   prc lint <plan.json>
//   prc library add <folder> | status | search <query> | describe <id>
//   prc export <sequence> [out.mp4]
//   prc undo [--force]
import fs from 'node:fs';
import path from 'node:path';
import { transcribe, transcriptView } from '@cc-mcp/core/transcribe/index.ts';
import { addFolder, startWorker, status } from '@cc-mcp/core/library/index.ts';
import { formatHits, search } from '@cc-mcp/core/library/search.ts';
import { libraryPath } from '@cc-mcp/core/library/db.ts';
import { buildCut } from './build.ts';
import { doctor, formatChecks } from './doctor.ts';
import { applyCutEdits } from './edit.ts';
import { reportText } from './report.ts';
import { outlineSequence } from './outline.ts';
import { exportSequence, resolveSequence } from './project.ts';
import { tightenSequence } from './tighten.ts';
import { journaled, undoLast } from './undo.ts';

const [cmd, ...args] = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const pos = args.filter((a) => !a.startsWith('--'));
const json = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8'));

async function main() {
  switch (cmd) {
    case 'doctor': { const c = await doctor(); console.log(formatChecks(c)); process.exitCode = c.some((x) => !x.ok && !/UXP/.test(x.name)) ? 1 : 0; return; }
    case 'transcribe': { const t = await transcribe(pos[0], { force: flag('--force'), onProgress: (d, n) => process.stderr.write(`\r${d.toFixed(0)}/${n.toFixed(0)} s`) }); console.log(transcriptView(t)); return; }
    case 'build': case 'lint': {
      const plan = json(pos[0]);
      const dry = cmd === 'lint' || flag('--dry');
      const r = dry ? await buildCut(plan, { dryRun: true, baseDir: path.dirname(path.resolve(pos[0])), libraryPath }) : await journaled('build_cut', plan.name, async () => { const b = await buildCut(plan, { baseDir: path.dirname(path.resolve(pos[0])), libraryPath }); return { ...b, sequenceId: b.report.sequence?.id }; });
      console.log(reportText(r.report));
      return;
    }
    case 'inspect': { console.log((await outlineSequence((await resolveSequence(pos[0])).id)).text); return; }
    case 'edit': { const s = await resolveSequence(pos[0]); const r = await journaled('apply_cut_edits', s.name, async () => { const b = await applyCutEdits(s.id, json(pos[1])); return { ...b, sequenceId: b.report.sequence?.id }; }); console.log(r.summary + '\n' + reportText(r.report)); return; }
    case 'tighten': { const s = await resolveSequence(pos[0]); const r = await tightenSequence(s.id, {}, { dryRun: !flag('--apply') }); console.log(r.summary); return; }
    case 'export': { const s = await resolveSequence(pos[0]); const out = pos[1] ?? path.resolve(`${s.name.replace(/[^\w.-]+/g, '_')}.mp4`); const r = await exportSequence(s.id, out); console.log(`${r.file} (${(r.ms / 1000).toFixed(1)} s)`); return; }
    case 'undo': { console.log(await undoLast({ force: flag('--force') })); return; }
    case 'library': {
      const [sub, ...rest] = pos;
      if (sub === 'add') { const r = addFolder(rest[0]); console.log(r, r.queued ? startWorker() : ''); return; }
      if (sub === 'status') { console.log(JSON.stringify(status(), null, 1)); return; }
      if (sub === 'search') { console.log(formatHits(search(rest.join(' ')))); return; }
      break;
    }
  }
  console.log('usage: prc doctor | transcribe <media> | build <plan.json> [--dry] | lint <plan.json> | inspect [seq] | edit <seq> <edits.json> | tighten <seq> [--apply] | export <seq> [out] | undo | library add <folder> | status | search <query>');
  process.exitCode = 2;
}

main().catch((e) => { console.error(`error: ${e.message}`); process.exitCode = 1; });
