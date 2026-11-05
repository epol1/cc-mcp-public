// UI kit Cursor (K1): an arrow (or a touch dot) that moves along waypoints with eased moves and hold keys, presses
// on clicks (a small squeeze) and drops a ripple where it clicked. Clicks and drags are layer markers on the cursor
// ("click buy", "press vol" with a duration), read by the press and ripple expressions, so dragging a marker retimes
// the click; they are also written as comp markers for the timeline. <Cursor flow={uiSteps(...)} /> takes the path
// and clicks from a step list.
import { Fragment, jsx } from '../jsx-runtime.ts';
import { CompMarkers, Effect, Ellipse, Fill, Group, Path, RigEffect, Shape, Stroke } from '../primitives.ts';
import { expr, keys, tween } from '../anim.ts';
import type { Anim } from '../anim.ts';
import type { EasingSpec } from '../../shared/easing.ts';
import type { PseudoEffectDef, PseudoParam } from '../../compile/ffx/pseudo.ts';
import type { UiColor } from './theme.ts';
import { uiTheme } from './theme.ts';
import type { UiBase } from './common.ts';
import { pressExpr, px, scan, timing } from './common.ts';
import type { CursorEvents, CursorWaypoint } from './steps.ts';

const sl = (name: string, def: number, min: number, max: number, extra: Partial<Extract<PseudoParam, { kind: 'slider' }>> = {}): PseudoParam => ({ kind: 'slider', name, default: def, min, max, precision: 2, ...extra });

/** "aec Cursor": press depth, ripple size/duration/opacity, and the Press state (from "click"/"press" markers). */
export const CURSOR_FX: PseudoEffectDef = { name: 'aec Cursor', params: [
  sl('Press Depth', 14, 0, 50, { display: 'percent', precision: 1 }), sl('Ripple Size', 56, 0, 400, { display: 'pixel', precision: 0 }),
  sl('Ripple Duration', 0.5, 0.05, 3), sl('Ripple Opacity', 45, 0, 100, { display: 'percent', precision: 0 }),
  { kind: 'group', name: 'State', params: [sl('Press', 0, 0, 1)] },
] };

export interface CursorProps extends Omit<UiBase, 'enterAt' | 'exitAt'>, Partial<CursorEvents> {
  /** 'arrow' (default, tip at the hotspot) or 'touch' (a soft finger dot, for phones and tablets). */
  kind?: 'arrow' | 'touch';
  /** Arrow height (or touch dot diameter) in px (default 26 / 40 at theme scale). */
  size?: number;
  color?: UiColor;
  outline?: UiColor;
  /** Ripple color, or false for none. */
  ripple?: UiColor | false;
  /** Also write the clicks as comp markers (default true). */
  compMarkers?: boolean;
  /** Fade in just before the first move (default true). */
  fadeIn?: boolean;
  /** Default easing of moves given as bare waypoints. */
  easing?: EasingSpec;
}

// A macOS-like pointer, 20 units tall, tip at (0, 0).
const ARROW: [number, number][] = [[0, 0], [0, 16.4], [3.9, 12.7], [6.6, 19], [9.3, 17.9], [6.7, 11.7], [12, 11.7]];

/** Position keys: hold at each arrival, leave at the next waypoint's `from`, eased into the next arrival. */
export function cursorKeys(path: CursorWaypoint[], easing: EasingSpec = 'easeInOutCubic'): Anim | [number, number] | undefined {
  if (!path.length) return undefined;
  if (path.length === 1) return [path[0].p[0], path[0].p[1]];
  const ks: { t: number; v: [number, number]; easing?: EasingSpec; hold?: boolean }[] = [];
  path.forEach((w, i) => {
    if (i === 0) { ks.push({ t: w.t, v: w.p, hold: true }); return; }
    const prev = ks[ks.length - 1];
    const from = w.from ?? prev.t;
    if (w.t < prev.t) throw new Error(`<Cursor>: waypoint at ${w.t}s comes before the previous one (${prev.t}s)`);
    if (from > prev.t + 1e-3) ks.push({ t: from, v: path[i - 1].p, easing: w.easing ?? easing });
    else { prev.hold = false; prev.easing = w.easing ?? easing; }
    ks.push({ t: w.t, v: w.p, hold: true });
  });
  return keys(...ks);
}

/**
 * A cursor driven by a path of waypoints (or a uiSteps flow): moves with eased keys and holds, presses on each click
 * (and stays pressed through drags), and a ripple expands where it clicked.
 */
export function Cursor(p: CursorProps) {
  if (!p.id) throw new Error('<Cursor> needs an id');
  const t = uiTheme(p.theme);
  const s = t.scale;
  const name = p.name ?? (p.id === 'cursor' ? 'Cursor' : `Cursor ${p.id}`);
  const ev: CursorEvents = { path: p.path ?? p.flow?.cursor.path ?? [], clicks: p.clicks ?? p.flow?.cursor.clicks ?? [], presses: p.presses ?? p.flow?.cursor.presses ?? [] };
  const clicks = ev.clicks.map((c: any) => (typeof c === 'number' ? { t: c } : c)) as { t: number; target?: string }[];
  const touch = p.kind === 'touch';
  const pos = cursorKeys(ev.path, p.easing) ?? p.position;
  const k = (p.size ?? (touch ? 40 : 26) * s) / (touch ? 1 : 20);
  const firstT = ev.path.length ? Math.min(ev.path[0].t, ev.path[1]?.from ?? Infinity) : 0;
  const fade = p.fadeIn !== false && ev.path.length > 0 ? { opacity: tween({ from: 0, to: 100, duration: 0.25, delay: Math.max(0, firstT - 0.3), easing: 'easeOutCubic' }) } : {};
  const markers = [
    ...clicks.map((c) => ({ t: c.t, comment: c.target ? `click ${c.target}` : 'click' })),
    ...ev.presses.map((c) => ({ t: c.t, comment: c.target ? `press ${c.target}` : 'press', duration: c.duration })),
  ].sort((a, b) => a.t - b.t);
  const fill = p.color ?? (touch ? '#ffffff' : '#111318');
  const outline = p.outline ?? '#ffffff';
  const body = touch
    ? [jsx(Group, { name: 'Touch', children: [jsx(Ellipse, { size: [px(k), px(k)] }), jsx(Stroke, { color: outline, width: px(2 * s), opacity: 70 }), jsx(Fill, { color: fill, opacity: 35 })] })]
    : [jsx(Group, { name: 'Arrow', children: [
      jsx(Path, { closed: true, points: ARROW.map(([x, y]) => ({ p: [+(x * k).toFixed(2), +(y * k).toFixed(2)] as [number, number] })) }),
      jsx(Stroke, { color: outline, width: px(1.6 * s), join: 'round' }),
      jsx(Fill, { color: fill }),
    ] })];
  const cursor = jsx(Shape, {
    id: p.id, name, ...timing(p), tags: ['ui', 'cursor'], markers,
    ...(Array.isArray(pos) ? { position: pos } : pos ? { position: pos } : {}),
    ...(Object.keys(fade).length ? { animate: fade } : {}),
    scale: expr('// ae-compose ui: squeeze on clicks, held through drags ("Cursor" effect)\nvar e = effect("Cursor");\nmul(value, 1 - e("Press Depth").value / 100 * e("Press").value);'),
    children: [
      ...body,
      ...(touch ? [] : [jsx(Effect, { name: 'Drop Shadow', label: 'Cursor Shadow', params: { 'Shadow Color': '#000000', Opacity: 40, Direction: 160, Distance: px(2 * s), Softness: px(5 * s) } })]),
      jsx(RigEffect, { def: CURSOR_FX, name: 'Cursor', values: { 'Ripple Size': px((touch ? 70 : 56) * s), Press: expr(pressExpr(['click', 'press'])) } }),
    ],
  });
  const C = `__AEC_LAYER(${p.id})__`;
  const last = [
    ...scan(['click', 'press'], 'C'),
    'var j = -1; for (var k = 0; k < T.length; k++) if (T[k] <= time) j = k;',
    'var u = j < 0 ? 1 : (time - T[j]) / Math.max(C.effect("Cursor")("Ripple Duration").value, 0.01);',
  ];
  const ripple = p.ripple === false ? null : jsx(Shape, {
    id: `${p.id}.ripple`, name: `${name} Ripple`, ...timing(p), tags: ['ui', 'cursor'],
    position: expr(['// ae-compose ui: ripple where the cursor clicked (its "click"/"press" markers)', `var C = ${C};`, ...last, 'j < 0 ? C.transform.position : C.transform.position.valueAtTime(T[j]);'].join('\n')),
    scale: expr([`var C = ${C};`, ...last, 'var s = 100 * L.bezier(0.16, 1, 0.3, 1, u);', '[s, s];'].join('\n')),
    opacity: expr([`var C = ${C};`, ...last, 'u >= 1 ? 0 : C.effect("Cursor")("Ripple Opacity").value * (1 - L.bezier(0.33, 0, 0.67, 1, u));'].join('\n')),
    children: [
      jsx(Ellipse, { size: expr(`var d = ${C}.effect("Cursor")("Ripple Size").value;\n[d, d];`) }),
      jsx(Fill, { color: p.ripple ?? (t.mode === 'dark' || touch ? '#ffffff' : '#0b0d12') }),
    ],
  });
  const off = p.from ?? 0;
  const comp = p.compMarkers !== false && clicks.length ? jsx(CompMarkers, { markers: clicks.map((c) => ({ t: off + c.t, comment: c.target ? `click ${c.target}` : 'click' })) }) : null;
  return jsx(Fragment, { children: [ripple, cursor, comp].filter(Boolean) });
}
