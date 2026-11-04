// `aec` CLI. Every command prints a short human summary; --json prints the raw result for scripts/agents.
import fs from 'node:fs';
import path from 'node:path';
import { buildScene, inspect, applyEdits, contactSheet, snapshot, listEffects, describeEffect, listDialogs, answerDialog, runExtendScript, importFootage, undo } from '../api/index.ts';
import { doctor } from '../api/doctor.ts';
import { renderPreview } from '../visual/preview.ts';
import { watchScene } from './watch.ts';

const argv = process.argv.slice(2);
const cmd = argv[0];
const flags: Record<string, string | boolean> = {};
const pos: string[] = [];
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const [k, v] = a.slice(2).split('=');
    if (v !== undefined) flags[k] = v;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--') && !['json', 'refresh', 'no-variants', 'new-version', 'full', 'gif', 'project', 'undo'].includes(k)) flags[k] = argv[++i];
    else flags[k] = true;
  } else pos.push(a);
}
const json = !!flags.json;
const out = (human: string, raw: any) => console.log(json ? JSON.stringify(raw, null, 1) : human);
const params = () => {
  const p: Record<string, any> = {};
  for (const kv of String(flags.param ?? '').split(',').filter(Boolean)) { const [k, v] = kv.split('='); p[k] = isNaN(+v) ? v : +v; }
  return p;
};

const HELP = `aec — ae-compose CLI (native After Effects from TSX)

  aec doctor                         check the whole environment
  aec build <scene.tsx> [--no-variants] [--variant A] [--version 3] [--frames 8] [--param k=v,..]
  aec watch <scene.tsx>              rebuild in place on save (keeps live control values)
  aec inspect [comp] [--full] [--project] [--layers 1,2]
  aec edit <ops.json> [--comp name]  apply agent edit ops (one undo step)
  aec undo                           Edit > Undo in AE
  aec snapshot [comp] --times 0,1.5,3
  aec sheet [comp] [--frames 12]     contact sheet
  aec preview [comp] [--range 0-3] [--scale 0.5] [--fps 15] [--gif]
  aec effects [query] [--describe <name>]
  aec import <file> [--folder name]
  aec dialogs [--answer <hwnd> <button>]
  aec eval "<extendscript>"
Add --json to any command for machine-readable output.`;

async function main() {
  switch (cmd) {
    case 'doctor': {
      const r = await doctor();
      out(r.checks.map((c) => `${c.ok ? '✔' : c.warn ? '!' : '✘'} ${c.name} — ${c.detail}${!c.ok && c.fix ? `\n    fix: ${c.fix}` : ''}`).join('\n') + `\n\n${r.ok ? 'All checks passed.' : 'Some checks failed.'}`, r);
      process.exitCode = r.ok ? 0 : 1;
      break;
    }
    case 'build': {
      if (!pos[0]) throw new Error('usage: aec build <scene.tsx>');
      const r = await buildScene({ file: pos[0] }, { variants: flags['no-variants'] ? false : flags.variant ? String(flags.variant).split(',') : true, version: flags.version ? +flags.version : undefined, frames: flags.frames !== undefined ? +flags.frames : 8, params: params() });
      out(`${r.ok ? '✔' : '✘'} ${r.scene}: ${r.comps.map((c) => `${c.name} (${c.layers} layers)`).join(', ')} in ${r.ms} ms${r.error ? `\n  error: ${r.error}` : ''}${r.warnings.length ? '\n  warnings:\n    ' + r.warnings.join('\n    ') : ''}${r.exprErrors.length ? '\n  expression errors:\n    ' + r.exprErrors.map((e) => `${e.node} ${e.prop}${e.src ? ` (${e.src})` : ''}: ${e.error}`).join('\n    ') : ''}${r.contactSheets.length ? `\n  contact sheet: ${r.contactSheets.join(', ')}` : ''}`, r);
      process.exitCode = r.ok ? 0 : 1;
      break;
    }
    case 'watch':
      if (!pos[0]) throw new Error('usage: aec watch <scene.tsx>');
      await watchScene(pos[0], { frames: flags.frames !== undefined ? +flags.frames : 6 });
      break;
    case 'inspect': {
      const r = await inspect(flags.project ? { project: true } : { comp: pos[0], detail: flags.full ? 'full' : 'outline', layers: flags.layers ? String(flags.layers).split(',').map((x) => (isNaN(+x) ? x : +x)) : undefined });
      out(r.outline, r.json);
      break;
    }
    case 'edit': {
      const file = pos[0];
      const input = JSON.parse(file === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(file, 'utf8'));
      const r = await applyEdits(Array.isArray(input) ? { comp: flags.comp as string, ops: input } : { comp: (flags.comp as string) ?? input.comp, ops: input.ops });
      out(`${r.ok ? '✔' : '✘'} ${r.comp}: ${r.changes?.length ?? 0} changes in ${r.ms} ms${r.error ? `\n  error: ${r.error} (${r.at})` : ''}${r.contactSheet ? `\n  contact sheet: ${r.contactSheet}` : ''}`, r);
      break;
    }
    case 'undo':
      out('undone', await undo());
      break;
    case 'snapshot': {
      const times = String(flags.times ?? '0').split(',').map(Number);
      const r = await snapshot(pos[0], times);
      out(r.files.join('\n'), r);
      break;
    }
    case 'sheet': {
      const r = await contactSheet(pos[0], flags.frames ? +flags.frames : 12);
      out(r.sheet, r);
      break;
    }
    case 'preview': {
      const [a, b] = String(flags.range ?? '').split('-').map(Number);
      const r = await renderPreview(pos[0], { start: isNaN(a) ? undefined : a, end: isNaN(b) ? undefined : b, scale: flags.scale ? +flags.scale : 0.5, fps: flags.fps ? +flags.fps : 15, gif: !!flags.gif });
      out(r.file, r);
      break;
    }
    case 'effects':
      if (flags.describe) { const r = await describeEffect(String(flags.describe)); out(`${r.name} (${r.matchName})\n` + r.params.map((p: any) => `  ${p.index}. ${p.name} [${p.mn}] ${p.type}${p.default !== undefined ? ` = ${JSON.stringify(p.default)}` : ''}${p.min !== undefined ? ` (${p.min}..${p.max})` : ''}${p.options ? `\n       ${p.options.join(' | ')}` : ''}`).join('\n'), r); }
      else { const r = listEffects(pos[0] ?? '', 80); out(r.map((e) => `${e.name}  [${e.mn}]  ${e.category}`).join('\n'), r); }
      break;
    case 'import':
      out(JSON.stringify(await importFootage(pos[0], flags.folder as string)), null);
      break;
    case 'dialogs': {
      if (flags.answer) { const r = await answerDialog(+flags.answer, pos[0] ?? 'OK'); out(JSON.stringify(r), r); break; }
      const r = await listDialogs();
      out(r.dialogs.length ? r.dialogs.map((d) => `hwnd ${d.hwnd} "${d.title}" ${d.owned ? '' : '(owner-less) '}buttons: ${d.buttons?.join(', ') || '(drawn by AE: see capture)'}\n  capture: ${d.capture}`).join('\n') : `no dialogs${r.hung ? ' (AE is busy / not responding)' : ''}`, r);
      break;
    }
    case 'eval': {
      const r = await runExtendScript(pos.join(' '));
      out(r.ok ? r.result : `error: ${r.error}`, r);
      break;
    }
    default:
      console.log(HELP);
  }
}

main().catch((e) => { console.error(`aec: ${e.message}`); if ((e as any).dialogs) console.error(JSON.stringify((e as any).dialogs, null, 1)); process.exitCode = 1; });
void path;
