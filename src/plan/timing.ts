// Beat sheet → planned timeline (pure). Every element of every beat gets an arrival, a hold and an exit, using the
// same timing the scaffold writes (title reveal per word, sublines after the title lands, exits anchored to the
// beat's end, visuals on a spring), so the plan checks and the built scene agree. Type sizes and line breaks
// follow SKILL.md §6.7 for the canvas (16:9, 9:16, square), measured with the approximate text metrics.
import { approxWidth } from '@cc-mcp/core/text/measure.ts';
import { breakLines } from '@cc-mcp/core/text/linebreak.ts';
import type { Beat, BeatSheet, ElementRole, PlanBeat, PlanElement, PlanIssue, PlanTimeline } from './types.ts';
import { HARD_CUTS } from './types.ts';

/** Timing constants shared by the timeline and the scaffold (seconds). */
export const TIMING = {
  /** First element of a beat starts this long after the beat starts (the "Title Delay" control). */
  titleDelay: 0.15,
  /** When a beat has a visual, it leads and the title follows this much later. */
  visualLead: 0.25,
  /** Title: per-word reveal (easeOutExpo); "Word Stagger" control. */
  titleEach: 0.08, titleUnit: 0.6,
  /** Sublines start this long before the title has landed (it is settling), then reveal per word. */
  subOverlap: 0.15, subEach: 0.06, subUnit: 0.5, subGap: 0.2,
  /** Exits (easeInCubic, per word). */
  titleExitEach: 0.03, titleExitUnit: 0.3, subExitEach: 0.02, subExitUnit: 0.25, visualExit: 0.3,
  /** Visual placeholder: spring rise. */
  visualArrive: 0.6,
  /** End card: logo draw-on (SVG) or a spring pop (placeholder mark), then the CTA. */
  logoSvg: 1.2, logoMark: 0.8, ctaLag: 0.3, ctaEach: 0.07, ctaUnit: 0.5,
  endHold: 2.5,
  overlap: 0.3,
  /** Shortest exit lead (s): exits start at least this long before a beat ends. */
  minExitLead: 0.45,
} as const;

/** Transition length by kind (the placeholder components use the same). */
export const TRANSITION_DUR: Record<string, number> = {
  cut: 0, 'match-cut': 0.6, 'hand-off': 1.0, 'shape-wipe': 0.9, 'zoom-through': 0.8, 'push-through': 0.8,
  'parallax-split': 0.9, 'liquid-wipe': 0.9, 'slice-wipe': 0.8, 'grid-wipe': 0.8, 'light-leak': 0.8,
};
export const transitionDur = (kind: string) => TRANSITION_DUR[kind] ?? 0.9;

/** Canvas sizes for the sheet's `format` shorthand (the reframe targets). */
export const FORMAT_SIZE: Record<string, [number, number]> = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350] };

export type Format = 'landscape' | 'vertical' | 'square';
export function formatOf(w: number, h: number): Format {
  const r = w / h;
  return r > 1.15 ? 'landscape' : r < 0.87 ? 'vertical' : 'square';
}

/** Type sizes for the canvas (SKILL.md §6.7), px. */
export function typeScale(w: number, h: number) {
  const f = formatOf(w, h);
  const k = f === 'landscape' ? w / 1920 : w / 1080;
  const base = f === 'landscape' ? { hero: 170, headline: 120, small: 96, min: 72, sub: 52, cta: 64 }
    : f === 'vertical' ? { hero: 140, headline: 112, small: 92, min: 72, sub: 56, cta: 60 }
    : { hero: 145, headline: 102, small: 84, min: 62, sub: 46, cta: 54 };
  const r = (x: number) => Math.round(x * k);
  return { format: f, hero: r(base.hero), headline: r(base.headline), small: r(base.small), min: r(base.min), sub: r(base.sub), cta: r(base.cta) };
}

/** Width factors over approxWidth (a regular grotesque) for the scaffold's faces. */
export const FONT_FACTOR = { display: 1.12, body: 1.0, bold: 1.06 } as const;

export const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
/** Reading time per SKILL.md §2.4: 0.5 s + 0.3 s per word, at least `min`. */
export const readingTime = (n: number, min: number) => Math.max(min, 0.5 + 0.3 * n);
const round2 = (x: number) => Math.round(x * 100) / 100;
const ceilTo = (x: number, step: number) => Math.ceil(x / step - 1e-9) * step;

/** Fit text into maxW: hard breaks kept, balanced breaks added, shrunk in 10 % steps down to minSize. */
export function layoutText(text: string, size: number, minSize: number, maxW: number, tracking: number, factor: number, maxLines: number) {
  const hard = text.split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean);
  let s = size;
  for (;;) {
    const measure = (x: string) => approxWidth(x, s, { tracking }) * factor;
    const lines = hard.flatMap((l) => (measure(l) <= maxW ? [l] : breakLines(l, { maxWidth: maxW, measure, maxLines })));
    const fits = lines.length <= maxLines && lines.every((l) => measure(l) <= maxW + 1);
    if (fits || s <= minSize) {
      const width = Math.min(maxW, Math.max(...lines.map(measure), 1));
      return { size: s, lines, fits, shrunk: s < size, box: [Math.round(width), Math.round(lines.length * s * 1.15)] as [number, number] };
    }
    s = Math.max(minSize, Math.round(s * 0.9));
  }
}

/** Beat name → identifier for the scaffold (T.<key>), unique within the sheet. */
export function beatKeys(names: string[]): string[] {
  const used = new Set<string>(['end']);
  return names.map((n) => {
    const parts = n.normalize('NFKD').replace(/[^\w\s-]/g, ' ').split(/[\s_-]+/).filter(Boolean);
    let k = parts.map((p, i) => (i ? p[0].toUpperCase() + p.slice(1).toLowerCase() : p.toLowerCase())).join('') || 'beat';
    if (/^\d/.test(k)) k = 'b' + k;
    let u = k, i = 2;
    while (used.has(u)) u = `${k}${i++}`;
    used.add(u);
    return u;
  });
}
export const kebab = (k: string) => k.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

export const textsOf = (b: Pick<Beat, 'text'>): string[] => (b.text === undefined ? [] : Array.isArray(b.text) ? b.text : [b.text]).map((t) => String(t)).filter((t) => t.trim());

interface Draft { el: PlanElement; exitSpan: number }

/** The planned timeline for a sheet. `logoFound` says whether end.logo resolved to a file (draw-on vs a placeholder mark). */
export function buildTimeline(sheet: BeatSheet, logoFound = false): { timeline: PlanTimeline; notes: PlanIssue[] } {
  const [fw, fh] = FORMAT_SIZE[sheet.format ?? '16:9'] ?? FORMAT_SIZE['16:9'];
  const w = sheet.width ?? fw, h = sheet.height ?? fh, fps = sheet.fps ?? 30;
  const S = typeScale(w, h);
  const notes: PlanIssue[] = [];
  const T = TIMING;
  const defOverlap = sheet.overlap ?? T.overlap;
  type Item = Beat & { endCard?: boolean };
  const items: Item[] = sheet.beats.map((b) => ({ ...b }));
  const endCard = sheet.end;
  if (endCard) items.push({ name: 'End Card', purpose: 'payoff: logo and call to action', duration: 0, text: endCard.text, transitionIn: endCard.transitionIn, overlap: endCard.overlap, hold: endCard.hold ?? T.endHold, endCard: true });
  const keys = beatKeys(items.map((b) => (b.endCard ? 'end' : b.name)));
  if (endCard) keys[keys.length - 1] = 'end';
  const kindOf = (i: number) => (i > 0 ? items[i].transitionIn : undefined);
  const overlapOf = (i: number) => (i === 0 ? 0 : items[i].overlap ?? (HARD_CUTS.includes(kindOf(i) ?? '') ? 0 : defOverlap));

  // Pass 1: local element timings (exit lead is shared, so exits come in pass 2).
  const drafts: { beat: PlanBeat; els: Draft[] }[] = [];
  items.forEach((b, i) => {
    const last = i === items.length - 1;
    const nextKind = last ? undefined : kindOf(i + 1);
    const exits = !last && b.holdTo !== 'end' && !HARD_CUTS.includes(nextKind ?? '');
    const texts = textsOf(b);
    const visual = !!b.visual && !b.endCard;
    const prefix = kebab(keys[i]);
    const els: Draft[] = [];
    const layout: PlanBeat['layout'] = b.endCard ? 'end' : texts.length && visual ? 'text+visual' : texts.length ? 'text' : visual ? 'visual' : 'empty';
    const fmt = S.format;
    const card: [number, number] = layout === 'visual'
      ? (fmt === 'landscape' ? [Math.round(w * 0.47), Math.round(h * 0.52)] : fmt === 'vertical' ? [Math.round(w * 0.78), Math.round(h * 0.3)] : [Math.round(w * 0.7), Math.round(h * 0.45)])
      : (fmt === 'landscape' ? [Math.round(w * 0.33), Math.round(h * 0.4)] : fmt === 'vertical' ? [Math.round(w * 0.74), Math.round(h * 0.27)] : [Math.round(w * 0.6), Math.round(h * 0.34)]);
    const rowGap = Math.round(w * 0.047);
    const textW = layout === 'text+visual' && fmt === 'landscape' ? w * 0.8 - card[0] - rowGap : fmt === 'vertical' ? w * 0.78 : w * 0.8;
    const d0 = T.titleDelay;
    if (visual) {
      els.push({ el: { id: `${prefix}-visual`, role: 'visual', text: b.visual, box: card, arrive: [d0, d0 + T.visualArrive], leave: null, readable: [0, 0], needs: 1 }, exitSpan: T.visualExit });
    }
    if (b.endCard) {
      const mark = T.logoMark, svg = T.logoSvg;
      const landLogo = d0 + (endCard?.logo && logoFound ? svg : mark);
      const logoBox: [number, number] = [Math.round(w * (fmt === 'landscape' ? 0.29 : 0.5)), Math.round(h * (fmt === 'vertical' ? 0.1 : 0.17))];
      els.push({ el: { id: 'end-logo', role: 'logo', text: endCard?.logo, box: endCard?.logo && logoFound ? logoBox : [Math.round(S.hero * 1.1), Math.round(S.hero * 1.1)], arrive: [d0, landLogo], leave: null, readable: [0, 0], needs: 2 }, exitSpan: 0.3 });
      if (texts.length) {
        const L = layoutText(texts[0], S.cta, S.min * 0.6, w * 0.8, 0, FONT_FACTOR.bold, 2);
        const n = words(texts[0]);
        const t0 = round2(landLogo - T.ctaLag);
        els.push({ el: { id: 'end-cta', role: 'cta', text: texts[0], layout: L.lines.join('\r'), size: L.size, tracking: 20, words: n, box: L.box, arrive: [t0, t0 + (n - 1) * T.ctaEach + T.ctaUnit], leave: null, readable: [0, 0], needs: readingTime(n, 2) }, exitSpan: 0 });
      }
    } else if (texts.length) {
      const [title, ...subs] = texts;
      const n = words(title);
      let size = n <= 3 ? S.hero : n <= 6 ? S.headline : S.small;
      if (layout === 'text+visual' && fmt === 'landscape') size = Math.min(size, S.small);
      const tracking = size >= S.hero ? -20 : size >= S.headline ? -10 : 0;
      const L = layoutText(title, size, S.min, textW, tracking, FONT_FACTOR.display, 3);
      if (!L.fits) notes.push({ rule: 'long-text', severity: 'warn', beat: b.name, message: `beat "${b.name}": the headline "${clip(title)}" does not fit the safe area even at ${L.size} px: shorten it or split it across two beats` });
      else if (L.shrunk) notes.push({ rule: 'long-text', severity: 'info', beat: b.name, message: `beat "${b.name}": the headline "${clip(title)}" was set at ${L.size} px (from ${size}) to fit ${L.lines.length} line(s): a shorter line would read bigger` });
      const start = d0 + (visual ? T.visualLead : 0);
      const land = start + (n - 1) * T.titleEach + T.titleUnit;
      els.push({ el: { id: `${prefix}-title`, role: 'title', text: title, layout: L.lines.join('\r'), size: L.size, tracking, words: n, box: L.box, arrive: [round2(start), round2(land)], leave: null, readable: [0, 0], needs: readingTime(n, 1.5) }, exitSpan: (n - 1) * T.titleExitEach + T.titleExitUnit });
      subs.forEach((s, k) => {
        const m = words(s);
        const SL = layoutText(s, S.sub, Math.round(S.sub * 0.85), textW, 0, FONT_FACTOR.body, 2);
        if (!SL.fits) notes.push({ rule: 'long-text', severity: 'warn', beat: b.name, message: `beat "${b.name}": the line "${clip(s)}" needs more than two lines at ${SL.size} px: shorten it or give it its own beat` });
        const t0 = land - T.subOverlap + k * T.subGap;
        els.push({ el: { id: `${prefix}-sub${k ? k + 1 : ''}`, role: 'sub', text: s, layout: SL.lines.join('\r'), size: SL.size, tracking: 0, words: m, box: SL.box, arrive: [round2(t0), round2(t0 + (m - 1) * T.subEach + T.subUnit)], leave: null, readable: [0, 0], needs: readingTime(m, 1) }, exitSpan: (m - 1) * T.subExitEach + T.subExitUnit });
      });
    }
    let duration = b.duration;
    if (b.endCard) {
      const land = Math.max(...els.map((d) => d.el.arrive[1]));
      duration = Math.round(ceilTo(land + (b.hold ?? T.endHold), 0.1) * 10) / 10;
    }
    drafts.push({ beat: { name: b.name, key: keys[i], purpose: b.purpose ?? '', start: 0, end: 0, duration, overlap: overlapOf(i), transitionIn: kindOf(i), exits, final: last, endCard: b.endCard, layout, elements: [] }, els });
  });

  // Shared exit lead: long enough for every exit to finish before the middle of the overlap with the next beat.
  let exitLead: number = T.minExitLead;
  drafts.forEach(({ beat, els }, i) => {
    if (!beat.exits) return;
    const ovNext = drafts[i + 1]?.beat.overlap ?? 0;
    for (const d of els) exitLead = Math.max(exitLead, d.exitSpan + ovNext / 2);
  });
  exitLead = Math.round(ceilTo(exitLead, 0.05) * 100) / 100;

  // Pass 2: absolute times, exits and readable windows.
  let cursor = 0;
  const beats: PlanBeat[] = [];
  drafts.forEach(({ beat, els }, i) => {
    beat.start = round2(i === 0 ? 0 : cursor - beat.overlap);
    beat.end = round2(beat.start + beat.duration);
    cursor = beat.end;
    const ovNext = drafts[i + 1]?.beat.overlap ?? 0;
    for (const { el, exitSpan } of els) {
      const leaveAt = beat.duration - exitLead;
      el.leave = beat.exits ? [round2(beat.start + leaveAt), round2(beat.start + leaveAt + exitSpan)] : null;
      const readEnd = beat.exits ? leaveAt : beat.final ? beat.duration : beat.duration - ovNext;
      el.arrive = [round2(beat.start + el.arrive[0]), round2(beat.start + el.arrive[1])];
      el.readable = [el.arrive[1], round2(beat.start + Math.max(readEnd, el.arrive[1] - beat.start))];
      beat.elements.push(el);
    }
    beats.push(beat);
  });
  const transitions = beats.slice(1).flatMap((b, i) => (b.transitionIn ? [{ kind: b.transitionIn, at: round2(b.start + b.overlap / 2), dur: transitionDur(b.transitionIn), from: beats[i].name, to: b.name, overlap: b.overlap }] : []));
  const duration = round2(beats.length ? beats[beats.length - 1].end : 0);
  return { timeline: { name: sheet.name, width: w, height: h, fps, duration, exitLead, titleDelay: T.titleDelay, stagger: T.titleEach, beats, transitions }, notes };
}

export const clip = (s: string, n = 40) => (s.length > n ? s.slice(0, n - 1) + '…' : s).replace(/\s*[\r\n]+\s*/g, ' ');
