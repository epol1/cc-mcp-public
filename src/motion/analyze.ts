// Motion analysis (pure, Node): turns the per-layer transform samples taken in AE (MotionData) into what a motion
// designer judges: per-sample speed (px/s, with scale and rotation counted as the speed of the layer's corners)
// and opacity rate, the moves (with an easing class), holds, the arrival and the exit of each layer, and how many
// elements move at once. The speed graph, the summary and the style lint all read this.
import { classifyProgress } from './classify.ts';
import type { EasingClass, Hold, LayerMotion, Move, MoveChannel, MotionAnalysis, MotionData, MotionLayer, MotionOptions } from './types.ts';

const DEFAULTS: Required<MotionOptions> = {
  minSpeed: 8, minScaleRate: 2, minRotationRate: 2, minOpacityRate: 3, minPeakSpeed: 30, quietFraction: 0.03, minHold: 0.2, visibleOpacity: 5,
};
/** A run of change that fades less than this (opacity points) and is slower than minPeakSpeed is a drift. */
const MIN_FADE = 10;
const NON_ELEMENT_KINDS = new Set(['null', 'camera', 'light', 'adjustment']);
const RAD = Math.PI / 180;

const tagsOf = (L: MotionLayer) => L.tags ?? [];
const hasTag = (L: MotionLayer, tag: string) => tagsOf(L).some((t) => t === tag || t.startsWith(tag + ':'));

/** Background: tagged 'bg', or a solid that fills the frame (or has no bounds: solids default to comp size). */
export function isBackground(L: MotionLayer, d: Pick<MotionData, 'w' | 'h'>): boolean {
  if (hasTag(L, 'bg')) return true;
  if (L.kind !== 'solid') return false;
  const b = L.b?.find((x) => !!x);
  return !b || (Math.min(b[2], d.w) - Math.max(b[0], 0)) * (Math.min(b[3], d.h) - Math.max(b[1], 0)) >= 0.9 * d.w * d.h;
}

/** An element a viewer looks at (not background, controls, nulls, cameras, lights or adjustment layers). */
export function isElement(L: MotionLayer, d: Pick<MotionData, 'w' | 'h'>): boolean {
  return !NON_ELEMENT_KINDS.has(L.kind) && !hasTag(L, 'controls') && !isBackground(L, d);
}

/** Cloner instances count as one element (they share the cloner tag), and so do the parts of one component that
 * share a `group:<id>` tag (a chart's bars, labels and ticks arrive as one gesture). */
export function groupKey(L: MotionLayer, index: number): string {
  const t = tagsOf(L);
  return t.find((x) => x.startsWith('group:')) ?? t.find((x) => x === 'cloner' || x.startsWith('cloner:')) ?? `#${index}`;
}

/** Half-diagonal of the layer at 100 % scale, from its bounds; full-frame layers and unknown sizes get a frame-based guess. */
function layerRadius(L: MotionLayer, d: MotionData): number {
  const est: number[] = [];
  L.s.forEach((v, i) => {
    const b = L.b?.[i];
    if (!v || !b) return;
    const sc = Math.max(Math.abs(v[2]), Math.abs(v[3])) / 100;
    if (sc > 0.05) est.push(Math.hypot(b[2] - b[0], b[3] - b[1]) / 2 / sc);
  });
  if (est.length) return est.sort((a, b) => a - b)[Math.floor(est.length / 2)];
  const half = Math.hypot(d.w, d.h) / 2;
  return ['solid', 'footage', 'precomp', 'adjustment'].includes(L.kind) ? half : half / 4;
}

function visibility(L: MotionLayer, d: MotionData, o: Required<MotionOptions>): boolean[] {
  return d.times.map((_, i) => {
    const v = L.s[i];
    if (!v || v[5] <= o.visibleOpacity || Math.abs(v[2]) < 0.5 || Math.abs(v[3]) < 0.5) return false;
    const b = L.b?.[i];
    if (!b) return true;
    return b[2] - b[0] >= 1 && b[3] - b[1] >= 1 && b[2] > 0 && b[0] < d.w && b[3] > 0 && b[1] < d.h;
  });
}

/** Change between two samples. */
interface Interval { ok: boolean; dt: number; trans: number; scaleRate: number; rotRate: number; opRate: number; speed: number; active: boolean }

function intervals(L: MotionLayer, d: MotionData, R: number, o: Required<MotionOptions>): Interval[] {
  const out: Interval[] = [];
  for (let k = 0; k + 1 < d.times.length; k++) {
    const a = L.s[k], b = L.s[k + 1], dt = d.times[k + 1] - d.times[k];
    if (!a || !b || !(dt > 0)) { out.push({ ok: false, dt, trans: 0, scaleRate: 0, rotRate: 0, opRate: 0, speed: 0, active: false }); continue; }
    const trans = Math.hypot(b[0] - a[0], b[1] - a[1]) / dt;
    const scaleRate = Math.max(Math.abs(b[2] - a[2]), Math.abs(b[3] - a[3])) / dt;
    const rotRate = Math.abs(b[4] - a[4]) / dt;
    const opRate = Math.abs(b[5] - a[5]) / dt;
    const sc = (Math.max(Math.abs(a[2]), Math.abs(a[3])) + Math.max(Math.abs(b[2]), Math.abs(b[3]))) / 200;
    const speed = trans + (scaleRate / 100) * R + rotRate * RAD * R * sc;
    const active = trans >= o.minSpeed || scaleRate >= o.minScaleRate || rotRate >= o.minRotationRate || opRate >= o.minOpacityRate;
    out.push({ ok: true, dt, trans, scaleRate, rotRate, opRate, speed, active });
  }
  return out;
}

/** Maximal runs of indices where pred holds, as [first, last]. */
export function runs(n: number, pred: (i: number) => boolean): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= n; i++) {
    if (i < n && pred(i)) { if (start < 0) start = i; continue; }
    if (start >= 0) out.push([start, i - 1]);
    start = -1;
  }
  return out;
}

const amountOf = (iv: Interval[], r: [number, number]) => { let s = 0; for (let k = r[0]; k <= r[1]; k++) s += (iv[k].speed + iv[k].opRate) * iv[k].dt; return s; };

/** Glue the small oscillations of a settling spring (a short pause, then a smaller move) to the move before. */
function mergeTails(rs: [number, number][], iv: Interval[], step: number): [number, number][] {
  const gap = Math.max(1, Math.round(0.1 / step));
  const out: [number, number][] = [];
  let lastPiece = 0;
  for (const r of rs) {
    const prev = out[out.length - 1];
    const amt = amountOf(iv, r);
    const between = prev ? iv.slice(prev[1] + 1, r[0]) : [];
    if (prev && r[0] - prev[1] - 1 <= gap && between.every((x) => x.ok) && amt < 0.5 * lastPiece) prev[1] = r[1];
    else out.push([r[0], r[1]]);
    lastPiece = amt;
  }
  return out;
}

/** How straight the change over intervals a..b is: net change ÷ path length (1 = one direction, ≈ 0 = back and forth). */
function straightness(L: MotionLayer, iv: Interval[], R: number, a: number, b: number): number {
  const p = L.s[a]!, e = L.s[b + 1]!;
  let path = 0;
  for (let k = a; k <= b; k++) path += (iv[k].speed + iv[k].opRate) * iv[k].dt;
  const net = Math.hypot(e[0] - p[0], e[1] - p[1]) + (Math.max(Math.abs(e[2] - p[2]), Math.abs(e[3] - p[3])) / 100) * R + Math.abs(e[4] - p[4]) * RAD * R + Math.abs(e[5] - p[5]);
  return path > 0 ? net / path : 1;
}

/**
 * Split a run at flat, slow stretches (below quietFraction of the run's peak for at least minHold, going one way):
 * those are a drift during a hold, not part of the move. The decaying tail of an ease-out (or the start of an
 * ease-in) and the small oscillations of a settling spring stay with their move; only the flat part is cut out.
 */
function splitQuiet(L: MotionLayer, r: [number, number], iv: Interval[], R: number, o: Required<MotionOptions>): { moves: [number, number][]; quiet: [number, number][] } {
  let ps = 0, po = 0;
  for (let k = r[0]; k <= r[1]; k++) { ps = Math.max(ps, iv[k].speed); po = Math.max(po, iv[k].opRate); }
  const useS = ps >= o.minPeakSpeed, useO = po >= MIN_FADE;
  if (!useS && !useO) return { moves: [r], quiet: [] };
  const act = (k: number) => Math.max(useS ? iv[k].speed / ps : 0, useO ? iv[k].opRate / po : 0);
  const quiet: [number, number][] = [];
  for (const [qa, qb] of runs(r[1] - r[0] + 1, (j) => act(r[0] + j) < o.quietFraction).map(([a, b]) => [a + r[0], b + r[0]] as [number, number])) {
    let a = qa, b = qb;
    if (a > r[0]) while (a <= b && act(a) < 0.99 * act(a - 1)) a++;
    if (b < r[1]) while (b >= a && act(b) < 0.99 * act(b + 1)) b--;
    let dur = 0;
    for (let k = a; k <= b; k++) dur += iv[k].dt;
    if (b < a || dur < o.minHold - 1e-9 || straightness(L, iv, R, a, b) < 0.6) continue;
    // At the end of the run, a drift keeps going; a stretch that dies out is the move settling (a spring's last wobbles).
    if (b === r[1]) {
      const acts: number[] = [];
      for (let k = a; k <= b; k++) acts.push(act(k));
      if (act(b) < 0.5 * acts.sort((x, y) => x - y)[Math.floor(acts.length / 2)]) continue;
    }
    quiet.push([a, b]);
  }
  const moves: [number, number][] = [];
  let cur = r[0];
  for (const [a, b] of quiet) { if (a > cur) moves.push([cur, a - 1]); cur = b + 1; }
  if (cur <= r[1]) moves.push([cur, r[1]]);
  return { moves, quiet };
}

function channelOf(prop: string): MoveChannel | null {
  const p = prop.toLowerCase();
  if (p.includes('opac')) return 'opacity';
  if (p.includes('scale')) return 'scale';
  if (p.includes('rot') || p.includes('orient')) return 'rotation';
  if (p.includes('pos') || p === 'x' || p === 'y' || p.includes('anchor')) return 'position';
  return null;
}

/** The easing the build used for this move: the overlapping segment on the dominant channel (else any channel). */
function builtEase(L: MotionLayer, t0: number, t1: number, dominant: MoveChannel): string | undefined {
  let best: { ease: string; score: number } | undefined;
  for (const s of L.segments ?? []) {
    if (s.ease === 'hold') continue;
    const ov = Math.min(t1, s.t1) - Math.max(t0, s.t0);
    if (ov <= 0) continue;
    const score = ov + (channelOf(s.prop) === dominant ? 1e3 : 0);
    if (!best || score > best.score) best = { ease: s.ease, score };
  }
  return best?.ease;
}

function buildMove(L: MotionLayer, d: MotionData, k0: number, k1: number, iv: Interval[], R: number, o: Required<MotionOptions>): Move {
  const t0 = d.times[k0], t1 = d.times[k1 + 1];
  const dist = { position: 0, scale: 0, rotation: 0, opacity: 0 };
  const seen = new Set<MoveChannel>();
  for (let k = k0; k <= k1; k++) {
    const x = iv[k], sc = Math.max(Math.abs(L.s[k]![2]), Math.abs(L.s[k]![3])) / 100;
    dist.position += x.trans * x.dt; dist.scale += (x.scaleRate / 100) * R * x.dt; dist.rotation += x.rotRate * RAD * R * sc * x.dt; dist.opacity += x.opRate * x.dt;
    if (x.trans >= o.minSpeed) seen.add('position');
    if (x.scaleRate >= o.minScaleRate) seen.add('scale');
    if (x.rotRate >= o.minRotationRate) seen.add('rotation');
    if (x.opRate >= o.minOpacityRate) seen.add('opacity');
  }
  const spatial = dist.position + dist.scale + dist.rotation;
  const dominant: MoveChannel = spatial >= 4 ? (['position', 'scale', 'rotation'] as const).reduce((a, c) => (dist[c] > dist[a] ? c : a), 'position' as MoveChannel) : 'opacity';
  const rate = (k: number) => (dominant === 'opacity' ? iv[k].opRate : iv[k].speed);
  let kp = k0;
  for (let k = k0; k <= k1; k++) if (rate(k) > rate(kp)) kp = k;
  const peakAt = (d.times[kp] + d.times[kp + 1]) / 2;
  const ts = d.times.slice(k0, k1 + 2);
  const smp = L.s.slice(k0, k1 + 2) as number[][];
  let ps: number[];
  if (dominant === 'position') {
    let far = smp[0], fd = 0;
    for (const v of smp) { const dd = Math.hypot(v[0] - smp[0][0], v[1] - smp[0][1]); if (dd > fd) { fd = dd; far = v; } }
    const ux = fd > 0 ? (far[0] - smp[0][0]) / fd : 1, uy = fd > 0 ? (far[1] - smp[0][1]) / fd : 0;
    ps = smp.map((v) => (v[0] - smp[0][0]) * ux + (v[1] - smp[0][1]) * uy);
  } else if (dominant === 'scale') {
    const rx = Math.max(...smp.map((v) => v[2])) - Math.min(...smp.map((v) => v[2]));
    const ry = Math.max(...smp.map((v) => v[3])) - Math.min(...smp.map((v) => v[3]));
    ps = smp.map((v) => (rx >= ry ? v[2] : v[3]));
  } else ps = smp.map((v) => (dominant === 'rotation' ? v[4] : v[5]));
  const built = builtEase(L, t0, t1, dominant);
  const j = classifyProgress(ts, ps, built);
  const move: Move = {
    t0, t1, peak: rate(kp), peakAt, peakRatio: t1 > t0 ? (peakAt - t0) / (t1 - t0) : 0, ease: j.ease,
    channels: (['position', 'scale', 'rotation', 'opacity'] as const).filter((c) => seen.has(c)), dominant,
    distance: dominant === 'opacity' ? dist.opacity : spatial, drift: false,
  };
  if (j.overshoot !== undefined && (j.ease === 'overshoot' || j.ease === 'spring-like' || j.ease === 'anticipate')) move.overshoot = j.overshoot;
  if (built) move.built = built;
  return move;
}

export interface DriftOptions { driftMinDur?: number; driftSpan?: number; driftLong?: number }

/**
 * A constant drift (camera drift, ticker, loop): at least driftMinDur (1 s) long and spanning driftSpan (60 %)
 * of the time the layer is visible, or longer than driftLong (2.5 s); linear or a gentle ease-in-out whose peak
 * speed stays under 1.7× its average.
 */
export function isDrift(m: Move, L: Pick<LayerMotion, 'appear' | 'vanish'>, o: DriftOptions = {}): boolean {
  const dur = m.t1 - m.t0;
  if (dur < (o.driftMinDur ?? 1) || (m.ease !== 'linear' && m.ease !== 'ease-in-out')) return false;
  const span = L.appear !== null && L.vanish !== null ? L.vanish - L.appear : dur;
  if (!(dur >= (o.driftSpan ?? 0.6) * span || dur >= (o.driftLong ?? 2.5))) return false;
  return m.peak <= 1.7 * (m.distance / dur);
}

/** Several moves as one (an entrance in two stages). */
function chain(ms: Move[]): Move {
  if (ms.length === 1) return ms[0];
  const main = ms.reduce((a, m) => (m.distance > a.distance ? m : a));
  const top = ms.reduce((a, m) => (m.peak > a.peak ? m : a));
  const t0 = ms[0].t0, t1 = ms[ms.length - 1].t1;
  return { ...main, t0, t1, peak: top.peak, peakAt: top.peakAt, peakRatio: (top.peakAt - t0) / (t1 - t0), channels: [...new Set(ms.flatMap((m) => m.channels))], distance: ms.reduce((s, m) => s + m.distance, 0), drift: false };
}

/** A per-interval value at each sample: the mean of the intervals on either side. */
function perSample(iv: Interval[], n: number, f: (x: Interval) => number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const near = [iv[i - 1], iv[i]].filter((x): x is Interval => !!x && x.ok);
    out.push(near.length ? near.reduce((s, x) => s + f(x), 0) / near.length : 0);
  }
  return out;
}

function analyzeLayer(L: MotionLayer, index: number, d: MotionData, o: Required<MotionOptions>): LayerMotion {
  const n = d.times.length;
  const R = layerRadius(L, d);
  const visible = visibility(L, d, o);
  const iv = intervals(L, d, R, o);
  const moveIv: boolean[] = iv.map(() => false), driftIv: boolean[] = iv.map(() => false);
  const ranges: [number, number][] = [];
  for (const r of mergeTails(runs(iv.length, (k) => iv[k].active), iv, d.step)) {
    const { moves, quiet } = splitQuiet(L, r, iv, R, o);
    for (const [a, b] of quiet) for (let k = a; k <= b; k++) driftIv[k] = true;
    for (const [a, b] of moves) {
      let peak = 0, opMin = Infinity, opMax = -Infinity, seen = false;
      for (let k = a; k <= b; k++) peak = Math.max(peak, iv[k].speed);
      for (let i = a; i <= b + 1; i++) { const v = L.s[i]; if (v) { opMin = Math.min(opMin, v[5]); opMax = Math.max(opMax, v[5]); } if (visible[i]) seen = true; }
      const subtle = peak < o.minPeakSpeed && opMax - opMin < MIN_FADE;
      if (subtle || !seen) { for (let k = a; k <= b; k++) driftIv[k] = true; continue; }
      ranges.push([a, b]);
      for (let k = a; k <= b; k++) moveIv[k] = true;
    }
  }
  const moves = ranges.map(([a, b]) => buildMove(L, d, a, b, iv, R, o));

  const stillIv = iv.map((_, k) => visible[k] && visible[k + 1] && !moveIv[k]);
  const lastVis = visible.lastIndexOf(true), firstVis = visible.indexOf(true);
  const end = Math.min(L.out, d.dur);
  const appear = firstVis >= 0 ? d.times[firstVis] : null;
  const vanish = lastVis >= 0 ? (lastVis === n - 1 ? Math.max(d.times[lastVis], end) : Math.min(d.times[lastVis] + d.step, end)) : null;
  const holds: Hold[] = runs(stillIv.length, (k) => stillIv[k]).map(([a, b]) => {
    const t0 = d.times[a];
    const t1 = b + 1 === n - 1 && visible[n - 1] ? Math.max(d.times[n - 1], end) : d.times[b + 1];
    const h: Hold = { t0, t1, dur: t1 - t0 };
    for (let k = a; k <= b; k++) if (driftIv[k]) { h.drift = true; break; }
    return h;
  }).filter((h) => h.dur >= o.minHold - 1e-9);

  const lm: LayerMotion = {
    name: L.name, id: L.id, kind: L.kind, tags: tagsOf(L), index, content: isElement(L, d), group: groupKey(L, index),
    speed: perSample(iv, n, (x) => x.speed), opacityRate: perSample(iv, n, (x) => x.opRate),
    visible, moving: d.times.map((_, i) => i < moveIv.length && moveIv[i]),
    still: d.times.map((_, i) => visible[i] && !(i < moveIv.length && moveIv[i])),
    moves, holds, arrival: null, exit: null, appear, vanish,
    peak: Math.max(0, ...moves.map((m) => (m.dominant === 'opacity' ? 0 : m.peak))), activeTime: moves.reduce((s, m) => s + m.t1 - m.t0, 0), radius: R,
  };
  for (const m of moves) m.drift = isDrift(m, lm);

  // Arrival: the moves from the first appearance up to the first stillness (a still moment shorter than minHold
  // before it, like a key that starts a frame after the in point, doesn't count). Exit: the moves after the last
  // stillness, after which the layer doesn't hold again.
  const stillRuns = runs(stillIv.length, (k) => stillIv[k]).map(([a, b]) => ({ a, b, dur: d.times[b + 1] - d.times[a] }));
  const holdBefore = (k: number) => stillRuns.some((r) => r.b < k && r.dur >= o.minHold - 1e-9);
  const holdAfter = (k: number) => stillRuns.some((r) => r.a > k && r.dur >= o.minHold - 1e-9);
  const stillBefore = (k: number) => stillRuns.some((r) => r.b < k);
  const stillAfter = (k: number) => stillRuns.some((r) => r.a > k);
  const joined = (i: number) => !stillRuns.some((r) => r.a > ranges[i][1] && r.b < ranges[i + 1][0]);
  let arrivalEnd = -1;
  if (ranges.length && !holdBefore(ranges[0][0])) {
    let last = 0;
    while (last + 1 < ranges.length && joined(last)) last++;
    if (stillAfter(ranges[last][1])) { lm.arrival = chain(moves.slice(0, last + 1)); arrivalEnd = last; }
  }
  const lastI = ranges.length - 1;
  if (lastI > arrivalEnd && !holdAfter(ranges[lastI][1])) {
    let firstI = lastI;
    while (firstI - 1 > arrivalEnd && joined(firstI - 1)) firstI--;
    if (stillBefore(ranges[firstI][0])) lm.exit = chain(moves.slice(firstI, lastI + 1));
  }
  return lm;
}

/** Analyze every layer and the comp-level activity (elements moving / visible per sample). */
export function analyzeMotion(d: MotionData, opts: MotionOptions = {}): MotionAnalysis {
  const o = { ...DEFAULTS, ...opts } as Required<MotionOptions>;
  const layers = d.layers.map((L, i) => analyzeLayer(L, i, d, o));
  const n = d.times.length;
  // Constant drifts (tickers, loops, slow pushes) are ambient motion: they don't compete for attention.
  const busy = layers.map((L) => d.times.map((t) => L.moves.some((m) => !m.drift && t >= m.t0 - 1e-9 && t < m.t1 - 1e-9)));
  const moving: number[] = [], visible: number[] = [], camera: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const mv = new Set<string>(), vis = new Set<string>();
    let cam = false;
    layers.forEach((L, j) => {
      if (L.kind === 'camera' && L.moving[i]) cam = true;
      if (!L.content) return;
      if (L.visible[i]) vis.add(L.group);
      if (busy[j][i] && L.visible[i]) mv.add(L.group);
    });
    moving.push(mv.size); visible.push(vis.size); camera.push(cam);
  }
  let pk = 0;
  for (let i = 1; i < n; i++) if (moving[i] > moving[pk]) pk = i;
  return {
    comp: d.comp, w: d.w, h: d.h, fps: d.fps, dur: d.dur, step: d.step, times: d.times, layers,
    activity: { moving, visible, camera, peak: n ? moving[pk] : 0, peakAt: n ? d.times[pk] : 0 },
    scenes: d.scenes ?? [], transitions: d.transitions ?? [],
  };
}

/** Moves of the piece's elements, cloner instances counted once (the first instance of each cloner). */
export function elementMoves(a: MotionAnalysis): { layer: LayerMotion; move: Move }[] {
  const seen = new Set<string>();
  const out: { layer: LayerMotion; move: Move }[] = [];
  for (const L of a.layers) {
    if (!L.content || (L.group.startsWith('cloner') && seen.has(L.group))) continue;
    seen.add(L.group);
    for (const m of L.moves) out.push({ layer: L, move: m });
  }
  return out;
}

/** How much a layer does, for ranking: time in moves, with constant drifts counting a tenth. */
export const activityScore = (L: LayerMotion): number => L.moves.reduce((s, m) => s + (m.t1 - m.t0) * (m.drift ? 0.1 : 1), 0);

export const easeCounts = (moves: Move[]): Partial<Record<EasingClass, number>> => {
  const c: Partial<Record<EasingClass, number>> = {};
  for (const m of moves) c[m.ease] = (c[m.ease] ?? 0) + 1;
  return c;
};
