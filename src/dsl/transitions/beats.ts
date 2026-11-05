// <Beats>: beats in a row with transitions between them, each transition timed from the boundary of the beats it
// joins. Every <Beat> becomes a named <Sequence> (a scene marker, so ripple edits work); the next beat starts when
// the previous one's transition starts (overlap kinds: the beats overlap by the transition's length) or at the cut
// (cut kinds). Changing a beat's duration moves every later beat and transition with it on rebuild, and in AE the
// transition layers sit at the boundary and move with ripple edits.
//
//   <Beats>
//     <Beat name="Hook" duration={3}>…</Beat>
//     <ShapeWipe id="wipe" shape={bar} duration={0.7} />
//     <Beat name="Build" duration={3.5}>…</Beat>
//   </Beats>
import { Fragment, childrenOf, isElement, jsx } from '../jsx-runtime.ts';
import { Sequence } from '../primitives.ts';
import { dslWarn } from '../warn.ts';
import type { Time } from '@ae-mcp/core/units.ts';
import { compInfo, expand, sec, withProps } from './core.ts';
import type { El, TransitionDef, TransitionIO } from './core.ts';

export interface BeatProps {
  /** Scene name (a comp marker spanning the beat; the ripple handle). */
  name: string;
  /** On-screen length, including the overlap with the transitions on either side. */
  duration: Time;
  children?: any;
}
/** One beat of a <Beats> row. */
export function Beat(_p: BeatProps): El {
  throw new Error('<Beat> must be a direct child of <Beats>');
}
(Beat as any).aecBeat = true;

export interface BeatsProps {
  /** Start of the first beat (relative to the enclosing Sequence). */
  from?: Time;
  children?: any;
}

interface BeatInfo { name: string; start: number; dur: number; content: El[] }
interface TrInfo { def: TransitionDef; props: any; d: number; window: number }

/** Flattens children; user components that return beats or transitions are called. */
function items(children: any): El[] {
  const out: El[] = [];
  for (const c of childrenOf(children)) {
    if (typeof c === 'string') { if (c.trim()) dslWarn(`<Beats>: stray text "${c.trim().slice(0, 30)}" ignored`); continue; }
    const t: any = c.type;
    if (typeof t === 'function' && !t.aec && !t.aecBeat && !t.transition) { out.push(...items(t({ ...c.props }))); continue; }
    out.push(c);
  }
  return out;
}

/** Beat starts/ends and transition windows (seconds), without building anything. */
export function beatTimeline(p: BeatsProps): { beats: { name: string; start: number; end: number }[]; transitions: { kind: string; id: string; at: number; duration: number }[]; end: number } {
  const r = plan(p);
  return { beats: r.beats.map((b) => ({ name: b.name, start: b.start, end: b.start + b.dur })), transitions: r.trs.flat().map((t) => ({ kind: t.def.kind, id: t.props.id, at: t.window, duration: t.d })), end: r.beats.length ? Math.max(...r.beats.map((b) => b.start + b.dur)) : sec(p.from, compInfo().fps, 0) };
}

function plan(p: BeatsProps): { beats: BeatInfo[]; trs: TrInfo[][] } {
  const { fps } = compInfo();
  const beats: BeatInfo[] = [];
  const trs: TrInfo[][] = [];
  let pending: TrInfo[] = [];
  for (const c of items(p.children)) {
    const t: any = c.type;
    if (t?.aecBeat) {
      if (!c.props.name) throw new Error('<Beat> needs a name (it becomes the scene marker)');
      if (c.props.duration === undefined) throw new Error(`<Beat name="${c.props.name}"> needs a duration`);
      const dur = sec(c.props.duration, fps);
      let start: number;
      if (!beats.length) {
        if (pending.length) throw new Error('<Beats>: a transition comes before the first <Beat>');
        start = sec(p.from, fps, 0);
      } else {
        const prev = beats[beats.length - 1], end = prev.start + prev.dur;
        const overlap = Math.max(0, ...pending.map((x) => (x.def.cut === undefined ? x.d : 0)));
        start = end - overlap;
        if (overlap > prev.dur + 1e-9 || overlap > dur + 1e-9) throw new Error(`<Beats>: the transition into "${c.props.name}" (${overlap} s) is longer than a beat it joins`);
        for (const x of pending) x.window = start - (x.def.cut ?? 0) * x.d;
      }
      if (beats.length) trs.push(pending);
      pending = [];
      beats.push({ name: c.props.name, start, dur, content: expand(c.props.children) });
      continue;
    }
    if (t?.transition) {
      const def: TransitionDef = t.transition;
      if (!c.props.id) throw new Error(`<${t.displayName ?? def.label}> inside <Beats> needs an id`);
      if (c.props.at !== undefined) dslWarn(`<${t.displayName ?? def.label} id="${c.props.id}">: at= is ignored inside <Beats> (the beat boundary sets it)`);
      pending.push({ def, props: c.props, d: sec(c.props.duration, fps, def.defaultDuration), window: 0 });
      continue;
    }
    throw new Error(`<Beats> children must be <Beat> or transitions (ShapeWipe, HandOff, …); got <${t?.displayName ?? t?.aec ?? typeof t}>. Put shared layers outside <Beats>.`);
  }
  if (pending.length) throw new Error('<Beats>: a transition after the last <Beat> has nothing to lead into');
  return { beats, trs };
}

/** Beats in a row joined by transitions (see the module comment). */
export function Beats(p: BeatsProps): El {
  const { w, h, fps } = compInfo();
  const { beats, trs } = plan(p);
  const under: El[][] = [], over: El[][] = [];
  const adopted = new Map<string, string>();
  const adopt = (carrier: string, parent: string) => {
    const was = adopted.get(carrier);
    if (was && was !== parent) dslWarn(`<Beats>: carrier ${carrier} is already following ${was}; ${parent} is ignored`);
    else adopted.set(carrier, parent);
  };
  for (let i = 0; i < trs.length; i++) {
    const A = beats[i], B = beats[i + 1];
    under.push([]); over.push([]);
    for (const t of trs[i]) {
      const io: TransitionIO = {
        outgoing: A.content, incoming: B.content, outAt: t.window - A.start, inAt: t.window - B.start,
        before: t.window - A.start, after: B.start + B.dur - t.window, dur: t.d, w: t.props.size?.[0] ?? w, h: t.props.size?.[1] ?? h, fps, adopt,
      };
      const r = t.def.build(t.props, io);
      A.content = r.outgoing;
      B.content = r.incoming;
      if (r.under.length) under[i].push(jsx(Sequence, { from: t.window, children: r.under }));
      if (r.over?.length) over[i].push(jsx(Sequence, { from: t.window, children: r.over }));
    }
  }
  // Carriers adopted by later transitions (they live in the earlier transitions' layer lists).
  if (adopted.size) {
    const fix = (els: El[]) => els.map((s) => withProps(s, { children: childrenOf(s.props.children).map((c: any) => (isElement(c) && adopted.has(c.props.id) ? withProps(c, { parent: adopted.get(c.props.id) }) : c)) }));
    for (let i = 0; i < under.length; i++) { under[i] = fix(under[i]); over[i] = fix(over[i]); }
  }
  const out: El[] = [];
  beats.forEach((b, i) => {
    if (i > 0) out.push(...under[i - 1]);
    out.push(jsx(Sequence, { name: b.name, from: b.start, duration: b.dur, children: b.content }));
    if (i > 0) out.push(...over[i - 1]);
  });
  return jsx(Fragment, { children: out });
}
(Beats as any).displayName = 'Beats';

export const isBeat = (el: any) => isElement(el) && !!(el.type as any)?.aecBeat;
