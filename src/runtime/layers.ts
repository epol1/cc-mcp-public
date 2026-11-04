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
  matte?: { layer: string; type: 'alpha' | 'alphaInverted' | 'luma' | 'lumaInverted' };
  markers?: { t: number; comment?: string; dur?: number; label?: number }[];
  /** Anchor at a fraction of the layer's content box (sourceRectAtTime), e.g. [0.5, 0.5] = center. */
  anchorBox?: number[];
  /** Footage fit into the comp: cover | contain | fill | width | height | none. */
  fit?: string;
  muted?: boolean;
  loop?: boolean;
}

function hasProp(L: IrLayer, suffix: string): boolean {
  if (!L.props) return false;
  for (let i = 0; i < L.props.length; i++) { const p = L.props[i].p; if (p.substring(p.length - suffix.length) === suffix) return true; }
  return false;
}

/** Sets the anchor point to a fraction of the content box (text/shape). Call before animators/keys. */
export function applyAnchorBox(layer: Layer, L: IrLayer): void {
  if (!L.anchorBox) return;
  const r = (layer as any).sourceRectAtTime(L.in !== undefined ? L.in : 0, false);
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
  }
  if (!L.fit || L.fit === 'none' || hasProp(L, 'ADBE Scale')) return;
  const sw = av.source ? av.source.width : av.width, sh = av.source ? av.source.height : av.height;
  if (!sw || !sh) { warn(ctx, 'cannot fit: source has no size'); return; }
  let fx = comp.width / sw, fy = comp.height / sh;
  if (L.fit === 'cover') fx = fy = Math.max(fx, fy);
  else if (L.fit === 'contain') fx = fy = Math.min(fx, fy);
  else if (L.fit === 'width') fy = fx;
  else if (L.fit === 'height') fx = fy;
  const sc = layer.property('ADBE Transform Group').property('ADBE Scale') as Property;
  sc.setValue([fx * 100, fy * 100, 100]);
}

const LIGHT: { [k: string]: string } = { parallel: 'PARALLEL', spot: 'SPOT', point: 'POINT', ambient: 'AMBIENT', environment: 'ENVIRONMENT' };
const MATTE: { [k: string]: string } = { alpha: 'ALPHA', alphaInverted: 'ALPHA_INVERTED', luma: 'LUMA', lumaInverted: 'LUMA_INVERTED' };

export const TAG = 'aec:';

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
  layer!.comment = TAG + L.id;
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
