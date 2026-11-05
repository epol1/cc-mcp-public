// ES3 runtime entry: publishes $.global.AEC. Every public call returns a JSON string (our own stringify).
import { build } from './build';
import type { BuildOpts, IrProject } from './build';
import { stringify } from './json';
import { snapshotComp } from './snapshot';
import { findTaggedComp } from './project';
import { inspectComp, inspectProject } from './inspect';
import type { InspectOpts } from './inspect';
import { edit } from './edit';
import type { EditOp } from './edit';
import { contactFrames, describeEffect, importFile, layerSourceFrame, previewItem } from './tools';
import { lintSample } from './lint';
import { motionSample } from './motion';
import type { MotionSampleOpts } from './motion';
import { renderComp, renderTemplates } from './render';
import type { RenderCompOpts } from './render';
import type { LintSampleOpts } from './lint';

/**
 * Read-only tools that need a temporary comp (effect description, footage previews) leave a no-op undo group
 * behind; count them so AEC.undo() still undoes the last real build/edit in one call.
 */
function noopGroup(name: string, fn: () => any): any {
  app.beginUndoGroup('ae-compose: ' + name);
  try { return fn(); } finally { app.endUndoGroup(); $.global.__aecNoopUndos = ($.global.__aecNoopUndos || 0) + 1; }
}
/**
 * A build or edit: no-op groups before it are buried under it. After AE has cleared its undo history (a render or a
 * cache purge, see __aecHistory), count the real steps made since, so undo never claims more than AE can do.
 */
function realChange(fn: () => any): any {
  $.global.__aecNoopUndos = 0;
  const r = fn();
  const h = $.global.__aecHistory;
  if (h && r && r.ok) h.steps++;
  return r;
}

/** App-wide cache purge (frees AE's disk cache). AE also drops its undo history with it, so record that. */
function purgeCaches(): any {
  app.purge(PurgeTarget.ALL_CACHES);
  $.global.__aecNoopUndos = 0;
  $.global.__aecHistory = { reason: 'a cache purge', steps: 0 };
  return { ok: true };
}

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
  build: function (project: IrProject, opts: BuildOpts) { return guard(() => realChange(() => build(project, opts || {}))); },
  inspect: function (target: any, opts: InspectOpts) { return guard(() => (target === 'project' ? inspectProject() : inspectComp(target && target.comp !== undefined ? target.comp : target, opts || {}))); },
  edit: function (target: any, ops: EditOp[], opts: any) { return guard(() => realChange(() => edit(target || {}, ops || [], opts || {}))); },
  /** Edit > Undo (command 16): used by tests to prove each build/edit undoes in one step. */
  describeEffect: function (mn: string) { return guard(() => noopGroup('describe effect', () => describeEffect(mn))); },
  importFile: function (path: string, folder?: string) { return guard(() => importFile(path, folder)); },
  contactFrames: function (ref: any, n: number, dir: string, times?: number[]) { return guard(() => contactFrames(ref, n, dir, times)); },
  previewItem: function (ref: any, n: number, dir: string, times?: number[]) { return guard(() => noopGroup('preview', () => previewItem(ref, n, dir, times))); },
  layerSourceFrame: function (comp: any, layer: any, t: number, dir: string) { return guard(() => noopGroup('sample frame', () => layerSourceFrame(comp, layer, t, dir))); },
  lintSample: function (comp: any, opts: LintSampleOpts) { return guard(() => noopGroup('lint', () => lintSample(comp, opts || {}))); },
  motionSample: function (comp: any, opts: MotionSampleOpts) {
    return guard(() => noopGroup('motion sample', () => {
      let c: any = null;
      if (comp === null || comp === undefined) c = app.project.activeItem;
      else if (typeof comp === 'number') c = app.project.itemByID(comp);
      else c = findTaggedComp(String(comp));
      if (!c) for (let i = 1; i <= app.project.numItems; i++) { const it = app.project.item(i); if (it instanceof CompItem && it.name === comp) { c = it; break; } }
      if (!(c instanceof CompItem)) return { ok: false, error: 'comp not found: ' + comp };
      return motionSample(c, opts || {});
    }));
  },
  render: function (comp: any, opts: RenderCompOpts) { return guard(() => renderComp(comp, opts)); },
  purgeCaches: function () { return guard(() => purgeCaches()); },
  renderTemplates: function () { return guard(() => noopGroup('render templates', () => renderTemplates())); },
  /**
   * Edit > Undo for the last `steps` ae-compose builds/edits (a variant build is one step per variant plus one
   * for the compare comp; the build report says how many). Read-only probes since then are skipped. This is AE's
   * own Undo: changes made by hand in AE after the last ae-compose call are undone first.
   */
  undo: function (steps?: number) {
    return guard(() => {
      const n = Math.max(1, steps || 1);
      const extra = $.global.__aecNoopUndos || 0;
      // AE cleared its history at a render or cache purge: only the steps made since then exist.
      const h = $.global.__aecHistory;
      const can = h ? Math.min(n, h.steps) : n;
      if (can > 0) for (let i = 0; i < can + extra; i++) app.executeCommand(16);
      if (can > 0) $.global.__aecNoopUndos = 0;
      if (h) h.steps -= can;
      if (can < n) return { ok: can > 0, steps: can, skippedProbes: can > 0 ? extra : 0, error: (can ? 'only ' + can + ' step(s) could be undone: ' : 'nothing to undo: ') + 'After Effects cleared its undo history at ' + h.reason + ', so earlier builds and edits can no longer be undone (they are still in the project; rebuild or edit to change them).' };
      return { ok: true, steps: n, skippedProbes: extra };
    });
  },
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
