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

export function applyKeys(ctx: Ctx, prop: Property, keys: IrKey[]): void {
  for (let k = prop.numKeys; k >= 1; k--) prop.removeKey(k);
  if (!keys.length) return;
  const times = map(keys, (k) => k.t);
  const values = map(keys, (k) => coerce(ctx, prop, k.v));
  if (keys.length === 1) prop.setValueAtTime(times[0], values[0]);
  else prop.setValuesAtTimes(times, values);
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
