// Style lint (pure, Node): the craft rules of skills/ae-compose/SKILL.md §2 and §6 as checks on the motion analysis.
// Repeated transitions, crowded entrances, short holds, one easing for everything, linear moves, slide furniture,
// a rushed end state, everything moving at once, and dead air between beats. Issues have the text lint's shape
// (src/lint/index.ts): every one names the layer and the time range, and says what to change.
import { elementMoves, isDrift, runs } from './analyze.ts';
import type { DriftOptions } from './analyze.ts';
import { fmtDur, fmtRange, fmtT, names, q } from './fmt.ts';
import { STYLE_RULES } from './types.ts';
import type { LayerMotion, Move, MotionAnalysis, MotionData, StyleIssue, StyleRule } from './types.ts';

export { STYLE_RULES };

export interface StyleOptions extends DriftOptions {
  /** Rules to skip. */
  ignore?: StyleRule[];
  /** crowded-entrance: more than this many elements starting their arrival inside entranceWindow (default 3, 0.2 s). */
  maxEntrances?: number;
  entranceWindow?: number;
  /** short-hold: shortest hold for a non-text element between landing and leaving, seconds (default 0.8). */
  minHold?: number;
  /** easing-monotony: only judged with at least this many moves (default 4). */
  minMoves?: number;
  /** slide-furniture: an element in the outer furnitureEdge band (default 0.22 of the frame) no larger than furnitureArea of the frame (default 0.12), still across furnitureScenes scenes (default 2) or furnitureShare of the piece (default 0.7). */
  furnitureEdge?: number;
  furnitureArea?: number;
  furnitureScenes?: number;
  furnitureShare?: number;
  /** short-end-hold: shortest final hold, seconds (default 2). */
  minEndHold?: number;
  /** everything-moves: more than crowdShare (default 0.7) of at least crowdMin (default 3) visible elements moving for crowdDur (default 1 s). */
  crowdShare?: number;
  crowdMin?: number;
  crowdDur?: number;
  /** dead-air: a stretch with only the background on screen, seconds (default 0.6). */
  deadAir?: number;
}

type Add = (i: StyleIssue) => void;
const EPS = 1e-6;
/** Layers that are part of a transition (a wipe shape, a light leak) are quick by design. */
const isTransition = (L: LayerMotion) => L.tags.some((t) => t === 'transition' || t.startsWith('transition:'));

/** Transitions from data.transitions, else from layers tagged 'transition:<kind>'. */
function transitionsOf(d: MotionData): NonNullable<MotionData['transitions']> {
  if (d.transitions?.length) return [...d.transitions].sort((x, y) => x.t - y.t);
  const out: NonNullable<MotionData['transitions']> = [];
  for (const L of d.layers) for (const tag of L.tags ?? []) {
    if (!tag.startsWith('transition:')) continue;
    const kind = tag.slice('transition:'.length);
    if (!out.some((t) => t.kind === kind && Math.abs(t.t - L.in) < 0.05)) out.push({ kind, t: L.in, dur: L.out - L.in, layer: L.name });
  }
  return out.sort((x, y) => x.t - y.t);
}

function transitionRepeat(d: MotionData, add: Add): void {
  const tr = transitionsOf(d);
  for (let i = 0; i < tr.length; ) {
    let j = i;
    while (j + 1 < tr.length && tr[j + 1].kind === tr[i].kind) j++;
    if (j > i) {
      const run = tr.slice(i, j + 1);
      const layers = run.map((t) => t.layer).filter((x): x is string => !!x);
      add({ rule: 'transition-repeat', severity: 'warn', layers: layers.length ? layers : undefined, t: [run[0].t, run[run.length - 1].t + run[run.length - 1].dur],
        message: `the "${tr[i].kind}" transition is used ${run.length === 2 ? 'twice' : `${run.length} times`} in a row (${run.map((t) => fmtT(t.t)).join(', ')}): make each transition different, ideally one that grows out of the scene (a hand-off, a wipe with a shape from the shot, a camera move)` });
    }
    i = j + 1;
  }
}

/** First arrival per element group (cloner instances arrive as one). */
function groupArrivals(a: MotionAnalysis): { name: string; t0: number; t1: number }[] {
  const by = new Map<string, { name: string; t0: number; t1: number; n: number }>();
  for (const L of a.layers) {
    if (!L.content || !L.arrival || isTransition(L)) continue;
    const g = by.get(L.group);
    if (!g) by.set(L.group, { name: L.name, t0: L.arrival.t0, t1: L.arrival.t1, n: 1 });
    else { g.n++; if (L.arrival.t0 < g.t0) { g.t0 = L.arrival.t0; g.t1 = L.arrival.t1; } }
  }
  return [...by.entries()].map(([k, g]) => ({ name: k.startsWith('cloner') && g.n > 1 ? `${g.name} (+${g.n - 1} cloner instances)` : g.name, t0: g.t0, t1: g.t1 })).sort((x, y) => x.t0 - y.t0);
}

function crowdedEntrance(a: MotionAnalysis, o: StyleOptions, add: Add): void {
  const max = o.maxEntrances ?? 3, win = o.entranceWindow ?? 0.2;
  const arr = groupArrivals(a);
  for (let i = 0; i < arr.length; ) {
    let j = i;
    while (j + 1 < arr.length && arr[j + 1].t0 - arr[i].t0 <= win + EPS) j++;
    const n = j - i + 1;
    if (n > max) {
      const list = arr.slice(i, j + 1).map((x) => x.name);
      add({ rule: 'crowded-entrance', severity: 'warn', layers: list, t: [arr[i].t0, arr[j].t0],
        message: `${n} elements start arriving within ${win} s ${fmtRange([arr[i].t0, arr[j].t0])} (${names(list)}): lead with the main one and bring the others in 150–300 ms later, or group them so they move as one` });
      i = j + 1;
    } else i++;
  }
}

/** The longest still time between a layer's landing and its leaving (moves in between don't count). */
function settledTime(L: LayerMotion, from: number, to: number, exit: Move | null): number {
  const mid = L.moves.filter((m) => m.t0 >= from - EPS && m.t1 <= to + EPS && !(exit && m.t0 >= exit.t0 - EPS));
  let best = 0, cur = from;
  for (const m of mid) { best = Math.max(best, m.t0 - cur); cur = Math.max(cur, m.t1); }
  return Math.max(best, to - cur);
}

function shortHold(a: MotionAnalysis, o: StyleOptions, add: Add): void {
  const min = o.minHold ?? 0.8;
  const done = new Set<string>();
  for (const L of a.layers) {
    if (!L.content || L.kind === 'text' || !L.arrival || isTransition(L) || done.has(L.group)) continue;
    const cut = !L.exit;
    const leave = L.exit ? L.exit.t0 : L.vanish;
    if (leave === null || (cut && leave >= a.dur - a.step / 2 - EPS)) continue;
    const held = settledTime(L, L.arrival.t1, leave, L.exit);
    if (held >= min - EPS) continue;
    done.add(L.group);
    add({ rule: 'short-hold', severity: 'warn', layer: L.name, t: [L.arrival.t1, leave],
      message: `${q(L.name)} lands at ${fmtT(L.arrival.t1)} and ${cut ? 'is cut' : 'starts leaving'} at ${fmtT(leave)}: it holds only ${held.toFixed(1)} s; hold it at least ${min} s (1–1.5 s for a pop-up or badge) before anything replaces it, or cut the element` });
  }
}

function easingMonotony(a: MotionAnalysis, o: StyleOptions, add: Add): void {
  // Spatial moves only: fades are their own kind of move (and usually linear).
  const ms = elementMoves(a).filter(({ move }) => move.ease !== 'step' && !move.drift && move.dominant !== 'opacity');
  if (ms.length < (o.minMoves ?? 4)) return;
  const kinds = new Set(ms.map(({ move }) => move.ease));
  if (kinds.size !== 1) return;
  const ease = ms[0].move.ease;
  add({ rule: 'easing-monotony', severity: 'info', layers: [...new Set(ms.map(({ layer }) => layer.name))], t: [Math.min(...ms.map(({ move }) => move.t0)), Math.max(...ms.map(({ move }) => move.t1))],
    message: `all ${ms.length} moves use the same easing (${ease}): give each kind of move its own (ease-out for arrivals, ease-in about 30 % faster for exits, ease-in-out between two rests, a spring or overshoot for a playful accent)` });
}

const within = (m: Move, s: Move | null) => !!s && m.t0 >= s.t0 - EPS && m.t1 <= s.t1 + EPS;

function linearMove(a: MotionAnalysis, o: StyleOptions, add: Add): void {
  const done = new Set<string>();
  for (const L of a.layers) {
    if (!(L.content || L.kind === 'camera') || done.has(L.group)) continue;
    for (const m of L.moves) {
      // Linear fades are normal; constant drifts, tickers and loops are linear by design.
      if (m.ease !== 'linear' || m.dominant === 'opacity' || isDrift(m, L, o)) continue;
      if (L.group.startsWith('cloner')) done.add(L.group);
      const fix = within(m, L.arrival) ? 'easeOutExpo or easeOutQuint for an arrival' : within(m, L.exit) ? 'easeInCubic for an exit' : 'easeInOutCubic between two rests';
      add({ rule: 'linear-move', severity: 'warn', layer: L.name, t: [m.t0, m.t1],
        message: `${q(L.name)} moves at constant speed (linear) ${fmtRange([m.t0, m.t1])}${m.built && m.built !== 'linear' ? ` although it was built with ${m.built}` : ''}: ease it (${fix}); keep linear for constant drifts, tickers and loops only` });
    }
  }
}

function sampleNear(a: MotionAnalysis, L: LayerMotion, d: MotionData, t: number): number[] | null {
  const b = d.layers[L.index].b;
  if (!b) return null;
  let best = -1;
  a.times.forEach((ti, i) => { if (b[i] && L.visible[i] && (best < 0 || Math.abs(ti - t) < Math.abs(a.times[best] - t))) best = i; });
  return best >= 0 ? b[best] : null;
}

function slideFurniture(d: MotionData, a: MotionAnalysis, o: StyleOptions, add: Add): void {
  const band = o.furnitureEdge ?? 0.22, maxArea = (o.furnitureArea ?? 0.12) * a.w * a.h;
  const minScenes = o.furnitureScenes ?? 2, share = o.furnitureShare ?? 0.7;
  for (const L of a.layers) {
    if (!L.content || L.tags.includes('persistent') || isTransition(L) || !L.holds.length) continue;
    const h = L.holds.reduce((x, y) => (y.dur > x.dur ? y : x));
    const b = sampleNear(a, L, d, (h.t0 + h.t1) / 2);
    if (!b || (b[2] - b[0]) * (b[3] - b[1]) > maxArea) continue;
    const v = b[1] >= (1 - band) * a.h ? 'bottom' : b[3] <= band * a.h ? 'top' : '';
    const s = b[0] >= (1 - band) * a.w ? 'right' : b[2] <= band * a.w ? 'left' : '';
    if (!v && !s) continue;
    const scenes = a.scenes.filter((sc) => Math.min(h.t1, sc.t + sc.dur) - Math.max(h.t0, sc.t) >= Math.min(1, 0.5 * sc.dur) - EPS);
    if (scenes.length < minScenes && h.dur < share * a.dur - EPS) continue;
    const where = v && s ? `the ${v}-${s} corner` : `the ${v || s} edge`;
    const across = scenes.length >= minScenes ? ` across ${scenes.length} scenes` : ` (${Math.round((100 * h.dur) / a.dur)} % of the piece)`;
    add({ rule: 'slide-furniture', severity: 'warn', layer: L.name, t: [h.t0, h.t1],
      message: `${q(L.name)} sits still near ${where} for ${fmtDur(h.dur)}${across} ${fmtRange([h.t0, h.t1])}: it reads as slide furniture; let it carry its beat and leave with it, or mark it persistent if the brief asks for it` });
  }
}

/** The final state: when the last element on screen at the end settled, and when that state ends. */
export function finalHold(a: MotionAnalysis): { settle: number; end: number; hold: number; layer: string; leaving: boolean } | null {
  const n = a.times.length;
  const els = a.layers.filter((L) => L.content && L.vanish !== null);
  if (!n || !els.length) return null;
  let F = els.filter((L) => L.visible[n - 1]);
  let end = a.dur, leaving = false;
  if (!F.length) {
    const last = Math.max(...els.map((L) => L.vanish!));
    F = els.filter((L) => L.vanish! >= last - 0.5);
    end = Math.min(...F.map((L) => (L.exit ? L.exit.t0 : L.vanish!)));
    leaving = true;
  }
  let settle = -Infinity, layer = '';
  for (const L of F) {
    let s = L.appear ?? 0;
    for (const m of L.moves) if (!m.drift && m.t0 < end - EPS) s = Math.max(s, Math.min(m.t1, end));
    if (s > settle) { settle = s; layer = L.name; }
  }
  return { settle, end, hold: Math.max(0, end - settle), layer, leaving };
}

function shortEndHold(a: MotionAnalysis, o: StyleOptions, add: Add): void {
  const min = o.minEndHold ?? 2;
  const f = finalHold(a);
  if (!f || f.hold >= min - EPS) return;
  add({ rule: 'short-end-hold', severity: 'warn', layer: f.layer, t: [f.settle, f.end],
    message: `the final state holds ${f.hold.toFixed(1)} s (${q(f.layer)} settles at ${fmtT(f.settle)}, ${f.leaving ? 'everything starts leaving' : 'the comp ends'} at ${fmtT(f.end)}): hold the end frame (logo, CTA, final line) at least ${min} s; lengthen the last Sequence or ripple the last scene` });
}

function everythingMoves(a: MotionAnalysis, o: StyleOptions, add: Add): void {
  const share = o.crowdShare ?? 0.7, minVis = o.crowdMin ?? 3, minDur = o.crowdDur ?? 1;
  const { moving, visible, camera } = a.activity;
  // A camera move or a transition moves everything on purpose: one motion, not many competing ones.
  const inTransition = (t: number) => a.transitions.some((x) => t >= x.t - EPS && t < x.t + x.dur - EPS);
  const ok = (i: number) => !camera[i] && !inTransition(a.times[i]) && visible[i] >= minVis && moving[i] > share * visible[i] + EPS;
  for (const [s, e] of runs(a.times.length, ok)) {
    const dur = (e - s + 1) * a.step;
    if (dur < minDur - EPS) continue;
    let pk = s;
    for (let i = s; i <= e; i++) if (moving[i] > moving[pk]) pk = i;
    const who = [...new Map(a.layers.filter((L) => L.content && L.moving[pk]).map((L) => [L.group, L.name] as const)).values()];
    add({ rule: 'everything-moves', severity: 'warn', layers: who, t: [a.times[s], a.times[e] + a.step],
      message: `${moving[pk]} of ${visible[pk]} visible elements move at once for ${fmtDur(dur)} ${fmtRange([a.times[s], a.times[e] + a.step])}: there is no focal point; let one element lead and keep the others still (stagger them 150–300 ms, or hold them)` });
  }
}

function deadAir(a: MotionAnalysis, o: StyleOptions, add: Add): void {
  const min = o.deadAir ?? 0.6;
  const vis = a.activity.visible;
  const first = vis.findIndex((v) => v > 0), last = vis.length - 1 - [...vis].reverse().findIndex((v) => v > 0);
  if (first < 0) return;
  for (const [s, e] of runs(vis.length, (i) => i > first && i < last && vis[i] === 0)) {
    const dur = (e - s + 1) * a.step;
    if (dur < min - EPS) continue;
    const t: [number, number] = [a.times[s], a.times[e + 1] ?? a.times[e] + a.step];
    add({ rule: 'dead-air', severity: 'warn', t,
      message: `nothing but the background is on screen for ${fmtDur(dur)} ${fmtRange(t)}: overlap the beats by 0.2–0.4 s so one hands off to the next, instead of leaving a gap` });
  }
}


/** Run every style rule (minus opts.ignore) on a motion analysis of `d`. */
export function styleLint(d: MotionData, a: MotionAnalysis, opts: StyleOptions = {}): StyleIssue[] {
  const issues: StyleIssue[] = [];
  const skip = new Set(opts.ignore ?? []);
  const add: Add = (i) => { if (!skip.has(i.rule)) issues.push(i); };
  transitionRepeat(d, add);
  crowdedEntrance(a, opts, add);
  shortHold(a, opts, add);
  easingMonotony(a, opts, add);
  linearMove(a, opts, add);
  slideFurniture(d, a, opts, add);
  shortEndHold(a, opts, add);
  everythingMoves(a, opts, add);
  deadAir(a, opts, add);
  return issues;
}

/** One line per issue, warnings first (like formatIssues for the text lint). */
export function formatStyleIssues(issues: StyleIssue[]): string[] {
  const order = (i: StyleIssue) => (i.severity === 'warn' ? 0 : 1);
  return [...issues].sort((x, y) => order(x) - order(y)).map((i) => `${i.severity === 'warn' ? 'warn' : 'note'} [${i.rule}] ${i.message}`);
}
