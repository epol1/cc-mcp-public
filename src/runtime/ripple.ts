// Ripple edits (D50): insert or remove time, or stretch a span, and shift everything after it so nothing is
// retimed by hand. Layers after the edit move whole (startTime: keys, markers and footage frames travel
// with them); layers spanning it get keys, markers and in/out points remapped, with eases rescaled so curve
// shapes survive; ae-compose expressions are time-warped (text reveals, springs) or re-anchored (timing
// rigs); precomps spanning the edit are rippled inside unless they are shared. Scenes are comp markers
// with a duration (named <Sequence>s emit them), so "the scene at 1:02" resolves to a span.
import type { Ctx } from './ctx';
import { fail, warn } from './ctx';
import type { IrKey } from './keys';
import { applyKeys, captureKeys } from './keys';
import { isCrashy, isCrashyParent, isOpaqueValueType } from './safety';
import { errText, trim } from './util';

const EPS = 1e-6;

/** The edit as a time map: old comp span [a, b] becomes [a, a + len]. a === b inserts `len` seconds at a. */
export interface TimeMap { a: number; b: number; len: number }

interface Stats { shifted: number; spanning: number; keys: number; markers: number; exprs: number; rigs: number; removed: string[]; precomps: string[]; untouchedExprs: number }

function delta(m: TimeMap): number { return m.len - (m.b - m.a); }
function isInsert(m: TimeMap): boolean { return m.b - m.a < EPS; }

/** Old comp time → new. On an insert, a time exactly at the insert point moves unless `stay` (it ends a motion). */
export function mapT(m: TimeMap, t: number, stay?: boolean): number {
  if (isInsert(m)) return t < m.a - EPS || (stay === true && t < m.a + EPS) ? t : t + m.len;
  if (t <= m.a) return t;
  if (t >= m.b) return t + delta(m);
  return m.a + (t - m.a) * m.len / (m.b - m.a);
}

export function parseT(v: any, fps: number): number {
  if (typeof v === 'number') return v;
  const s = trim(String(v));
  let r: RegExpExecArray | null;
  if ((r = /^(-?[\d.]+)\s*ms$/.exec(s))) return +r[1] / 1000;
  if ((r = /^(-?[\d.]+)\s*s$/.exec(s))) return +r[1];
  if ((r = /^(-?[\d.]+)\s*f$/.exec(s))) return +r[1] / fps;
  if ((r = /^(\d+):(\d+):(\d+):(\d+)$/.exec(s))) return +r[1] * 3600 + +r[2] * 60 + +r[3] + +r[4] / fps;
  if ((r = /^(\d+):(\d+(?:\.\d+)?)$/.exec(s))) return +r[1] * 60 + +r[2];
  if (/^-?[\d.]+$/.test(s)) return +s;
  throw new Error('invalid time "' + v + '": use seconds (1.5), "1.5s", "400ms", "12f", "1:02" or "hh:mm:ss:ff"');
}

// ---------- properties ----------

type Visit = (p: Property) => void;

function walk(g: PropertyGroup | Layer, f: Visit, skipped: string[]): void {
  const n = (g as PropertyGroup).numProperties;
  for (let i = 1; i <= n; i++) {
    const p = (g as PropertyGroup).property(i);
    if (!p) continue;
    if (p.propertyType === PropertyType.PROPERTY) { if (!isCrashy(p.matchName)) f(p as Property); continue; }
    if (isCrashyParent(p.matchName)) { skipped[skipped.length] = p.name; continue; }
    walk(p as PropertyGroup, f, skipped);
  }
}

function clone(k: IrKey): IrKey {
  const c: any = {};
  for (const x in k) if (Object.prototype.hasOwnProperty.call(k, x)) c[x] = (k as any)[x];
  return c as IrKey;
}
function scaleEase(e: { speed: number; influence: number }[] | undefined, r: number): any {
  if (!e) return e;
  const o: any[] = [];
  for (let d = 0; d < e.length; d++) o[d] = { speed: e[d].speed * r, influence: e[d].influence };
  return o;
}
function zeroEase(e: { speed: number; influence: number }[] | undefined): any {
  if (!e) return e;
  const o: any[] = [];
  for (let d = 0; d < e.length; d++) o[d] = { speed: 0, influence: e[d].influence };
  return o;
}

/**
 * Remaps one property's keys. Each old key k gets an arrival time (where its incoming segment ends) and a
 * departure time (where its outgoing segment starts); they differ only when an insert lands exactly on a key
 * in the middle of an animation — the key is then doubled so the value holds for the inserted time.
 * Segment speeds rescale by old/new segment length (influence is a percentage, so curve shapes are kept).
 */
function remapKeys(ctx: Ctx, p: Property, m: TimeMap): number {
  const ks = splitLinearAt(p, captureKeys(p), m);
  const n = ks.length;
  if (!n) return 0;
  const arr: number[] = [], dep: number[] = [];
  for (let k = 0; k < n; k++) {
    const t = ks[k].t;
    if (isInsert(m) && Math.abs(t - m.a) < EPS) {
      const hasPrev = k > 0, hasNext = k < n - 1;
      arr[k] = hasPrev ? t : t + m.len;
      dep[k] = hasNext ? t + m.len : arr[k];
    } else { arr[k] = mapT(m, t); dep[k] = arr[k]; }
  }
  const out: IrKey[] = [];
  for (let k = 0; k < n; k++) {
    const key = clone(ks[k]);
    const rIn = k > 0 ? (ks[k].t - ks[k - 1].t) / Math.max(arr[k] - dep[k - 1], EPS) : 1;
    const rOut = k < n - 1 ? (ks[k + 1].t - ks[k].t) / Math.max(arr[k + 1] - dep[k], EPS) : 1;
    key.ie = scaleEase(key.ie, rIn);
    key.oe = scaleEase(key.oe, rOut);
    if (dep[k] - arr[k] > EPS) {
      // Hold: the arrival key keeps the incoming ease, the departure key the outgoing one.
      const first = clone(key), second = clone(key);
      first.t = arr[k]; first.oe = zeroEase(key.oe); if (first.o !== 'hold') first.o = 'linear';
      second.t = dep[k]; second.ie = zeroEase(key.ie); if (second.i !== 'hold') second.i = 'linear';
      if (key.sp) { first.sp = { ti: key.sp.ti, to: key.sp.ti ? zeros(key.sp.ti.length) : undefined, cont: false, auto: false }; second.sp = { ti: key.sp.to ? zeros(key.sp.to.length) : undefined, to: key.sp.to, cont: false, auto: false }; }
      first.tc = false; second.tc = false;
      push(out, first); push(out, second);
    } else { key.t = arr[k]; push(out, key); }
  }
  try { applyKeys(ctx, p, out, true); }
  catch (e) { throw new Error('could not move the keys of ' + p.name + ' (' + p.matchName + '): ' + errText(e)); }
  return n;
}

/**
 * Insert edits: a LINEAR segment that spans the insert point gets an exact key at that point (so it holds for the
 * inserted time instead of stretching), e.g. a time-remapped precomp keeps playing at speed, pauses, resumes.
 */
function splitLinearAt(p: Property, ks: IrKey[], m: TimeMap): IrKey[] {
  if (!isInsert(m) || ks.length < 2) return ks;
  const vt = p.propertyValueType;
  if (vt === PropertyValueType.SHAPE || vt === PropertyValueType.TEXT_DOCUMENT) return ks;
  for (let k = 0; k < ks.length - 1; k++) {
    const a = ks[k], b = ks[k + 1];
    if (!(a.t < m.a - EPS && b.t > m.a + EPS) || a.o !== 'linear' || b.i !== 'linear') continue;
    if (a.sp && ((a.sp.to && (a.sp.to[0] || a.sp.to[1])) || (b.sp && b.sp.ti && (b.sp.ti[0] || b.sp.ti[1])))) continue; // curved spatial path
    const f = (m.a - a.t) / (b.t - a.t);
    let v: any;
    if (typeof a.v === 'number') v = a.v + (b.v - a.v) * f;
    else { v = []; for (let d = 0; d < a.v.length; d++) v[d] = a.v[d] + (b.v[d] - a.v[d]) * f; }
    const mid: IrKey = { t: m.a, v: v, i: 'linear', o: 'linear' };
    if (a.ie) { mid.ie = scaleEase(a.oe, 1); mid.oe = scaleEase(a.oe, 1); }
    if (a.sp) mid.sp = { ti: zeros(a.sp.ti ? a.sp.ti.length : 2), to: zeros(a.sp.to ? a.sp.to.length : 2), cont: false, auto: false };
    const out: IrKey[] = [];
    for (let j = 0; j <= k; j++) out[out.length] = ks[j];
    out[out.length] = mid;
    for (let j = k + 1; j < ks.length; j++) out[out.length] = ks[j];
    return out;
  }
  return ks;
}

function zeros(n: number): number[] { const z: number[] = []; for (let i = 0; i < n; i++) z[i] = 0; return z; }

/** Appends, merging keys that land on the same time (removed time): the later key wins, keeping the earlier arrival ease. */
function push(out: IrKey[], k: IrKey): void {
  const last = out[out.length - 1];
  if (last && Math.abs(last.t - k.t) < EPS) { const ie = last.ie, i = last.i; out[out.length - 1] = k; k.ie = ie; k.i = i; return; }
  out[out.length] = k;
}

function remapMarkers(mp: Property, m: TimeMap, ctx?: Ctx, owner?: string): number {
  const n = mp.numKeys;
  if (!n) return 0;
  const list: { t: number; v: MarkerValue }[] = [];
  for (let k = 1; k <= n; k++) list[list.length] = { t: mp.keyTime(k), v: mp.keyValue(k) as any };
  for (let k = n; k >= 1; k--) mp.removeKey(k);
  for (let i = 0; i < list.length; i++) {
    const it = list[i], d = (it.v as any).duration || 0;
    // Beat-grid markers (A5) follow the music, which keeps playing through a ripple: they stay where they are.
    const cm = String((it.v as any).comment);
    if (!owner && d === 0 && (cm === 'beat' || /^bar \d+$/.test(cm))) { placeMarker(mp, it.t, it.v); continue; }
    const t2 = mapT(m, it.t);
    const e2 = d > 0 ? mapT(m, it.t + d, true) : t2;
    if (d > 0) (it.v as any).duration = Math.max(0, e2 - t2);
    if (!placeMarker(mp, t2, it.v) && ctx) warn(ctx, (owner || 'marker') + ': a protected-region marker on a time-stretched layer could not keep its exact length (AE couples them); check it');
  }
  return n;
}

/**
 * Adds a marker at comp time t. AE repositions protected-region markers on time-stretched layers (set at 3.82 s,
 * lands at 3.37 s), so read back where it landed and correct the request until it lands on t.
 */
function placeMarker(mp: Property, t: number, v: MarkerValue): boolean {
  let x = t;
  const wantDur = (v as any).duration || 0;
  for (let iter = 0; iter < 8; iter++) {
    const before: number[] = [];
    for (let k = 1; k <= mp.numKeys; k++) before[before.length] = mp.keyTime(k);
    mp.setValueAtTime(x, v);
    let landed = -1, idx = -1;
    for (let k = 1; k <= mp.numKeys; k++) {
      const kt = mp.keyTime(k);
      let old = false;
      for (let j = 0; j < before.length; j++) if (Math.abs(before[j] - kt) < 1e-6) { old = true; break; }
      if (!old) { landed = kt; idx = k; break; }
    }
    if (idx < 0) return true;
    if (Math.abs(landed - t) < 1e-4) {
      // AE also rescales protected-region durations on stretched layers (start and length are coupled there):
      // the start is exact; report a length that differs.
      const gotDur = (mp.keyValue(idx) as any).duration || 0;
      return wantDur <= 0 || Math.abs(gotDur - wantDur) < 1e-3;
    }
    mp.removeKey(idx);
    x += t - landed;
  }
  mp.setValueAtTime(x, v);
  return false;
}

// ---------- expressions ----------

const TIME_TOKEN = /(^|[^.\w$])time(?![\w$])/g;
const TIME_TEST = /(^|[^.\w$])time(?![\w$])/;

function warpFn(m: TimeMap, name: string): string {
  const A = m.a.toFixed(6), B = m.b.toFixed(6), L = m.len.toFixed(6), D = delta(m).toFixed(6);
  let body: string;
  if (isInsert(m)) body = 'return t < ' + A + ' ? t : (t < ' + A + ' + ' + L + ' ? ' + A + ' : t - ' + L + ');';
  else if (m.len < EPS) body = 'return t < ' + A + ' ? t : t + (' + B + ' - ' + A + ');';
  else body = 'return t <= ' + A + ' ? t : (t < ' + A + ' + ' + L + ' ? ' + A + ' + (t - ' + A + ') * (' + B + ' - ' + A + ') / ' + L + ' : t - ' + D + ');';
  return 'function ' + name + '(t) { ' + body + ' } // ae-compose ripple time warp';
}

/** Re-expresses the expression in the old timeline: time → warp(time), inPoint/outPoint → their old values. */
function warpExpr(src: string, m: TimeMap, oldIn: number, oldOut: number): string {
  let n = 1;
  while (src.indexOf('function aecW' + n + '(') >= 0) n++;
  const name = 'aecW' + n;
  let s = src.replace(TIME_TOKEN, '$1' + name + '(time)');
  s = s.replace(/(^|[^.\w$])inPoint(?![\w$])/g, '$1(' + oldIn.toFixed(6) + ')');
  s = s.replace(/(^|[^.\w$])outPoint(?![\w$])/g, '$1(' + oldOut.toFixed(6) + ')');
  return warpFn(m, name) + '\n' + s;
}

function fixExpression(p: Property, m: TimeMap, spanning: boolean, oldIn: number, oldOut: number, st: Stats): void {
  let src: string;
  try { src = p.expression; } catch (e) { return; }
  if (!src) return;
  if (src.indexOf('ae-compose') < 0) { if (TIME_TEST.test(src)) st.untouchedExprs++; return; }
  if (src.indexOf('ae-compose rig') >= 0) {
    // Rigs read the property's own (already moved) keys: only the pivot time moves.
    const r = /var t0 = (-?[\d.]+);/.exec(src);
    if (r) { p.expression = src.replace(r[0], 'var t0 = ' + mapT(m, +r[1]).toFixed(6) + ';'); st.rigs++; }
    return;
  }
  // Layer-relative text reveals move with the layer; absolute ones (springs, earlier warps) and anything on a
  // spanning layer are warped.
  if (!spanning && src.indexOf('ae-compose spring') < 0 && src.indexOf('function aecW') < 0) return;
  p.expression = warpExpr(src, m, oldIn, oldOut);
  st.exprs++;
}

/** AE refuses to set keys on properties hidden in the current state (e.g. 3D-only options on a 2D layer). Probe with a no-op write. */
function settable(p: Property): boolean {
  // setValueAtKey succeeds on hidden properties while "set value at times" does not: probe with the latter.
  try { p.setValueAtTime(p.keyTime(1), p.keyValue(1)); return true; } catch (e) { return false; }
}

// ---------- layers ----------

function isFootageLike(L: Layer): boolean {
  const src: any = (L as any).source;
  if (!src || !(src instanceof FootageItem)) return false;
  try { if ((src as FootageItem).mainSource && (src as any).mainSource.isStill) return false; } catch (e) {}
  return src.duration > 0;
}

function sourceLimit(L: Layer): number {
  const src: any = (L as any).source;
  const stretch = (L as any).stretch || 100;
  return L.startTime + src.duration * Math.abs(stretch) / 100;
}

function usesOf(comp: CompItem, src: CompItem): number {
  let n = 0;
  try { n = src.usedIn.length; } catch (e) { n = 1; }
  let here = 0;
  for (let i = 1; i <= comp.numLayers; i++) if ((comp.layer(i) as any).source === src) here++;
  return here > 1 ? here : n;
}

function rippleLayer(ctx: Ctx, comp: CompItem, L: Layer, m: TimeMap, deep: boolean, depth: number, st: Stats): void {
  const i = L.inPoint, o = L.outPoint;
  const skipped: string[] = [];
  const keyed: Property[] = [], exprs: Property[] = [];
  let markers: Property | null = null;
  walk(L, (p) => {
    if (p.matchName === 'ADBE Marker') { markers = p; return; }
    if (p.numKeys > 0) {
      if (isOpaqueValueType(p.propertyValueType)) warn(ctx, L.name + ': keys on ' + p.name + ' cannot be moved by scripts');
      else if (!settable(p)) warn(ctx, L.name + ': ' + p.name + ' is hidden in the current state; its keys were not moved');
      else keyed[keyed.length] = p;
    }
    try { if (p.expression) exprs[exprs.length] = p; } catch (e) {}
  }, skipped);
  if (skipped.length) warn(ctx, L.name + ': gradient fill/stroke keys are not remapped (' + skipped.join(', ') + ')');

  const src: any = (L as any).source;
  const remapped = (L as any).timeRemapEnabled === true;
  const stretch = (L as any).stretch;
  // A precomp spanning the edit is rippled inside (its own keys, layers and markers), unless it is shared.
  if (deep && src instanceof CompItem && !remapped && Math.abs(stretch - 100) < EPS && depth < 8) {
    if (usesOf(comp, src) > 1) warn(ctx, 'precomp "' + src.name + '" is used more than once, so its contents were not rippled (duplicate it first to ripple one use)');
    else {
      const from = Math.max(m.a, i);
      const inner: TimeMap = { a: from - L.startTime, b: Math.max(m.b, from) - L.startTime, len: isInsert(m) ? m.len : mapT(m, Math.max(m.b, from)) - mapT(m, from) };
      rippleComp(ctx, src, inner, deep, depth + 1, st);
      st.precomps[st.precomps.length] = src.name;
    }
  }
  // The layer start moves only when its in point is inside a stretched span.
  const ni = isInsert(m) ? i : mapT(m, i);
  for (let k = 0; k < keyed.length; k++) st.keys += remapKeys(ctx, keyed[k], m);
  if (markers) st.markers += remapMarkers(markers, m, ctx, L.name);
  if (Math.abs(ni - i) > EPS) {
    // Moving startTime would move the keys again: they are already at their final comp times, so shift the
    // layer through its in point for non-footage layers, and through startTime (then re-place keys) for footage.
    if (isFootageLike(L) || src instanceof CompItem) {
      const keep: { p: Property; keys: IrKey[] }[] = [];
      for (let k = 0; k < keyed.length; k++) keep[keep.length] = { p: keyed[k], keys: captureKeys(keyed[k]) };
      L.startTime = L.startTime + (ni - i);
      for (let k = 0; k < keep.length; k++) applyKeys(ctx, keep[k].p, keep[k].keys, true);
    }
    L.inPoint = ni;
  }
  let no = mapT(m, o, true);
  if (isFootageLike(L) && !remapped) {
    const lim = sourceLimit(L);
    if (no > lim + EPS) {
      if (lim < comp.duration - EPS) warn(ctx, L.name + ': footage is too short to extend to ' + no.toFixed(2) + 's; it ends at ' + lim.toFixed(2) + 's (enable time remapping to hold the last frame)');
      no = lim;
    }
  }
  if (no - L.inPoint < comp.frameDuration) no = L.inPoint + comp.frameDuration;
  L.outPoint = no;
  for (let k = 0; k < exprs.length; k++) fixExpression(exprs[k], m, true, i, o, st);
  st.spanning++;
}

function shiftLayer(L: Layer, m: TimeMap, st: Stats): void {
  const i = L.inPoint, o = L.outPoint;
  L.startTime = L.startTime + delta(m);
  const exprs: Property[] = [];
  walk(L, (p) => { try { if (p.expression) exprs[exprs.length] = p; } catch (e) {} }, []);
  for (let k = 0; k < exprs.length; k++) fixExpression(exprs[k], m, false, i, o, st);
  st.shifted++;
}

export function rippleComp(ctx: Ctx, comp: CompItem, m: TimeMap, deep: boolean, depth: number, st: Stats): void {
  const D = delta(m);
  const fr = comp.frameDuration;
  if (D > 0) comp.duration = comp.duration + D;
  const layers: Layer[] = [];
  for (let i = 1; i <= comp.numLayers; i++) layers[layers.length] = comp.layer(i);
  const removeOnly = !isInsert(m) && m.len < EPS;
  for (let n = 0; n < layers.length; n++) {
    const L = layers[n];
    const locked = L.locked;
    if (locked) L.locked = false;
    const i = L.inPoint, o = L.outPoint;
    let gone = false;
    if (isInsert(m) ? o <= m.a + EPS : o <= m.a + EPS) { /* entirely before the edit */ }
    else if (isInsert(m) ? i >= m.a - EPS : i >= m.b - EPS) shiftLayer(L, m, st);
    else if (removeOnly && i >= m.a - EPS && o <= m.b + EPS) { st.removed[st.removed.length] = L.name; L.remove(); gone = true; }
    else if (removeOnly && i > m.a) {
      // Starts inside the removed time: cut its head off, then it follows the material after the cut.
      L.inPoint = m.b;
      shiftLayer(L, m, st);
    } else if (removeOnly && isFootageLike(L)) {
      warn(ctx, L.name + ': a single footage layer cannot have time cut out of its middle; its end was shortened instead');
      L.outPoint = Math.max(L.inPoint + fr, o + D);
      st.spanning++;
    } else rippleLayer(ctx, comp, L, m, deep, depth, st);
    if (locked && !gone) L.locked = true;
  }
  const mk = (comp as any).markerProperty as Property;
  if (mk && mk.numKeys) st.markers += remapMarkers(mk, m);
  if (D < 0) comp.duration = Math.max(comp.duration + D, fr);
  // Work area follows the edit.
  const ws = comp.workAreaStart, we = ws + comp.workAreaDuration;
  const nws = Math.min(mapT(m, ws), comp.duration - fr), nwe = Math.min(mapT(m, we, true), comp.duration);
  comp.workAreaDuration = fr;
  comp.workAreaStart = Math.max(0, nws);
  comp.workAreaDuration = Math.max(fr, nwe - comp.workAreaStart);
}

// ---------- scenes and quiet time ----------

/** Times of beat-grid comp markers ("beat", "bar N"; BeatMarkers). */
function beatTimes(comp: CompItem): number[] {
  const mk: any = (comp as any).markerProperty, out: number[] = [];
  for (let k = 1; k <= mk.numKeys; k++) { const c = String(mk.keyValue(k).comment); if (c === 'beat' || /^bar \d+$/.test(c)) out[out.length] = mk.keyTime(k); }
  return out;
}

export function scenesOf(comp: CompItem): { name: string; a: number; b: number }[] {
  const out: { name: string; a: number; b: number }[] = [];
  const mk = (comp as any).markerProperty as Property;
  if (!mk) return out;
  for (let k = 1; k <= mk.numKeys; k++) {
    const v: any = mk.keyValue(k);
    if (v.duration > 0) out[out.length] = { name: v.comment || 'Scene ' + k, a: mk.keyTime(k), b: mk.keyTime(k) + v.duration };
  }
  return out;
}

function findScene(ctx: Ctx, comp: CompItem, ref: any): { name: string; a: number; b: number } {
  const sc = scenesOf(comp);
  const names: string[] = [];
  for (let i = 0; i < sc.length; i++) names[names.length] = '"' + sc[i].name + '" ' + sc[i].a.toFixed(2) + '–' + sc[i].b.toFixed(2) + 's';
  const list = names.length ? names.join(', ') : 'none (scenes are comp markers with a duration; named <Sequence>s add them, or pass span: [start, end])';
  if (typeof ref === 'string') {
    for (let i = 0; i < sc.length; i++) if (sc[i].name.toLowerCase() === ref.toLowerCase()) return sc[i];
    return fail(ctx, 'scene "' + ref + '" not found; scenes: ' + list);
  }
  const t = parseT(ref.at, comp.frameRate);
  let best: { name: string; a: number; b: number } | null = null;
  for (let i = 0; i < sc.length; i++) if (t >= sc[i].a - EPS && t < sc[i].b - EPS && (!best || sc[i].b - sc[i].a < best.b - best.a)) best = sc[i];
  if (!best) return fail(ctx, 'no scene contains ' + t.toFixed(2) + 's; scenes: ' + list);
  return best;
}

function controlValue(comp: CompItem, s: string, t: number): number {
  const r = /layer\("([^"]+)"\)\.effect\("([^"]+)"\)\(1\)/.exec(s);
  if (!r) { const x = parseFloat(s); return isNaN(x) ? 0 : x; }
  let v = 0;
  try { v = ((comp.layer(r[1]).property('ADBE Effect Parade') as PropertyGroup).property(r[2]) as any).property(1).valueAtTime(t, false); } catch (e) { return 0; }
  const c = /^clamp\(.*,\s*(-?[\d.e+]+),\s*(-?[\d.e+]+)\)$/.exec(trim(s));
  if (c) v = Math.min(Math.max(v, +c[1]), +c[2]);
  return v;
}

/** Top-level comma split of the argument list that follows `head` in src (handles nested calls like clamp(...)). */
function argsAfter(src: string, head: string): string[] | null {
  const at = src.indexOf(head);
  if (at < 0) return null;
  const out: string[] = [];
  let depth = 0, cur = '';
  for (let i = at + head.length; i < src.length; i++) {
    const ch = src.charAt(i);
    if (ch === '(') depth++;
    if (ch === ')') { if (depth === 0) { out[out.length] = trim(cur); return out; } depth--; }
    if (ch === ',' && depth === 0) { out[out.length] = trim(cur); cur = ''; continue; }
    cur += ch;
  }
  return null;
}

/** The comma-separated values of a `var a = x, b = y, c = z;` line (top-level commas only). */
function varList(src: string, head: string): string[] | null {
  const at = src.indexOf(head);
  if (at < 0) return null;
  const end = src.indexOf(';', at);
  const body = src.substring(at + 4, end);
  const out: string[] = [];
  let depth = 0, cur = '';
  for (let i = 0; i <= body.length; i++) {
    const ch = i < body.length ? body.charAt(i) : ',';
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { const eq = cur.indexOf('='); out[out.length] = trim(cur.substring(eq + 1)); cur = ''; continue; }
    cur += ch;
  }
  return out;
}

function springSettle(c: number, k: number, mass: number): number {
  const w0 = Math.sqrt(k / mass), z = c / (2 * Math.sqrt(k * mass));
  const t = z < 1 ? Math.log(200) / (z * w0) : 6 / w0;
  return Math.min(Math.max(t, 0.1), 3);
}

/** Time windows in which an ae-compose text reveal or spring expression is moving. */
function exprWindow(comp: CompItem, L: Layer, src: string, t: number): number[] | null {
  if (src.indexOf('function aecW') >= 0) return null;
  const sp = argsAfter(src, 'su(t * fps, fps, ');
  const settle = (cs: string, ks: string, ms: string) => springSettle(controlValue(comp, cs, t), controlValue(comp, ks, t), controlValue(comp, ms, t));
  const unit = varList(src, 'var each = ');
  if (unit) {
    const off = /time - inPoint - (-?[\d.]+) - delay/.exec(src);
    const by = /per-(charNoSpaces|char|word|line)/.exec(src);
    let text = '';
    try { text = ((L as any).property('ADBE Text Properties').property('ADBE Text Document').value as TextDocument).text; } catch (e) {}
    const kind = by ? by[1] : 'char';
    let units = kind === 'char' ? text.length : kind === 'charNoSpaces' ? text.replace(/\s/g, '').length : kind === 'word' ? trim(text).split(/\s+/).length : trim(text).split(/[\r\n]+/).length;
    if (units < 1) units = 1;
    const each = controlValue(comp, unit[0], t), delay = controlValue(comp, unit[2], t);
    const durS = /^Math\.max\((.*), 0\.0001\)$/.exec(unit[1]);
    const dur = sp && sp.length >= 3 ? settle(sp[0], sp[1], sp[2]) : controlValue(comp, durS ? durS[1] : unit[1], t);
    const s0 = src.indexOf('time - outPoint + delay') >= 0 ? L.outPoint - delay : L.inPoint + (off ? +off[1] : 0) + delay;
    return [s0, s0 + (units - 1) * Math.max(each, 0) + dur];
  }
  const spr = /f = \(time - (-?[\d.]+) - \((.+)\)\) \* fps;/.exec(src);
  if (spr) {
    const ck = varList(src, 'var k = ');
    const s0 = +spr[1] + controlValue(comp, spr[2], t);
    return [s0, s0 + (ck && ck.length >= 3 ? settle(ck[1], ck[0], ck[2]) : 1)];
  }
  return null;
}

function same(a: any, b: any): boolean {
  if (typeof a === 'number' || typeof a === 'boolean') return a === b;
  if (a && a.length !== undefined && b && b.length === a.length) { for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1e-6) return false; return true; }
  return false;
}

/** Busy intervals (something animating) inside [a, b] across enabled layers. */
function busy(comp: CompItem, a: number, b: number): number[][] {
  const out: number[][] = [];
  for (let i = 1; i <= comp.numLayers; i++) {
    const L = comp.layer(i);
    if (!L.enabled || L.outPoint <= a || L.inPoint >= b) continue;
    walk(L, (p) => {
      if (p.matchName === 'ADBE Marker' || isOpaqueValueType(p.propertyValueType)) return;
      for (let k = 1; k < p.numKeys; k++) {
        const t0 = p.keyTime(k), t1 = p.keyTime(k + 1);
        if (t1 <= a || t0 >= b || p.keyOutInterpolationType(k) === KeyframeInterpolationType.HOLD) continue;
        const vt = p.propertyValueType;
        if (vt !== PropertyValueType.SHAPE && vt !== PropertyValueType.TEXT_DOCUMENT && same(p.keyValue(k), p.keyValue(k + 1))) continue;
        out[out.length] = [Math.max(t0, L.inPoint), Math.min(t1, L.outPoint)];
      }
      let src = '';
      try { src = p.expression; } catch (e) {}
      if (src && src.indexOf('ae-compose') >= 0) { const w = exprWindow(comp, L, src, a); if (w) out[out.length] = [Math.max(w[0], L.inPoint), Math.min(w[1], L.outPoint)]; }
    }, []);
  }
  return out;
}

/** Longest stretch of [a, b] where nothing animates: [start, end]. */
export function quietGap(comp: CompItem, a: number, b: number): number[] {
  const iv = busy(comp, a, b);
  iv.sort((x, y) => x[0] - y[0]);
  let best = [a, a], cur = a;
  for (let i = 0; i < iv.length; i++) {
    if (iv[i][0] > cur && iv[i][0] - cur > best[1] - best[0]) best = [cur, Math.min(iv[i][0], b)];
    if (iv[i][1] > cur) cur = iv[i][1];
  }
  if (b > cur && b - cur > best[1] - best[0]) best = [cur, b];
  return best;
}

// ---------- the op ----------

/**
 * { op: 'ripple', ...one of }
 *   at + by          insert `by` seconds at `at` (negative removes the time after `at`)
 *   span + scale|duration|by   stretch/compress [start, end] (scale 1.25 = 25% slower) or add/remove time in it
 *   scene + by       add/remove hold time inside a scene, at its quietest moment (where: 'quiet' | 'start' | 'end' | time)
 *   scene + scale|duration     slow down / speed up a whole scene
 * Scenes are named by marker comment, or { at: '1:02' } for the scene containing that time.
 */
export function ripple(ctx: Ctx, comp: CompItem, op: any): any {
  const fps = comp.frameRate, fr = comp.frameDuration;
  const snap = (t: number) => Math.round(t * fps) / fps;
  const has = (x: any) => x !== undefined && x !== null;
  let m: TimeMap | null = null;
  const info: any = {};
  let a = 0, b = 0;
  if (has(op.scene)) { const sc = findScene(ctx, comp, op.scene); a = sc.a; b = sc.b; info.scene = sc.name; }
  else if (has(op.span)) { a = parseT(op.span[0], fps); b = parseT(op.span[1], fps); }
  if (has(op.scene) || has(op.span)) {
    if (b - a < fr) fail(ctx, 'ripple span is shorter than a frame');
    if (has(op.scale) || has(op.duration) || (has(op.by) && !has(op.scene) && !has(op.where))) {
      // A span with `by` (and no `where`) stretches: its length changes by `by`.
      const len = has(op.duration) ? parseT(op.duration, fps) : has(op.scale) ? (b - a) * op.scale : b - a + parseT(op.by, fps);
      if (len < fr) fail(ctx, 'ripple would make the span shorter than a frame');
      m = { a: a, b: b, len: snap(len) };
    } else if (has(op.by)) {
      const by = snap(parseT(op.by, fps));
      let at: number;
      const where = has(op.where) ? op.where : 'quiet';
      if (where === 'quiet') {
        const g = quietGap(comp, a, b);
        info.quiet = [g[0], g[1]];
        if (by < 0 && g[1] - g[0] < -by - EPS) fail(ctx, 'only ' + (g[1] - g[0]).toFixed(2) + 's of still time in [' + a.toFixed(2) + ', ' + b.toFixed(2) + ']; use scale to compress instead');
        if (g[1] - g[0] < fr) { warn(ctx, 'no still moment in [' + a.toFixed(2) + ', ' + b.toFixed(2) + ']: stretched it instead'); m = { a: a, b: b, len: snap(b - a + by) }; at = a; }
        else at = by < 0 ? (g[0] + g[1] + by) / 2 : (g[0] + g[1]) / 2;
      } else at = where === 'start' ? a : where === 'end' ? (by < 0 ? b + by : b) : parseT(where, fps);
      if (!m) m = by >= 0 ? { a: snap(at!), b: snap(at!), len: by } : { a: snap(at!), b: snap(at! - by), len: 0 };
    } else fail(ctx, 'ripple with a span/scene needs scale, duration or by');
  } else if (has(op.at) && has(op.by)) {
    const at = snap(parseT(op.at, fps)), by = snap(parseT(op.by, fps));
    m = by >= 0 ? { a: at, b: at, len: by } : { a: at, b: at - by, len: 0 };
  } else fail(ctx, 'ripple needs { at, by }, { span, scale|duration|by } or { scene, scale|duration|by }');
  // snap: 'beats' (A5): round the change so everything after it (the edited scene's end) lands on a beat marker.
  if (op.snap === 'beats' && m) {
    const beats = beatTimes(comp);
    if (!beats.length) warn(ctx, 'snap: "beats" needs beat markers on the comp (BeatMarkers); the edit was not snapped');
    else {
      const end = has(op.scene) || has(op.span) ? b : m.b;
      const want = end + delta(m);
      let best = beats[0];
      for (let i = 1; i < beats.length; i++) if (Math.abs(beats[i] - want) < Math.abs(best - want)) best = beats[i];
      const adj = snap(best - want);
      if (Math.abs(adj) > EPS) {
        if (isInsert(m)) m = { a: m.a, b: m.b, len: Math.max(fr, m.len + adj) };
        else if (m.len < EPS && m.b - adj > m.a + fr) m = { a: m.a, b: snap(m.b - adj), len: 0 };
        else m = { a: m.a, b: m.b, len: Math.max(fr, m.len + adj) };
        info.snappedToBeat = best;
      }
    }
  }
  const mm = m!;
  if (isInsert(mm) && mm.len < EPS) fail(ctx, 'ripple by 0s does nothing');
  const st: Stats = { shifted: 0, spanning: 0, keys: 0, markers: 0, exprs: 0, rigs: 0, removed: [], precomps: [], untouchedExprs: 0 };
  const before = comp.duration;
  rippleComp(ctx, comp, mm, op.deep !== false, 0, st);
  info.edit = isInsert(mm) ? { insert: mm.len, at: mm.a } : mm.len < EPS ? { remove: [mm.a, mm.b] } : { stretch: [mm.a, mm.b], to: [mm.a, mm.a + mm.len], scale: mm.len / (mm.b - mm.a) };
  info.delta = delta(mm);
  info.duration = [before, comp.duration];
  info.shiftedLayers = st.shifted;
  info.spanningLayers = st.spanning;
  info.keysRemapped = st.keys;
  info.markersRemapped = st.markers;
  info.expressionsWarped = st.exprs;
  info.rigsReanchored = st.rigs;
  if (st.removed.length) info.removedLayers = st.removed;
  if (st.precomps.length) info.precompsRippled = st.precomps;
  if (st.untouchedExprs) warn(ctx, st.untouchedExprs + ' non-ae-compose expression(s) that use `time` were left unchanged; check them');
  return info;
}
