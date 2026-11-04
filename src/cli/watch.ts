// `aec watch`: rebuilds the scene in place on every save (same comp, live control values kept).
import path from 'node:path';
import chokidar from 'chokidar';
import { buildScene } from '../api/build.ts';

export async function watchScene(file: string, opts: { frames?: number } = {}): Promise<void> {
  const abs = path.resolve(file);
  let running = false, queued = false;
  const run = async () => {
    if (running) { queued = true; return; }
    running = true;
    const t = new Date().toLocaleTimeString();
    try {
      const r = await buildScene({ file: abs }, { replace: true, frames: opts.frames ?? 6, open: true });
      console.log(`[${t}] ${r.ok ? '✔' : '✘'} ${r.comps.map((c) => c.name).join(', ')} ${r.ms} ms${r.restoredControls ? `, kept ${r.restoredControls} control values` : ''}${r.error ? ` — ${r.error}` : ''}${r.warnings.length ? ` — ${r.warnings.length} warning(s): ${r.warnings[0]}` : ''}${r.contactSheets[0] ? `\n           sheet: ${r.contactSheets[0]}` : ''}`);
    } catch (e: any) {
      console.log(`[${t}] ✘ ${e.message}`);
    }
    running = false;
    if (queued) { queued = false; run(); }
  };
  console.log(`watching ${abs} (Ctrl+C to stop)`);
  await run();
  const w = chokidar.watch(path.dirname(abs), { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 30 } });
  w.on('change', (p: string) => { if (/\.(tsx?|json)$/.test(p)) run(); });
  await new Promise(() => {});
}
