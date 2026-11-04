// Frame capture. saveFrameToPng is async in AE 26.5 (returns a task with wait()) (D12).
// 32 bpc projects write PNGs scaled ×0.1 (D13): we report the depth so Node can compensate.
import { each } from './util';

export interface SnapshotResult { comp: string; bpc: number; frames: { t: number; file: string; ok: boolean; error?: string }[] }

export function snapshotComp(comp: CompItem, times: number[], dir: string, prefix: string): SnapshotResult {
  const folder = new Folder(dir);
  if (!folder.exists) folder.create();
  const res: SnapshotResult = { comp: comp.name, bpc: app.project.bitsPerChannel, frames: [] };
  const safe = String(prefix).replace(/[^A-Za-z0-9_\-]+/g, '_');
  each(times, (t, i) => {
    const f = new File(folder.fsName + '/' + safe + '_' + ('000' + i).slice(-3) + '.png');
    try {
      const task: any = (comp as any).saveFrameToPng(t, f);
      if (task && typeof task.wait === 'function') task.wait();
      res.frames.push({ t: t, file: f.fsName, ok: f.exists });
    } catch (e) {
      res.frames.push({ t: t, file: f.fsName, ok: false, error: String(e) });
    }
  });
  return res;
}
