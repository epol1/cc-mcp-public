// Phase 6 AE integration check (pnpm test:ae, or `node --import tsx tests/integration/p6/assets.ts`).
// In a throwaway project saved under %TEMP%\aec-p6 (the dev project is saved and reopened at the end):
//  1. fetch one asset of each kind (fetch_asset path): files land in footage/ next to the .aep, are imported
//     (not icons/fonts) and credited; one fetch import undoes in one step;
//  2. build a scene that uses every kind through `asset:` sources; one undo restores the comp exactly;
//  3. rebuild, save, and run AE's own File > Dependencies > Collect Files: every fetched file is in the collection;
//  4. move the project folder and reopen it: no footage is missing.
// Prints PASS/FAIL lines like the Phase 5 checks.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { check, done, es, buildUndoCheck } from '../p5/harness.ts';
import { buildScene } from '../../../src/api/index.ts';
import { fetchAssetTool } from '../../../src/api/assets.ts';
import { creditedIds } from '@ae-mcp/core/assets/credits.ts';
import { callRuntime } from '../../../src/bridge/index.ts';
import { clickDialogButton, pressDialog, quickDialogs, setDialogText } from '@ae-mcp/core/bridge/dialogs.ts';

// A fresh folder per run: AE keeps handles on footage of a closed project (an older run's MP4 can't be deleted).
const RUN = path.join(os.tmpdir(), 'aec-p6', String(Date.now()));
const ROOT = path.join(RUN, 'project');
const AEP = path.join(ROOT, 'p6-assets.aep');
const COLLECTED = path.join(RUN, 'collected');
const SCENE = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'assets-scene.tsx');
const js = (s: string) => JSON.stringify(s.replace(/\\/g, '/'));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const FETCHES: { id: string; variant?: string; kind: string; imported: boolean }[] = [
  { id: 'iconify:lucide:rocket', kind: 'icon', imported: false },
  { id: 'polyhaven:brown_photostudio_02', variant: '1k-hdr', kind: 'hdri', imported: true },
  { id: 'polyhaven:rubber_duck_toy', variant: '1k-gltf', kind: 'model', imported: true },
  { id: 'ambientcg:Paper006', variant: '1k-jpg', kind: 'texture', imported: true },
  { id: 'pixabay:2297204', variant: 'web', kind: 'photo', imported: true },
  { id: 'pixabay:video:4006', variant: '360p', kind: 'video', imported: true },
  { id: 'unsplash:cckf4TsHAuw', variant: 'regular', kind: 'photo', imported: true },
  { id: 'openverse:audio:eab8a6e2-0ac8-4615-9e0d-ebde30523783', kind: 'audio', imported: true },
  { id: 'fontsource:space-grotesk', variant: 'full', kind: 'font', imported: false },
];

async function itemCount(): Promise<number> { return +(await es('app.project.numItems')); }

/**
 * Closes every dialog AE has open and waits until none is left. MUST run before any further project call when a
 * dialog flow fails: AE crashed (2026-11-05, D99) when a Collect Files dialog was cancelled after its project had
 * been closed underneath it (a native file dialog's modal loop still lets bridge evals run).
 */
async function closeDialogs(): Promise<boolean> {
  for (let i = 0; i < 20; i++) {
    let ds: { hwnd: number; title: string }[];
    try { ds = await quickDialogs(); } catch { await sleep(1000); continue; }
    if (!ds.length) return true;
    // Innermost first (the last listed is usually on top): WM_CLOSE answers Cancel.
    for (const d of ds.slice().reverse()) await pressDialog(d.hwnd, 'Cancel').catch(() => undefined);
    await sleep(1000);
  }
  return false;
}

/**
 * Drives File > Dependencies > Collect Files (command 2482) into `dest`: AE's own options dialog (Enter = "Collect…"),
 * then the Windows "Collect files into folder" dialog, where only the File name box is filled (Win32, by control
 * id) and Save (button 1) is clicked. Any surprise: every dialog is cancelled before returning (D99).
 */
async function collectFiles(dest: string): Promise<{ ok: boolean; detail: string }> {
  const log: string[] = [];
  const fail = async (detail: string) => {
    const closed = await closeDialogs();
    return { ok: false, detail: `${detail}; ${log.join('; ')}${closed ? '' : '; DIALOGS STILL OPEN'}` };
  };
  await es(`app.scheduleTask("app.executeCommand(2482)", 300, false); "scheduled"`);
  let stage = 0;
  for (let i = 0; i < 180; i++) {
    await sleep(1000);
    let ds: { hwnd: number; title: string }[];
    try { ds = await quickDialogs(); } catch (e: any) { log.push(`list failed: ${e.message}`); continue; }
    const d = ds[ds.length - 1];
    if (!d) {
      // Done when the dialogs are gone and the collected project is on disk.
      if (stage === 2 && fs.existsSync(dest) && listFiles(dest).some((f) => /\.aep$/i.test(f))) return { ok: true, detail: log.join('; ') };
      if (stage === 2 && i > 150) return fail('the dialogs closed but no collected project appeared');
      continue;
    }
    if (stage === 0 && /^Collect Files$/i.test(d.title)) {
      log.push(d.title);
      const r = await pressDialog(d.hwnd, 'Collect...');
      log.push(`collect: ${r.via}`);
      stage = 1;
    } else if (stage === 1 && /into folder/i.test(d.title)) {
      log.push(d.title);
      const t = await setDialogText(d.hwnd, dest);
      if (!t.set) return fail(`could not fill the File name box: ${t.error ?? `it reads "${t.value}"`}`);
      await sleep(300);
      const r = await clickDialogButton(d.hwnd, 1);
      if (!r.pressed) return fail(`could not press Save: ${r.error}`);
      log.push('save: bm_click');
      stage = 2;
    } else if (stage === 2) {
      // Collecting: a progress window may come and go. Anything that stays a long time is a problem.
      if (i > 150) return fail(`dialog "${d.title}" still open after saving`);
    } else if (i > 20) return fail(`unexpected dialog "${d.title}" at stage ${stage}`);
  }
  return fail('timed out');
}

const listFiles = (dir: string): string[] => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listFiles(path.join(dir, e.name)) : [path.join(dir, e.name)])) : [];

async function main() {
  const ping = await callRuntime('ping', [], { timeoutMs: 20_000 });
  const dev: string | null = ping.project;
  // Older runs, best effort (files AE still holds stay until AE lets go).
  for (const old of fs.existsSync(path.dirname(RUN)) ? fs.readdirSync(path.dirname(RUN)) : []) { try { fs.rmSync(path.join(path.dirname(RUN), old), { recursive: true, force: true }); } catch { /* in use */ } }
  fs.mkdirSync(ROOT, { recursive: true });
  // The dev project is ours (scratch/): save it so a new project can open without a prompt, reopen it at the end.
  if (dev) await es('if (app.project.dirty) app.project.save(); "saved"', 600_000);
  await es(`app.newProject(); app.project.bitsPerChannel = 16; app.project.save(new File(${js(AEP)})); app.project.file.fsName`);
  check('throwaway project saved', fs.existsSync(AEP));
  try {
    // 1. fetch_asset, each kind.
    const fetched: Record<string, string[]> = {};
    for (const f of FETCHES) {
      try {
        const r = await fetchAssetTool({ id: f.id, variant: f.variant });
        fetched[f.id] = [r.file, ...r.files];
        check(`fetch ${f.kind} ${f.id}: in the project's footage folder`, r.inProject && path.resolve(r.file).startsWith(path.join(ROOT, 'footage')), r.file);
        check(`fetch ${f.kind} ${f.id}: ${f.imported ? 'imported' : 'not imported'}`, !!r.imported === f.imported, JSON.stringify(r.imported));
        if (f.kind === 'model') check('model packed into one .glb', /\.glb$/i.test(r.file), r.file);
        if (f.kind === 'icon') check('icon is a sanitized .svg', /\.svg$/i.test(r.file) && !/<script/i.test(fs.readFileSync(r.file, 'utf8')));
        if (f.kind === 'texture') check('texture: color map plus the other maps', /color/i.test(path.basename(r.file)) && r.files.length >= 2, `${r.file} + ${r.files.length}`);
      } catch (e: any) { check(`fetch ${f.kind} ${f.id}`, false, e.message); }
    }
    const credited = creditedIds(path.join(ROOT, 'CREDITS.md'));
    check('CREDITS.md lists every fetch', FETCHES.every((f) => credited.includes(f.id)), `missing: ${FETCHES.filter((f) => !credited.includes(f.id)).map((f) => f.id).join(', ')}`);
    // A fetch import is one undo step (a variant not imported yet).
    const before = await itemCount();
    const again = await fetchAssetTool({ id: 'polyhaven:brown_photostudio_02', variant: '2k-hdr' });
    const afterImport = await itemCount();
    const u = await callRuntime('undo', [1]);
    const afterUndo = await itemCount();
    check('a fetch import is one undo step', !!again.imported && afterImport === before + 1 && afterUndo === before && !!u.ok, `${before} → ${afterImport} → ${afterUndo}`);

    // 2. A scene using every kind through asset: sources; one undo restores it exactly.
    await buildUndoCheck('asset: scene', SCENE, 'P6Assets_v001', { frames: 4, motion: false }, async (r) => {
      check('asset: refs resolved and copied into the project', (r.assets?.length ?? 0) >= 8 && r.assets!.every((a) => a.inProject), JSON.stringify(r.assets?.map((a) => [a.id, a.inProject])));
      const ir = JSON.parse(fs.readFileSync(r.irFile!, 'utf8'));
      const outside = (ir.assets ?? []).filter((a: any) => a.path && !path.resolve(a.path).startsWith(ROOT));
      check('IR footage points at the project copies', outside.length === 0, outside.map((a: any) => a.path).join(', '));
      check('scene credits written next to the project', (r.credits ?? []).some((c) => path.dirname(c) === ROOT));
      console.log(`contact sheet: ${r.contactSheets[0]}`);
    });

    // 3. Rebuild (kept), save, Collect Files.
    const kept = await buildScene({ file: SCENE }, { frames: 4, motion: false });
    check('rebuild for collect', kept.ok, kept.error);
    if (kept.contactSheets[0]) console.log(`contact sheet: ${kept.contactSheets[0]}`);
    await es('app.project.save(); "saved"');
    const col = await collectFiles(COLLECTED);
    check('Collect Files ran', col.ok, col.detail);
    const collected = listFiles(COLLECTED).map((f) => path.basename(f).toLowerCase());
    const used = (kept.assets ?? []).map((a) => path.basename(a.file).toLowerCase()).filter((n) => !n.endsWith('.svg'));
    const missing = used.filter((n) => !collected.includes(n));
    check('Collect Files kept every fetched file the scene uses', col.ok && used.length >= 7 && missing.length === 0, `missing: ${missing.join(', ')} (collected ${collected.length} files)`);

    // 4. Open the collected project: every footage item resolves inside the collection, none missing. (Renaming the
    // project folder instead failed with EPERM: AE keeps handles on footage after the project closes.) Never touch
    // the project while a dialog is open.
    if (!(await closeDialogs())) throw new Error('a dialog is still open in After Effects: stopping without touching the project');
    const collectedAep = listFiles(COLLECTED).find((f) => /\.aep$/i.test(f));
    if (col.ok && collectedAep) {
      await es(`app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES); app.open(new File(${js(collectedAep)})); "opened"`, 600_000);
      const r = JSON.parse(await es(`(function(){var root=${js(COLLECTED)}.toLowerCase(),miss=[],out=[],n=0;for(var i=1;i<=app.project.numItems;i++){var it=app.project.item(i);if(!(it instanceof FootageItem)||!it.file)continue;n++;if(it.footageMissing)miss.push(it.name);var p=it.file.fsName.replace(/\\\\/g,"/").toLowerCase();if(p.indexOf(root)!==0)out.push(it.name);}return '{"n":'+n+',"miss":"'+miss.join("|")+'","out":"'+out.join("|")+'"}';})()`));
      check('collected project: every footage item found', r.n >= 7 && r.miss === '', `${r.n} items, missing: ${r.miss}`);
      check('collected project: footage relinked inside the collection', r.out === '', `outside: ${r.out}`);
    }
  } catch (e: any) {
    check('phase 6 asset checks ran to the end', false, e.message);
  } finally {
    // Back to the dev project without saving the throwaway one, but only with no dialog open (see closeDialogs).
    if (await closeDialogs()) {
      try { await es(`app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES); ${dev ? `app.open(new File(${js(dev)}));` : ''} "back"`, 600_000); } catch (e: any) { console.log(`could not reopen the dev project: ${e.message}`); }
    } else console.log('a dialog is still open in After Effects: left the project as it is (answer the dialog, then reopen the dev project)');
  }
  done();
}

main();
