// Speed graph: one PNG that shows how a comp moves, for an agent that sees still images. Time runs left to right
// with the scenes as labeled bands; each animated layer gets a row with its speed curve (filled), holds shaded,
// time off screen hatched, opacity as a thin line, and each move labeled with its easing class. The bottom row
// counts the elements moving at each moment. Drawn as SVG and rendered with sharp.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { activityScore } from './analyze.ts';
import { fmtSpeed } from './fmt.ts';
import type { EasingClass, LayerMotion, MotionAnalysis, MotionData } from './types.ts';

export interface SpeedGraphOptions {
  /** Image width in px (default 1600). */
  width?: number;
  /** Height of one layer row in px (default 54). */
  rowHeight?: number;
  /** Most layer rows drawn (default 14; the most active layers are kept, constant drifts count less). */
  maxRows?: number;
  /** Time range to draw, seconds (default the whole comp). */
  from?: number; to?: number;
  /** Row order: by first move (default, reads as a waterfall) or most active first. */
  order?: 'time' | 'activity';
  title?: string;
}

export interface SpeedGraphResult { file: string; width: number; height: number; rows: string[]; omitted: string[] }

export const EASE_COLORS: Record<EasingClass, string> = {
  'ease-out': '#79c0ff', 'ease-in': '#d2a8ff', 'ease-in-out': '#56d364', linear: '#ff7b72',
  overshoot: '#ffa657', anticipate: '#e3b341', 'spring-like': '#f778ba', step: '#8b949e',
};
const C = { bg: '#0d1117', panel: '#161b22', grid: '#30363d', text: '#e6edf3', dim: '#8b949e', speed: '#388bfd', hold: '#3fb950', opacity: '#d29922', busy: '#f85149', band: ['#1b2230', '#141a24'] };
const FONT = 'Segoe UI, Arial, sans-serif', MONO = 'Consolas, Menlo, monospace';
const LABEL_W = 230, PAD_R = 18, HEAD = 92, ACT_H = 74, FOOT = 46;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const r1 = (v: number) => Math.round(v * 10) / 10;

interface Row { L: LayerMotion; n: number }

/** Animated layers (cloner instances collapsed into one row), the kept ones and the omitted names. */
function pickRows(a: MotionAnalysis, o: SpeedGraphOptions): { rows: Row[]; omitted: string[] } {
  const groups = new Map<string, Row>();
  for (const L of a.layers) {
    if (!L.moves.length || L.tags.includes('controls')) continue;
    const g = groups.get(L.group);
    if (g) { g.n++; if (activityScore(L) > activityScore(g.L)) g.L = L; } else groups.set(L.group, { L, n: 1 });
  }
  const ranked = [...groups.values()].sort((x, y) => activityScore(y.L) - activityScore(x.L) || y.L.peak - x.L.peak);
  const keep = ranked.slice(0, o.maxRows ?? 14);
  if ((o.order ?? 'time') === 'time') keep.sort((x, y) => x.L.moves[0].t0 - y.L.moves[0].t0 || x.L.index - y.L.index);
  return { rows: keep, omitted: ranked.slice(keep.length).map((r) => r.L.name) };
}

function tickStep(span: number): number {
  for (const s of [0.25, 0.5, 1, 2, 5, 10, 30]) if (span / s <= 24) return s;
  return 60;
}

/** The graph as an SVG string (speedGraph renders it to PNG). */
export function speedGraphSvg(d: MotionData, a: MotionAnalysis, o: SpeedGraphOptions = {}): { svg: string; width: number; height: number; rows: string[]; omitted: string[] } {
  const W = o.width ?? 1600, RH = o.rowHeight ?? 54;
  const t0 = Math.max(0, o.from ?? 0), t1 = Math.min(a.dur, o.to ?? a.dur);
  const span = Math.max(1e-6, t1 - t0);
  const X0 = LABEL_W, X1 = W - PAD_R;
  const X = (t: number) => r1(X0 + ((Math.min(t1, Math.max(t0, t)) - t0) / span) * (X1 - X0));
  const { rows, omitted } = pickRows(a, o);
  const rowsTop = HEAD, actTop = rowsTop + rows.length * RH + 10;
  const H = actTop + ACT_H + FOOT;
  const idx = a.times.map((t, i) => [t, i] as const).filter(([t]) => t >= t0 - 1e-9 && t <= t1 + 1e-9).map(([, i]) => i);
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  out.push(`<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="${C.bg}"/><line x1="0" y1="0" x2="0" y2="6" stroke="${C.grid}" stroke-width="2"/></pattern></defs>`);
  out.push(`<rect width="100%" height="100%" fill="${C.bg}"/>`);

  // Title.
  const title = o.title ?? `${a.comp} · ${a.dur.toFixed(1)} s · ${a.fps} fps · speed per layer (px/s, scale and rotation counted at the corners)`;
  out.push(`<text x="14" y="24" font-family="${FONT}" font-size="17" fill="${C.text}">${esc(title)}</text>`);

  // Scene bands across rows and the activity row, with names in the band header.
  const bandTop = 34, bandH = 22, plotBottom = actTop + ACT_H;
  a.scenes.forEach((s, i) => {
    if (s.t + s.dur < t0 || s.t > t1) return;
    const xa = X(s.t), xb = X(s.t + s.dur);
    out.push(`<rect x="${xa}" y="${bandTop}" width="${r1(xb - xa)}" height="${plotBottom - bandTop}" fill="${C.band[i % 2]}"/>`);
    out.push(`<line x1="${xa}" y1="${bandTop}" x2="${xa}" y2="${plotBottom}" stroke="#3b4a63" stroke-width="1"/>`);
    out.push(`<text x="${r1(xa + 5)}" y="${bandTop + 15}" font-family="${FONT}" font-size="12" fill="${C.text}">${esc(cut(s.name, Math.max(3, Math.floor((xb - xa - 8) / 6.5))))}</text>`);
  });
  for (const tr of a.transitions) {
    if (tr.t < t0 || tr.t > t1) continue;
    const x = X(tr.t), xe = X(tr.t + tr.dur);
    out.push(`<rect x="${x}" y="${bandTop + bandH}" width="${Math.max(2, r1(xe - x))}" height="3" fill="${C.opacity}"/>`);
    out.push(`<text x="${r1(x + 2)}" y="${bandTop + bandH + 14}" font-family="${FONT}" font-size="10" fill="${C.opacity}">${esc(cut(tr.kind, 18))}</text>`);
  }

  // Time axis and grid.
  const ts = tickStep(span);
  for (let t = Math.ceil(t0 / ts) * ts; t <= t1 + 1e-9; t += ts) {
    const x = X(t);
    out.push(`<line x1="${x}" y1="${HEAD - 4}" x2="${x}" y2="${plotBottom}" stroke="${C.grid}" stroke-width="0.6" stroke-dasharray="2,4"/>`);
    out.push(`<text x="${x}" y="${HEAD - 7}" text-anchor="middle" font-family="${MONO}" font-size="11" fill="${C.dim}">${Number.isInteger(t) ? t + 's' : t.toFixed(2).replace(/0$/, '') + 's'}</text>`);
  }

  // Layer rows.
  const loudest = Math.max(1e-6, ...rows.map(({ L }) => Math.max(0, ...idx.map((i) => L.speed[i]))));
  rows.forEach(({ L, n }, r) => {
    const top = rowsTop + r * RH, base = top + RH - 6, hgt = RH - 18;
    const src = d.layers[L.index];
    const fade = L.peak <= 0;
    const vals = idx.map((i) => (fade ? L.opacityRate[i] : L.speed[i]));
    // Each row is scaled to its own peak so the shape of every move reads, but never below a fifth of the loudest
    // layer: slow drifts and small moves stay visibly smaller than the hero move.
    const peak = Math.max(1e-6, ...vals);
    const scale = fade ? peak : Math.max(peak, 0.2 * loudest);
    out.push(`<line x1="0" y1="${top + RH}" x2="${W}" y2="${top + RH}" stroke="${C.grid}" stroke-width="0.6"/>`);
    // Off screen (inactive, transparent or outside the frame).
    let s = -1;
    for (let j = 0; j <= idx.length; j++) {
      const off = j < idx.length && !L.visible[idx[j]];
      if (off && s < 0) s = j;
      if (!off && s >= 0) {
        const xa = X(a.times[idx[s]]), xb = j < idx.length ? X(a.times[idx[j]]) : X1;
        out.push(`<rect x="${xa}" y="${top + 2}" width="${r1(xb - xa)}" height="${RH - 4}" fill="url(#hatch)" opacity="0.7"/>`);
        s = -1;
      }
    }
    for (const h of L.holds) {
      if (h.t1 < t0 || h.t0 > t1) continue;
      const xa = X(h.t0), xb = X(h.t1);
      out.push(`<rect x="${xa}" y="${top + 2}" width="${r1(xb - xa)}" height="${RH - 4}" fill="${C.hold}" opacity="0.13"/>`);
      if (xb - xa > 70) out.push(`<text x="${r1((xa + xb) / 2)}" y="${base - 2}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="${C.hold}">hold ${h.dur.toFixed(1)}s${h.drift ? ' ~' : ''}</text>`);
    }
    // Speed curve.
    const pts = idx.map((i, j) => `${X(a.times[i])},${r1(base - (vals[j] / scale) * hgt)}`);
    if (pts.length) out.push(`<path d="M${X(a.times[idx[0]])},${base} L${pts.join(' L')} L${X(a.times[idx[idx.length - 1]])},${base} Z" fill="${C.speed}" fill-opacity="0.45" stroke="${C.speed}" stroke-width="1.2"/>`);
    // Opacity as a thin line (0 at the baseline, 100 at the top).
    const op = idx.map((i) => { const v = src.s[i]; return `${X(a.times[i])},${r1(base - ((v ? Math.max(0, Math.min(100, v[5])) : 0) / 100) * hgt)}`; });
    if (op.length) out.push(`<polyline points="${op.join(' ')}" fill="none" stroke="${C.opacity}" stroke-width="1" stroke-opacity="0.7" stroke-dasharray="4,3"/>`);
    // Moves: extent bar at the bottom and the easing class near the peak.
    let lastEnd = -Infinity;
    for (const m of L.moves) {
      if (m.t1 < t0 || m.t0 > t1) continue;
      const col = EASE_COLORS[m.ease], xa = X(m.t0), xb = X(m.t1);
      out.push(`<rect x="${xa}" y="${base + 1}" width="${Math.max(1.5, r1(xb - xa))}" height="3" fill="${col}"/>`);
      const label = `${m.drift ? 'drift ' : ''}${m.ease}${m.overshoot && m.ease !== 'anticipate' ? ` +${Math.round(m.overshoot * 100)}%` : ''}`;
      const w = label.length * 6.2;
      let x = Math.min(X1 - w, Math.max(X0 + 2, X(m.peakAt) - w / 2));
      if (x < lastEnd + 4) x = lastEnd + 4;
      if (x + w > X1 + 1) continue;
      out.push(`<text x="${r1(x)}" y="${top + 13}" font-family="${FONT}" font-size="11" font-weight="600" fill="${col}">${esc(label)}</text>`);
      lastEnd = x + w;
    }
    // Name and stats.
    out.push(`<rect x="0" y="${top}" width="${LABEL_W - 6}" height="${RH}" fill="${C.bg}"/>`);
    out.push(`<text x="12" y="${top + 21}" font-family="${FONT}" font-size="13" fill="${C.text}">${esc(cut(L.name, 30))}</text>`);
    const stat = `${L.kind}${n > 1 ? ` ×${n}` : ''} · ${L.moves.length} move${L.moves.length === 1 ? '' : 's'} · peak ${fade ? fmtSpeed(peak) + ' %/s' : fmtSpeed(peak) + ' px/s'}`;
    out.push(`<text x="12" y="${top + 39}" font-family="${FONT}" font-size="11" fill="${C.dim}">${esc(cut(stat, 38))}</text>`);
  });

  // Activity row: elements moving per sample (red where most visible elements move), visible elements as a line.
  const act = a.activity, aBase = actTop + ACT_H - 8, aH = ACT_H - 22;
  const amax = Math.max(1, ...idx.map((i) => act.visible[i]));
  out.push(`<rect x="0" y="${actTop}" width="${LABEL_W - 6}" height="${ACT_H}" fill="${C.bg}"/>`);
  out.push(`<line x1="0" y1="${actTop - 5}" x2="${W}" y2="${actTop - 5}" stroke="${C.dim}" stroke-width="1"/>`);
  out.push(`<text x="12" y="${actTop + 22}" font-family="${FONT}" font-size="13" fill="${C.text}">elements moving</text>`);
  out.push(`<text x="12" y="${actTop + 38}" font-family="${FONT}" font-size="11" fill="${C.dim}">${esc(`bars: moving (drifts excluded), red: most`)}</text>`);
  out.push(`<text x="12" y="${actTop + 53}" font-family="${FONT}" font-size="11" fill="${C.dim}">${esc(`line: visible · max ${act.peak} moving at ${act.peakAt.toFixed(1)}s`)}</text>`);
  out.push(`<text x="${X0 - 4}" y="${aBase - aH + 4}" text-anchor="end" font-family="${MONO}" font-size="10" fill="${C.dim}">${amax}</text>`);
  out.push(`<text x="${X0 - 4}" y="${aBase}" text-anchor="end" font-family="${MONO}" font-size="10" fill="${C.dim}">0</text>`);
  const bw = Math.max(1, ((X1 - X0) * a.step) / span);
  for (const i of idx) {
    if (!act.moving[i]) continue;
    const hgt = (act.moving[i] / amax) * aH;
    const busy = act.visible[i] >= 3 && act.moving[i] > 0.7 * act.visible[i] && !act.camera[i];
    out.push(`<rect x="${X(a.times[i])}" y="${r1(aBase - hgt)}" width="${r1(bw)}" height="${r1(hgt)}" fill="${busy ? C.busy : C.speed}" fill-opacity="0.8"/>`);
  }
  const vis = idx.map((i) => `${r1(X(a.times[i]) + bw / 2)},${r1(aBase - (act.visible[i] / amax) * aH)}`);
  if (vis.length) out.push(`<polyline points="${vis.join(' ')}" fill="none" stroke="${C.text}" stroke-width="1" stroke-opacity="0.6"/>`);

  // Footer: legend and omitted rows.
  const fy = plotBottom + 18;
  let lx = 14;
  for (const [k, col] of Object.entries(EASE_COLORS)) {
    out.push(`<rect x="${lx}" y="${fy - 9}" width="10" height="10" fill="${col}"/><text x="${lx + 14}" y="${fy}" font-family="${FONT}" font-size="11" fill="${C.dim}">${k}</text>`);
    lx += 24 + k.length * 6.4;
  }
  out.push(`<rect x="${lx + 6}" y="${fy - 9}" width="14" height="10" fill="${C.hold}" opacity="0.35"/><text x="${lx + 24}" y="${fy}" font-family="${FONT}" font-size="11" fill="${C.dim}">hold (~ with drift)</text>`);
  lx += 140;
  out.push(`<rect x="${lx}" y="${fy - 9}" width="14" height="10" fill="url(#hatch)"/><text x="${lx + 18}" y="${fy}" font-family="${FONT}" font-size="11" fill="${C.dim}">off screen</text>`);
  lx += 90;
  out.push(`<line x1="${lx}" y1="${fy - 4}" x2="${lx + 16}" y2="${fy - 4}" stroke="${C.opacity}" stroke-dasharray="4,3"/><text x="${lx + 20}" y="${fy}" font-family="${FONT}" font-size="11" fill="${C.dim}">opacity</text>`);
  if (omitted.length) out.push(`<text x="14" y="${fy + 20}" font-family="${FONT}" font-size="12" fill="${C.opacity}">${esc(cut(`${omitted.length} more animated layer${omitted.length === 1 ? '' : 's'} not shown (least active): ${omitted.slice(0, 8).join(', ')}${omitted.length > 8 ? ', …' : ''}`, Math.floor(W / 6.6)))}</text>`);
  out.push('</svg>');
  return { svg: out.join('\n'), width: W, height: H, rows: rows.map((r) => r.L.name), omitted };
}

/** Render the speed graph to a PNG file. */
export async function speedGraph(d: MotionData, a: MotionAnalysis, file: string, o: SpeedGraphOptions = {}): Promise<SpeedGraphResult> {
  const g = speedGraphSvg(d, a, o);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await sharp(Buffer.from(g.svg)).png().toFile(file);
  return { file, width: g.width, height: g.height, rows: g.rows, omitted: g.omitted };
}
