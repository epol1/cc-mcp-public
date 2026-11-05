// export_mogrt in AE (pnpm test:ae, or `node --import tsx tests/integration/mogrt/mogrt.ts`): in a throwaway saved
// project, build a lower third with two EG texts and a control; the export is refused while the project has unsaved
// changes and works with save: true; check the file and its fields, and that undo reports the history AE cleared. An
// unsaved project is refused too, in both cases without AE's modal "needs to be saved first" prompt. A karaoke caption
// template (<Captions template>) is checked and exported too. The files are kept in ~/.ae-compose/test/ for the
// Premiere test (tests/premiere/mogrt.ts). Prints PASS/FAIL lines.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { check, done, findComp, es } from '../p5/harness.ts';
import sharp from 'sharp';
import { buildScene, exportMogrt, snapshot, undo } from '../../../src/api/index.ts';
import { callRuntime } from '../../../src/bridge/index.ts';
import { quickDialogs } from '@ae-mcp/core/bridge/dialogs.ts';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const SCENE = path.join(HERE, 'lowerthird-scene.tsx');
export const MOGRT_FIXTURE = path.join(os.homedir(), '.ae-compose', 'test', 'AecMogrtLowerThird.mogrt');
export const KARAOKE_FIXTURE = path.join(os.homedir(), '.ae-compose', 'test', 'AecKaraokeCaption.mogrt');
const RUN = path.join(os.tmpdir(), 'aec-mogrt', String(Date.now()));
const AEP = path.join(RUN, 'mogrt-test.aep');
const js = (s: string) => JSON.stringify(s.split(path.sep).join('/'));

const ping = await callRuntime('ping', [], { timeoutMs: 20_000 });
const dev: string | null = ping.project;
if (!dev && (await es('app.project.dirty ? "1" : "0"')) === '1') {
  check('an unsaved project with changes is open: save or close it first (this check opens its own project)', false);
  done();
  process.exit();
}
fs.mkdirSync(RUN, { recursive: true });
// As in the Phase 6 check: the dev project is ours, saved so a new project opens without a prompt.
if (dev) await es('if (app.project.dirty) app.project.save(); "saved"', 600_000);
await es(`app.newProject(); app.project.save(new File(${js(AEP)})); app.project.file.fsName`);
try {
  const b = await buildScene({ file: SCENE }, { frames: 4 });
  check('lower third builds', b.ok, b.error);
  const comp = b.comps[0].name;
  const r0 = await exportMogrt(comp, { out: MOGRT_FIXTURE, overwrite: true });
  check('unsaved changes are refused without save', !r0.ok && /unsaved changes/.test(r0.error ?? ''), r0.error);
  check('without a prompt', (await quickDialogs()).length === 0);
  const r = await exportMogrt(comp, { out: MOGRT_FIXTURE, overwrite: true, save: true });
  check('save: true saves in place, then exports', r.ok && !!r.saved, r.error);
  check('no dialog left open', (await quickDialogs()).length === 0);
  console.log(`  export warnings answered: ${r.warnings.length} ${r.warnings.join(', ')}`);
  check('file written', r.ok && fs.statSync(MOGRT_FIXTURE).size > 10_000, String(r.bytes));
  check('fields are the EG properties', ['Name', 'Role', 'Accent Color'].every((f) => r.fields.includes(f)), r.fields.join(', '));
  check('template named after the scene', /^AecMogrtLowerThird/.test(r.template ?? ''), r.template);
  let entries = '';
  try { entries = execFileSync(path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'tar.exe'), ['-tf', MOGRT_FIXTURE], { encoding: 'utf8' }); } catch (e: any) { entries = String(e.message); }
  check('a mogrt package (definition.json inside)', /definition\.json/.test(entries), entries.slice(0, 300));
  // AE clears its undo history at the export (saving alone keeps it): undo says so and changes nothing.
  const u = await undo(1);
  check('undo reports the history AE cleared at the export', !u.ok && /template export/.test(u.error ?? '') && (await es(`${findComp(comp)} ? "1" : "0"`)) === '1', JSON.stringify(u));
  const missing = await exportMogrt('AecNoSuchComp').then((x) => x.error ?? 'ok', (e) => String(e.message));
  check('a missing comp is an error', /not found/.test(missing), missing);

  // A karaoke caption template: the highlight advances with the word times, the "Word Times" field drives it, the
  // text keeps its bottom centre on the title-safe line, and it exports with both fields.
  const k = await buildScene({ file: path.join(HERE, 'karaoke-scene.tsx') }, { frames: 2, lint: false });
  check('karaoke template builds', k.ok, k.error);
  const kc = k.comps[0].name;
  const yellow = async (t: number) => {
    const f = (await snapshot(kc, [t])).files[0];
    const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let n = 0, bottom = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      if (data[i] > 200 && data[i + 1] > 170 && data[i + 2] < 120) n++;
      if (data[i] > 200 && data[i + 1] > 170) bottom = Math.max(bottom, Math.floor(i / 4 / info.width));
    }
    return { n, bottom };
  };
  const early = await yellow(0.1), late = await yellow(2.95);
  check('the highlight advances word by word', late.n > early.n * 3 && late.n > 500, `${early.n} → ${late.n}`);
  check('the caption sits on the title-safe bottom line', late.bottom > 930 && late.bottom < 1000, String(late.bottom));
  const times = `(function () { var c = ${findComp(kc)}; return c.layer("Word Times").property("ADBE Text Properties").property("ADBE Text Document"); })()`;
  const orig = await es(`${times}.value.text`);
  await es(`${times}.setValue(new TextDocument("0 0 0 0 0 0 0 0")); "set"`);
  const allLit = await yellow(0.1);
  await es(`${times}.setValue(new TextDocument(${JSON.stringify(orig)})); "restored"`);
  check('the Word Times field drives it (all 0 → every word lit at once)', allLit.n > late.n * 0.8, `${allLit.n} vs ${late.n}`);
  const kr = await exportMogrt(kc, { out: KARAOKE_FIXTURE, overwrite: true, save: true });
  check('karaoke template exports', kr.ok, kr.error);
  check('its fields are Caption and Word Times', ['Caption', 'Word Times'].every((f) => kr.fields.includes(f)), kr.fields.join(', '));

  // An unsaved project: refused, no prompt.
  await es('app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES); app.newProject(); "new"');
  const b2 = await buildScene({ file: SCENE }, { frames: 2, lint: false });
  const r2 = await exportMogrt(b2.comps[0].name, { out: path.join(RUN, 'unsaved.mogrt') });
  check('an unsaved project is refused', !r2.ok && /saved project/.test(r2.error ?? ''), r2.error);
  check('without a prompt', (await quickDialogs()).length === 0);
  await es('app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES); "closed"');
} finally {
  if (dev) await es(`app.open(new File(${js(dev)})); "reopened"`, 600_000);
  else if (!(await es('app.project ? "1" : "0"').catch(() => '0')).startsWith('1')) await es('app.newProject(); "new"');
}
done();
