// ES3 runtime entry: publishes $.global.AEC. Every public call returns a JSON string (our own stringify).
import { build } from './build';
import type { BuildOpts, IrProject } from './build';
import { stringify } from './json';
import { snapshotComp } from './snapshot';
import { findTaggedComp } from './project';

function guard(fn: () => any): string {
  try {
    return stringify(fn());
  } catch (e) {
    return stringify({ ok: false, error: String((e as any).message || e), line: (e as any).line });
  }
}

const AEC: any = {
  version: '__AEC_RUNTIME_VERSION__',
  ping: function () { return guard(() => ({ ok: true, version: AEC.version, ae: app.version, project: app.project.file ? app.project.file.fsName : null, items: app.project.numItems, bpc: app.project.bitsPerChannel })); },
  build: function (project: IrProject, opts: BuildOpts) { return guard(() => build(project, opts || {})); },
  snapshot: function (compRef: { id?: string; name?: string }, times: number[], dir: string) {
    return guard(() => {
      let comp: CompItem | null = compRef.id ? findTaggedComp(compRef.id) : null;
      if (!comp && compRef.name) {
        for (let i = 1; i <= app.project.numItems; i++) { const it = app.project.item(i); if (it instanceof CompItem && it.name === compRef.name) { comp = it; break; } }
      }
      if (!comp) return { ok: false, error: 'comp not found' };
      return { ok: true, result: snapshotComp(comp, times, dir, comp.name) };
    });
  },
};

$.global.AEC = AEC;
