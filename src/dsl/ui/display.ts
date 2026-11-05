// UI kit display components (K1): Card, Avatar, Badge, Tooltip, Toast, Modal, ListItem and Feed. Cards, toasts,
// tooltips and modal panels are precomps (one editable comp each, animated as one layer, collapsed so vectors stay
// sharp). Transient ones carry one "Reveal" rig effect: they show during their "show" layer markers (drag a marker to
// retime, stretch it to hold longer), spring in and ease out.
import { Fragment, jsx } from '../jsx-runtime.ts';
import type { AecElement } from '../jsx-runtime.ts';
import { Effect, Ellipse, Fill, Group, Path, Precomp, Rect, RigEffect, Shape, Solid, Stroke, Text } from '../primitives.ts';
import { Box, Stack } from '../layout.ts';
import { expr, spring } from '../anim.ts';
import { field } from '../field.ts';
import { Cloner, line } from '../cloner.ts';
import type { Effector } from '../cloner.ts';
import type { PseudoEffectDef, PseudoParam } from '../../compile/ffx/pseudo.ts';
import type { UiColor, UiTheme } from './theme.ts';
import { plain, uiTheme } from './theme.ts';
import type { UiBase } from './common.ts';
import { column, events, hashPick, initials as initialsOf, motion, overlay, place, px, resolve, revealExpr, row, textWidth, timing, windows } from './common.ts';
import { Button } from './controls.ts';
import type { ButtonProps } from './controls.ts';
import type { UiEvents } from './steps.ts';

const sl = (name: string, def: number, min: number, max: number, extra: Partial<Extract<PseudoParam, { kind: 'slider' }>> = {}): PseudoParam => ({ kind: 'slider', name, default: def, min, max, precision: 2, ...extra });

/** Greedy line breaks (AE "\r") so point text fits `width` at `size`. */
export function wrapText(text: string, size: number, width: number, weight: 'regular' | 'medium' | 'semibold' | 'bold' = 'regular'): string {
  const lines: string[] = [];
  let cur = '';
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && textWidth(next, size, weight) > width) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.join('\r');
}
const lineCount = (s: string) => s.split('\r').length;

/** Soft drop shadow for raised surfaces. */
const shadow = (t: UiTheme, s: number, strength = 1) => jsx(Effect, { name: 'Drop Shadow', label: 'Soft Shadow', params: { 'Shadow Color': '#000000', Opacity: Math.round((t.mode === 'dark' ? 45 : 14) * strength), Direction: 180, Distance: px(10 * s * strength), Softness: px(32 * s * strength) } });

// ---------- Reveal (shared by Tooltip, Toast, Modal) ----------
/** "aec Reveal": start offset/scale, spring in (Damping, Stiffness), ease out (Out Duration), and the Show/Hide curves. */
export const REVEAL_FX: PseudoEffectDef = { name: 'aec Reveal', params: [
  sl('Offset X', 0, -1000, 1000, { display: 'pixel', precision: 1 }), sl('Offset Y', 24, -1000, 1000, { display: 'pixel', precision: 1 }),
  sl('Start Scale', 96, 0, 200, { display: 'percent', precision: 1 }), sl('Damping', 18, 1, 60, { precision: 1 }), sl('Stiffness', 220, 1, 1000, { precision: 0 }),
  sl('Out Duration', 0.22, 0.01, 3), { kind: 'group', name: 'State', params: [sl('Show', 0, 0, 1), sl('Hide', 0, 0, 1)] },
] };

interface RevealOpts { offset: [number, number]; startScale: number; damping: number; stiffness: number; out: number }

/** Layer props that make a layer show during its "show" markers through the "Reveal" effect. */
function reveal(win: [number, number][], o: RevealOpts) {
  return {
    markers: windows(win, 'show'),
    position: expr('// ae-compose ui: reveal offset ("Reveal" effect; shows during this layer\'s "show" markers)\nvar e = effect("Reveal"), i = e("Show").value, o = e("Hide").value;\nadd(value, mul([e("Offset X").value, e("Offset Y").value], (1 - i) + 0.5 * o));'),
    scale: expr('var e = effect("Reveal"), k = L.lerp(e("Start Scale").value, 100, e("Show").value) / 100 * (1 - 0.03 * e("Hide").value);\nmul(value, k);'),
    opacity: expr('var e = effect("Reveal");\nvalue * L.clamp(e("Show").value * 2.5, 0, 1) * (1 - e("Hide").value);'),
    fx: jsx(RigEffect, { def: REVEAL_FX, name: 'Reveal', values: {
      'Offset X': o.offset[0], 'Offset Y': o.offset[1], 'Start Scale': o.startScale, Damping: o.damping, Stiffness: o.stiffness, 'Out Duration': o.out,
      Show: expr(revealExpr('in', 'Reveal')), Hide: expr(revealExpr('out', 'Reveal')),
    } }),
  };
}

/** Show windows: events (uiSteps show steps, or a target's hovers) or at/hold (hold default: reading time + 1 s). */
function showWindows(ev: UiEvents, p: { at?: number; hold?: number }, words: number, defAt: number): [number, number][] {
  if (ev.show?.length) return ev.show;
  const a = p.at ?? defAt;
  const hold = p.hold ?? Math.max(2, 0.5 + 0.3 * words + 1);
  return [[a, a + hold]];
}
const words = (...s: (string | undefined)[]) => s.filter(Boolean).join(' ').split(/\s+/).filter(Boolean).length;

// ---------- Card ----------
export interface CardProps extends UiBase {
  /** Card size (default 340 × 200 at theme scale). */
  size?: [number, number];
  title?: string;
  body?: string;
  padding?: number;
  /** Content laid out top-left inside the card (a column); replaces title/body. */
  children?: any;
  shadow?: boolean;
  color?: UiColor;
}

/** A card: a precomp with a rounded surface, a hairline border and a soft shadow; its content is laid out inside. */
export function Card(p: CardProps) {
  const { t, s, name } = resolve(p, 'Card');
  const [w, h] = p.size ?? [340 * s, 200 * s];
  const pad = p.padding ?? 20 * s;
  const kids: any[] = [];
  if (p.children !== undefined) kids.push(...[p.children].flat());
  else {
    const title = p.title ?? 'Weekly report';
    kids.push(jsx(Text, { id: `${p.id}.title`, name: `${name} Title`, font: t.fonts.semibold, size: px(17 * s), color: t.text, align: 'left', anchor: 'left', text: title }));
    const body = p.body ?? 'Revenue is up 12% on last week, led by the new onboarding flow.';
    kids.push(jsx(Text, { id: `${p.id}.body`, name: `${name} Body`, font: t.fonts.regular, size: px(14 * s), color: t.muted, align: 'left', anchor: 'left', leading: px(20 * s), text: wrapText(body, 14 * s, w - 2 * pad) }));
  }
  const card = jsx(Precomp, {
    id: p.id, name, width: Math.round(w), height: Math.round(h), collapse: true, ...timing(p), ...motion(p, s), tags: ['ui', 'card'],
    effects: p.shadow === false ? [] : [shadow(t, s)],
    children: [
      jsx(Shape, { id: `${p.id}.bg`, name: `${name} Surface`, children: [jsx(Rect, { size: [px(w - 1), px(h - 1)], roundness: px(t.radius * s * 1.6) }), jsx(Stroke, { color: t.border, width: Math.max(1, s) }), jsx(Fill, { color: p.color ?? t.surface })] }),
      jsx(Box, { width: w, height: h, padding: pad, align: 'start', children: column(kids, 10 * s, 'start') }),
    ],
  });
  return place(p.position, card);
}

// ---------- Avatar ----------
export interface AvatarProps extends UiBase {
  /** The person's name (initials and a palette color come from it). */
  person?: string;
  /** Initials override. */
  initials?: string;
  size?: number;
  color?: UiColor;
  status?: 'online' | 'away' | 'busy';
  /** Ring color (e.g. the background, to separate overlapping avatars). */
  ring?: UiColor;
  /** Essential Graphics names (in a cloner master): { initials: 'Initials', color: 'Avatar Color' }. */
  fields?: { initials?: string; color?: string };
}

/** Initials in a circle, colored from the theme palette by the name; optional status dot and ring. */
export function Avatar(p: AvatarProps) {
  const { t, s, name } = resolve(p, 'Avatar');
  const person = p.person ?? 'Jordan Reyes';
  const d = p.size ?? 40 * s;
  const color = p.color ?? hashPick(t.avatars, person);
  const ini = p.initials ?? initialsOf(person);
  const mo = motion(p, s);
  const statusColor = p.status === 'online' ? t.success : p.status === 'away' ? t.warning : t.danger;
  const circle = jsx(Shape, {
    id: p.id, name, ...timing(p), ...mo, tags: ['ui', 'avatar'],
    children: [
      ...(p.status ? [jsx(Group, { name: 'Status', position: [px(d * 0.36), px(d * 0.36)], children: [jsx(Ellipse, { size: [px(d * 0.3), px(d * 0.3)] }), jsx(Stroke, { color: t.bg, width: px(Math.max(1.5, d * 0.06)) }), jsx(Fill, { color: statusColor })] })] : []),
      jsx(Group, { name: 'Circle', children: [
        jsx(Ellipse, { size: [px(d), px(d)] }),
        ...(p.ring ? [jsx(Stroke, { color: p.ring, width: px(Math.max(2, d * 0.06)) })] : []),
        jsx(Fill, { color: p.fields?.color ? field(p.fields.color, plain(color)) : color }),
      ] }),
    ],
  });
  const text = jsx(Text, {
    id: `${p.id}.initials`, name: `${name} Initials`, ...timing(p), ...(mo.animate ? { animate: { ...mo.animate } } : {}), font: t.fonts.semibold, size: px(d * 0.38), color: '#ffffff', text: ini,
    ...(p.fields?.initials ? { eg: p.fields.initials } : {}),
  });
  return place(p.position, overlay([circle, text]));
}

// ---------- Badge ----------
export interface BadgeProps extends UiBase {
  label?: string;
  tone?: 'accent' | 'success' | 'danger' | 'warning' | 'neutral';
  /** 'soft' (tinted, default) or 'solid'. */
  variant?: 'soft' | 'solid';
  /** Pops in with a spring at this time. */
  popAt?: number;
}

/** A pill label ("New", "Pro", "3"); soft tint or solid; optional spring pop. */
export function Badge(p: BadgeProps) {
  const { t, s, name } = resolve(p, 'Badge');
  const label = p.label ?? 'New';
  const tone = p.tone ?? 'accent';
  const c = tone === 'neutral' ? t.muted : t[tone];
  const solid = p.variant === 'solid';
  const h = 22 * s, fs = 12 * s;
  const w = Math.max(h, textWidth(label, fs, 'semibold') + 18 * s);
  const mo = motion(p, s);
  const anim = { ...(mo.animate ?? {}), ...(p.popAt !== undefined ? { scale: spring({ from: 0, delay: p.popAt, damping: 12, stiffness: 220 }) } : {}) };
  const pill = jsx(Shape, {
    id: p.id, name, ...timing(p), ...(Object.keys(anim).length ? { animate: anim } : {}), tags: ['ui', 'badge'],
    children: [jsx(Rect, { size: [px(w), px(h)], roundness: px(h / 2) }), jsx(Fill, { color: c, opacity: solid ? 100 : t.mode === 'dark' ? 18 : 12 })],
  });
  const { scale: _s, ...textAnim } = anim;
  const text = jsx(Text, {
    id: `${p.id}.label`, name: `${name} Label`, ...timing(p), ...(Object.keys(textAnim).length ? { animate: textAnim } : {}), font: t.fonts.semibold, size: px(fs), color: solid ? t.onAccent : c, text: label,
    scale: expr(`// ae-compose ui: follows the badge\n__AEC_LAYER(${p.id})__.transform.scale;`),
  });
  return place(p.position, overlay([pill, text]));
}

// ---------- Tooltip ----------
export interface TooltipProps extends UiBase, Pick<UiEvents, 'show'> {
  text?: string;
  /** Show while the cursor hovers this component id (its hover windows from the flow). */
  for?: string;
  /** Where the bubble sits relative to `position` (the point it points at). */
  placement?: 'top' | 'bottom';
  at?: number;
  hold?: number;
}

/** A small bubble with an arrow whose tip sits at `position`; shows on its target's hovers (or show windows / at+hold). */
export function Tooltip(p: TooltipProps) {
  const { t, s, name } = resolve(p, 'Tooltip');
  const ev = events(p);
  const text = p.text ?? 'Monthly, no spam';
  const fs = 13 * s, bh = 30 * s, ar = 6 * s;
  const bw = textWidth(text, fs, 'medium') + 22 * s;
  const W = Math.ceil(bw), H = Math.ceil(bh + ar);
  const top = (p.placement ?? 'top') === 'top';
  const bg = t.mode === 'dark' ? '#f2f4f8' : '#1a1f29', fg = t.mode === 'dark' ? '#0f141c' : '#ffffff';
  const hovers = p.for && p.flow ? (p.flow.on(p.for).hover ?? []) : [];
  const win = [...(ev.show ?? []), ...hovers.map(([a, b]): [number, number] => [a + 0.25, b === a ? a + 0.25 : b])].sort((a, b) => a[0] - b[0]);
  const rv = reveal(win.length ? win : showWindows({}, p, words(text), 0.5), { offset: [0, top ? 6 * s : -6 * s], startScale: 94, damping: 22, stiffness: 320, out: 0.15 });
  const cy = top ? bh / 2 : ar + bh / 2;
  const arrow = top ? `M${px(W / 2 - ar)} ${px(bh - 0.5)} L${px(W / 2)} ${px(bh + ar)} L${px(W / 2 + ar)} ${px(bh - 0.5)} Z` : `M${px(W / 2 - ar)} ${px(ar + 0.5)} L${px(W / 2)} 0 L${px(W / 2 + ar)} ${px(ar + 0.5)} Z`;
  const tip = jsx(Precomp, {
    id: p.id, name, width: W, height: H, collapse: true, ...timing(p), tags: ['ui', 'tooltip'],
    anchor: [W / 2, top ? H : 0], markers: rv.markers, position: p.position ? undefined : rv.position, scale: rv.scale, opacity: rv.opacity,
    ...(p.position ? { position: rv.position, x: undefined } : {}),
    effects: [rv.fx, shadow(t, s, 0.5)],
    children: [
      jsx(Shape, { id: `${p.id}.bubble`, name: `${name} Bubble`, space: 'comp', children: [jsx(Path, { d: arrow, name: 'Arrow' }), jsx(Rect, { size: [px(bw), px(bh)], position: [px(W / 2), px(cy)], roundness: px(8 * s) }), jsx(Fill, { color: bg })] }),
      jsx(Text, { id: `${p.id}.text`, name: `${name} Text`, font: t.fonts.medium, size: px(fs), color: fg, text, position: [W / 2, cy] }),
    ],
  });
  // The tip is the layer's anchor, so the layer sits exactly at `position` (no layout needed).
  if (p.position) (tip.props as any).props = { 'ADBE Transform Group/ADBE Position': undefined };
  return p.position ? jsx(Fragment, { children: [withPos(tip, p.position)] }) : tip;
}

/** Sets a static rest position under a position expression (layer not in layout). */
function withPos(el: AecElement, pos: [number, number]): AecElement {
  const props = { ...el.props };
  delete props.props;
  // A position expression keeps its static value as `value`: give the rest as the layer's x/y.
  props.x = pos[0]; props.y = pos[1];
  return { ...el, props };
}

// ---------- Toast ----------
export interface ToastProps extends UiBase, Pick<UiEvents, 'show'> {
  title?: string;
  body?: string;
  /** 'success' (check), 'info' (dot), 'avatar' (initials of `person`) or 'none'. */
  icon?: 'success' | 'info' | 'avatar' | 'none';
  person?: string;
  width?: number;
  /** Slides in from (default top). */
  from?: number;
  direction?: 'top' | 'bottom' | 'left' | 'right';
  at?: number;
  hold?: number;
}

/** A notification card that springs in, holds for its "show" marker's duration, and eases out. */
export function Toast(p: ToastProps) {
  const { t, s, name } = resolve(p, 'Toast');
  const ev = events(p);
  const w = p.width ?? 360 * s, pad = 14 * s, ic = 34 * s, gap = 12 * s;
  const title = p.title ?? 'Account created';
  const body = p.body ?? 'Welcome aboard. Your workspace is ready.';
  const icon = p.icon ?? 'success';
  const tw = w - 2 * pad - (icon === 'none' ? 0 : ic + gap);
  const bodyText = body ? wrapText(body, 14 * s, tw) : '';
  const textH = 15 * s * 1.3 + (bodyText ? 3 * s + lineCount(bodyText) * 19 * s : 0);
  const h = Math.ceil(Math.max(ic, textH) + 2 * pad);
  const dir = p.direction ?? 'top';
  const dist = 16 * s + h * 0.6;
  const off: [number, number] = dir === 'top' ? [0, -dist] : dir === 'bottom' ? [0, dist] : dir === 'left' ? [-dist, 0] : [dist, 0];
  const rv = reveal(showWindows(ev, p, words(title, body), 0.4), { offset: off, startScale: 98, damping: 17, stiffness: 190, out: 0.28 });
  let iconEl: any = null;
  if (icon === 'success' || icon === 'info') {
    const c = icon === 'success' ? t.success : t.accent;
    iconEl = jsx(Shape, { id: `${p.id}.icon`, name: `${name} Icon`, children: [
      ...(icon === 'success' ? [jsx(Group, { name: 'Check', children: [jsx(Path, { closed: false, points: [{ p: [px(-6 * s), px(0.5 * s)] }, { p: [px(-1.5 * s), px(5 * s)] }, { p: [px(6.5 * s), px(-4.5 * s)] }] }), jsx(Stroke, { color: c, width: px(2.2 * s), cap: 'round', join: 'round' })] })]
        : [jsx(Group, { name: 'Dot', children: [jsx(Ellipse, { size: [px(10 * s), px(10 * s)] }), jsx(Fill, { color: c })] })]),
      jsx(Group, { name: 'Disc', children: [jsx(Ellipse, { size: [px(ic), px(ic)] }), jsx(Fill, { color: c, opacity: 18 })] }),
    ] });
  } else if (icon === 'avatar') iconEl = Avatar({ id: `${p.id}.avatar`, person: p.person, size: ic, theme: t });
  const texts = column([
    jsx(Text, { id: `${p.id}.title`, name: `${name} Title`, font: t.fonts.semibold, size: px(15 * s), color: t.text, align: 'left', anchor: 'left', text: title }),
    ...(bodyText ? [jsx(Text, { id: `${p.id}.body`, name: `${name} Body`, font: t.fonts.regular, size: px(14 * s), color: t.muted, align: 'left', anchor: 'left', leading: px(19 * s), text: bodyText })] : []),
  ], 3 * s, 'start');
  const toast = jsx(Precomp, {
    id: p.id, name, width: Math.ceil(w), height: h, collapse: true, ...(p.duration !== undefined ? { duration: p.duration } : {}), tags: ['ui', 'toast'],
    markers: rv.markers, position: rv.position, scale: rv.scale, opacity: rv.opacity,
    effects: [rv.fx, shadow(t, s)],
    children: [
      jsx(Shape, { id: `${p.id}.bg`, name: `${name} Surface`, children: [jsx(Rect, { size: [px(w - 1), px(h - 1)], roundness: px(16 * s) }), jsx(Stroke, { color: t.border, width: Math.max(1, s) }), jsx(Fill, { color: t.raised })] }),
      jsx(Box, { width: w, height: h, padding: pad, align: 'start', children: iconEl ? row([iconEl, texts], gap, 'center') : texts }),
    ],
  });
  return place(p.position, toast);
}

// ---------- Modal ----------
export interface ModalProps extends UiBase, Pick<UiEvents, 'show'> {
  title?: string;
  body?: string;
  /** Primary button label (id "<id>.primary"); its clicks come from the flow. */
  primary?: string;
  /** Secondary button label (id "<id>.secondary"); false for none. */
  secondary?: string | false;
  width?: number;
  scrimOpacity?: number;
  at?: number;
  hold?: number;
}

function modalMetrics(p: ModalProps, t: UiTheme) {
  const s = t.scale;
  const w = p.width ?? 400 * s, pad = 24 * s;
  const title = p.title ?? 'Turn on notifications?';
  const body = wrapText(p.body ?? 'Get a heads-up when a teammate mentions you or a build finishes.', 15 * s, w - 2 * pad);
  const bh = 44 * s;
  const h = Math.ceil(pad + 20 * s * 1.25 + 8 * s + lineCount(body) * 21 * s + 22 * s + bh + pad);
  const btnW = (l: string) => Math.max(bh * 1.6, textWidth(l, 15 * s, 'semibold') + 40 * s);
  return { w, h, pad, title, body, bh, btnW, gap: 10 * s };
}

/** Centre points of a modal's buttons (for uiSteps targets), from the same metrics the Modal uses. */
export function modalButtonPoints(p: ModalProps, center: [number, number]): { primary: [number, number]; secondary?: [number, number] } {
  const t = uiTheme(p.theme);
  const m = modalMetrics(p, t);
  const y = center[1] + m.h / 2 - m.pad - m.bh / 2;
  const pw = m.btnW(p.primary ?? 'Allow');
  const px1 = center[0] + m.w / 2 - m.pad - pw / 2;
  const out: { primary: [number, number]; secondary?: [number, number] } = { primary: [Math.round(px1), Math.round(y)] };
  if (p.secondary !== false) { const sw = m.btnW(p.secondary ?? 'Not now'); out.secondary = [Math.round(px1 - pw / 2 - m.gap - sw / 2), Math.round(y)]; }
  return out;
}

/**
 * A dialog: a scrim over the whole comp (or screen) and a panel precomp (title, body, buttons) that springs up while
 * shown. Put it at the top level of the comp or screen (the scrim fills it). Buttons are Buttons with ids
 * "<id>.primary" / "<id>.secondary", so uiSteps clicks press them.
 */
export function Modal(p: ModalProps) {
  const { t, s, name } = resolve(p, 'Modal');
  const ev = events(p);
  const m = modalMetrics(p, t);
  const win = showWindows(ev, p, 99, 0.5);
  const winForever: [number, number][] = ev.show?.length ? ev.show : p.hold !== undefined ? win : [[win[0][0], win[0][0]]];
  const rv = reveal(winForever, { offset: [0, 24 * s], startScale: 94, damping: 20, stiffness: 240, out: 0.2 });
  const panelId = `${p.id}.panel`;
  const btn = (k: 'primary' | 'secondary', label: string, variant: ButtonProps['variant']) => Button({ id: `${p.id}.${k}`, name: `${name} ${label}`, label, variant, theme: t, flow: p.flow, width: m.btnW(label) });
  const buttons = [
    ...(p.secondary !== false ? [btn('secondary', p.secondary ?? 'Not now', 'secondary')] : []),
    btn('primary', p.primary ?? 'Allow', 'primary'),
  ];
  const panel = jsx(Precomp, {
    id: panelId, name: `${name} Panel`, width: Math.ceil(m.w), height: m.h, collapse: true, tags: ['ui', 'modal'],
    markers: rv.markers, position: rv.position, scale: rv.scale, opacity: rv.opacity,
    effects: [rv.fx, shadow(t, s, 1.4)],
    children: [
      jsx(Shape, { id: `${p.id}.bg`, name: `${name} Surface`, children: [jsx(Rect, { size: [px(m.w - 1), px(m.h - 1)], roundness: px(20 * s) }), jsx(Stroke, { color: t.border, width: Math.max(1, s) }), jsx(Fill, { color: t.raised })] }),
      jsx(Box, { width: m.w, height: m.h, padding: m.pad, align: 'start', children: column([
        jsx(Text, { id: `${p.id}.title`, name: `${name} Title`, font: t.fonts.bold, size: px(20 * s), color: t.text, align: 'left', anchor: 'left', text: m.title }),
        jsx(Text, { id: `${p.id}.body`, name: `${name} Body`, font: t.fonts.regular, size: px(15 * s), color: t.muted, align: 'left', anchor: 'left', leading: px(21 * s), text: m.body, layout: { offset: [0, 0] } }),
        jsx(Stack, { direction: 'row', width: m.w - 2 * m.pad, justify: 'end', gap: m.gap, align: 'center', layout: {}, offset: [0, 14 * s], children: buttons }),
      ], 8 * s, 'start') }),
    ],
  });
  const scrim = jsx(Solid, {
    id: `${p.id}.scrim`, name: `${name} Scrim`, color: plain(t.scrim), tags: ['ui', 'scrim'],
    opacity: expr(`// ae-compose ui: follows the panel's reveal\nvar e = __AEC_LAYER(${panelId})__.effect("Reveal");\n${p.scrimOpacity ?? 55} * L.clamp(e("Show").value * 1.6, 0, 1) * (1 - e("Hide").value);`),
  });
  return jsx(Fragment, { children: [scrim, place(p.position, panel)] });
}

// ---------- ListItem / Feed ----------
export interface ListItemProps extends UiBase {
  title?: string;
  subtitle?: string;
  meta?: string;
  person?: string;
  width?: number;
  height?: number;
  /** Expose Title, Subtitle, Meta, Initials and Avatar Color in Essential Graphics (cloner masters: Feed sets this). */
  fields?: boolean;
}

/** A list row: avatar, title and subtitle at the left, meta (time) at the right, on a rounded surface. */
export function ListItem(p: ListItemProps) {
  const { t, s, name } = resolve(p, 'ListItem');
  const w = p.width ?? 358 * s, h = p.height ?? 68 * s, pad = 14 * s;
  const person = p.person ?? p.title ?? 'Jordan Reyes';
  const mo = motion(p, s);
  const tm = { ...timing(p), ...(mo.animate ? { animate: { ...mo.animate } } : {}) };
  const f = (n: string) => (p.fields ? { eg: n } : {});
  const bg = jsx(Shape, { id: p.id, name, ...tm, tags: ['ui', 'list-item'], children: [jsx(Rect, { size: [px(w), px(h)], roundness: px(14 * s) }), jsx(Fill, { color: t.surface })] });
  const texts = column([
    jsx(Text, { id: `${p.id}.title`, name: `${name} Title`, ...tm, font: t.fonts.semibold, size: px(15 * s), color: t.text, align: 'left', anchor: 'left', text: p.title ?? 'Jordan Reyes', ...f('Title') }),
    jsx(Text, { id: `${p.id}.subtitle`, name: `${name} Subtitle`, ...tm, font: t.fonts.regular, size: px(13 * s), color: t.muted, align: 'left', anchor: 'left', text: p.subtitle ?? 'Shipped the new onboarding', ...f('Subtitle') }),
  ], 2 * s, 'start');
  const left = row([Avatar({ id: `${p.id}.avatar`, person, size: 40 * s, theme: t, enterAt: p.enterAt, exitAt: p.exitAt, ...(p.fields ? { fields: { initials: 'Initials', color: 'Avatar Color' } } : {}) }), texts], 12 * s, 'center');
  const meta = jsx(Text, { id: `${p.id}.meta`, name: `${name} Meta`, ...tm, font: t.fonts.regular, size: px(12 * s), color: t.muted, align: 'right', anchor: 'right', text: p.meta ?? '2m', ...f('Meta') });
  return place(p.position, overlay([bg, jsx(Stack, { direction: 'row', width: w, padding: [0, pad], justify: 'spaceBetween', align: 'center', children: [left, meta] })]));
}

export interface FeedRow { title: string; subtitle?: string; meta?: string; person?: string; color?: string }

export interface FeedProps extends Omit<UiBase, 'position' | 'enterAt' | 'exitAt'> {
  rows: FeedRow[];
  width?: number;
  itemHeight?: number;
  gap?: number;
  /** Centre of the first row (default: [width / 2, itemHeight / 2], the top of a ScrollView's content). */
  position?: [number, number];
  /** Rows rise in one after another from this time (stagger effector on the master's entrance). */
  enterAt?: number;
  stagger?: number;
  effectors?: Effector[];
}

/**
 * A feed: one ListItem master cloned per row (P1 Cloner, line distribution downward); each row's texts, initials and
 * avatar color are Essential Properties set from `rows`. Edit the master once and every row follows.
 */
export function Feed(p: FeedProps) {
  const t = uiTheme(p.theme);
  const s = t.scale;
  const w = p.width ?? 358 * s, ih = p.itemHeight ?? 68 * s, gap = p.gap ?? 8 * s;
  if (!p.rows?.length) throw new Error(`<Feed id="${p.id}"> needs rows: [{ title, subtitle, meta }]`);
  const first = p.rows[0];
  const data = p.rows.map((r) => {
    const person = r.person ?? r.title;
    return { Title: r.title, Subtitle: r.subtitle ?? '', Meta: r.meta ?? '', Initials: initialsOf(person), 'Avatar Color': r.color ?? hashPick(t.avatars, person) };
  });
  const effectors = [...(p.effectors ?? []), ...(p.enterAt !== undefined && !(p.effectors ?? []).some((e) => e.kind === 'stagger') ? [{ kind: 'stagger', each: p.stagger ?? 0.07 } as Effector] : [])];
  return Cloner({
    id: p.id, name: p.name ?? `Feed ${p.id}`, size: [Math.ceil(w), Math.ceil(ih)], data,
    distribute: line({ spacing: ih + gap, angle: 90, centered: false }),
    position: p.position ?? [w / 2, ih / 2],
    effectors,
    of: ListItem({ id: `${p.id}.item`, name: `${p.name ?? `Feed ${p.id}`} Row`, title: first.title, subtitle: first.subtitle, meta: first.meta, person: first.person, width: w, height: ih, theme: t, fields: true, enterAt: p.enterAt !== undefined ? 0 : undefined }),
    ...(p.enterAt !== undefined ? { from: p.enterAt } : {}),
  } as any);
}
