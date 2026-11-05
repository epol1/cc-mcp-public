// Motion summary: a few text lines an agent can read next to the speed graph ("title arrives 0.20–0.85 s
// (ease-out, peak 1900 px/s), holds 2.4 s; 5 elements move at once at 3.1 s …").
import { activityScore, easeCounts, elementMoves } from './analyze.ts';
import { fmtSpan, fmtSpeed, q } from './fmt.ts';
import { finalHold } from './style.ts';
import type { LayerMotion, Move, MotionAnalysis } from './types.ts';

export interface SummaryOptions {
  /** Most layers described one per line (default 8; the most active are kept, constant drifts count less). */
  maxLayers?: number;
}

const moveText = (verb: string, m: Move) => {
  const fade = m.dominant === 'opacity';
  const v = fade ? verb.replace(/^arrives$/, 'fades in').replace(/^exits$/, 'fades out') : verb;
  const peak = fade ? '' : `, peak ${fmtSpeed(m.peak)} px/s`;
  return `${v} ${fmtSpan(m.t0, m.t1)} (${m.ease}${peak}${m.built ? `, built ${m.built}` : ''})`;
};

/** One line for a layer: arrival, hold, moves in between, exit. */
export function layerLine(L: LayerMotion, groupSize = 1): string {
  const parts: string[] = [];
  const inner = L.moves.filter((m) => !(L.arrival && m.t1 <= L.arrival.t1 + 1e-6) && !(L.exit && m.t0 >= L.exit.t0 - 1e-6));
  if (L.arrival) parts.push(moveText('arrives', L.arrival));
  else if (L.appear !== null) parts.push(`appears at ${L.appear.toFixed(2)} s`);
  const longest = L.holds.length ? L.holds.reduce((a, h) => (h.dur > a.dur ? h : a)) : null;
  if (longest) parts.push(`holds ${longest.dur.toFixed(1)} s${longest.drift ? ' (with a drift)' : ''}`);
  for (const m of inner.slice(0, 2)) parts.push(moveText(m.drift ? 'drifts' : 'moves', m));
  if (inner.length > 2) parts.push(`${inner.length - 2} more moves`);
  if (L.exit) parts.push(moveText('exits', L.exit));
  const who = groupSize > 1 ? `${q(L.name)} (+${groupSize - 1} cloner instances)` : q(L.name);
  return `${who} ${parts.join(', ')}`;
}

/** A few lines: the piece, the most active elements, peak activity and the final hold. */
export function motionSummary(a: MotionAnalysis, opts: SummaryOptions = {}): string[] {
  const max = opts.maxLayers ?? 8;
  const groups = new Map<string, LayerMotion[]>();
  for (const L of a.layers) if (L.content) groups.set(L.group, [...(groups.get(L.group) ?? []), L]);
  const firsts = [...groups.values()].map((g) => ({ L: g[0], n: g.length }));
  const animated = firsts.filter(({ L }) => L.moves.length > 0);
  const moves = elementMoves(a).map((x) => x.move);
  const counts = Object.entries(easeCounts(moves)).sort((x, y) => (y[1] ?? 0) - (x[1] ?? 0)).map(([k, v]) => `${v} ${k}`).join(', ');
  const lines = [`${q(a.comp)} ${a.dur.toFixed(1)} s: ${firsts.length} elements, ${animated.length} animated, ${moves.length} moves${counts ? ` (${counts})` : ''}`];
  const shown = [...animated].sort((x, y) => activityScore(y.L) - activityScore(x.L)).slice(0, max)
    .sort((x, y) => (x.L.moves[0]?.t0 ?? 0) - (y.L.moves[0]?.t0 ?? 0));
  for (const { L, n } of shown) lines.push(layerLine(L, n));
  if (animated.length > shown.length) lines.push(`… ${animated.length - shown.length} more animated elements`);
  const { peak, peakAt, visible, moving } = a.activity;
  if (peak > 0) {
    const i = a.times.indexOf(peakAt);
    lines.push(`most at once: ${peak} of ${visible[i]} visible elements move at ${peakAt.toFixed(1)} s`);
    const busy = moving.filter((m, k) => visible[k] > 0 && m > 0).length * a.step;
    lines.push(`something moves for ${busy.toFixed(1)} s of ${a.dur.toFixed(1)} s`);
  }
  const f = finalHold(a);
  if (f) lines.push(`final state: ${q(f.layer)} settles at ${f.settle.toFixed(2)} s and holds ${f.hold.toFixed(1)} s${f.leaving ? ' before everything leaves' : ' to the end'}`);
  return lines;
}
