// Recovery: get After Effects back to a state where ae-compose can work (D67).
//  - known dialogs are answered (Crash Repair → Continue), unknown ones reported with their captures;
//  - AE not running → launched, then we wait for the bridge (answering Crash Repair on the way);
//  - AE running but hung → reported. It is only killed and relaunched with `force`, which discards unsaved work, so
//    an agent passes it only after the user has agreed;
//  - AE responsive but the bridge silent → reported with the fix.
import { spawn, execFileSync } from 'node:child_process';
import { CepBackend } from '../bridge/cep.ts';
import { aeWindows, autoAnswerKnown } from '@ae-mcp/core/bridge/dialogs.ts';
import { findAfterEffects } from '../bridge/locate.ts';
import { resetBackend } from '../bridge/index.ts';

export interface RecoverResult {
  ok: boolean;
  /** What was found and what was done, in order. */
  steps: string[];
  state: 'ready' | 'dialog' | 'hung' | 'bridge-down' | 'not-running' | 'launch-failed';
  dialogs?: { hwnd: number; title: string; capture?: string }[];
  ms: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait for the CEP bridge to answer, answering Crash Repair (and other known dialogs) while AE starts. */
async function waitForBridge(steps: string[], timeoutMs: number): Promise<boolean> {
  const cep = new CepBackend();
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const h = await cep.health();
    if (h.ok) { steps.push(`bridge is up (${h.detail})`); resetBackend(); return true; }
    try {
      const w = await aeWindows();
      if (w.dialogs.length) { const a = await autoAnswerKnown(w); if (a.length) steps.push(`answered: ${a.join('; ')}`); }
    } catch { /* keep waiting */ }
    await sleep(3000);
  }
  return false;
}

export async function recover(opts: { force?: boolean; launch?: boolean; timeoutSec?: number } = {}): Promise<RecoverResult> {
  const t0 = Date.now();
  const steps: string[] = [];
  const done = (r: Omit<RecoverResult, 'steps' | 'ms'>): RecoverResult => ({ ...r, steps, ms: Date.now() - t0 });
  const timeoutMs = (opts.timeoutSec ?? 300) * 1000;
  const ae = findAfterEffects();
  let w = await aeWindows({ capture: true });

  if (w.running && w.dialogs.length) {
    const answered = await autoAnswerKnown(w);
    if (answered.length) steps.push(`answered: ${answered.join('; ')}`);
    await sleep(1500);
    w = await aeWindows({ capture: true });
    if (w.dialogs.length) {
      steps.push(`${w.dialogs.length} dialog(s) still open; look at the captures and answer with answer_dialog`);
      return done({ ok: false, state: 'dialog', dialogs: w.dialogs.map((d) => ({ hwnd: d.hwnd, title: d.title, capture: d.capture })) });
    }
  }

  if (w.running && w.hung) {
    if (!opts.force) {
      steps.push('After Effects is not responding. It may be busy (a long render or script): wait and retry. To kill and relaunch it, which loses unsaved work, ask the user first, then call recover with force');
      return done({ ok: false, state: 'hung' });
    }
    steps.push('force: ending the hung After Effects process (unsaved work is lost)');
    try { execFileSync('taskkill', ['/IM', 'AfterFX.exe', '/F'], { windowsHide: true }); } catch (e: any) { steps.push(`taskkill: ${e.message}`); }
    await sleep(4000);
    w = await aeWindows();
  }

  if (!w.running) {
    if (opts.launch === false) { steps.push('After Effects is not running'); return done({ ok: false, state: 'not-running' }); }
    if (!ae) { steps.push('After Effects not found (set AEC_AE_DIR)'); return done({ ok: false, state: 'launch-failed' }); }
    steps.push(`launching ${ae.exe}`);
    try { spawn(ae.exe, [], { detached: true, stdio: 'ignore', windowsHide: false }).unref(); } catch (e: any) { steps.push(`launch failed: ${e.message}`); return done({ ok: false, state: 'launch-failed' }); }
    if (await waitForBridge(steps, timeoutMs)) return done({ ok: true, state: 'ready' });
    const w2 = await aeWindows({ capture: true });
    steps.push(w2.running ? 'After Effects started but the bridge did not answer in time' : 'After Effects did not start');
    return done({ ok: false, state: w2.dialogs.length ? 'dialog' : 'launch-failed', dialogs: w2.dialogs.map((d) => ({ hwnd: d.hwnd, title: d.title, capture: d.capture })) });
  }

  const h = await new CepBackend().health();
  if (h.ok) { steps.push(`After Effects is responsive; ${h.detail}`); resetBackend(); return done({ ok: true, state: 'ready' }); }
  steps.push(`After Effects is running but the bridge is silent (${h.detail}). Open Window > Extensions > ae-compose once, or restart After Effects (ask the user: unsaved work)`);
  if (await waitForBridge(steps, Math.min(timeoutMs, 15_000))) return done({ ok: true, state: 'ready' });
  return done({ ok: false, state: 'bridge-down' });
}
