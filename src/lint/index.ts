// Lint rules (pure, Node): judge the text samples taken in AE (src/runtime/lint.ts) and report what a viewer
// would notice: text cut off by the frame or outside the safe area, box text that overflows, texts on top of each
// other, text on screen too briefly to read, missing fonts, and mechanical linear moves. Blank frames are judged
// from rendered frames (./frames.ts). Every issue names the layer and the time range so the agent can fix it.

import { cssBezier } from '../shared/bezier.ts';
import { STYLE_RULES } from '@ae-mcp/core/motion/types.ts';
import type { StyleRule } from '@ae-mcp/core/motion/types.ts';
import { springUnit } from '../shared/spring.ts';
import { formatIssues as formatReport } from '@ae-mcp/core/lint/report.ts';

export type TextLintRule = 'off-frame' | 'safe-area' | 'overflow' | 'overlap' | 'occlusion' | 'reading-time' | 'missing-font' | 'linear-motion' | 'blank-frame';
/** Text lint rules plus the style-lint craft rules (src/motion/style.ts), so `ignore` takes either. */
export type LintRule = TextLintRule | StyleRule;
export const LINT_RULES: LintRule[] = ['off-frame', 'safe-area', 'overflow', 'overlap', 'occlusion', 'reading-time', 'missing-font', 'linear-motion', 'blank-frame', ...STYLE_RULES];

export interface LintOptions {
  /** Safe-area margin per side: 'action' (5 %, default), 'title' (10 %), or a fraction of the frame. */
  safe?: 'action' | 'title' | 'reels' | number;
  /** Reading speed in words per second (default 3.5, about 210 words a minute). */
  readingRate?: number;
  /** Time to notice a text before reading starts, seconds (default 0.5). */
  minRead?: number;
  /** Rules to skip. */
  ignore?: LintRule[];
}

export interface LintIssue {
  rule: LintRule;
  severity: 'warn' | 'info';
  message: string;
  layer?: string;
  layers?: string[];
  t?: [number, number];
}

/** One text layer as sampled in AE: per sample time null (inactive) or [opacity 0–100, x1, y1, …, x4, y4]. */
export interface LintText {
  path: string; name: string; id?: string | null; text?: string; words?: number; font?: string; size?: number;
  substitute?: boolean; box?: boolean; overflow?: boolean; in: number; out: number; threeD?: boolean; err?: string;
  s: (number[] | null)[];
  /** Index in the top comp (top-level 2D texts only; occlusion compares stacking order). */
  idx?: number;
  /** The layer's own in/out point in top-comp time (anchors for per-unit animator timing). */
  lin?: number; lout?: number;
  units?: { char: number; charNoSpaces: number; word: number; line: number; firstWord: number };
  /** ae-compose per-unit animators, with the current values of their live controls. */
  anims?: LintAnim[];
  /** Intervals (top-comp time) where a hand-built range selector hides most of the text. */
  hidden?: [number, number][];
}
export interface LintAnim {
  by: 'char' | 'charNoSpaces' | 'word' | 'line'; dir: 'in' | 'out'; anchor: 'start' | 'end'; order: string; off: number;
  each: number; dur: number; delay: number; spring?: [number, number, number]; bezier?: [number, number, number, number];
}
export interface LintData {
  ok: boolean; comp: string; itemId?: number; w: number; h: number; fps: number; dur: number; step: number;
  times: number[]; texts: LintText[]; linear: { layer: string; prop: string; segments: number; t: [number, number] }[];
  truncated?: boolean; ms?: number;
  /** 2D layers stacked above the top-level texts, sampled like texts. kind: solid | footage (opaque) | footage-alpha | shape | precomp. */
  occluders?: { name: string; idx: number; kind: string; s: (number[] | null)[] }[];
}

interface Box { x0: number; y0: number; x1: number; y1: number }
interface Sample { op: number; b: Box; area: number }

const area = (b: Box) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
const fmt = (t: number) => `${(Math.round(t * 10) / 10).toFixed(1)}s`;
const range = (t: [number, number]) => (t[1] - t[0] < 0.05 ? `at ${fmt(t[0])}` : `at ${fmt(t[0])}–${fmt(t[1])}`);
const q = (s: string) => `"${s.length > 40 ? s.slice(0, 37) + '…' : s}"`;

function boxOf(v: number[]): Box | null {
  const xs = [v[1], v[3], v[5], v[7]], ys = [v[2], v[4], v[6], v[8]];
  if (xs.some((x) => !Number.isFinite(x)) || ys.some((y) => !Number.isFinite(y))) return null;
  const b = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  return area(b) >= 1 ? b : null;
}
const edgeDelta = (a: Box, b: Box) => Math.max(Math.abs(a.x0 - b.x0), Math.abs(a.y0 - b.y0), Math.abs(a.x1 - b.x1), Math.abs(a.y1 - b.y1));
const centerSpeed = (a: Box, b: Box, dt: number) =>
  Math.max(Math.abs((a.x0 + a.x1 - b.x0 - b.x1) / 2), Math.abs((a.y0 + a.y1 - b.y0 - b.y1) / 2), Math.abs((a.x1 - a.x0) - (b.x1 - b.x0)) / 2, Math.abs((a.y1 - a.y0) - (b.y1 - b.y0)) / 2) / dt;

/** Longest run of consecutive indices where pred holds: [first, last] or null. */
function longestRun(n: number, pred: (i: number) => boolean): [number, number] | null {
  let best: [number, number] | null = null, start = -1;
  for (let i = 0; i <= n; i++) {
    if (i < n && pred(i)) { if (start < 0) start = i; continue; }
    if (start >= 0 && (!best || i - 1 - start > best[1] - best[0])) best = [start, i - 1];
    start = -1;
  }
  return best;
}

/** Seconds until a unit's progress passes `level` (0–1): spring, cubic bezier over `dur`, or `dur` itself. */
function progressTime(a: LintAnim, level: number, rising: boolean): number {
  if (a.spring && a.spring.every(Number.isFinite)) {
    const [c, k, m] = a.spring, fps = 120;
    let last = 0;
    for (let f = 1; f <= fps * 10; f++) {
      const p = springUnit(f, fps, c, k, m);
      if (rising) { if (Math.abs(1 - p) > 1 - level) last = f / fps; } else if (p > level) return f / fps;
    }
    return rising ? last + 1 / fps : 10;
  }
  if (a.bezier) {
    for (let x = 0; x <= 1.0001; x += 0.005) {
      const p = cssBezier(a.bezier, Math.min(1, x));
      if (rising ? p >= level : p > level) return x * a.dur;
    }
  }
  return a.dur;
}

/**
 * Intervals where per-unit animators keep the text unreadable: before the units a reader needs have landed
 * (the first word for word/line reveals, the whole first word for character reveals, everything for other
 * orders), and from the moment the first unit starts leaving. Times are top-comp seconds.
 */
export function animatorHidden(T: LintText): [number, number][] {
  const out: [number, number][] = [...(T.hidden ?? [])];
  const lin = T.lin ?? T.in, lout = T.lout ?? T.out;
  for (const a of T.anims ?? []) {
    if (![a.each, a.dur, a.delay].every(Number.isFinite)) continue;
    const n = Math.max(1, T.units?.[a.by] ?? 1);
    const maxI = a.order === 'center' || a.order === 'edges' ? (n - 1) / 2 : n - 1;
    const base = a.anchor === 'end' ? lout - a.delay : lin + a.off + a.delay;
    if (a.dir === 'in') {
      const iRead = a.order !== 'start' ? maxI : a.by === 'word' || a.by === 'line' ? 0 : Math.min(maxI, Math.max(0, (T.units?.firstWord ?? 1) - 1));
      out.push([-1e9, base + iRead * a.each + progressTime(a, 0.95, true)]);
    } else {
      out.push([base + progressTime(a, 0.05, false), 1e9]);
    }
  }
  return out;
}

/** Per-text derived state: samples, rest box, and which samples are visible / readable. */
export function analyzeText(T: LintText, d: LintData) {
  const n = d.times.length;
  const hidden = animatorHidden(T);
  const isHidden = (t: number) => hidden.some(([a, b]) => t >= a - 1e-6 && t < b - 1e-6);
  const S: (Sample | null)[] = T.s.map((v) => { const b = v ? boxOf(v) : null; return v && b ? { op: v[0], b, area: area(b) } : null; });
  while (S.length < n) S.push(null);
  const maxOp = Math.max(0, ...S.map((s) => (s ? s.op : 0)));
  // Rest = the middle of the longest still stretch (text settled after its entrance).
  const still = longestRun(n, (i) => i > 0 && !!S[i] && !!S[i - 1] && S[i]!.op >= 50 && edgeDelta(S[i]!.b, S[i - 1]!.b) <= 1.5);
  let rest: Box | null = null;
  if (still) rest = S[Math.round((still[0] - 1 + still[1]) / 2)]!.b;
  else { let bi = -1; S.forEach((s, i) => { if (s && (bi < 0 || s.op > S[bi]!.op)) bi = i; }); rest = bi >= 0 ? S[bi]!.b : null; }
  const restArea = rest ? area(rest) : 0;
  const visible = S.map((s, i) => !!s && s.op >= 50 && s.area >= 0.5 * restArea && !isHidden(d.times[i]));
  const readable = S.map((s, i) => {
    if (!visible[i] || s!.op < 0.9 * maxOp) return false;
    // Still enough to read: the move to or from a neighbouring sample is slow (the frame a slide lands on counts).
    const prev = i > 0 ? S[i - 1] : null, next = i + 1 < n ? S[i + 1] : null;
    if (!prev && !next) return true;
    const vp = prev ? centerSpeed(s!.b, prev.b, d.times[i] - d.times[i - 1]) : Infinity;
    const vn = next ? centerSpeed(next.b, s!.b, d.times[i + 1] - d.times[i]) : Infinity;
    return Math.min(vp, vn) <= 250;
  });
  return { S, rest, visible, readable };
}

const spanOf = (d: LintData, run: [number, number]): [number, number] => [d.times[run[0]], d.times[run[1]]];
const dur = (d: LintData, run: [number, number]) => d.times[run[1]] - d.times[run[0]] + d.step;

export function lintRules(d: LintData, opts: LintOptions = {}): LintIssue[] {
  const issues: LintIssue[] = [];
  const skip = new Set(opts.ignore ?? []);
  const add = (i: LintIssue) => { if (!skip.has(i.rule)) issues.push(i); };
  const margin = opts.safe === 'title' ? 0.1 : typeof opts.safe === 'number' ? opts.safe : 0.05;
  const safeName = opts.safe === 'title' ? 'title-safe' : opts.safe === 'reels' ? 'vertical platform (UI-free)' : typeof opts.safe === 'number' ? `${Math.round(opts.safe * 100)} % safe` : 'action-safe';
  // Vertical social (SKILL.md §6.7): keep out of the top 250, bottom 400, right 120 and left 60 px at 1080×1920.
  const reels = opts.safe === 'reels' ? { top: 250 * d.h / 1920, right: 120 * d.w / 1080, bottom: 400 * d.h / 1920, left: 60 * d.w / 1080 } : null;
  const rate = opts.readingRate ?? 3.5, minRead = opts.minRead ?? 0.5;
  const A = d.texts.map((T) => analyzeText(T, d));

  // Missing fonts, grouped per font.
  const missing = new Map<string, string[]>();
  for (const T of d.texts) if (T.substitute && T.font) missing.set(T.font, [...(missing.get(T.font) ?? []), T.path]);
  for (const [font, layers] of missing) add({ rule: 'missing-font', severity: 'warn', layers, message: `font "${font}" is not installed; AE substitutes another font in ${layers.map(q).join(', ')}` });

  d.texts.forEach((T, k) => {
    const { S, readable, visible } = A[k];
    const n = d.times.length;
    if (T.box && T.overflow) add({ rule: 'overflow', severity: 'warn', layer: T.path, message: `box text ${q(T.path)} overflows its box: the last lines are hidden (enlarge the box or shorten the text)` });

    // Frame edges and safe area, judged where the text is readable (entrances from off-screen are fine).
    const over = { left: 0, right: 0, top: 0, bottom: 0 }, unsafe = { left: 0, right: 0, top: 0, bottom: 0 };
    let offT: [number, number] | null = null, unsafeT: [number, number] | null = null;
    for (let i = 0; i < n; i++) {
      if (!readable[i]) continue;
      const b = S[i]!.b, t = d.times[i];
      const o = { left: -b.x0, right: b.x1 - d.w, top: -b.y0, bottom: b.y1 - d.h };
      const mx = margin * d.w, my = margin * d.h;
      const u = reels ? { left: reels.left - b.x0, right: b.x1 - (d.w - reels.right), top: reels.top - b.y0, bottom: b.y1 - (d.h - reels.bottom) } : { left: mx - b.x0, right: b.x1 - (d.w - mx), top: my - b.y0, bottom: b.y1 - (d.h - my) };
      let off = false, uns = false;
      for (const e of ['left', 'right', 'top', 'bottom'] as const) {
        if (o[e] > 2) { over[e] = Math.max(over[e], o[e]); off = true; }
        if (u[e] > 2) { unsafe[e] = Math.max(unsafe[e], u[e]); uns = true; }
      }
      if (off) offT = offT ? [offT[0], t] : [t, t];
      if (uns) unsafeT = unsafeT ? [unsafeT[0], t] : [t, t];
    }
    const edges = (m: typeof over) => (Object.keys(m) as (keyof typeof over)[]).filter((e) => m[e] > 0).map((e) => `${e} by ${Math.round(m[e])} px`).join(', ');
    if (offT) add({ rule: 'off-frame', severity: 'warn', layer: T.path, t: offT, message: `${q(T.path)} is cut off by the frame edge (${edges(over)}) ${range(offT)}` });
    else if (unsafeT) add({ rule: 'safe-area', severity: 'warn', layer: T.path, t: unsafeT, message: `${q(T.path)} is outside the ${safeName} area (${edges(unsafe)}) ${range(unsafeT)}` });

    // Reading time: the longest stretch where the text is readable vs. what its word count needs.
    const words = T.words ?? 0;
    if (words > 0 && visible.some(Boolean)) {
      const run = longestRun(n, (i) => readable[i]);
      const have = run ? dur(d, run) : 0, need = minRead + words / rate;
      if (have < need - d.step / 2) {
        const where = run ? ` ${range(spanOf(d, run))}` : '';
        add({ rule: 'reading-time', severity: 'warn', layer: T.path, t: run ? spanOf(d, run) : undefined, message: `${q(T.text ?? T.path)} is readable for ${have.toFixed(1)} s${where}; ${words} word${words === 1 ? '' : 's'} need about ${need.toFixed(1)} s (hold it longer, or reveal faster)` });
      }
    }
  });

  // Texts on top of each other, both visible for at least 0.3 s.
  for (let a = 0; a < d.texts.length; a++) for (let b = a + 1; b < d.texts.length; b++) {
    const frac: number[] = [];
    const hit = (i: number) => {
      if (!A[a].visible[i] || !A[b].visible[i]) return false;
      const p = A[a].S[i]!, r = A[b].S[i]!;
      const inter = area({ x0: Math.max(p.b.x0, r.b.x0), y0: Math.max(p.b.y0, r.b.y0), x1: Math.min(p.b.x1, r.b.x1), y1: Math.min(p.b.y1, r.b.y1) });
      frac[i] = inter / Math.min(p.area, r.area);
      return frac[i] >= 0.15;
    };
    const run = longestRun(d.times.length, hit);
    if (run && dur(d, run) >= 0.3 - 1e-6) {
      const pct = Math.round(100 * Math.max(...frac.slice(run[0], run[1] + 1)));
      add({ rule: 'overlap', severity: 'warn', layers: [d.texts[a].path, d.texts[b].path], t: spanOf(d, run), message: `${q(d.texts[a].path)} and ${q(d.texts[b].path)} overlap (${pct} % of the smaller one) ${range(spanOf(d, run))}` });
    }
  }

  // Text covered by a layer stacked above it, while the text should be readable.
  for (let k = 0; k < d.texts.length; k++) {
    const T = d.texts[k];
    if (T.idx === undefined) continue;
    for (const O of d.occluders ?? []) {
      if (O.idx >= T.idx) continue;
      const cov: number[] = [];
      const hit = (i: number) => {
        const t = A[k].S[i], v = O.s[i];
        if (!A[k].readable[i] || !t || !v || v[0] < 50) return false;
        const ob = boxOf(v);
        if (!ob) return false;
        cov[i] = area({ x0: Math.max(t.b.x0, ob.x0), y0: Math.max(t.b.y0, ob.y0), x1: Math.min(t.b.x1, ob.x1), y1: Math.min(t.b.y1, ob.y1) }) / t.area;
        return cov[i] >= 0.4;
      };
      const run = longestRun(d.times.length, hit);
      if (!run || dur(d, run) < 0.3 - 1e-6) continue;
      const pct = Math.round(100 * Math.max(...cov.slice(run[0], run[1] + 1).filter((x) => x !== undefined)));
      const sure = O.kind === 'solid' || O.kind === 'footage';
      add({ rule: 'occlusion', severity: sure ? 'warn' : 'info', layers: [T.path, O.name], t: spanOf(d, run),
        message: sure
          ? `${q(T.path)} is covered by ${q(O.name)} above it (${pct} % of the text) ${range(spanOf(d, run))}`
          : `${q(T.path)} may be hidden behind ${q(O.name)} (${O.kind === 'shape' ? 'a shape layer' : O.kind === 'precomp' ? 'a precomp' : 'footage with alpha'} above it whose bounds cover ${pct} % of the text) ${range(spanOf(d, run))}; check the contact sheet` });
    }
  }

  for (const m of d.linear ?? []) add({ rule: 'linear-motion', severity: 'info', layer: m.layer, t: m.t, message: `${q(m.layer)} ${m.prop} moves with linear keys only (${m.segments} segment${m.segments === 1 ? '' : 's'}); ease it unless the constant speed is intended` });
  return issues;
}

/** One line per issue, warnings first, for build/edit reports (the shared core format). */
export function formatIssues(issues: LintIssue[]): string[] {
  return formatReport(issues);
}
