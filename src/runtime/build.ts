// AEC.build: IR project → native comps, in ONE undo group (undo groups don't span evals).
// Passes: assets → per comp: create layers bottom-up → attrs/wiring/text → structure (groups) →
// values/keys → expressions → EG; then sticky controls, viewer, snapshots.
import type { Ctx } from './ctx';
import { AecError, newCtx, warn } from './ctx';
import type { IrAsset } from './project';
import { ensureFolder, ensureLib, findTaggedComp, importAsset } from './project';
import type { IrLayer } from './layers';
import { applyAnchorBox, applyFootage, createLayer, fitScale, lockIfNeeded, setLayerAttrs, tagOf, TAG, vectorToShapes, wireLayer } from './layers';
import type { Pending } from './groups';
import { applyProps, buildGroups, flushExpressions } from './groups';
import { setTextDocument } from './text';
import { byIndexPath, mustResolve } from './props';
import { snapshotComp } from './snapshot';
import type { IrLayout } from './layout';
import { measureLeaf, solveComp } from './layout';
import { each, errText, now } from './util';
import { lintSample } from './lint';
import type { LintSampleOpts } from './lint';
import { motionSample } from './motion';
import type { MotionSampleOpts } from './motion';

export interface IrComp {
  id: string;
  name: string;
  w: number;
  h: number;
  fps: number;
  dur: number;
  bg?: number[];
  par?: number;
  renderer?: string;
  motionBlur?: boolean;
  shutterAngle?: number;
  shutterPhase?: number;
  samples?: number;
  adaptive?: number;
  draft3d?: boolean;
  part?: boolean; // helper precomp → _parts folder
  layers: IrLayer[];
  markers?: { t: number; comment?: string; dur?: number }[];
  layouts?: IrLayout[];
  mgt?: { name: string; props: { layer: string; p: string; name: string }[] };
}

export interface IrProject {
  irVersion: number;
  scene: string;
  assets?: IrAsset[];
  comps: IrComp[]; // dependency order: precomps before the comps that use them
  main?: string;
  /** Footage-mode expression library to import or relink first (D73). */
  lib?: { item: string; file: string; version: string };
}

export interface BuildOpts {
  replace?: boolean;
  keepControls?: boolean;
  open?: boolean;
  snapshots?: { comp?: string; times: number[]; dir: string; prefix?: string }[];
  /** Lint samples of the main comp, taken inside the build's undo group (so one undo still reverts the build). */
  lint?: LintSampleOpts;
  /** Motion samples of the main comp (motion previews, style lint), also inside the undo group. */
  motion?: MotionSampleOpts;
}

const CONTROL_MN: { [mn: string]: boolean } = {
  'ADBE Slider Control': true, 'ADBE Color Control': true, 'ADBE Checkbox Control': true, 'ADBE Point Control': true,
  'ADBE Point3D Control': true, 'ADBE Angle Control': true, 'ADBE Dropdown Control': true, 'ADBE Layer Control': true,
};

function isControl(fx: PropertyGroup): boolean {
  return CONTROL_MN[fx.matchName] === true || fx.matchName.indexOf('Pseudo/') === 0;
}

/**
 * The tweakable values of a control effect, keyed by name: an expression control's one value ("Title Delay"), or
 * every value param of a rig (pseudo) effect ("aec Cloner/Speed"). Groups, keyed and opaque params are skipped.
 */
function controlParams(fx: PropertyGroup): { key: string; p: Property }[] {
  const out: { key: string; p: Property }[] = [];
  const pseudo = fx.matchName.indexOf('Pseudo/') === 0;
  const n = pseudo ? fx.numProperties : 1;
  for (let j = 1; j <= n; j++) {
    const p = fx.property(j) as Property;
    if (!p || p.propertyType !== PropertyType.PROPERTY || p.numKeys > 0) continue;
    const vt = p.propertyValueType;
    if (vt === PropertyValueType.CUSTOM_VALUE || vt === PropertyValueType.NO_VALUE || vt === PropertyValueType.LAYER_INDEX) continue;
    if (pseudo && p.matchName === 'ADBE Effect Built In Params') continue;
    out[out.length] = { key: pseudo ? fx.name + '/' + p.name : fx.name, p: p };
  }
  return out;
}

/** Build-time default of each control, stored in the layer comment after the tag ("aec:<id>;d=Rise=80&Rise%20Delay=0.2"). */
function storedDefaults(L: Layer): { [name: string]: any } {
  const c = L.comment || '';
  const i = c.indexOf(';d=');
  if (i < 0) return {};
  // Query-string format: escape(name)=v[,v...]&... (AE strips control characters from comments, so the
  // separators must be printable; escape() keeps "=" and "&" out of names).
  const out: { [name: string]: any } = {};
  const parts = c.substring(i + 3).split('&');
  for (let k = 0; k < parts.length; k++) {
    const eq = parts[k].indexOf('=');
    if (eq <= 0) continue;
    const vs = parts[k].substring(eq + 1).split(',');
    const nums: number[] = [];
    for (let j = 0; j < vs.length; j++) nums[j] = parseFloat(vs[j]);
    out[unescape(parts[k].substring(0, eq))] = nums.length === 1 ? nums[0] : nums;
  }
  return out;
}

function sameValue(a: any, b: any): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-6;
  if (a && b && a.length !== undefined && b.length !== undefined && a.length === b.length) {
    for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1e-6) return false;
    return true;
  }
  return a === b;
}

/** Records the code defaults of a layer's controls (called right after the build sets them). */
function stampDefaults(L: Layer): void {
  const fxp = L.property('ADBE Effect Parade') as PropertyGroup;
  if (!fxp) return;
  const d: string[] = [];
  let any = false;
  for (let k = 1; k <= fxp.numProperties; k++) {
    const fx = fxp.property(k) as PropertyGroup;
    if (!isControl(fx)) continue;
    const ps = controlParams(fx);
    for (let q = 0; q < ps.length; q++) {
      const v: any = ps[q].p.value;
      if (typeof v !== 'number' && !(v && v.length !== undefined)) continue;
      const vals: string[] = [];
      if (typeof v === 'number') vals[0] = String(v); else for (let j = 0; j < v.length; j++) vals[j] = String(v[j]);
      d[d.length] = escape(ps[q].key) + '=' + vals.join(',');
      any = true;
    }
  }
  if (!any) return;
  const tag = tagOf(L);
  if (tag) L.comment = TAG + tag + ';d=' + d.join('&');
}

/**
 * Reads control values that were changed IN AE (they differ from the default the previous build wrote), so a
 * rebuild keeps those tweaks (sticky controls) while untouched controls pick up new defaults from the code.
 */
function captureControls(comp: CompItem): { [key: string]: any } {
  const out: { [key: string]: any } = {};
  for (let i = 1; i <= comp.numLayers; i++) {
    const L = comp.layer(i);
    const tag = tagOf(L);
    if (!tag) continue;
    const fxp = L.property('ADBE Effect Parade') as PropertyGroup;
    if (!fxp) continue;
    const defaults = storedDefaults(L);
    for (let k = 1; k <= fxp.numProperties; k++) {
      const fx = fxp.property(k) as PropertyGroup;
      if (!isControl(fx)) continue;
      const ps = controlParams(fx);
      for (let q = 0; q < ps.length; q++) {
        const key = ps[q].key, v = ps[q].p.value;
        if (defaults[key] !== undefined && sameValue(defaults[key], v)) continue; // untouched in AE
        out[tag + '|' + key] = v;
      }
    }
  }
  return out;
}

function restoreControls(ctx: Ctx, comp: CompItem, saved: { [key: string]: any }): number {
  let n = 0;
  for (let i = 1; i <= comp.numLayers; i++) {
    const L = comp.layer(i);
    const tag = tagOf(L);
    if (!tag) continue;
    const fxp = L.property('ADBE Effect Parade') as PropertyGroup;
    if (!fxp) continue;
    for (let k = 1; k <= fxp.numProperties; k++) {
      const fx = fxp.property(k) as PropertyGroup;
      if (!isControl(fx)) continue;
      const ps = controlParams(fx);
      for (let q = 0; q < ps.length; q++) {
        const key = tag + '|' + ps[q].key;
        if (saved[key] === undefined) continue;
        try { ps[q].p.setValue(saved[key]); n++; } catch (e) { warn(ctx, 'could not restore control ' + ps[q].key); }
      }
    }
  }
  return n;
}

function clearGenerated(comp: CompItem): void {
  for (let i = comp.numLayers; i >= 1; i--) {
    const L = comp.layer(i);
    if (tagOf(L)) { L.locked = false; L.remove(); }
  }
}

function setupComp(ctx: Ctx, c: IrComp, folder: FolderItem, parts: FolderItem, replace: boolean, saved: { [k: string]: { [key: string]: any } }): CompItem {
  let comp = replace ? findTaggedComp(c.id) : null;
  if (comp) {
    if (!saved[c.id]) { saved[c.id] = captureControls(comp); clearGenerated(comp); }
    comp.name = c.name;
    comp.width = c.w;
    comp.height = c.h;
    comp.frameRate = c.fps;
    comp.duration = c.dur;
    if (c.par) comp.pixelAspect = c.par;
  } else {
    comp = app.project.items.addComp(c.name, c.w, c.h, c.par || 1, c.dur, c.fps);
  }
  comp.comment = TAG + c.id + ';scene=' + ctx.scene;
  comp.parentFolder = c.part ? parts : folder;
  if (c.bg) comp.bgColor = [c.bg[0], c.bg[1], c.bg[2]];
  if (c.renderer) {
    try { comp.renderer = c.renderer; } catch (e) { warn(ctx, 'renderer ' + c.renderer + ' unavailable'); }
  }
  if (c.motionBlur !== undefined) comp.motionBlur = c.motionBlur;
  if (c.shutterAngle !== undefined) comp.shutterAngle = c.shutterAngle;
  if (c.shutterPhase !== undefined) comp.shutterPhase = c.shutterPhase;
  if (c.samples !== undefined) comp.motionBlurSamplesPerFrame = c.samples;
  if (c.adaptive !== undefined) comp.motionBlurAdaptiveSampleLimit = c.adaptive;
  if (c.draft3d !== undefined) comp.draft3d = c.draft3d;
  return comp;
}

/** Cloner instance jobs, run once every expression of the build is set (copies carry their expressions). */
interface InstanceJob { comp: CompItem; layer: Layer; id: string; spec: { count: number; prefix: string; overrides?: ({ [name: string]: any } | null)[]; timeRemap?: boolean } }

const pad = (k: number, n: number) => { let s = String(k); const w = String(n).length < 3 ? 3 : String(n).length; while (s.length < w) s = '0' + s; return s; };

/**
 * Duplicates instance 1 of a cloner into `count` instances in place. Each copy is a duplicate of the previous one, so
 * it lands directly above it: instance 1 ends at the bottom and instance N on top (the expressions count from the
 * bottom). AE names a duplicate by incrementing the number ("Cards 001" → "Cards 002"); we rename only when it
 * didn't, because a rename makes AE rescan every expression in the comp (~35 ms with a cloner in it). Copies share
 * instance 1's tag ("aec:<id>;clone"); target one instance by its name.
 */
/** "#rgb" / "#rrggbb" → [r, g, b, 1]. */
function hexColor(s: string): number[] {
  let h = s.replace('#', '');
  if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
  return [parseInt(h.substring(0, 2), 16) / 255, parseInt(h.substring(2, 4), 16) / 255, parseInt(h.substring(4, 6), 16) / 255, 1];
}

function cloneInstances(ctx: Ctx, job: InstanceJob): void {
  ctx.cur = job.id;
  const n = job.spec.count;
  const name = (k: number) => job.spec.prefix + ' ' + pad(k, n);
  job.layer.name = name(1);
  job.layer.comment = TAG + job.id + ';clone';
  let last: Layer = job.layer;
  for (let k = 1; k <= n; k++) {
    // Copies inherit instance 1's tag (rebuilds and lint find them by it): writing a comment per copy costs ~50 ms.
    if (k > 1) {
      last = last.duplicate();
      if (last.name !== name(k)) { last.name = name(k); (ctx as any).renames = ((ctx as any).renames || 0) + 1; }
    }
    const ov = job.spec.overrides ? job.spec.overrides[k - 1] : null;
    if (!ov) continue;
    const grp = last.property('ADBE Layer Overrides') as PropertyGroup;
    if (!grp) { warn(ctx, 'instance ' + last.name + ' has no Essential Properties to override'); continue; }
    for (const f in ov) {
      if (!Object.prototype.hasOwnProperty.call(ov, f)) continue;
      const p = grp.property(f) as Property;
      if (!p) { warn(ctx, 'no Essential Property "' + f + '" on ' + last.name); continue; }
      try {
        const v = ov[f];
        if (typeof v === 'string' && p.propertyValueType === PropertyValueType.TEXT_DOCUMENT) { const d: any = p.value; d.text = v; p.setValue(d); }
        else if (typeof v === 'string' && p.propertyValueType === PropertyValueType.COLOR) p.setValue(hexColor(v));
        else p.setValue(v);
      } catch (e) { warn(ctx, 'override "' + f + '" on ' + last.name + ': ' + errText(e)); }
    }
  }
}

function buildComp(ctx: Ctx, c: IrComp, comp: CompItem, exprsOut: { prop: Property; id: string }[], deferred: Pending, jobs: InstanceJob[]): void {
  ctx.layers = {};
  ctx.eg = [];
  const pending: Pending = { exprs: [] };
  const sizes: { [id: string]: number[] } = {};
  const mk = (ctx as any).mark || function () {};
  // Pass 1: create bottom-up so final stacking equals IR order (index 0 = top).
  for (let i = c.layers.length - 1; i >= 0; i--) {
    const L = c.layers[i];
    ctx.cur = L.id;
    ctx.layers[L.id] = createLayer(ctx, comp, L);
  }
  mk('layers');
  // Pass 2: attributes, wiring, text documents.
  each(c.layers, (L) => {
    ctx.cur = L.id;
    const layer = ctx.layers[L.id];
    setLayerAttrs(ctx, layer, L);
    mk('attrs');
    if (L.text) { setTextDocument(ctx, layer as TextLayer, L.text); mk('textDocs'); applyAnchorBox(layer, L); measureLeaf(ctx, layer, L, sizes); mk('measure'); }
    if (L.type === 'footage' || L.type === 'model') applyFootage(ctx, layer, comp, L);
    if ((L as any).toShapes) ctx.layers[L.id] = vectorToShapes(ctx, comp, layer, L);
  });
  mk('layers');
  each(c.layers, (L) => { ctx.cur = L.id; wireLayer(ctx, ctx.layers[L.id], L); });
  mk('wire');
  // Re-assigning the renderer refreshes 3D property visibility: right after threeDLayer = true AE reports
  // Geometry Options as hidden until the comp's renderer is (re)set (verified, D36).
  if (c.renderer) { try { comp.renderer = c.renderer; } catch (e) { warn(ctx, 'renderer ' + c.renderer + ' unavailable'); } }
  // Pass 3: structure (shape contents, effects, masks, text animators).
  each(c.layers, (L) => {
    ctx.cur = L.id;
    if (!L.groups) return;
    for (let g = 0; g < L.groups.length; g++) buildGroups(ctx, ctx.layers[L.id], ctx.layers[L.id], L.groups[g].at, L.groups[g].items, pending);
  });
  mk('structure');
  // Shape anchors need the contents built first (text anchors were measured before animators).
  each(c.layers, (L) => {
    ctx.cur = L.id;
    if (L.type !== 'text') { applyAnchorBox(ctx.layers[L.id], L); measureLeaf(ctx, ctx.layers[L.id], L, sizes); }
  });
  // Layout: solve with real metrics; laid-out layers get their slot centre as position base.
  const anchors: { [id: string]: number[] } = {};
  each(c.layers, (L) => { if (L.anchorBox) anchors[L.id] = L.anchorBox; });
  const slots = c.layouts && c.layouts.length ? solveComp(ctx, c.layouts, sizes, anchors) : {};
  // Pass 4: values and keyframes.
  each(c.layers, (L) => { ctx.cur = L.id; (ctx as any).layoutBase = slots[L.id] || null; applyProps(ctx, ctx.layers[L.id], ctx.layers[L.id], L.props, pending); if (!(L as any).toShapes) fitScale(ctx, ctx.layers[L.id], comp, L); });
  (ctx as any).layoutBase = null;
  mk('values');
  // Pass 5: expressions (all targets exist now).
  // Comp markers before expressions: expressions may read them (thisComp.marker.key("reveal")).
  if (c.markers) {
    each(c.markers, (mk) => {
      const mv = new MarkerValue(mk.comment || '');
      if (mk.dur) mv.duration = mk.dur;
      (comp as any).markerProperty.setValueAtTime(mk.t, mv);
    });
  }
  // Precomps are built before the main comp, but their control expressions read comp("<main>"): apply those
  // once every comp of the build exists.
  if (c.part) { each(pending.exprs, (x) => { deferred.exprs.push(x); }); pending.exprs = []; }
  else flushExpressions(ctx, pending, exprsOut);
  mk('expressions');
  if (c.mgt) {
    comp.motionGraphicsTemplateName = c.mgt.name;
    each(c.mgt.props, (m) => {
      ctx.cur = m.layer;
      const L = ctx.layers[m.layer];
      const prop = mustResolve(ctx, L, m.p) as Property;
      if (!prop.addToMotionGraphicsTemplateAs(comp, m.name)) warn(ctx, 'could not add "' + m.name + '" to Essential Graphics');
    });
  }
  // Fields (PropSpec.eg): any property exposed by name, e.g. a cloner master's card color.
  if (ctx.eg.length) {
    if (!comp.motionGraphicsTemplateName) comp.motionGraphicsTemplateName = c.name;
    each(ctx.eg, (m) => {
      const prop = byIndexPath(m.layer, m.path) as Property;
      if (!prop.addToMotionGraphicsTemplateAs(comp, m.name)) warn(ctx, 'could not add field "' + m.name + '" to Essential Graphics');
    });
    ctx.eg = [];
  }
  each(c.layers, (L) => lockIfNeeded(ctx.layers[L.id], L));
  each(c.layers, (L) => { if (L.instances && L.instances.count > 1) jobs.push({ comp: comp, layer: ctx.layers[L.id], id: L.id, spec: L.instances }); else if (L.instances) ctx.layers[L.id].name = L.instances.prefix + ' ' + pad(1, 1); });
}

export function build(project: IrProject, opts: BuildOpts): any {
  const ctx = newCtx(project.scene);
  const t0 = now();
  const exprs: { prop: Property; id: string }[] = [];
  const result: any = { ok: true, scene: project.scene, comps: [], warnings: ctx.warnings, exprErrors: [], restoredControls: 0, phases: {} };
  // Per-phase timings (ms), reported with the build so slow builds can be explained.
  let tm = now();
  const mark = (k: string) => { const t = now(); result.phases[k] = (result.phases[k] || 0) + t - tm; tm = t; };
  (ctx as any).mark = mark;
  const saved: { [k: string]: { [key: string]: any } } = {};
  app.beginUndoGroup('ae-compose: build ' + project.scene);
  try {
    const folder = ensureFolder(['ae-compose', project.scene]);
    const parts = ensureFolder(['ae-compose', project.scene, '_parts']);
    const assetsFolder = ensureFolder(['ae-compose', project.scene, '_assets']);
    each(project.assets || [], (a) => { ctx.cur = a.id; ctx.items[a.id] = importAsset(ctx, a, assetsFolder); });
    if (project.lib) { ctx.cur = 'lib'; ensureLib(ctx, project.lib); }
    const deferred: Pending = { exprs: [] };
    const jobs: InstanceJob[] = [];
    // Rebuild: empty the comps users-first (main, then its parts). Removing a precomp's layers while many layers
    // still use it (cloner instances) makes every removal re-render them: 14 s instead of 0.2 s for 100 instances.
    if (opts.replace === true) {
      // A cloner master goes first, as a whole: deleting the comp removes all its instances in one step (3 s for
      // 300 instead of 34 s one by one). It is rebuilt as a new comp.
      for (let i = 0; i < project.comps.length; i++) {
        each(project.comps[i].layers, (L) => {
          if (!L.instances || !L.precomp) return;
          const old = findTaggedComp(L.precomp.comp);
          if (old) old.remove();
        });
      }
      for (let i = project.comps.length - 1; i >= 0; i--) {
        const old = findTaggedComp(project.comps[i].id);
        if (old) { saved[project.comps[i].id] = captureControls(old); clearGenerated(old); }
      }
      mark('clear');
    }
    for (let i = 0; i < project.comps.length; i++) {
      const c = project.comps[i];
      ctx.cur = c.id;
      mark('other');
      const comp = setupComp(ctx, c, folder, parts, opts.replace === true, saved);
      mark('setup');
      ctx.comps[c.id] = comp;
      buildComp(ctx, c, comp, exprs, deferred, jobs);
      mark('comps');
      for (let li = 1; li <= comp.numLayers; li++) stampDefaults(comp.layer(li));
      if (opts.keepControls !== false && saved[c.id]) result.restoredControls += restoreControls(ctx, comp, saved[c.id]);
      result.comps.push({ id: c.id, name: comp.name, itemId: comp.id, layers: comp.numLayers });
    }
    flushExpressions(ctx, deferred, exprs);
    mark('comps');
    each(jobs, (j) => cloneInstances(ctx, j));
    mark('instances');
    if ((ctx as any).renames) result.phases.renamedInstances = (ctx as any).renames;
    each(exprs, (x) => {
      const err = x.prop.expressionError;
      if (err) result.exprErrors.push({ node: x.id, prop: x.prop.matchName, error: err });
    });
    if (opts.lint) {
      mark('other');
      try { result.lint = lintSample(ctx.comps[project.main || project.comps[project.comps.length - 1].id], opts.lint); } catch (e) { result.lint = { ok: false, error: errText(e) }; }
      mark('lint');
    }
    if (opts.motion) {
      try { result.motion = motionSample(ctx.comps[project.main || project.comps[project.comps.length - 1].id], opts.motion); } catch (e) { result.motion = { ok: false, error: errText(e) }; }
      mark('motion');
    }
  } catch (e) {
    result.ok = false;
    if (e instanceof AecError) { result.error = e.message; result.node = e.node; }
    else { result.error = String(e); result.node = ctx.cur; result.line = (e as any).line; }
  } finally {
    app.endUndoGroup();
  }
  result.ms = now() - t0;
  if (result.ok) {
    const mainId = project.main || project.comps[project.comps.length - 1].id;
    const main = ctx.comps[mainId];
    if (main && opts.open !== false) { try { main.openInViewer(); } catch (e) { /* headless */ } }
    if (opts.snapshots) {
      result.snapshots = [];
      each(opts.snapshots, (s) => {
        const comp = ctx.comps[s.comp || mainId];
        result.snapshots.push(snapshotComp(comp, s.times, s.dir, s.prefix || comp.name));
        mark('snapshots');
      });
    }
  }
  return result;
}
