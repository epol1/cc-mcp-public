// uiSteps (K1): an interaction script as a list of timed steps ("move here, click Buy, type the email, open the
// modal, pick tab 2") → one flow object holding the cursor's path, clicks and drags, and every component's state
// times. <Cursor flow={flow} /> draws the path; each component given `flow` reads its own events by its id, and
// turns them into layer markers, so retiming a marker in AE retimes that state.
import type { EasingSpec } from '../../shared/easing.ts';

export type UiPoint = [number, number];

/** State times for one component (all seconds, relative to the Sequence/precomp holding the cursor and components). */
export interface UiEvents {
  /** Clicks (Button: press; Toggle/Checkbox: flip; Input: focus). */
  clickAt?: number[];
  /** Hover windows [start, end] (end = start means until the layer ends). */
  hover?: [number, number][];
  /** Tabs: select tab `index` (0-based) at `t`. */
  selectAt?: { t: number; index: number }[];
  /** Input: start typing. */
  typeAt?: number[];
  /** Slider: drag windows. */
  dragging?: [number, number][];
  /** Slider/ProgressBar: value keys (v null = the value it has at that moment). */
  valueAt?: { t: number; v: number | null }[];
  /** ScrollView: scroll to stop `stop` arriving at `t` (over `duration`). */
  scrollAt?: { t: number; stop: number; duration?: number }[];
  /** Toast/Modal/Tooltip: shown during [start, end] (end = start: until the layer ends). */
  show?: [number, number][];
}

export interface UiStep {
  /** When this step happens (s). Moves arrive at `at`; clicks happen at `at` (the cursor settles just before). */
  at: number;
  /** Move the cursor to a point or a named target. Hovers the target until the cursor moves on. */
  cursor?: UiPoint | string;
  /** Click a target (component id: its position comes from `targets`) or a point. */
  click?: string | UiPoint;
  /** Where to click when `click` names a component without a target position, or to override it. */
  point?: UiPoint;
  /** Tabs: the tab index the click selects. */
  index?: number;
  /** Move onto a target and hover it until the next move. */
  hover?: string | UiPoint;
  /** Drag the component `drag` from the cursor's position to `to` over `duration` (default 0.8 s). */
  drag?: string;
  to?: UiPoint | string;
  /** Slider value at the end of the drag (0–100). */
  value?: number;
  duration?: number;
  /** Start typing into this Input. */
  type?: string;
  /** Scroll this ScrollView to stop `stop` (arriving at `at`, over `duration`, default 0.8 s). */
  scroll?: string;
  stop?: number;
  /** Show a Toast/Modal/Tooltip (for `hold` s, or until a `hide` step). */
  show?: string;
  hold?: number;
  /** Hide a Toast/Modal/Tooltip shown earlier. */
  hide?: string;
  /** Name this moment: flow.cue('name'). */
  cue?: string;
  /** Move duration override (s) and easing. */
  move?: number;
  easing?: EasingSpec;
}

/** One cursor arrival: at `p` at `t`, leaving the previous point at `from` (holding until then). */
export interface CursorWaypoint { t: number; p: UiPoint; from?: number; easing?: EasingSpec }
export interface CursorEvents {
  path: CursorWaypoint[];
  clicks: { t: number; target?: string }[];
  /** Mouse held down (drags). */
  presses: { t: number; duration: number; target?: string }[];
}

export interface UiFlow {
  /** Props for <Cursor flow={flow} /> (path, clicks, presses). */
  cursor: CursorEvents;
  /** A component's events by id ({} when none). */
  on(target: string): UiEvents;
  /** Time of a named step (cue: 'open'). */
  cue(name: string): number;
  /** Time of the last event. */
  end: number;
  /** Target positions this flow knows. */
  targets: Record<string, UiPoint>;
  /** The same flow shifted by dt seconds (for components in a precomp that starts later). */
  shift(dt: number): UiFlow;
}

export interface UiStepsOptions {
  /** Component positions by id (the same points you give their `position`), so steps can name them. */
  targets?: Record<string, UiPoint>;
  /** Where the cursor starts (shown from `startAt`, default 0). Default: the first step's point. */
  start?: UiPoint | string;
  startAt?: number;
  /** How long the cursor rests on a target before a click (default 0.12 s). */
  settle?: number;
  /** Easing of moves (default easeInOutCubic: a move between two rests). */
  easing?: EasingSpec;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * const flow = uiSteps([
 *   { at: 0.8, click: 'email' }, { at: 1.0, type: 'email' },
 *   { at: 2.4, hover: 'agree' }, { at: 2.8, click: 'agree' },
 *   { at: 3.5, click: 'signup' }, { at: 3.8, show: 'toast', hold: 2.4 },
 * ], { targets: { email: [640, 300], agree: [520, 380], signup: [640, 450] } });
 * <Cursor id="cursor" flow={flow} />  <Input id="email" position={[640, 300]} flow={flow} …/>
 */
export function uiSteps(steps: UiStep[], opts: UiStepsOptions = {}): UiFlow {
  const targets = opts.targets ?? {};
  const settle = opts.settle ?? 0.12;
  const pt = (x: UiPoint | string, why: string): UiPoint => {
    if (typeof x !== 'string') return [x[0], x[1]];
    const p = targets[x];
    if (!p) throw new Error(`uiSteps: ${why} "${x}" has no position; add it to targets ({ targets: { ${x}: [x, y] } }) or give a point (known: ${Object.keys(targets).join(', ') || 'none'})`);
    return [p[0], p[1]];
  };
  const ev = new Map<string, UiEvents>();
  const E = (id: string) => { let e = ev.get(id); if (!e) { e = {}; ev.set(id, e); } return e; };
  const cues = new Map<string, number>();
  const path: CursorWaypoint[] = [];
  const clicks: CursorEvents['clicks'] = [];
  const presses: CursorEvents['presses'] = [];
  let cur: UiPoint | undefined, curT = opts.startAt ?? 0, end = 0;
  let hovering: { id: string; w: [number, number]; list: [number, number][] } | null = null;
  const shows = new Map<string, [number, number]>();
  if (opts.start !== undefined) { cur = pt(opts.start, 'start'); path.push({ t: curT, p: cur }); }

  // An open hover window ends when the cursor moves away (a zero-length one is dropped: [t, t] means "until the end").
  const leave = (t: number) => {
    if (!hovering) return;
    if (t - hovering.w[0] < 1e-3) hovering.list.splice(hovering.list.indexOf(hovering.w), 1);
    else hovering.w[1] = r3(t);
    hovering = null;
  };
  const hoverOn = (id: string | undefined, t: number) => {
    if (!id || (hovering && hovering.id === id)) return;
    leave(t);
    const w: [number, number] = [r3(t), r3(t)];
    const list = (E(id).hover ??= []);
    list.push(w);
    hovering = { id, w, list };
  };
  const moveTo = (p: UiPoint, arrive: number, s: UiStep, easing?: EasingSpec, dur?: number) => {
    if (!cur) { path.push({ t: r3(arrive), p }); cur = p; curT = arrive; return; }
    if (Math.abs(p[0] - cur[0]) < 0.5 && Math.abs(p[1] - cur[1]) < 0.5) return;
    const dist = Math.hypot(p[0] - cur[0], p[1] - cur[1]);
    const d = dur ?? s.move ?? Math.min(0.9, Math.max(0.35, 0.32 + dist / 2200));
    if (arrive < curT) throw new Error(`uiSteps: step at ${s.at}s moves the cursor before it arrived at its previous point (${r3(curT)}s); order the steps by time`);
    const from = Math.max(curT, arrive - d);
    leave(from);
    path.push({ t: r3(arrive), p, from: r3(from), easing: easing ?? s.easing ?? opts.easing ?? 'easeInOutCubic' });
    cur = p; curT = arrive;
  };

  const sorted = steps.map((s, i) => ({ s, i })).sort((a, b) => a.s.at - b.s.at || a.i - b.i).map((x) => x.s);
  for (const s of sorted) {
    const t = s.at;
    if (typeof t !== 'number' || !Number.isFinite(t)) throw new Error(`uiSteps: every step needs a numeric \`at\` (seconds), got ${JSON.stringify(s)}`);
    end = Math.max(end, t);
    if (s.cursor !== undefined) { moveTo(pt(s.cursor, 'cursor target'), t, s); if (typeof s.cursor === 'string') hoverOn(s.cursor, t); }
    if (s.hover !== undefined) { moveTo(pt(s.hover, 'hover target'), t, s); if (typeof s.hover === 'string') hoverOn(s.hover, t); }
    if (s.click !== undefined) {
      const id = typeof s.click === 'string' ? s.click : undefined;
      const p = s.point ?? (id && !targets[id] && cur ? cur : pt(s.click, 'click target'));
      moveTo(p, t - settle, s);
      hoverOn(id, Math.min(t - settle, t));
      clicks.push({ t: r3(t), target: id });
      if (id) {
        (E(id).clickAt ??= []).push(r3(t));
        if (s.index !== undefined) (E(id).selectAt ??= []).push({ t: r3(t), index: s.index });
      }
    }
    if (s.drag !== undefined) {
      const dur = s.duration ?? 0.8;
      if (!cur) throw new Error(`uiSteps: drag "${s.drag}" at ${t}s: move the cursor onto the handle first (a cursor/hover step, or opts.start)`);
      if (s.to === undefined) throw new Error(`uiSteps: drag "${s.drag}" needs \`to\` (a point or target)`);
      presses.push({ t: r3(t), duration: r3(dur), target: s.drag });
      if (curT > t) throw new Error(`uiSteps: drag "${s.drag}" at ${t}s starts before the cursor arrives (${r3(curT)}s)`);
      curT = t;
      moveTo(pt(s.to, 'drag target'), t + dur, s, s.easing ?? 'easeInOutCubic', dur);
      const e = E(s.drag);
      (e.dragging ??= []).push([r3(t), r3(t + dur)]);
      if (s.value !== undefined) (e.valueAt ??= []).push({ t: r3(t), v: null }, { t: r3(t + dur), v: s.value });
      end = Math.max(end, t + dur);
    }
    if (s.type !== undefined) (E(s.type).typeAt ??= []).push(r3(t));
    if (s.scroll !== undefined) (E(s.scroll).scrollAt ??= []).push({ t: r3(t), stop: s.stop ?? 1, duration: s.duration });
    if (s.hide !== undefined) {
      const w = shows.get(s.hide);
      if (!w) throw new Error(`uiSteps: hide "${s.hide}" at ${t}s, but it isn't shown (add a { show: '${s.hide}' } step before)`);
      w[1] = r3(t); shows.delete(s.hide);
    }
    if (s.show !== undefined) {
      const w: [number, number] = [r3(t), s.hold !== undefined ? r3(t + s.hold) : r3(t)];
      (E(s.show).show ??= []).push(w);
      if (s.hold === undefined) shows.set(s.show, w); else end = Math.max(end, t + s.hold);
    }
    if (s.cue !== undefined) cues.set(s.cue, t);
  }
  return makeFlow({ path, clicks, presses }, ev, cues, end, targets);
}

function makeFlow(cursor: CursorEvents, ev: Map<string, UiEvents>, cues: Map<string, number>, end: number, targets: Record<string, UiPoint>): UiFlow {
  const flow: UiFlow = {
    cursor,
    on: (id) => clone(ev.get(id) ?? {}),
    cue: (name) => { const t = cues.get(name); if (t === undefined) throw new Error(`uiSteps: no cue "${name}" (cues: ${[...cues.keys()].join(', ') || 'none'})`); return t; },
    end,
    targets,
    shift: (dt) => {
      const sh = (t: number) => r3(t + dt);
      const w = (x: [number, number]): [number, number] => [sh(x[0]), x[1] === x[0] ? sh(x[0]) : sh(x[1])];
      const ev2 = new Map<string, UiEvents>();
      for (const [k, e] of ev) ev2.set(k, {
        clickAt: e.clickAt?.map(sh), hover: e.hover?.map(w), selectAt: e.selectAt?.map((x) => ({ ...x, t: sh(x.t) })), typeAt: e.typeAt?.map(sh),
        dragging: e.dragging?.map(w), valueAt: e.valueAt?.map((x) => ({ ...x, t: sh(x.t) })), scrollAt: e.scrollAt?.map((x) => ({ ...x, t: sh(x.t) })), show: e.show?.map(w),
      });
      for (const e of ev2.values()) for (const k of Object.keys(e) as (keyof UiEvents)[]) if (e[k] === undefined) delete e[k];
      const c2: CursorEvents = {
        path: cursor.path.map((p) => ({ ...p, t: sh(p.t), from: p.from !== undefined ? sh(p.from) : undefined })),
        clicks: cursor.clicks.map((c) => ({ ...c, t: sh(c.t) })),
        presses: cursor.presses.map((c) => ({ ...c, t: sh(c.t) })),
      };
      return makeFlow(c2, ev2, new Map([...cues].map(([k, v]) => [k, v + dt])), end + dt, targets);
    },
  };
  return flow;
}

const clone = (e: UiEvents): UiEvents => JSON.parse(JSON.stringify(e));
