// Plan checks (pure): the direction rules of skills/ae-compose/SKILL.md §2 and §6 run on a beat sheet and its
// planned timeline, before any TSX detail exists. Reading time per text, the final hold, a hook in the first
// second, one purpose and one idea per beat, transitions that differ from the last one, 0.2–0.4 s overlaps, no
// slide furniture, pacing contrast. Each issue names the beat and says what to change.
import type { BeatSheet, PlanBeat, PlanElement, PlanIssue, PlanTimeline } from './types.ts';
import { HARD_CUTS, TRANSITION_KINDS } from './types.ts';
import { clip, textsOf, words } from './timing.ts';

const EPS = 1e-6;
const s1 = (x: number) => `${(Math.round(x * 10) / 10).toFixed(1)} s`;
const r1 = (x: number) => Math.ceil(x * 10 - 1e-6) / 10;

/** Text that reads as slide furniture: page numbers, section labels, agenda words. */
const FURNITURE = [
  /^\s*\d{1,2}\s*[/|·.:-]\s*\d{1,2}\s*$/, // 01 / 04, 2|5
  /^\s*0\d\s*$/, // 01
  /^\s*(chapter|section|part|step|scene|beat|slide|act)\s*[\d.ivx]*\s*[:.\-–—]?\s*\S{0,3}\s*$/i, // "Section 2", "Step 1:"
  /^\s*(intro|introduction|agenda|overview|summary|recap|conclusion|outro|the end|thank you|thanks|questions\??|q\s*&\s*a)\s*[.!]?\s*$/i,
];

export function isFurniture(text: string, beatName: string): boolean {
  const t = text.trim();
  return FURNITURE.some((re) => re.test(t)) || t.toLowerCase() === beatName.trim().toLowerCase();
}

const textEls = (b: PlanBeat) => b.elements.filter((e) => e.role === 'title' || e.role === 'sub' || e.role === 'cta');
const hold = (e: PlanElement) => e.readable[1] - e.readable[0];

export function checkPlan(sheet: BeatSheet, tl: PlanTimeline): PlanIssue[] {
  const out: PlanIssue[] = [];
  const beats = tl.beats;
  const sheetBeat = (b: PlanBeat) => (b.endCard ? undefined : sheet.beats.find((x) => x.name === b.name));

  // One purpose and some content per beat; unique names (they are ripple targets).
  const seen = new Map<string, number>();
  for (const b of beats) {
    if (b.endCard) continue;
    const sb = sheetBeat(b);
    if (!sb?.purpose || !String(sb.purpose).trim())
      out.push({ rule: 'purpose', severity: 'warn', beat: b.name, t: [b.start, b.end], message: `beat "${b.name}" has no purpose: say what the viewer learns or feels here ("what does the viewer get now?"), or cut the beat` });
    if (b.layout === 'empty')
      out.push({ rule: 'empty-beat', severity: 'warn', beat: b.name, t: [b.start, b.end], message: `beat "${b.name}" shows nothing (no text, no visual): give it the element that carries its purpose, or cut it` });
    const k = b.name.trim().toLowerCase();
    seen.set(k, (seen.get(k) ?? 0) + 1);
    if (seen.get(k) === 2) out.push({ rule: 'duplicate-beat', severity: 'warn', beat: b.name, message: `two beats are named "${b.name}": scene names are ripple targets in AE, so make each one unique` });
  }

  // Hook: something registers in the first second.
  const first = beats[0];
  if (first) {
    if (first.layout === 'empty' || !first.elements.length)
      out.push({ rule: 'hook', severity: 'warn', beat: first.name, t: [0, Math.min(1, first.end)], message: `nothing is on screen in the first second: open on the hook (a short, bold line or the hero visual arriving by 1 s)` });
    else {
      const startAt = Math.min(...first.elements.map((e) => e.arrive[0]));
      const lead = first.elements.find((e) => e.role === 'title') ?? first.elements[0];
      if (startAt > 1 + EPS)
        out.push({ rule: 'hook', severity: 'warn', beat: first.name, t: [0, startAt], message: `the first element only starts at ${s1(startAt)}: the hook must register within 1 s` });
      else if (lead.role === 'title' && lead.arrive[1] > 1.2 + EPS)
        out.push({ rule: 'hook', severity: 'info', beat: first.name, t: [lead.arrive[0], lead.arrive[1]], message: `the hook "${clip(lead.text ?? '')}" takes ${s1(lead.arrive[1])} to land (${lead.words} words): keep the opening line to 1–4 punchy words so it registers in the first second, and put the detail in the next beat` });
    }
    if (first.duration < 1 - EPS)
      out.push({ rule: 'hook', severity: 'warn', beat: first.name, t: [first.start, first.end], message: `the opening beat lasts ${s1(first.duration)}: a hook needs 1–2 s to land` });
    if (sheet.beats[0]?.transitionIn)
      out.push({ rule: 'transition-kind', severity: 'info', beat: first.name, message: `the first beat has no beat before it, so transitionIn "${sheet.beats[0].transitionIn}" is ignored: open on the hook` });
  }

  // Reading time per text, and requested holds.
  for (const b of beats) {
    for (const e of textEls(b)) {
      const h = hold(e);
      if (h + EPS >= e.needs) continue;
      const fix = b.endCard ? `raise end.hold (the end card grows to fit)` : `make the beat at least ${s1(r1(b.duration + e.needs - h))} (now ${s1(b.duration)})${e.words && e.words > 6 ? ', or cut words' : ''}`;
      out.push({ rule: 'reading-time', severity: 'warn', beat: b.name, t: [e.readable[0], e.readable[1]],
        message: `beat "${b.name}": ${e.role === 'sub' ? 'the line' : e.role === 'cta' ? 'the CTA' : 'the headline'} "${clip(e.text ?? '')}" (${e.words} word${e.words === 1 ? '' : 's'}) is readable for ${s1(Math.max(0, h))} (lands ${s1(e.readable[0])}, ${b.exits ? 'exits' : 'cut'} ${s1(e.readable[1])}) but needs ${s1(e.needs)}: ${fix}` });
    }
    const sb = sheetBeat(b);
    if (sb?.hold !== undefined && b.elements.length) {
      const landed = Math.max(...b.elements.map((e) => e.arrive[1]));
      const end = Math.min(...b.elements.map((e) => e.readable[1]));
      const avail = end - landed;
      if (avail + EPS < sb.hold)
        out.push({ rule: 'hold', severity: 'warn', beat: b.name, t: [landed, end], message: `beat "${b.name}" asks for a ${s1(sb.hold)} hold but only has ${s1(Math.max(0, avail))} after everything lands at ${s1(landed)}: make it ${s1(r1(b.duration + sb.hold - avail))}` });
      const need = Math.max(0, ...textEls(b).map((e) => e.needs));
      if (sb.hold + EPS < need)
        out.push({ rule: 'hold', severity: 'warn', beat: b.name, message: `beat "${b.name}" asks for a ${s1(sb.hold)} hold, shorter than the ${s1(need)} its copy needs to be read` });
    }
  }

  // Final hold: the end state stays still for at least 2 s.
  const last = beats[beats.length - 1];
  if (last) {
    if (last.endCard) {
      const h = sheet.end?.hold ?? 2.5;
      if (h + EPS < 2) out.push({ rule: 'final-hold', severity: 'warn', beat: last.name, t: [last.end - h, last.end], message: `the end card holds ${s1(h)} after it lands: hold the logo/CTA at least 2 s (end.hold ≥ 2)` });
    } else if (last.elements.length) {
      const settle = Math.max(...last.elements.map((e) => e.arrive[1]));
      const h = last.end - settle;
      if (h + EPS < 2) out.push({ rule: 'final-hold', severity: 'warn', beat: last.name, t: [settle, last.end], message: `the final state holds ${s1(Math.max(0, h))} (everything lands at ${s1(settle)}, the piece ends at ${s1(last.end)}): hold the end frame at least 2 s; make "${last.name}" ${s1(r1(last.duration + 2 - h))}, or add an end card` });
    }
  }

  // Transitions: known kinds, never the same twice in a row, overlaps of 0.2–0.4 s.
  const known = new Set<string>(TRANSITION_KINDS);
  for (let i = 1; i < beats.length; i++) {
    const b = beats[i], prev = beats[i - 1];
    const kind = b.transitionIn;
    if (kind && !known.has(kind))
      out.push({ rule: 'transition-kind', severity: 'info', beat: b.name, message: `transition "${kind}" into "${b.name}" is not a known kind (${TRANSITION_KINDS.join(', ')}): the scaffold uses a generic wipe placeholder` });
    if (!kind)
      out.push({ rule: 'transition-kind', severity: 'info', beat: b.name, t: [b.start, prev.end], message: `"${prev.name}" → "${b.name}" has no transitionIn: the beats only exit and enter across the overlap; consider a transition that grows out of "${prev.name}" (a hand-off of one of its elements, or a wipe with a shape from it)` });
    if (kind && i >= 2 && beats[i - 1].transitionIn === kind)
      out.push({ rule: 'transition-repeat', severity: kind === 'cut' ? 'info' : 'warn', beat: b.name, t: [beats[i - 1].start, b.start + b.overlap],
        message: `"${kind}" is used twice in a row (into "${prev.name}" and into "${b.name}"): make each transition different from the last, and only use one the content motivates` });
    const ov = b.overlap;
    const hard = HARD_CUTS.includes(kind ?? '');
    if (ov < -EPS)
      out.push({ rule: 'overlap', severity: 'warn', beat: b.name, t: [prev.end, b.start], message: `"${b.name}" starts ${s1(-ov)} after "${prev.name}" ends: that gap is dead air; overlap the beats by 0.2–0.4 s so one hands off to the next` });
    else if (hard && ov > EPS)
      out.push({ rule: 'overlap', severity: 'info', beat: b.name, message: `a ${kind} into "${b.name}" happens on the frame: it needs no overlap (${s1(ov)} given; use 0)` });
    else if (!hard && (ov < 0.2 - EPS || ov > 0.4 + EPS))
      out.push({ rule: 'overlap', severity: 'warn', beat: b.name, t: [b.start, b.start + Math.max(0, ov)], message: `"${prev.name}" → "${b.name}" overlaps ${s1(ov)}: overlap beats by 0.2–0.4 s so the transition is one continuous movement${ov > 0.4 ? ' (longer overlaps put two ideas on screen at once)' : ', not a gap or a jump'}` });
    if (ov > Math.min(b.duration, prev.duration) / 2 + EPS)
      out.push({ rule: 'overlap', severity: 'warn', beat: b.name, message: `the ${s1(ov)} overlap into "${b.name}" is more than half a beat: the two beats compete; shorten it to 0.2–0.4 s` });
  }

  // One idea per beat; no slide furniture.
  for (const b of beats) {
    if (b.endCard) continue;
    const sb = sheetBeat(b);
    const texts = sb ? textsOf(sb) : [];
    if (texts.length > 2)
      out.push({ rule: 'one-idea', severity: 'info', beat: b.name, message: `beat "${b.name}" carries ${texts.length} lines: one idea per beat; split the extra lines into their own beat or cut them` });
    if (texts[0] && words(texts[0]) > 10)
      out.push({ rule: 'one-idea', severity: 'info', beat: b.name, message: `beat "${b.name}": the headline has ${words(texts[0])} words, a paragraph rather than a beat: say it in ≤ 8 words and show the rest` });
    for (const t of texts)
      if (isFurniture(t, b.name))
        out.push({ rule: 'slide-furniture', severity: 'warn', beat: b.name, message: `beat "${b.name}": "${clip(t)}" reads as slide furniture (a section label or page number): text on screen carries the beat's message, so replace it with what the viewer should get` });
  }
  const end = sheet.end?.text;
  if (end && isFurniture(end, 'End Card'))
    out.push({ rule: 'slide-furniture', severity: 'warn', beat: 'End Card', message: `the end card says "${clip(end)}": end on the message or a call to action, not a sign-off slide` });

  // Pacing contrast: an energetic hook, calmer holds where the message lands.
  const body = beats.filter((b) => !b.endCard);
  if (body.length >= 3) {
    const ds = body.map((b) => b.duration);
    if (Math.max(...ds) <= Math.min(...ds) * 1.08 + EPS)
      out.push({ rule: 'pacing', severity: 'info', message: `all ${body.length} beats last about ${s1(ds[0])}: pace with contrast (a quick hook, longer holds where the message has to land)` });
  }
  return out;
}
