// Style lint on a plan (pure): the planned timeline is turned into the transform samples the AE sampler would take
// (MotionData: every element rises in on its arrival, holds still, eases out on its exit), so the build-time craft
// rules (src/motion/style.ts) can judge the plan before any TSX exists: dead air between beats, crowded
// entrances, visuals that leave right after landing, everything moving at once.
import { analyzeMotion } from '@ae-mcp/core/motion/analyze.ts';
import { styleLint } from '@ae-mcp/core/motion/style.ts';
import type { MotionData, MotionLayer, StyleRule } from '@ae-mcp/core/motion/types.ts';
import { formatOf } from './timing.ts';
import type { PlanBeat, PlanElement, PlanIssue, PlanRule, PlanTimeline } from './types.ts';

/** Rules the plan checks itself (more precisely) or that synthetic samples can't judge (easings, furniture, beats). */
const SKIP: StyleRule[] = ['transition-repeat', 'easing-monotony', 'linear-move', 'slide-furniture', 'short-end-hold', 'off-beat'];
const STEP = 0.05;

/** Rest centre of each element of a beat (a rough version of the scaffold's layout). */
function positions(b: PlanBeat, w: number, h: number): Map<PlanElement, [number, number]> {
  const out = new Map<PlanElement, [number, number]>();
  const row = b.layout === 'text+visual' && formatOf(w, h) === 'landscape';
  const stack = (els: PlanElement[], x: number) => {
    const gap = 30;
    const total = els.reduce((s, e) => s + e.box[1], 0) + gap * Math.max(0, els.length - 1);
    let y = h / 2 - total / 2;
    for (const e of els) { out.set(e, [x, y + e.box[1] / 2]); y += e.box[1] + gap; }
  };
  if (row) {
    const vis = b.elements.filter((e) => e.role === 'visual');
    const txt = b.elements.filter((e) => e.role !== 'visual');
    stack(vis, w * 0.3);
    stack(txt, w * 0.64);
  } else stack(b.elements, w / 2);
  return out;
}

const easeOut = (p: number) => 1 - Math.pow(1 - p, 4);
const easeIn = (p: number) => p * p * p;

/** The plan as MotionData (one layer per planned element; transitions from the plan). */
export function planMotion(tl: PlanTimeline): MotionData {
  const { width: w, height: h, fps } = tl;
  const n = Math.floor(tl.duration / STEP + 1e-6) + 1;
  const times = Array.from({ length: n }, (_, i) => Math.round(i * STEP * 1000) / 1000);
  const layers: MotionLayer[] = [];
  for (const b of tl.beats) {
    const pos = positions(b, w, h);
    for (const e of b.elements) {
      const [x, y] = pos.get(e)!;
      const rise = e.role === 'visual' ? 60 : Math.max(24, Math.round((e.size ?? 60) * 0.6));
      const s: (number[] | null)[] = [];
      const bb: (number[] | null)[] = [];
      for (const t of times) {
        if (t < b.start - 1e-6 || t >= b.end - 1e-6) { s.push(null); bb.push(null); continue; }
        let dy = 0, op = 100;
        const [a0, a1] = e.arrive;
        if (t < a0) { dy = rise; op = 0; }
        else if (t < a1) { const p = (t - a0) / Math.max(a1 - a0, 1e-3); dy = rise * (1 - easeOut(p)); op = Math.min(100, (100 * p) / 0.3); }
        if (e.leave && t >= e.leave[0]) {
          const p = Math.min(1, (t - e.leave[0]) / Math.max(e.leave[1] - e.leave[0], 1e-3));
          dy = -30 * easeIn(p); op = 100 * (1 - easeIn(p));
        }
        s.push([x, y + dy, 100, 100, 0, op]);
        bb.push([x - e.box[0] / 2, y + dy - e.box[1] / 2, x + e.box[0] / 2, y + dy + e.box[1] / 2]);
      }
      layers.push({ name: `${b.name} ${e.role}`, id: e.id, kind: e.role === 'visual' || e.role === 'logo' ? 'shape' : 'text', in: b.start, out: b.end, s, b: bb, text: e.text });
    }
  }
  return {
    comp: tl.name, w, h, fps, dur: tl.duration, step: STEP, times, layers,
    scenes: tl.beats.map((b) => ({ name: b.name, t: b.start, dur: b.duration })),
    transitions: tl.transitions.filter((x) => x.dur > 0).map((x) => ({ kind: x.kind, t: x.at - x.dur / 2, dur: x.dur })),
  };
}

/** Style-lint issues on the planned timing, attributed to the beat they start in. */
export function planStyleIssues(tl: PlanTimeline): PlanIssue[] {
  if (!tl.beats.length || tl.duration <= 0) return [];
  const d = planMotion(tl);
  const issues = styleLint(d, analyzeMotion(d), { ignore: SKIP });
  return issues.map((i) => {
    const t0 = i.t?.[0] ?? 0;
    const beat = [...tl.beats].reverse().find((b) => t0 >= b.start - 1e-6);
    return { rule: i.rule as PlanRule, severity: i.severity, message: `planned timing: ${i.message}`, beat: beat?.name, t: i.t };
  });
}
