// Final renders through AE's own Render Queue (renders the live, unsaved project state). renderQueue.render()
// must run OUTSIDE any undo group: inside one, AE shows "Undo group mismatch" and the bridge stalls (D65). So the
// item is added and configured in one small undo group, rendered, then removed in another. The render itself clears
// AE's undo history, so afterwards only the cleanup group exists (counted as a no-op) and AEC.undo knows nothing
// older can be undone (D65). Other queued items of the user's are parked (render =
// false) for the duration and re-queued afterwards; their settings are never touched.
import { findComp } from './inspect';
import { errText, indexOf } from './util';

export interface RenderCompOpts {
  /** Output module template (exact AE name). */
  template: string;
  /** Render settings template ("Best Settings", "Draft Settings"). */
  settings: string;
  /** Output path without extension; the template decides the extension (and "_[#####]" for sequences). */
  base: string;
  start?: number;
  end?: number;
  workArea?: boolean;
}

const STATUS: { [k: number]: string } = {};
(function () {
  const names = ['WILL_CONTINUE', 'NEEDS_OUTPUT', 'UNQUEUED', 'QUEUED', 'RENDERING', 'USER_STOPPED', 'ERR_STOPPED', 'DONE'];
  for (let i = 0; i < names.length; i++) { const v = (RQItemStatus as any)[names[i]]; if (v !== undefined) STATUS[v] = names[i]; }
})();

function noop(): void { $.global.__aecNoopUndos = ($.global.__aecNoopUndos || 0) + 1; }

/** Output module and render settings template names available in this AE (for errors and the tool docs). */
export function renderTemplates(): any {
  const c = app.project.items.addComp('__aec_rq_probe', 16, 16, 1, 1, 30);
  const rq = app.project.renderQueue;
  try {
    const item = rq.items.add(c);
    const o = { ok: true, outputModules: item.outputModule(1).templates, settings: item.templates };
    item.remove();
    return o;
  } finally { c.remove(); }
}

export function renderComp(ref: any, o: RenderCompOpts): any {
  const c = findComp(ref);
  if (!c) return { ok: false, error: 'comp not found: ' + ref };
  const rq = app.project.renderQueue;
  const parked: RenderQueueItem[] = [];
  let item: RenderQueueItem | null = null;
  const start = o.workArea ? c.workAreaStart : Math.max(0, o.start || 0);
  const end = o.workArea ? c.workAreaStart + c.workAreaDuration : Math.min(c.duration, o.end !== undefined ? o.end : c.duration);
  if (end - start < c.frameDuration / 2) return { ok: false, error: 'empty time span ' + start + '–' + end + ' s' };
  let file = '';
  app.beginUndoGroup('ae-compose: render setup');
  try {
    for (let k = 1; k <= rq.numItems; k++) { const x = rq.item(k); if (x.render && x.status === RQItemStatus.QUEUED) { x.render = false; parked[parked.length] = x; } }
    item = rq.items.add(c);
    if (indexOf(item.templates, o.settings) < 0) throw new Error('render settings template "' + o.settings + '" not found (have: ' + item.templates.join(', ') + ')');
    item.applyTemplate(o.settings);
    item.timeSpanStart = start;
    item.timeSpanDuration = end - start;
    const om = item.outputModule(1);
    if (indexOf(om.templates, o.template) < 0) throw new Error('output module template "' + o.template + '" not found (have: ' + om.templates.join(', ') + ')');
    om.applyTemplate(o.template);
    // The template's default file name tells the extension and whether it is a frame sequence.
    const def = decodeURI(String(om.file ? om.file.name : ''));
    const ext = /\.([A-Za-z0-9]+)$/.exec(def);
    const seq = def.indexOf('[#') >= 0;
    file = o.base + (seq ? '_[#####]' : '') + (ext ? '.' + ext[1] : '');
    const folder = new Folder(new File(file).path);
    if (!folder.exists) folder.create();
    om.file = new File(file);
  } catch (e) {
    if (item) { try { item.remove(); } catch (e2) {} }
    for (let k = 0; k < parked.length; k++) { try { parked[k].render = true; } catch (e3) {} }
    app.endUndoGroup(); noop();
    return { ok: false, error: errText(e) };
  }
  app.endUndoGroup(); noop();

  const t0 = new Date().getTime();
  let err = '';
  try { rq.render(); } catch (e) { err = errText(e); }
  const ms = new Date().getTime() - t0;
  const status = STATUS[item.status] || String(item.status);
  let out = file;
  try { out = item.outputModule(1).file.fsName; } catch (e) {}

  app.beginUndoGroup('ae-compose: render cleanup');
  try {
    try { item.remove(); } catch (e) {}
    for (let k = 0; k < parked.length; k++) { try { parked[k].render = true; } catch (e) {} }
  } finally { app.endUndoGroup(); }
  // A scripted render clears AE's undo history (verified: nothing before it can be undone). The cleanup group is now
  // the only entry: count it as a no-op and remember the floor for AEC.undo.
  $.global.__aecNoopUndos = 1;
  $.global.__aecHistory = { reason: 'the render of "' + c.name + '"', steps: 0 };
  return { ok: !err && status === 'DONE', error: err || (status !== 'DONE' ? 'render ended with status ' + status : undefined), status: status, file: out, comp: c.name, start: start, end: end, w: c.width, h: c.height, fps: c.frameRate, ms: ms };
}
