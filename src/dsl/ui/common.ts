// UI kit shared pieces: the base props every component takes, absolute placement on the layout engine, entrance/
// exit keys, layer markers for state times, the marker-reading expressions that turn those markers into 0–1 state
// curves (press, hover, toggle, show), and a text width estimate for sizing backgrounds at build time.
import { jsx } from '../jsx-runtime.ts';
import type { AecElement } from '../jsx-runtime.ts';
import { Align, Box, Overlay, Stack } from '../layout.ts';
import { seq, tween } from '../anim.ts';
import type { Anim } from '../anim.ts';
import { approxWidth } from '../../text/measure.ts';
import type { ThemeInput, UiTheme } from './theme.ts';
import { uiTheme } from './theme.ts';
import type { UiEvents, UiFlow } from './steps.ts';

/** Props every UI component takes. */
export interface UiBase {
  /** Required: prefixes every layer id of the component (ids are scene-global, so two instances never collide). */
  id: string;
  /** Layer name prefix (default: "<Kind> <id>"). */
  name?: string;
  /** 'dark' (default), 'light', or overrides ({ base: 'light', accent: '#ff5a00', scale: 2 }). */
  theme?: ThemeInput;
  /** Absolute centre in comp (or screen) px. Omit inside layout containers (Stack, Grid, Card…), which place it. */
  position?: [number, number];
  /** Entrance at this time (s): rises 14 px and fades in (easeOutQuint). */
  enterAt?: number;
  /** Exit at this time (s): fades out and settles to 97 % (easeInCubic). */
  exitAt?: number;
  /** Events from uiSteps(): the component reads its own (clicks, hovers, typing…) by its id. */
  flow?: UiFlow;
  /** Layer timing inside the Sequence. */
  from?: number;
  duration?: number;
}

export interface Resolved { t: UiTheme; s: number; name: string }

/** Theme, metric scale and layer-name prefix for a component. */
export function resolve(p: UiBase, kind: string): Resolved {
  if (!p.id) throw new Error(`<${kind}> needs an id (it prefixes the layer ids; ids are scene-global)`);
  const t = uiTheme(p.theme);
  return { t, s: t.scale, name: p.name ?? `${kind} ${p.id}` };
}

/** Events for this component: uiSteps flow events (by id), overridden by explicit props. */
export function events(p: UiBase & Partial<UiEvents>): UiEvents {
  const f = p.flow ? p.flow.on(p.id) : {};
  const out: any = { ...f };
  for (const k of ['clickAt', 'hover', 'selectAt', 'typeAt', 'dragging', 'valueAt', 'scrollAt', 'show'] as const) if ((p as any)[k] !== undefined) out[k] = (p as any)[k];
  return out;
}

/**
 * Absolute placement on the layout engine: an Align that fills the area with a zero-size box at `position`, so the
 * component's layers are centred on that point with real AE metrics. Without `position` the content is returned
 * as is (a layout leaf/overlay inside containers, or centred in the comp at the top level).
 */
export function place(position: [number, number] | undefined, content: AecElement): AecElement {
  if (!position) return content;
  return jsx(Align, { at: 'topLeft', children: jsx(Box, { width: 0, height: 0, offset: [position[0], position[1]], children: content }) });
}

/** Layers sharing one slot (centred on each other). */
export const overlay = (children: any[]) => jsx(Overlay, { children });
/** A row/column of parts. */
export const row = (children: any[], gap: number, align: 'start' | 'center' | 'end' = 'center') => jsx(Stack, { direction: 'row', gap, align, children });
export const column = (children: any[], gap: number, align: 'start' | 'center' | 'end' = 'start') => jsx(Stack, { direction: 'column', gap, align, children });

/** Entrance/exit animation props for one layer (opacity + rise; exit settles scale). */
export function motion(p: { enterAt?: number; exitAt?: number }, s = 1): { animate?: Record<string, Anim> } {
  const a: Record<string, Anim> = {};
  const IN = 0.35, OUT = 0.25;
  if (p.enterAt !== undefined) {
    a.y = tween({ from: Math.round(14 * s), duration: 0.55, delay: p.enterAt, easing: 'easeOutQuint' });
    a.opacity = p.exitAt !== undefined
      ? seq(tween({ from: 0, to: 100, duration: IN, delay: p.enterAt, easing: 'easeOutCubic' }), tween({ to: 0, duration: OUT, delay: Math.max(0, p.exitAt - p.enterAt - IN), easing: 'easeInCubic' }))
      : tween({ from: 0, to: 100, duration: IN, delay: p.enterAt, easing: 'easeOutCubic' });
  } else if (p.exitAt !== undefined) a.opacity = tween({ from: 100, to: 0, duration: OUT, delay: p.exitAt, easing: 'easeInCubic' });
  if (p.exitAt !== undefined) a.scale = tween({ from: 100, to: 97, duration: OUT, delay: p.exitAt, easing: 'easeInCubic' });
  return Object.keys(a).length ? { animate: a } : {};
}

/** Layer timing props. With `from`, state markers stay on the flow's (Sequence-relative) times. */
export const timing = (p: UiBase) => ({ ...(p.from !== undefined ? { from: p.from, markerBase: 'sequence' as const } : {}), ...(p.duration !== undefined ? { duration: p.duration } : {}) });

export type Marker = { t: number; comment: string; duration?: number };
/** Point markers. */
export const at = (times: number[] | undefined, comment: string): Marker[] => (times ?? []).map((t) => ({ t, comment }));
/** Window markers ([start, end] → a marker with a duration). */
export const windows = (w: [number, number][] | undefined, comment: string): Marker[] => (w ?? []).map(([a, b]) => ({ t: a, comment, duration: Math.round(Math.max(0, b - a) * 1000) / 1000 }));

/** Approximate rendered width of `text` in Inter at `size` px (Helvetica advances, +6 % for Inter; bolder +3 %). */
export function textWidth(text: string, size: number, weight: 'regular' | 'medium' | 'semibold' | 'bold' = 'regular'): number {
  const k = { regular: 1.06, medium: 1.08, semibold: 1.1, bold: 1.12 }[weight];
  return Math.ceil(approxWidth(text, size) * k);
}

/** Rounds to 0.5 px. */
export const px = (v: number) => Math.round(v * 2) / 2;

const fpsRef = '1 / thisComp.frameDuration';

/** Collects marker times (and durations) whose comment starts with one of `prefixes` on layer `src` (default this layer). */
export function scan(prefixes: string | string[], src = 'thisLayer'): string[] {
  const list = Array.isArray(prefixes) ? prefixes : [prefixes];
  const test = list.map((x) => `m.comment.indexOf(${JSON.stringify(x)}) == 0`).join(' || ');
  return [`var M = ${src}.marker, T = [], D = [];`, `for (var k = 1; k <= M.numKeys; k++) { var m = M.key(k); if (${test}) { T.push(m.time); D.push(m.duration); } }`];
}

/**
 * 0–1 press amount from "press…" markers: down in 90 ms, held for the marker's duration (a drag), released with a
 * spring (slight overshoot). Retime by dragging the markers.
 */
export function pressExpr(prefix: string | string[] = 'press'): string {
  return [
    `// ae-compose ui: press amount (0–1) from this layer's "${([] as string[]).concat(prefix).join('"/"')}" markers; drag a marker to retime it`,
    ...scan(prefix),
    'var j = -1; for (var k = 0; k < T.length; k++) if (T[k] <= time) j = k;',
    'var s = j < 0 ? -1 : time - T[j], dn = j < 0 ? 0 : Math.max(D[j], 0.09);',
    `s < 0 ? 0 : s < 0.09 ? L.bezier(0.33, 0, 0.2, 1, s / 0.09) : s < dn ? 1 : 1 - L.spring(s - dn, ${fpsRef}, 15, 320, 1);`,
  ].join('\n');
}

/** 0–1 hover amount from "hover…" window markers (in over 0.15 s, out over 0.2 s; duration 0 = until the layer ends). */
export function hoverExpr(prefix = 'hover'): string {
  return [
    `// ae-compose ui: hover amount (0–1) during this layer's "${prefix}" markers (their duration is the hover)`,
    ...scan(prefix),
    'var h = 0;',
    'for (var k = 0; k < T.length; k++) { var b = T[k] + (D[k] > 0 ? D[k] : 1e6); h = Math.max(h, Math.min(L.clamp((time - T[k]) / 0.15, 0, 1), 1 - L.clamp((time - b) / 0.2, 0, 1))); }',
    'L.smooth(0, 1, h);',
  ].join('\n');
}

/** 0–1 on-state from "toggle…" markers: each flips the state (starting from the rig's `initial` checkbox), with a spring. */
export function toggleExpr(fx: string, initial: string, prefix = 'toggle'): string {
  return [
    `// ae-compose ui: on/off (0–1); every "${prefix}" marker on this layer flips it (start state: ${fx} > ${initial})`,
    ...scan(prefix),
    'var n = 0, last = -1; for (var k = 0; k < T.length; k++) if (T[k] <= time) { n++; last = T[k]; }',
    `var cur = (Math.round(effect(${JSON.stringify(fx)})(${JSON.stringify(initial)}).value) + n) % 2;`,
    `last < 0 ? cur : L.lerp(1 - cur, cur, L.spring(time - last, ${fpsRef}, 17, 260, 1));`,
  ].join('\n');
}

/** Show (0–1, spring in) or hide (0–1, eased out) progress of the window markers "show…" on this layer. */
export function revealExpr(which: 'in' | 'out', fx: string, prefix = 'show'): string {
  const head = [
    `// ae-compose ui: ${which === 'in' ? 'show' : 'hide'} progress (0–1) of this layer's "${prefix}" markers; drag or stretch them to retime`,
    ...scan(prefix),
    'var j = -1; for (var k = 0; k < T.length; k++) if (T[k] <= time) j = k;',
    `var e = effect(${JSON.stringify(fx)});`,
  ];
  if (which === 'in') return [...head, `j < 0 ? 0 : L.spring(time - T[j], ${fpsRef}, e("Damping").value, e("Stiffness").value, 1);`].join('\n');
  return [...head, 'var b = j < 0 ? 1e6 : T[j] + (D[j] > 0 ? D[j] : 1e6);', 'j < 0 ? 0 : L.bezier(0.32, 0, 0.67, 0, (time - b) / Math.max(e("Out Duration").value, 0.01));'].join('\n');
}

/** Initials from a name: "Jordan Reyes" → "JR". */
export function initials(name: string): string {
  const w = name.trim().split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] ?? '') + (w.length > 1 ? w[w.length - 1][0] : w[0]?.[1] ?? '')).toUpperCase();
}

/** Stable palette pick for a string. */
export function hashPick<T>(list: T[], key: string): T {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return list[h % list.length];
}
