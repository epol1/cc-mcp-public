// AEC.build: IR project → native comps, in ONE undo group (undo groups don't span evals).
// Passes: assets → per comp: create layers bottom-up → attrs/wiring/text → structure (groups) →
// values/keys → expressions → EG; then sticky controls, viewer, snapshots.
import type { Ctx } from './ctx';
import { AecError, newCtx, warn } from './ctx';
import type { IrAsset } from './project';
import { ensureFolder, findTaggedComp, importAsset } from './project';
import type { IrLayer } from './layers';
import { applyAnchorBox, applyFootage, createLayer, fitScale, lockIfNeeded, setLayerAttrs, tagOf, TAG, wireLayer } from './layers';
import type { Pending } from './groups';
import { applyProps, buildGroups, flushExpressions } from './groups';
import { setTextDocument } from './text';
import { mustResolve } from './props';
import { snapshotComp } from './snapshot';
import type { IrLayout } from './layout';
import { measureLeaf, solveComp } from './layout';
import { each, now } from './util';

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
}

export interface BuildOpts {
  replace?: boolean;
  keepControls?: boolean;
  open?: boolean;
  snapshots?: { comp?: string; times: number[]; dir: string; prefix?: string }[];
}

const CONTROL_MN: { [mn: string]: boolean } = {
  'ADBE Slider Control': true, 'ADBE Color Control': true, 'ADBE Checkbox Control': true, 'ADBE Point Control': true,
  'ADBE Point3D Control': true, 'ADBE Angle Control': true, 'ADBE Dropdown Control': true, 'ADBE Layer Control': true,
};

function isControl(fx: PropertyGroup): boolean {
  return CONTROL_MN[fx.matchName] === true || fx.matchName.indexOf('Pseudo/') === 0;
}

/** Build-time default of each control, stored in the layer comment after the tag ("aec:<id>;d=<json>"). */
function storedDefaults(L: Layer): { [name: string]: any } {
  const c = L.comment || '';
  const i = c.indexOf(';d=');
  if (i < 0) return {};
  // Format: name=v[,v...] entries separated by  (values are numbers or number arrays).
  const out: { [name: string]: any } = {};
  const parts = c.substring(i + 3).split('');
  for (let k = 0; k < parts.length; k++) {
    const eq = parts[k].lastIndexOf('=');
    if (eq <= 0) continue;
    const vs = parts[k].substring(eq + 1).split(',');
    const nums: number[] = [];
    for (let j = 0; j < vs.length; j++) nums[j] = parseFloat(vs[j]);
    out[parts[k].substring(0, eq)] = nums.length === 1 ? nums[0] : nums;
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
    const p = fx.property(1) as Property;
    if (!p || p.numKeys > 0 || p.propertyValueType === PropertyValueType.CUSTOM_VALUE) continue;
    const v: any = p.value;
    if (typeof v !== 'number' && !(v && v.length !== undefined)) continue;
    const vals: string[] = [];
    if (typeof v === 'number') vals[0] = String(v); else for (let j = 0; j < v.length; j++) vals[j] = String(v[j]);
    d[d.length] = fx.name + '=' + vals.join(',');
    any = true;
  }
  if (!any) return;
  const tag = tagOf(L);
  if (tag) L.comment = TAG + tag + ';d=' + d.join('');
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
      const p = fx.property(1) as Property;
      if (!p || p.numKeys > 0 || p.propertyValueType === PropertyValueType.CUSTOM_VALUE) continue;
      if (defaults[fx.name] !== undefined && sameValue(defaults[fx.name], p.value)) continue; // untouched in AE
      out[tag + '|' + fx.name] = p.value;
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
      const key = tag + '|' + fx.name;
      if (!isControl(fx) || saved[key] === undefined) continue;
      const p = fx.property(1) as Property;
      if (p.numKeys > 0) continue;
      try { p.setValue(saved[key]); n++; } catch (e) { warn(ctx, 'could not restore control ' + fx.name); }
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
    saved[c.id] = captureControls(comp);
    clearGenerated(comp);
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

function buildComp(ctx: Ctx, c: IrComp, comp: CompItem, exprsOut: { prop: Property; id: string }[], deferred: Pending): void {
  ctx.layers = {};
  const pending: Pending = { exprs: [] };
  const sizes: { [id: string]: number[] } = {};
  // Pass 1: create bottom-up so final stacking equals IR order (index 0 = top).
  for (let i = c.layers.length - 1; i >= 0; i--) {
    const L = c.layers[i];
    ctx.cur = L.id;
    ctx.layers[L.id] = createLayer(ctx, comp, L);
  }
  // Pass 2: attributes, wiring, text documents.
  each(c.layers, (L) => {
    ctx.cur = L.id;
    const layer = ctx.layers[L.id];
    setLayerAttrs(ctx, layer, L);
    if (L.text) { setTextDocument(ctx, layer as TextLayer, L.text); applyAnchorBox(layer, L); measureLeaf(ctx, layer, L, sizes); }
    if (L.type === 'footage' || L.type === 'model') applyFootage(ctx, layer, comp, L);
  });
  each(c.layers, (L) => { ctx.cur = L.id; wireLayer(ctx, ctx.layers[L.id], L); });
  // Re-assigning the renderer refreshes 3D property visibility: right after threeDLayer = true AE reports
  // Geometry Options as hidden until the comp's renderer is (re)set (verified, D36).
  if (c.renderer) { try { comp.renderer = c.renderer; } catch (e) { warn(ctx, 'renderer ' + c.renderer + ' unavailable'); } }
  // Pass 3: structure (shape contents, effects, masks, text animators).
  each(c.layers, (L) => {
    ctx.cur = L.id;
    if (!L.groups) return;
    for (let g = 0; g < L.groups.length; g++) buildGroups(ctx, ctx.layers[L.id], ctx.layers[L.id], L.groups[g].at, L.groups[g].items, pending);
  });
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
  each(c.layers, (L) => { ctx.cur = L.id; (ctx as any).layoutBase = slots[L.id] || null; applyProps(ctx, ctx.layers[L.id], ctx.layers[L.id], L.props, pending); fitScale(ctx, ctx.layers[L.id], comp, L); });
  (ctx as any).layoutBase = null;
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
  if (c.mgt) {
    comp.motionGraphicsTemplateName = c.mgt.name;
    each(c.mgt.props, (m) => {
      ctx.cur = m.layer;
      const L = ctx.layers[m.layer];
      const prop = mustResolve(ctx, L, m.p) as Property;
      if (!prop.addToMotionGraphicsTemplateAs(comp, m.name)) warn(ctx, 'could not add "' + m.name + '" to Essential Graphics');
    });
  }
  each(c.layers, (L) => lockIfNeeded(ctx.layers[L.id], L));
}

export function build(project: IrProject, opts: BuildOpts): any {
  const ctx = newCtx(project.scene);
  const t0 = now();
  const exprs: { prop: Property; id: string }[] = [];
  const result: any = { ok: true, scene: project.scene, comps: [], warnings: ctx.warnings, exprErrors: [], restoredControls: 0 };
  const saved: { [k: string]: { [key: string]: any } } = {};
  app.beginUndoGroup('ae-compose: build ' + project.scene);
  try {
    const folder = ensureFolder(['ae-compose', project.scene]);
    const parts = ensureFolder(['ae-compose', project.scene, '_parts']);
    const assetsFolder = ensureFolder(['ae-compose', project.scene, '_assets']);
    each(project.assets || [], (a) => { ctx.cur = a.id; ctx.items[a.id] = importAsset(ctx, a, assetsFolder); });
    const deferred: Pending = { exprs: [] };
    for (let i = 0; i < project.comps.length; i++) {
      const c = project.comps[i];
      ctx.cur = c.id;
      const comp = setupComp(ctx, c, folder, parts, opts.replace === true, saved);
      ctx.comps[c.id] = comp;
      buildComp(ctx, c, comp, exprs, deferred);
      for (let li = 1; li <= comp.numLayers; li++) stampDefaults(comp.layer(li));
      if (opts.keepControls !== false && saved[c.id]) result.restoredControls += restoreControls(ctx, comp, saved[c.id]);
      result.comps.push({ id: c.id, name: comp.name, itemId: comp.id, layers: comp.numLayers });
    }
    flushExpressions(ctx, deferred, exprs);
    each(exprs, (x) => {
      const err = x.prop.expressionError;
      if (err) result.exprErrors.push({ node: x.id, prop: x.prop.matchName, error: err });
    });
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
      });
    }
  }
  return result;
}
