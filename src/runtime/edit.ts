// AEC.edit: surgical patch ops on existing comps (generated or hand-built), all in ONE undo group.
// Targets: layer by aec id, name or 1-based index; properties by path (matchName/display name/#index).
import type { Ctx } from './ctx';
import { AecError, fail, newCtx, warn } from './ctx';
import type { GroupSpec, Pending, PropSpec } from './groups';
import { applyProps, buildGroups, flushExpressions } from './groups';
import type { IrKey } from './keys';
import { applyKeys, captureKeys } from './keys';
import { mustResolve, resolve, setStatic } from './props';
import type { IrLayer } from './layers';
import { applyAnchorBox, applyFootage, createLayer, setLayerAttrs, tagOf, wireLayer } from './layers';
import { findItem, importFile, itemCandidates } from './tools';
import { makeTextDocument, setTextDocument } from './text';
import { findComp } from './inspect';
import { parseT, ripple } from './ripple';
import { clamp, each, now } from './util';

export interface EditOp { op: string; layer?: any; [k: string]: any }

function findLayer(ctx: Ctx, comp: CompItem, ref: any): Layer {
  if (ref === undefined || ref === null) fail(ctx, 'op needs a "layer" (aec id, name or index)');
  if (typeof ref === 'number') { if (ref < 1 || ref > comp.numLayers) fail(ctx, 'layer index out of range: ' + ref); return comp.layer(ref); }
  const s = String(ref);
  const matches: Layer[] = [];
  for (let i = 1; i <= comp.numLayers; i++) { const L = comp.layer(i); if (tagOf(L) === s) return L; if (L.name === s) matches.push(L); }
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) fail(ctx, 'layer name "' + s + '" is ambiguous (' + matches.length + ' layers); use the index or aec id');
  return fail(ctx, 'layer not found: "' + s + '"');
}

function vlen(a: any): number {
  if (typeof a === 'number') return Math.abs(a);
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s);
}
function vsub(a: any, b: any): any {
  if (typeof a === 'number') return a - b;
  const r: number[] = [];
  for (let i = 0; i < a.length; i++) r[i] = a[i] - b[i];
  return r;
}

/** Applies a CSS cubic-bezier shape to the segments between selected keys, using real values/times (curve editing). */
function applyBezier(p: Property, bez: number[], which: number[] | null): number {
  const n = p.numKeys;
  if (n < 2) return 0;
  const vt = p.propertyValueType;
  const dims = vt === PropertyValueType.TwoD ? 2 : vt === PropertyValueType.ThreeD ? 3 : 1;
  const single = dims === 1 && (vt === PropertyValueType.TwoD_SPATIAL || vt === PropertyValueType.ThreeD_SPATIAL || vt === PropertyValueType.COLOR);
  const cs = vt === PropertyValueType.COLOR ? 255 : 1;
  const x1 = Math.max(bez[0], 0.001), y1 = bez[1], x2 = Math.min(bez[2], 0.999), y2 = bez[3];
  let count = 0;
  for (let k = 1; k < n; k++) {
    if (which && !(indexIn(which, k) && indexIn(which, k + 1))) continue;
    const t0 = p.keyTime(k), t1 = p.keyTime(k + 1);
    const v0 = p.keyValue(k), v1 = p.keyValue(k + 1);
    const dt = t1 - t0;
    const outE: KeyframeEase[] = [], inE: KeyframeEase[] = [];
    if (single || typeof v0 === 'number') {
      const dv = single ? vlen(vsub(v1, v0)) * cs : (v1 as number) - (v0 as number);
      outE[0] = new KeyframeEase((y1 / x1) * dv / dt, x1 * 100);
      inE[0] = new KeyframeEase(((1 - y2) / (1 - x2)) * dv / dt, (1 - x2) * 100);
    } else {
      for (let d = 0; d < dims; d++) {
        const dv = (v1 as any)[d] - (v0 as any)[d];
        outE[d] = new KeyframeEase((y1 / x1) * dv / dt, x1 * 100);
        inE[d] = new KeyframeEase(((1 - y2) / (1 - x2)) * dv / dt, (1 - x2) * 100);
      }
    }
    p.setInterpolationTypeAtKey(k, p.keyInInterpolationType(k), KeyframeInterpolationType.BEZIER);
    p.setInterpolationTypeAtKey(k + 1, KeyframeInterpolationType.BEZIER, p.keyOutInterpolationType(k + 1));
    p.setTemporalContinuousAtKey(k, false);
    p.setTemporalContinuousAtKey(k + 1, false);
    (p as any).setTemporalEaseAtKey(k, p.keyInTemporalEase(k), outE);
    (p as any).setTemporalEaseAtKey(k + 1, inE, p.keyOutTemporalEase(k + 1));
    count++;
  }
  return count;
}

function indexIn(a: number[], x: number): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] === x) return true;
  return false;
}

function setEase(p: Property, k: number, side: 'in' | 'out' | 'both', speed: number | null, influence: number | null): void {
  const scale = (arr: KeyframeEase[]) => {
    const o: KeyframeEase[] = [];
    for (let d = 0; d < arr.length; d++) o[d] = new KeyframeEase(speed !== null ? speed : arr[d].speed, influence !== null ? clamp(influence, 0.1, 100) : arr[d].influence);
    return o;
  };
  p.setInterpolationTypeAtKey(k, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
  const ie = p.keyInTemporalEase(k), oe = p.keyOutTemporalEase(k);
  (p as any).setTemporalEaseAtKey(k, side === 'out' ? ie : scale(ie), side === 'in' ? oe : scale(oe));
}

function prop(ctx: Ctx, L: Layer, path: string): Property {
  const p = mustResolve(ctx, L, path) as Property;
  if (p.propertyType !== PropertyType.PROPERTY) fail(ctx, '"' + path + '" is a group, not a property');
  return p;
}

function runOp(ctx: Ctx, comp: CompItem, op: EditOp, pending: Pending, changes: any[]): void {
  const L = op.op === 'addLayer' || op.op === 'placeItem' || op.op === 'ripple' || op.op === 'setComp' || op.op === 'precompose' || op.op === 'duplicateComp' ? null : findLayer(ctx, comp, op.layer);
  switch (op.op) {
    case 'setProperty': {
      const p = prop(ctx, L!, op.path);
      const before = p.numKeys ? p.numKeys + ' keys' : p.propertyValueType === PropertyValueType.SHAPE || p.propertyValueType === PropertyValueType.TEXT_DOCUMENT ? '(complex)' : p.value;
      if (op.removeExpr) { p.expression = ''; }
      if (op.keys) applyKeys(ctx, p, op.keys);
      else if (op.value !== undefined) setStatic(ctx, p, op.value);
      if (op.expr !== undefined) pending.exprs.push({ owner: [], layer: L!, spec: { p: op.path, expr: op.expr }, id: ctx.cur });
      changes.push({ layer: L!.name, path: op.path, before: before });
      break;
    }
    case 'setEasing': {
      const p = prop(ctx, L!, op.path);
      if (op.bezier) { const n = applyBezier(p, op.bezier, op.keys || null); changes.push({ layer: L!.name, path: op.path, segments: n }); }
      else if (op.ease) {
        const ks: number[] = op.keys || []; if (!ks.length) for (let k = 1; k <= p.numKeys; k++) ks.push(k);
        each(ks, (k) => setEase(p, k, op.side || 'both', op.ease.speed !== undefined ? op.ease.speed : null, op.ease.influence !== undefined ? op.ease.influence : null));
        changes.push({ layer: L!.name, path: op.path, keys: ks.length });
      } else if (op.interpolation) {
        const it = op.interpolation === 'linear' ? KeyframeInterpolationType.LINEAR : op.interpolation === 'hold' ? KeyframeInterpolationType.HOLD : KeyframeInterpolationType.BEZIER;
        for (let k = 1; k <= p.numKeys; k++) if (!op.keys || indexIn(op.keys, k)) p.setInterpolationTypeAtKey(k, it, it);
        changes.push({ layer: L!.name, path: op.path, interpolation: op.interpolation });
      }
      break;
    }
    case 'retimeKeys': {
      // Shift and/or scale key times around a pivot (curve shapes preserved: speeds rescale with time).
      const paths: string[] = op.paths || (op.path ? [op.path] : []);
      each(paths, (path) => {
        const p = (op.skipStatic ? resolve(L!, path) : prop(ctx, L!, path)) as Property;
        if (!p || p.propertyType !== PropertyType.PROPERTY || !p.numKeys) return;
        const keys = captureKeys(p);
        const s = op.scale !== undefined ? op.scale : 1, sh = op.shift !== undefined ? op.shift : 0;
        const pivot = op.pivot !== undefined ? op.pivot : keys[0].t;
        each(keys, (k) => {
          k.t = pivot + (k.t - pivot) * s + sh;
          if (k.ie) for (let d = 0; d < k.ie.length; d++) k.ie[d].speed /= s;
          if (k.oe) for (let d = 0; d < k.oe.length; d++) k.oe[d].speed /= s;
        });
        applyKeys(ctx, p, keys);
        changes.push({ layer: L!.name, path: path, keys: keys.length, shift: sh, scale: s });
      });
      break;
    }
    case 'setLayer': {
      setLayerAttrs(ctx, L!, op.attrs as IrLayer);
      if (op.attrs.name) L!.name = op.attrs.name;
      if (op.attrs.parent !== undefined) L!.setParentWithJump(op.attrs.parent === null ? null as any : findLayer(ctx, comp, op.attrs.parent));
      if (op.attrs.matte) (L as any).setTrackMatte(findLayer(ctx, comp, op.attrs.matte.layer), (TrackMatteType as any)[{ alpha: 'ALPHA', alphaInverted: 'ALPHA_INVERTED', luma: 'LUMA', lumaInverted: 'LUMA_INVERTED' }[op.attrs.matte.type as string] || 'ALPHA']);
      if (op.attrs.matte === null) (L as any).removeTrackMatte();
      if (op.attrs.index !== undefined) L!.moveBefore(comp.layer(Math.max(1, op.attrs.index)));
      changes.push({ layer: L!.name, attrs: op.attrs });
      break;
    }
    case 'addGroups': {
      buildGroups(ctx, L!, L!, op.at, op.items as GroupSpec[], pending);
      changes.push({ layer: L!.name, added: op.items.length, at: op.at });
      break;
    }
    case 'addEffect': {
      buildGroups(ctx, L!, L!, 'ADBE Effect Parade', [op.effect as GroupSpec], pending);
      const fxp = L!.property('ADBE Effect Parade') as PropertyGroup;
      if (op.index !== undefined && op.index < fxp.numProperties) (fxp.property(fxp.numProperties) as any).moveTo(op.index);
      changes.push({ layer: L!.name, addedEffect: op.effect.mn });
      break;
    }
    case 'setEnabled': {
      const g = mustResolve(ctx, L!, op.path) as any;
      g.enabled = op.enabled;
      changes.push({ layer: L!.name, path: op.path, enabled: op.enabled });
      break;
    }
    case 'removeProperty': {
      const p = mustResolve(ctx, L!, op.path) as any;
      if (!p.parentProperty || p.parentProperty.propertyType !== PropertyType.INDEXED_GROUP) fail(ctx, '"' + op.path + '" is not removable (only effects, masks, shape contents, animators)');
      const nm = p.name; p.remove();
      changes.push({ layer: L!.name, removed: nm });
      break;
    }
    case 'moveProperty': {
      const p = mustResolve(ctx, L!, op.path) as any;
      p.moveTo(op.to);
      changes.push({ layer: L!.name, moved: op.path, to: op.to });
      break;
    }
    case 'setProps': {
      const owner = op.owner ? mustResolve(ctx, L!, op.owner) : L!;
      applyProps(ctx, L!, owner, op.props as PropSpec[], pending);
      changes.push({ layer: L!.name, owner: op.owner || '(layer)', props: op.props.length });
      break;
    }
    case 'setText': {
      const sp = L!.property('ADBE Text Properties').property('ADBE Text Document') as Property;
      const cur: any = sp.value;
      const spec = op.text;
      if (spec.full) { sp.setValue(makeTextDocument(ctx, cur, spec)); }
      else {
        if (spec.text !== undefined) cur.text = spec.text;
        if (spec.font) cur.font = spec.font;
        if (spec.size !== undefined) cur.fontSize = spec.size;
        if (spec.fill) { cur.applyFill = true; cur.fillColor = [spec.fill[0], spec.fill[1], spec.fill[2]]; }
        if (spec.tracking !== undefined) cur.tracking = spec.tracking;
        if (spec.leading !== undefined) { if (spec.leading === 'auto') cur.autoLeading = true; else { cur.autoLeading = false; cur.leading = spec.leading; } }
        sp.setValue(cur);
      }
      changes.push({ layer: L!.name, text: spec.text !== undefined ? spec.text : '(style)' });
      break;
    }
    case 'replaceFootage': {
      const f = new File(op.file);
      if (!f.exists) fail(ctx, 'file not found: ' + op.file);
      const src: any = (L as any).source;
      if (!(src instanceof FootageItem)) fail(ctx, 'layer has no footage source');
      if (op.everywhere) src.replace(f);
      else { const item = app.project.importFile(new ImportOptions(f)); (L as any).replaceSource(item, false); }
      changes.push({ layer: L!.name, footage: op.file });
      break;
    }
    case 'addLayer': {
      const spec = op.spec as IrLayer;
      const nl = createLayer(ctx, comp, spec);
      ctx.layers[spec.id] = nl;
      setLayerAttrs(ctx, nl, spec);
      // Same passes as a build: text document (font/size/style) and anchor box before contents and props.
      if (spec.text) setTextDocument(ctx, nl as TextLayer, spec.text);
      if (spec.type === 'footage' || spec.type === 'model') applyFootage(ctx, nl, comp, spec);
      wireLayer(ctx, nl, spec);
      if (spec.groups) for (let g = 0; g < spec.groups.length; g++) buildGroups(ctx, nl, nl, spec.groups[g].at, spec.groups[g].items, pending);
      applyAnchorBox(nl, spec);
      applyProps(ctx, nl, nl, spec.props, pending);
      if (op.index) nl.moveBefore(comp.layer(Math.min(op.index, comp.numLayers)));
      changes.push({ added: nl.name, index: nl.index });
      break;
    }
    case 'removeLayer': {
      const nm = L!.name; L!.locked = false; L!.remove();
      changes.push({ removedLayer: nm });
      break;
    }
    case 'duplicateLayer': {
      const d = L!.duplicate();
      if (op.name) d.name = op.name;
      d.comment = '';
      changes.push({ duplicated: L!.name, as: d.name, index: d.index });
      break;
    }
    case 'setComp': {
      const a = op.attrs;
      if (a.renderer) comp.renderer = a.renderer;
      if (a.bg) comp.bgColor = [a.bg[0], a.bg[1], a.bg[2]];
      if (a.w) comp.width = a.w;
      if (a.h) comp.height = a.h;
      if (a.dur) comp.duration = a.dur;
      if (a.fps) comp.frameRate = a.fps;
      if (a.motionBlur !== undefined) comp.motionBlur = a.motionBlur;
      if (a.shutterAngle !== undefined) comp.shutterAngle = a.shutterAngle;
      if (a.name) comp.name = a.name;
      changes.push({ comp: comp.name, attrs: a });
      break;
    }
    case 'precompose': {
      const idx: number[] = [];
      each(op.layers, (r: any) => idx.push(findLayer(ctx, comp, r).index));
      const nc = comp.layers.precompose(idx, op.name || 'Precomp', op.moveAll !== false);
      changes.push({ precomposed: idx.length, comp: nc.name, itemId: nc.id });
      break;
    }
    case 'duplicateComp': {
      const nc = comp.duplicate();
      nc.name = op.name || comp.name + ' copy';
      nc.comment = '';
      changes.push({ duplicatedComp: comp.name, as: nc.name, itemId: nc.id });
      break;
    }
    case 'rigTiming': {
      // Adds live delay/speed controls to an existing animated property (keys stay editable).
      const p = prop(ctx, L!, op.path);
      if (p.numKeys < 2) fail(ctx, op.path + ' has fewer than 2 keys');
      const ctl = ensureControls(comp);
      const fxp = ctl.property('ADBE Effect Parade') as PropertyGroup;
      const add = (name: string, v: number) => { let fx: any = fxp.property(name); if (!fx) { fx = fxp.addProperty('ADBE Slider Control'); fx.name = name; fx = fxp.property(name); (fx.property(1) as Property).setValue(v); } return name; };
      const dn = op.delayName ? add(op.delayName, 0) : null;
      const sn = op.speedName ? add(op.speedName, 100) : null;
      const t0 = p.keyTime(1);
      const ref = (n: string) => 'thisComp.layer("Controls").effect(' + JSON_q(n) + ')(1)';
      const lines = ['// ae-compose rig (added by edit): live timing controls', 'var t0 = ' + t0 + ';', 'var d = ' + (dn ? ref(dn) : '0') + ';', 'var s = Math.max(' + (sn ? ref(sn) + ' / 100' : '1') + ', 0.0001);', 'valueAtTime(t0 + (time - t0 - d) * s);'];
      p.expression = lines.join('\n');
      changes.push({ layer: L!.name, path: op.path, controls: [dn, sn] });
      break;
    }
    case 'placeItem': {
      // Existing project media (or a file imported now) as a new layer: footage, stills, comps.
      let it: any = null;
      if (op.file) { const r = importFile(op.file, op.folder); if (!r.ok) fail(ctx, r.error); it = app.project.itemByID(r.id); }
      else it = findItem(op.item);
      if (!it) fail(ctx, 'no unique project item for "' + op.item + '"; matches: ' + itemCandidates(op.item) + ' (use the #id, or list_project_items)');
      if (!(it instanceof CompItem) && !(it instanceof FootageItem)) fail(ctx, '"' + it.name + '" is a ' + it.typeName + ' and cannot be a layer');
      if (it === comp) fail(ctx, 'cannot place a comp inside itself');
      const nl = comp.layers.add(it);
      if (op.name) nl.name = op.name;
      const fr = comp.frameRate;
      if (op.start !== undefined && op.start !== null) nl.startTime = parseT(op.start, fr);
      if (op.in !== undefined && op.in !== null) nl.inPoint = parseT(op.in, fr);
      if (op.out !== undefined && op.out !== null) nl.outPoint = parseT(op.out, fr);
      if (op.below !== undefined) nl.moveAfter(findLayer(ctx, comp, op.below));
      else if (op.above !== undefined) nl.moveBefore(findLayer(ctx, comp, op.above));
      else if (op.index) nl.moveBefore(comp.layer(Math.min(op.index, comp.numLayers)));
      applyFootage(ctx, nl, comp, { fit: op.fit || 'none', muted: op.muted, loop: op.loop } as any);
      changes.push({ placed: it.name, itemId: it.id, layer: nl.name, index: nl.index, in: nl.inPoint, out: nl.outPoint });
      break;
    }
    case 'ripple':
      changes.push({ ripple: ripple(ctx, comp, op) });
      break;
    default:
      fail(ctx, 'unknown op "' + op.op + '"');
  }
}

function JSON_q(s: string): string {
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function ensureControls(comp: CompItem): Layer {
  for (let i = 1; i <= comp.numLayers; i++) if (comp.layer(i).name === 'Controls') return comp.layer(i);
  const n = comp.layers.addNull(comp.duration);
  n.name = 'Controls';
  n.enabled = false;
  n.moveToBeginning();
  return n;
}

export function edit(target: { comp?: any }, ops: EditOp[], opts: { undoName?: string; keepPartial?: boolean }): any {
  const ctx = newCtx('edit');
  const t0 = now();
  const changes: any[] = [];
  const res: any = { ok: true, changes: changes, warnings: ctx.warnings, exprErrors: [] };
  const comp = findComp(target.comp);
  if (!comp) return { ok: false, error: 'comp not found: ' + (target.comp || '(active comp)') };
  for (let i = 1; i <= comp.numLayers; i++) { const t = tagOf(comp.layer(i)); if (t) ctx.layers[t] = comp.layer(i); }
  const pending: Pending = { exprs: [] };
  const exprs: { prop: Property; id: string }[] = [];
  app.beginUndoGroup(opts.undoName || 'ae-compose: edit (' + ops.length + ' ops)');
  // Sentinel change (net zero) so the undo group is never empty: a failed batch can then be rolled back with
  // one Undo without ever undoing something older.
  const c0 = comp.comment;
  comp.comment = c0 + ' ';
  comp.comment = c0;
  let failed = false;
  try {
    for (let i = 0; i < ops.length; i++) { ctx.cur = 'op' + (i + 1) + ':' + ops[i].op; runOp(ctx, comp, ops[i], pending, changes); }
    flushExpressions(ctx, pending, exprs);
    each(exprs, (x) => { if (x.prop.expressionError) res.exprErrors.push({ node: x.id, prop: x.prop.matchName, error: x.prop.expressionError }); });
  } catch (e) {
    failed = true;
    res.ok = false;
    if (e instanceof AecError) { res.error = e.message; res.at = e.node; } else { res.error = String(e); res.at = ctx.cur; res.line = (e as any).line; }
  } finally {
    app.endUndoGroup();
  }
  // All or nothing: a batch that fails part-way is undone, so the project is exactly as before the call.
  if (failed && opts.keepPartial !== true) {
    try { app.executeCommand(16); res.rolledBack = true; } catch (e2) { res.rolledBack = false; }
    res.changes = [];
  }
  res.comp = comp.name;
  res.itemId = comp.id;
  res.ms = now() - t0;
  void resolve; void warn;
  return res;
}
