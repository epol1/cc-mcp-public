// Keyframes with exact temporal eases and spatial tangents.
// Order matters in AE: set values, then interpolation (BEZIER before eases), then spatial flags/tangents,
// then temporal continuity, then eases. Always pass both in and out eases.
import type { Ctx } from './ctx';
import { coerce, easeDims } from './props';
import { clamp, map } from './util';

export interface IrEase { speed: number; influence: number }
export interface IrKey {
  t: number; // seconds
  v: any;
  i?: 'bezier' | 'linear' | 'hold';
  o?: 'bezier' | 'linear' | 'hold';
  ie?: IrEase[];
  oe?: IrEase[];
  tc?: boolean; // temporal continuous
  sp?: { ti?: number[]; to?: number[]; cont?: boolean; auto?: boolean };
  rov?: boolean;
  label?: number;
}

function interp(t: string | undefined): KeyframeInterpolationType {
  if (t === 'linear') return KeyframeInterpolationType.LINEAR;
  if (t === 'hold') return KeyframeInterpolationType.HOLD;
  return KeyframeInterpolationType.BEZIER;
}

function eases(src: IrEase[] | undefined, dims: number, colorScale: number): KeyframeEase[] {
  const out: KeyframeEase[] = [];
  // Spatial and color properties take ONE ease: speed along the (straight) path = |per-dim speeds|,
  // ×255 for color (AE measures color speed in 0–255 units, calibrated D31).
  if (dims === 1 && src && src.length > 1) {
    let ss = 0;
    for (let d = 0; d < src.length; d++) ss += src[d].speed * src[d].speed;
    return [new KeyframeEase(Math.sqrt(ss) * colorScale, clamp(src[0].influence, 0.1, 100))];
  }
  for (let d = 0; d < dims; d++) {
    const e = src && src.length ? src[d < src.length ? d : src.length - 1] : { speed: 0, influence: 16.666666667 };
    out[d] = new KeyframeEase(e.speed, clamp(e.influence, 0.1, 100));
  }
  return out;
}

function isSpatial(prop: Property): boolean {
  const vt = prop.propertyValueType;
  return vt === PropertyValueType.TwoD_SPATIAL || vt === PropertyValueType.ThreeD_SPATIAL;
}

/**
 * Replaces a property's keys. `addFirst` sets the new keys before removing stale ones, so the property is never
 * empty in between: required for Time Remap (removing its last key switches remapping off and hides it).
 */
export function applyKeys(ctx: Ctx, prop: Property, keys: IrKey[], addFirst?: boolean): void {
  if (!addFirst) for (let k = prop.numKeys; k >= 1; k--) prop.removeKey(k);
  if (!keys.length) { for (let k = prop.numKeys; k >= 1; k--) prop.removeKey(k); return; }
  const times = map(keys, (k) => k.t);
  const values = map(keys, (k) => coerce(ctx, prop, k.v));
  if (keys.length === 1) prop.setValueAtTime(times[0], values[0]);
  else prop.setValuesAtTimes(times, values);
  if (addFirst) {
    for (let k = prop.numKeys; k >= 1; k--) {
      const t = prop.keyTime(k);
      let keep = false;
      for (let i = 0; i < times.length; i++) if (Math.abs(times[i] - t) < 1e-4) { keep = true; break; }
      if (!keep) prop.removeKey(k);
    }
  }
  const dims = easeDims(prop);
  const spatial = isSpatial(prop);
  const isText = prop.propertyValueType === PropertyValueType.TEXT_DOCUMENT;
  const cs = prop.propertyValueType === PropertyValueType.COLOR ? 255 : 1;
  for (let n = 0; n < keys.length; n++) {
    const k = keys[n];
    const idx = prop.nearestKeyIndex(k.t);
    if (isText) {
      prop.setInterpolationTypeAtKey(idx, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
      continue;
    }
    const it = interp(k.i);
    const ot = interp(k.o);
    prop.setInterpolationTypeAtKey(idx, it, ot);
    if (spatial) {
      const sp = k.sp || {};
      const zero = prop.propertyValueType === PropertyValueType.ThreeD_SPATIAL ? [0, 0, 0] : [0, 0];
      prop.setSpatialAutoBezierAtKey(idx, sp.auto === true);
      prop.setSpatialContinuousAtKey(idx, sp.cont === true);
      if (!sp.auto) (prop as any).setSpatialTangentsAtKey(idx, sp.ti || zero, sp.to || zero);
      if (n > 0 && n < keys.length - 1) prop.setRovingAtKey(idx, k.rov === true);
    }
    prop.setTemporalAutoBezierAtKey(idx, false);
    prop.setTemporalContinuousAtKey(idx, k.tc === true);
    if (it === KeyframeInterpolationType.BEZIER || ot === KeyframeInterpolationType.BEZIER) {
      (prop as any).setTemporalEaseAtKey(idx, eases(k.ie, dims, cs), eases(k.oe, dims, cs));
      // Setting eases turns HOLD/LINEAR sides back into BEZIER (verified): re-apply the interpolation.
      if (it !== KeyframeInterpolationType.BEZIER || ot !== KeyframeInterpolationType.BEZIER) prop.setInterpolationTypeAtKey(idx, it, ot);
    }
    if (k.label) {
      try { (prop as any).setLabelAtKey(idx, k.label); } catch (e) { /* older AE */ }
    }
  }
}

/** Reads keys into IR form so they can be re-applied after time transforms. */
export function captureKeys(p: Property): IrKey[] {
  const out: IrKey[] = [];
  const vt = p.propertyValueType;
  const spatial = vt === PropertyValueType.TwoD_SPATIAL || vt === PropertyValueType.ThreeD_SPATIAL;
  const I = (t: KeyframeInterpolationType) => (t === KeyframeInterpolationType.LINEAR ? 'linear' : t === KeyframeInterpolationType.HOLD ? 'hold' : 'bezier');
  for (let k = 1; k <= p.numKeys; k++) {
    let v: any = p.keyValue(k);
    if (vt === PropertyValueType.SHAPE) v = { v: v.vertices, i: v.inTangents, o: v.outTangents, c: v.closed };
    const key: any = { t: p.keyTime(k), v: v, i: I(p.keyInInterpolationType(k)), o: I(p.keyOutInterpolationType(k)) };
    if (vt !== PropertyValueType.TEXT_DOCUMENT) {
      const ie = p.keyInTemporalEase(k), oe = p.keyOutTemporalEase(k);
      key.ie = []; key.oe = [];
      for (let d = 0; d < ie.length; d++) key.ie[d] = { speed: ie[d].speed, influence: ie[d].influence };
      for (let d = 0; d < oe.length; d++) key.oe[d] = { speed: oe[d].speed, influence: oe[d].influence };
      key.tc = p.keyTemporalContinuous(k);
    }
    if (spatial) key.sp = { ti: p.keyInSpatialTangent(k), to: p.keyOutSpatialTangent(k), cont: p.keySpatialContinuous(k), auto: p.keySpatialAutoBezier(k) };
    try { const lb = (p as any).keyLabel(k); if (lb) key.label = lb; } catch (e) { /* older AE */ }
    out.push(key);
  }
  return out;
}
