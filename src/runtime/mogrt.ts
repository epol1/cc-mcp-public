// Motion Graphics templates (.mogrt) for Premiere: the comp's Essential Graphics properties (texts with eg=,
// control(), field()) become the template's fields. AE packages the comp and everything it uses into the file.
// AE exports only from a saved project with no unsaved changes (otherwise it stops on a modal "The project needs to
// be saved first" prompt), so such a project is refused here, or saved in place when the caller says so.
import { findComp } from './inspect';

/** `folder`: AE writes "<template name>.mogrt" into it (the API moves it to its file name). */
export function exportMogrt(ref: any, folder: string, save?: boolean): any {
  const c = findComp(ref);
  if (!c) return { ok: false, error: 'comp not found: ' + ref };
  if (!app.project.file) return { ok: false, error: 'After Effects exports templates only from a saved project: save the project (File > Save As), then export again' };
  const n = c.motionGraphicsTemplateControllerCount;
  if (!n) return { ok: false, error: '"' + c.name + '" has no Essential Graphics properties: give texts eg="Label" or use control() / field(), so Premiere has something to edit' };
  if (!c.motionGraphicsTemplateName) c.motionGraphicsTemplateName = c.name;
  let saved = false;
  if (app.project.dirty) {
    if (!save) return { ok: false, error: 'After Effects exports templates only when the project has no unsaved changes: pass save: true to save it in place first (ask the user), or save it yourself' };
    app.project.save();
    saved = true;
  }
  const fields: string[] = [];
  for (let i = 1; i <= n; i++) fields[fields.length] = c.getMotionGraphicsTemplateControllerName(i);
  // Everything is read first: after the export the comp object is invalid ("Object is invalid").
  const out = { ok: true, comp: c.name, template: c.motionGraphicsTemplateName, fields: fields, w: c.width, h: c.height, dur: c.duration, fps: c.frameRate, saved: saved };
  if (!c.exportAsMotionGraphicsTemplate(true, folder)) return { ok: false, error: 'After Effects did not export the template', comp: out.comp };
  // The export clears AE's undo history (verified: saving alone keeps it), like a render (D65).
  $.global.__aecNoopUndos = 0;
  $.global.__aecHistory = { reason: 'the template export of "' + out.comp + '"', steps: 0 };
  return out;
}
