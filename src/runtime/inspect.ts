// AEC.inspect: AE → JSON (lossless enough to round-trip IR). Skips crash-prone/opaque props (D15).
// detail "outline": only modified/animated/expression props; "full": every readable property.
import { isCrashy, isCrashyParent, isOpaqueValueType } from './safety';
import { tagOf } from './layers';
import { findTaggedComp } from './project';

export interface InspectOpts { detail?: 'outline' | 'full'; layers?: (string | number)[]; maxChars?: number; time?: number }

const VT: { [k: number]: string } = {};
(function () {
  const names = ['NO_VALUE', 'ThreeD_SPATIAL', 'ThreeD', 'TwoD_SPATIAL', 'TwoD', 'OneD', 'COLOR', 'CUSTOM_VALUE', 'MARKER', 'LAYER_INDEX', 'MASK_INDEX', 'SHAPE', 'TEXT_DOCUMENT'];
  for (let i = 0; i < names.length; i++) { const v = (PropertyValueType as any)[names[i]]; if (v !== undefined) VT[v] = names[i]; }
})();
const INTERP: { [k: number]: string } = {};
INTERP[KeyframeInterpolationType.LINEAR] = 'linear';
INTERP[KeyframeInterpolationType.BEZIER] = 'bezier';
INTERP[KeyframeInterpolationType.HOLD] = 'hold';

function arr(v: any): any {
  if (v && typeof v === 'object' && v.length !== undefined && typeof v !== 'string') { const o: any[] = []; for (let i = 0; i < v.length; i++) o[i] = v[i]; return o; }
  return v;
}

function shapeVal(s: any): any {
  return { v: arr2(s.vertices), i: arr2(s.inTangents), o: arr2(s.outTangents), c: s.closed };
}
function arr2(a: any): any[] { const o: any[] = []; for (let i = 0; i < a.length; i++) o[i] = [a[i][0], a[i][1]]; return o; }

function textVal(td: any, maxChars: number): any {
  const o: any = { text: td.text, font: td.font, size: td.fontSize, tracking: td.tracking, justification: String(td.justification) };
  try { o.fill = td.applyFill ? arr(td.fillColor) : null; } catch (e) {}
  try { if (td.applyStroke) { o.stroke = arr(td.strokeColor); o.strokeWidth = td.strokeWidth; } } catch (e) {}
  try { o.leading = td.autoLeading ? 'auto' : td.leading; } catch (e) {}
  try { if (td.boxText) { o.box = arr(td.boxTextSize); } } catch (e) {}
  try { o.lines = td.composedLineCount; } catch (e) {}
  try { if (td.fontCapsOption !== FontCapsOption.FONT_NORMAL_CAPS) o.caps = String(td.fontCapsOption); } catch (e) {}
  // Style runs: merge consecutive characters with identical font/size/fill.
  try {
    const n = Math.min(String(td.text).length, maxChars);
    const runs: any[] = [];
    let cur: any = null;
    for (let i = 0; i < n; i++) {
      const cr = td.characterRange(i, i + 1);
      const f = cr.font, sz = cr.fontSize, fc = cr.applyFill ? String(arr(cr.fillColor)) : 'none';
      if (cur && cur.font === f && cur.size === sz && cur.fillKey === fc) { cur.end = i + 1; continue; }
      cur = { start: i, end: i + 1, font: f, size: sz, fillKey: fc, fill: cr.applyFill ? arr(cr.fillColor) : null };
      runs.push(cur);
    }
    if (runs.length > 1) { for (let r = 0; r < runs.length; r++) delete runs[r].fillKey; o.runs = runs; }
  } catch (e) {}
  return o;
}

function readValue(p: Property, maxChars: number, t?: number): any {
  const vt = p.propertyValueType;
  const v = t !== undefined ? p.valueAtTime(t, false) : p.value;
  if (vt === PropertyValueType.SHAPE) return shapeVal(v);
  if (vt === PropertyValueType.TEXT_DOCUMENT) return textVal(v, maxChars);
  return arr(v);
}

function keyData(p: Property, maxChars: number): any[] {
  const out: any[] = [];
  const vt = p.propertyValueType;
  const spatial = vt === PropertyValueType.TwoD_SPATIAL || vt === PropertyValueType.ThreeD_SPATIAL;
  for (let k = 1; k <= p.numKeys; k++) {
    const key: any = { t: p.keyTime(k) };
    const v = p.keyValue(k);
    key.v = vt === PropertyValueType.SHAPE ? shapeVal(v) : vt === PropertyValueType.TEXT_DOCUMENT ? textVal(v, maxChars) : arr(v);
    const ii = INTERP[p.keyInInterpolationType(k)], oi = INTERP[p.keyOutInterpolationType(k)];
    if (ii !== 'bezier') key.i = ii;
    if (oi !== 'bezier') key.o = oi;
    if (vt !== PropertyValueType.TEXT_DOCUMENT) {
      const ie = p.keyInTemporalEase(k), oe = p.keyOutTemporalEase(k);
      key.ie = []; key.oe = [];
      for (let d = 0; d < ie.length; d++) key.ie[d] = { speed: ie[d].speed, influence: ie[d].influence };
      for (let d = 0; d < oe.length; d++) key.oe[d] = { speed: oe[d].speed, influence: oe[d].influence };
      if (p.keyTemporalContinuous(k)) key.tc = true;
      if (p.keyTemporalAutoBezier(k)) key.ta = true;
    }
    if (spatial) {
      key.sp = { ti: arr(p.keyInSpatialTangent(k)), to: arr(p.keyOutSpatialTangent(k)) };
      if (p.keySpatialContinuous(k)) key.sp.cont = true;
      if (p.keySpatialAutoBezier(k)) key.sp.auto = true;
      try { if (p.keyRoving(k)) key.rov = true; } catch (e) {}
    }
    try { const lab = (p as any).keyLabel(k); if (lab) key.label = lab; } catch (e) {}
    out.push(key);
  }
  return out;
}

/** Recursive property walk. Returns null when nothing worth reporting (outline mode). */
function walk(g: any, opts: InspectOpts, depth: number): any {
  const full = opts.detail === 'full';
  const maxChars = opts.maxChars || 400;
  if (g.propertyType === PropertyType.PROPERTY) {
    const p = g as Property;
    if (isCrashy(p.matchName)) return { m: p.matchName, n: p.name, skipped: 'gradient (read via .aepx)' };
    const vt = p.propertyValueType;
    const animated = p.numKeys > 0;
    const hasExpr = p.canSetExpression && p.expression !== '';
    let modified = false;
    try { modified = p.isModified; } catch (e) {}
    if (!full && !animated && !hasExpr && !modified) return null;
    const o: any = { m: p.matchName, n: p.name, vt: VT[vt] };
    if (isOpaqueValueType(vt) || vt === PropertyValueType.MARKER) { if (vt === PropertyValueType.NO_VALUE) return null; }
    else {
      try {
        if (animated) o.keys = keyData(p, maxChars);
        else o.v = readValue(p, maxChars);
      } catch (e) { o.err = String(e); }
    }
    if (hasExpr) { o.expr = p.expression; if (!p.expressionEnabled) o.exprOff = true; if (p.expressionError) o.exprErr = p.expressionError; }
    try { if (p.dimensionsSeparated) o.sep = true; } catch (e) {}
    if (vt === PropertyValueType.MARKER && animated) {
      o.markers = [];
      for (let k = 1; k <= p.numKeys; k++) { const mv: any = p.keyValue(k); o.markers.push({ t: p.keyTime(k), comment: mv.comment, dur: mv.duration }); }
      delete o.keys;
    }
    return o;
  }
  if (isCrashyParent(g.matchName)) {
    return { m: g.matchName, n: g.name, gradient: true, note: 'stops read from .aepx when requested' };
  }
  const indexed = g.propertyType === PropertyType.INDEXED_GROUP;
  const kids: any[] = [];
  for (let i = 1; i <= g.numProperties; i++) {
    let c: any;
    try { c = walk(g.property(i), opts, depth + 1); } catch (e) { c = { err: String(e), at: i }; }
    if (c) kids.push(c);
  }
  // Indexed groups (effects, contents, masks, animators) are structure: always report their items.
  const isItem = g.parentProperty && g.parentProperty.propertyType === PropertyType.INDEXED_GROUP;
  if (!full && !kids.length && !isItem) return null;
  const o: any = { m: g.matchName, n: g.name };
  if (indexed) o.indexed = true;
  try { if (g.enabled === false && g.canSetEnabled) o.enabled = false; } catch (e) {}
  if (g.matchName === 'ADBE Mask Atom') { try { o.mode = String(g.maskMode); o.inverted = g.inverted; } catch (e) {} }
  if (kids.length) o.c = kids;
  return o;
}

function layerType(L: any): string {
  if (L instanceof TextLayer) return 'text';
  if (L instanceof ShapeLayer) return 'shape';
  if (L instanceof CameraLayer) return 'camera';
  if (L instanceof LightLayer) return 'light';
  if ((L as any).constructor && String((L as any).reflect && (L as any).reflect.name) === 'ThreeDModelLayer') return 'model';
  if (L.nullLayer) return 'null';
  if (L.adjustmentLayer) return 'adjustment';
  const s = L.source;
  if (s instanceof CompItem) return 'precomp';
  if (s && s.mainSource instanceof SolidSource) return 'solid';
  return 'footage';
}

function layerInfo(L: any, opts: InspectOpts): any {
  const o: any = { index: L.index, name: L.name, type: layerType(L), in: L.inPoint, out: L.outPoint, start: L.startTime };
  const tag = tagOf(L);
  if (tag) o.id = tag;
  if (L.comment && !tag) o.comment = L.comment;
  if (L.stretch !== undefined && L.stretch !== 100) o.stretch = L.stretch;
  if (L.parent) o.parent = { index: L.parent.index, name: L.parent.name };
  if (L.threeDLayer) o.threeD = true;
  try { if (L.threeDPerChar) o.threeDPerChar = true; } catch (e) {}
  if (!L.enabled) o.enabled = false;
  if (L.solo) o.solo = true;
  if (L.shy) o.shy = true;
  if (L.locked) o.locked = true;
  try { if (L.guideLayer) o.guide = true; } catch (e) {}
  try { if (L.motionBlur) o.motionBlur = true; } catch (e) {}
  try { if (L.blendingMode !== BlendingMode.NORMAL) o.blend = String(L.blendingMode); } catch (e) {}
  try { if (L.hasTrackMatte) o.matte = { layer: L.trackMatteLayer ? L.trackMatteLayer.name : null, type: String(L.trackMatteType) }; } catch (e) {}
  try { if (L.isTrackMatte) o.isMatte = true; } catch (e) {}
  try { if (L.autoOrient !== AutoOrientType.NO_AUTO_ORIENT) o.autoOrient = String(L.autoOrient); } catch (e) {}
  try { if (L.environmentLayer) o.environment = true; } catch (e) {}
  try { if (L.lightType !== undefined && L instanceof LightLayer) o.lightType = String(L.lightType); } catch (e) {}
  try { if (L.source) o.source = { name: L.source.name, w: L.source.width, h: L.source.height, file: L.source.file ? L.source.file.fsName : undefined, comp: L.source instanceof CompItem ? true : undefined }; } catch (e) {}
  try { const r = L.sourceRectAtTime(opts.time !== undefined ? opts.time : L.inPoint, false); o.rect = [r.left, r.top, r.width, r.height]; } catch (e) {}
  const props: any[] = [];
  for (let i = 1; i <= L.numProperties; i++) {
    let c: any;
    try { c = walk(L.property(i), opts, 0); } catch (e) { c = { err: String(e), at: i }; }
    if (c) props.push(c);
  }
  o.props = props;
  return o;
}

export function findComp(ref: any): CompItem | null {
  if (!ref) return app.project.activeItem instanceof CompItem ? app.project.activeItem : null;
  if (typeof ref === 'number') { const it = app.project.itemByID(ref); return it instanceof CompItem ? it : null; }
  const s = String(ref);
  const tagged = findTaggedComp(s);
  if (tagged) return tagged;
  let found: CompItem | null = null;
  for (let i = 1; i <= app.project.numItems; i++) { const it = app.project.item(i); if (it instanceof CompItem && it.name === s) { found = it; break; } }
  return found;
}

export function inspectComp(ref: any, opts: InspectOpts): any {
  const c = findComp(ref);
  if (!c) return { ok: false, error: 'comp not found: ' + ref };
  const o: any = { ok: true, comp: { name: c.name, itemId: c.id, id: tagOf(c), w: c.width, h: c.height, fps: c.frameRate, dur: c.duration, par: c.pixelAspect, bg: arr(c.bgColor), renderer: c.renderer, motionBlur: c.motionBlur, shutterAngle: c.shutterAngle, numLayers: c.numLayers, workArea: [c.workAreaStart, c.workAreaDuration] } };
  try { if (c.motionGraphicsTemplateName) o.comp.mgt = c.motionGraphicsTemplateName; } catch (e) {}
  try { const mk = (c as any).markerProperty; if (mk && mk.numKeys) { o.comp.markers = []; for (let k = 1; k <= mk.numKeys; k++) o.comp.markers.push({ t: mk.keyTime(k), comment: mk.keyValue(k).comment }); } } catch (e) {}
  o.layers = [];
  for (let i = 1; i <= c.numLayers; i++) {
    const L = c.layer(i);
    if (opts.layers && opts.layers.length) {
      let want = false;
      for (let j = 0; j < opts.layers.length; j++) { const w = opts.layers[j]; if (w === i || w === L.name || w === tagOf(L)) want = true; }
      if (!want) continue;
    }
    o.layers.push(layerInfo(L, opts));
  }
  return o;
}

export function inspectProject(): any {
  const items: any[] = [];
  for (let i = 1; i <= app.project.numItems; i++) {
    const it: any = app.project.item(i);
    const o: any = { id: it.id, name: it.name, type: it.typeName, folder: it.parentFolder && it.parentFolder !== app.project.rootFolder ? it.parentFolder.name : undefined };
    if (it instanceof CompItem) { o.w = it.width; o.h = it.height; o.fps = it.frameRate; o.dur = it.duration; o.layers = it.numLayers; const t = tagOf(it); if (t) o.aec = t; }
    else if (it instanceof FootageItem) { o.w = it.width; o.h = it.height; o.dur = it.duration; try { o.file = it.file ? it.file.fsName : undefined; } catch (e) {} if (it.footageMissing) o.missing = true; }
    items.push(o);
  }
  const active: any = app.project.activeItem;
  return { ok: true, file: app.project.file ? app.project.file.fsName : null, bpc: app.project.bitsPerChannel, numItems: app.project.numItems, active: active ? active.name : null, items: items };
}
