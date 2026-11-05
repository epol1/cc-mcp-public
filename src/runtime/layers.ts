// Layer creation and layer-level attributes.
import type { Ctx } from './ctx';
import { fail, warn } from './ctx';
import type { GroupSpec, PropSpec } from './groups';
import type { TextDocSpec } from './text';
import { findTaggedComp } from './project';

export interface IrLayer {
  id: string;
  type: 'solid' | 'null' | 'text' | 'shape' | 'adjustment' | 'footage' | 'precomp' | 'camera' | 'light' | 'model';
  name: string;
  in?: number;
  out?: number;
  start?: number;
  stretch?: number;
  parent?: string;
  threeD?: boolean;
  threeDPerChar?: boolean;
  motionBlur?: boolean;
  blend?: string;
  enabled?: boolean;
  shy?: boolean;
  locked?: boolean;
  guide?: boolean;
  label?: number;
  quality?: 'BEST' | 'DRAFT' | 'WIREFRAME';
  collapse?: boolean;
  autoOrient?: 'NO_AUTO_ORIENT' | 'ALONG_PATH' | 'CAMERA_OR_POINT_OF_INTEREST' | 'CHARACTERS_TOWARD_CAMERA';
  environment?: boolean;
  solid?: { color: number[]; w?: number; h?: number };
  text?: TextDocSpec;
  footage?: { asset: string };
  precomp?: { comp: string };
  camera?: { twoNode?: boolean };
  light?: { kind: 'parallel' | 'spot' | 'point' | 'ambient' | 'environment'; source?: string };
  groups?: { at: string; items: GroupSpec[] }[];
  props?: PropSpec[];
  matte?: { layer: string; type: 'alpha' | 'alphaInverted' | 'luma' | 'lumaInverted'; showSource?: boolean };
  markers?: { t: number; comment?: string; dur?: number; label?: number }[];
  /** Anchor at a fraction of the layer's content box (sourceRectAtTime), e.g. [0.5, 0.5] = center. */
  anchorBox?: number[];
  /** Footage fit into the comp: cover | contain | fill | width | height | none. */
  fit?: string;
  muted?: boolean;
  loop?: boolean;
  /**
   * Cloner instances (P1): this layer is instance 1 of `count`; after the comp is built it is duplicated in place
   * (copies keep its expressions, which address themselves by index), renamed "<prefix> 001"…, tagged
   * "<id>.<k>", and given per-instance Essential Properties values (`overrides[k]`: EG name → value).
   */
  instances?: { count: number; prefix: string; overrides?: ({ [name: string]: any } | null)[]; timeRemap?: boolean };
}

function hasProp(L: IrLayer, suffix: string): boolean {
  if (!L.props) return false;
  for (let i = 0; i < L.props.length; i++) { const p = L.props[i].p; if (p.substring(p.length - suffix.length) === suffix) return true; }
  return false;
}

/**
 * The layer's content box for layout/anchors: for shape layers, the FULLY DRAWN shape (Trim Paths are switched
 * off while measuring; a draw-on starting at 0 % would otherwise measure as a sliver).
 */
export function contentRect(layer: Layer, t: number): { left: number; top: number; width: number; height: number } {
  const trims: PropertyGroup[] = [];
  const walk = (g: PropertyGroup) => {
    for (let i = 1; i <= g.numProperties; i++) {
      const p: any = g.property(i);
      if (p.matchName === 'ADBE Vector Filter - Trim') { if (p.enabled) trims.push(p); continue; }
      if (p.propertyType !== PropertyType.PROPERTY && (p.matchName === 'ADBE Root Vectors Group' || p.matchName === 'ADBE Vector Group' || p.matchName === 'ADBE Vectors Group')) walk(p);
    }
  };
  const root = layer.property('ADBE Root Vectors Group') as PropertyGroup;
  if (root) walk(root);
  for (let i = 0; i < trims.length; i++) trims[i].enabled = false;
  try { return (layer as any).sourceRectAtTime(t, false); } finally { for (let i = 0; i < trims.length; i++) trims[i].enabled = true; }
}

/** Sets the anchor point to a fraction of the content box (text/shape). Call before animators/keys. */
export function applyAnchorBox(layer: Layer, L: IrLayer): void {
  if (!L.anchorBox) return;
  const r = contentRect(layer, L.in !== undefined ? L.in : 0);
  const ap = layer.property('ADBE Transform Group').property('ADBE Anchor Point') as Property;
  const x = r.left + r.width * L.anchorBox[0];
  const y = r.top + r.height * L.anchorBox[1];
  ap.setValue((layer as any).threeDLayer ? [x, y, 0] : [x, y]);
}

/** Fits footage to the comp unless the IR sets Scale explicitly. */
export function applyFootage(ctx: Ctx, layer: Layer, comp: CompItem, L: IrLayer): void {
  const av = layer as any;
  if (L.muted && av.hasAudio) av.audioEnabled = false;
  if (L.loop && av.canSetTimeRemapEnabled) {
    av.timeRemapEnabled = true;
    const tr = layer.property('ADBE Time Remapping') as Property;
    tr.expression = 'loopOut("cycle")';
    // The out point was clamped to the source length before time remapping existed: extend it now.
    if (L.out !== undefined) layer.outPoint = L.out;
  }
  const f = fitFactors(ctx, layer, comp, L);
  if (!f || hasProp(L, 'ADBE Scale')) return; // an authored Scale is applied relative to the fit (fitScale, after props)
  const sc = layer.property('ADBE Transform Group').property('ADBE Scale') as Property;
  sc.setValue([f[0] * 100, f[1] * 100, 100]);
}

function fitFactors(ctx: Ctx, layer: Layer, comp: CompItem, L: IrLayer): number[] | null {
  if (!L.fit || L.fit === 'none') return null;
  const av = layer as any;
  const sw = av.source ? av.source.width : av.width, sh = av.source ? av.source.height : av.height;
  if (!sw || !sh) { warn(ctx, 'cannot fit: source has no size'); return null; }
  let fx = comp.width / sw, fy = comp.height / sh;
  if (L.fit === 'cover') fx = fy = Math.max(fx, fy);
  else if (L.fit === 'contain') fx = fy = Math.min(fx, fy);
  else if (L.fit === 'width') fy = fx;
  else if (L.fit === 'height') fx = fy;
  return [fx, fy];
}

/**
 * Footage with a fit AND an authored Scale (e.g. a slow push-in 100 → 108): the authored values are relative
 * to the fitted size (100 = exactly covering/containing), so the keys/value are multiplied by the fit factors.
 * Runs after props (pass 4).
 */
export function fitScale(ctx: Ctx, layer: Layer, comp: CompItem, L: IrLayer): void {
  if ((L.type !== 'footage' && L.type !== 'model') || !hasProp(L, 'ADBE Scale')) return;
  const f = fitFactors(ctx, layer, comp, L);
  if (!f) return;
  const sc = layer.property('ADBE Transform Group').property('ADBE Scale') as Property;
  const mul = (v: any) => [v[0] * f[0], v[1] * f[1], v.length > 2 ? v[2] : 100];
  if (sc.numKeys === 0) { sc.setValue(mul(sc.value)); return; }
  for (let k = 1; k <= sc.numKeys; k++) sc.setValueAtKey(k, mul(sc.keyValue(k)));
  // Eases are in %/s per dimension: scale them with the values.
  for (let k = 1; k <= sc.numKeys; k++) {
    const ie = sc.keyInTemporalEase(k), oe = sc.keyOutTemporalEase(k);
    const sIn: KeyframeEase[] = [], sOut: KeyframeEase[] = [];
    for (let d = 0; d < ie.length; d++) { sIn[d] = new KeyframeEase(ie[d].speed * (d < 2 ? f[d] : 1), ie[d].influence); sOut[d] = new KeyframeEase(oe[d].speed * (d < 2 ? f[d] : 1), oe[d].influence); }
    const it = sc.keyInInterpolationType(k), ot = sc.keyOutInterpolationType(k);
    if (it === KeyframeInterpolationType.BEZIER || ot === KeyframeInterpolationType.BEZIER) { (sc as any).setTemporalEaseAtKey(k, sIn, sOut); sc.setInterpolationTypeAtKey(k, it, ot); }
  }
}

const LIGHT: { [k: string]: string } = { parallel: 'PARALLEL', spot: 'SPOT', point: 'POINT', ambient: 'AMBIENT', environment: 'ENVIRONMENT' };
const MATTE: { [k: string]: string } = { alpha: 'ALPHA', alphaInverted: 'ALPHA_INVERTED', luma: 'LUMA', lumaInverted: 'LUMA_INVERTED' };

export const TAG = 'aec:';

/**
 * Style-lint tags kept in the layer comment after the id ("aec:<id>;tags=bg,transition:shape-wipe;d=…"), so every
 * tool that samples a comp (edits, lint_comp, motion_preview) knows what a layer is for, not only the build.
 */
export function commentTags(c: string): string[] {
  const i = c.indexOf(';tags=');
  if (i < 0) return [];
  const rest = c.substring(i + 6), e = rest.indexOf(';');
  const s = e >= 0 ? rest.substring(0, e) : rest;
  return s ? s.split(',') : [];
}
export const tagsSegment = (tags: string[] | undefined): string => (tags && tags.length ? ';tags=' + tags.join(',') : '');

export function tagOf(x: { comment: string }): string | null {
  const c = x.comment || '';
  if (c.substring(0, TAG.length) !== TAG) return null;
  const rest = c.substring(TAG.length);
  const semi = rest.indexOf(';');
  return semi >= 0 ? rest.substring(0, semi) : rest;
}

export function createLayer(ctx: Ctx, comp: CompItem, L: IrLayer): Layer {
  const layers = comp.layers;
  let layer: Layer;
  switch (L.type) {
    case 'solid':
    case 'adjustment': {
      const s = L.solid || { color: [1, 1, 1] };
      layer = layers.addSolid([s.color[0], s.color[1], s.color[2]], L.name, s.w || comp.width, s.h || comp.height, comp.pixelAspect, comp.duration);
      if (L.type === 'adjustment') (layer as AVLayer).adjustmentLayer = true;
      break;
    }
    case 'null':
      layer = layers.addNull(comp.duration);
      break;
    case 'text': {
      const t = L.text || { text: '' };
      layer = t.box ? layers.addBoxText([t.box.w, t.box.h], t.text) : layers.addText(t.text);
      break;
    }
    case 'shape':
      layer = layers.addShape();
      break;
    case 'footage':
    case 'model': {
      const item = L.footage ? ctx.items[L.footage.asset] : null;
      if (!item) fail(ctx, 'asset not imported: ' + (L.footage ? L.footage.asset : '(none)'));
      layer = layers.add(item as AVItem);
      break;
    }
    case 'precomp': {
      let c: CompItem | null = L.precomp ? ctx.comps[L.precomp.comp] : null;
      if (!c && L.precomp) c = findTaggedComp(L.precomp.comp); // comps built by an earlier request (variants → Compare)
      if (!c) fail(ctx, 'precomp not built yet: ' + (L.precomp ? L.precomp.comp : '(none)'));
      layer = layers.add(c as CompItem);
      break;
    }
    case 'camera':
      layer = layers.addCamera(L.name, [comp.width / 2, comp.height / 2]);
      if (L.camera && L.camera.twoNode === false) layer.autoOrient = AutoOrientType.NO_AUTO_ORIENT;
      break;
    case 'light': {
      layer = layers.addLight(L.name, [comp.width / 2, comp.height / 2]);
      const kind = LIGHT[L.light ? L.light.kind : 'point'];
      if (!kind) fail(ctx, 'unknown light kind');
      (layer as LightLayer).lightType = (LightType as any)[kind];
      break;
    }
    default:
      fail(ctx, 'unknown layer type ' + (L as any).type);
  }
  layer!.name = L.name;
  layer!.comment = TAG + L.id + tagsSegment((L as any).tags);
  return layer!;
}

export function setLayerAttrs(ctx: Ctx, layer: Layer, L: IrLayer): void {
  const av = layer as any;
  if (L.threeD !== undefined && L.type !== 'camera' && L.type !== 'light') av.threeDLayer = L.threeD;
  if (L.threeDPerChar) av.threeDPerChar = true;
  if (L.start !== undefined) layer.startTime = L.start;
  if (L.stretch !== undefined) av.stretch = L.stretch;
  if (L.in !== undefined) layer.inPoint = L.in;
  if (L.out !== undefined) layer.outPoint = L.out;
  if (L.motionBlur !== undefined) av.motionBlur = L.motionBlur;
  if (L.blend) {
    const b = (BlendingMode as any)[L.blend];
    if (b === undefined) fail(ctx, 'unknown blend mode ' + L.blend);
    av.blendingMode = b;
  }
  if (L.shy !== undefined) layer.shy = L.shy;
  if (L.guide !== undefined) av.guideLayer = L.guide;
  if (L.label !== undefined) layer.label = L.label;
  if (L.quality) av.quality = (LayerQuality as any)[L.quality];
  if (L.collapse !== undefined) av.collapseTransformation = L.collapse;
  if (L.autoOrient) layer.autoOrient = (AutoOrientType as any)[L.autoOrient];
  if (L.environment !== undefined) av.environmentLayer = L.environment;
  if (L.enabled !== undefined) layer.enabled = L.enabled;
  // Time Remap must exist before its expression is set (cloner stagger).
  if (L.instances && L.instances.timeRemap) av.timeRemapEnabled = true;
}

export function wireLayer(ctx: Ctx, layer: Layer, L: IrLayer): void {
  if (L.parent) {
    const p = ctx.layers[L.parent];
    if (!p) fail(ctx, 'parent not found: ' + L.parent);
    layer.setParentWithJump(p);
  }
  if (L.matte) {
    const m = ctx.layers[L.matte.layer];
    if (!m) fail(ctx, 'matte layer not found: ' + L.matte.layer);
    (layer as any).setTrackMatte(m, (TrackMatteType as any)[MATTE[L.matte.type]]);
    // AE switches the matte source's video off; keep it visible when asked (it still works as the matte).
    if (L.matte.showSource) m.enabled = true;
  }
  if (L.light && L.light.source) {
    const src = ctx.layers[L.light.source];
    if (!src) fail(ctx, 'light source layer not found: ' + L.light.source);
    (layer as any).lightSource = src;
  }
  if (L.markers) {
    const mp = layer.property('ADBE Marker') as Property;
    for (let i = 0; i < L.markers.length; i++) {
      const mk = L.markers[i];
      const mv = new MarkerValue(mk.comment || '');
      if (mk.dur) mv.duration = mk.dur;
      if (mk.label) mv.label = mk.label;
      mp.setValueAtTime(mk.t, mv);
    }
  }
}

export function lockIfNeeded(layer: Layer, L: IrLayer): void {
  if (L.locked) layer.locked = true;
}

export function warnUnused(ctx: Ctx, L: IrLayer): void {
  if (L.type === 'text' && !L.text) warn(ctx, 'text layer without text');
}

/**
 * Layer > Create Shapes from Vector Layer on an imported .ai/.eps/.pdf layer (D66): the command works on the
 * selected layer of the active comp and inserts "<name> Outlines" above it. The source layer is removed and the
 * shape layer takes over its name, tag and timing, so every later pass targets the shapes.
 */
export function vectorToShapes(ctx: Ctx, comp: CompItem, layer: Layer, L: IrLayer): Layer {
  try { comp.openInViewer(); } catch (e) { /* headless */ }
  for (let i = 1; i <= comp.numLayers; i++) comp.layer(i).selected = false;
  layer.selected = true;
  const n0 = comp.numLayers, idx = layer.index;
  app.executeCommand(app.findMenuCommandId('Create Shapes from Vector Layer'));
  const shape = comp.numLayers === n0 + 1 ? comp.layer(idx) : null;
  if (!shape || !(shape instanceof ShapeLayer)) fail(ctx, 'Create Shapes from Vector Layer did not convert "' + L.name + '" (is it vector art: .ai, .eps or .pdf?)');
  const s = shape as ShapeLayer;
  s.selected = false;
  s.name = L.name;
  s.comment = layer.comment;
  s.startTime = layer.startTime;
  s.inPoint = layer.inPoint;
  s.outPoint = layer.outPoint;
  layer.remove();
  const w = (L as any).vectorWidth;
  if (w) {
    const r = s.sourceRectAtTime(s.inPoint, false);
    if (r.width > 0) { const k = (w / r.width) * 100; (s.property('ADBE Transform Group').property('ADBE Scale') as Property).setValue([k, k]); }
  }
  return s;
}
