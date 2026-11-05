// UI kit controls (K1): Button, Toggle, Checkbox, Slider, ProgressBar, Input, Tabs. Each is native layers on the
// layout engine (a shape layer, plus text layers sharing its slot) with one rig effect on the shape holding its
// style and its state curves. States come from layer markers ("press", "hover", "toggle", "select 2", "focus",
// "type", "drag") read by expressions, so dragging a marker in AE retimes the state; values (slider, progress) are
// ordinary keys on the rig's Value param.
import { jsx } from '../jsx-runtime.ts';
import { Ellipse, Fill, Group, Path, Rect, RigEffect, Shape, Stroke, Text, Trim } from '../primitives.ts';
import { Stack } from '../layout.ts';
import { expr, keys } from '../anim.ts';
import type { Anim } from '../anim.ts';
import type { PseudoEffectDef, PseudoParam } from '../../compile/ffx/pseudo.ts';
import type { UiColor } from './theme.ts';
import type { UiBase } from './common.ts';
import { at, column, events, hoverExpr, motion, overlay, place, pressExpr, px, resolve, row, textWidth, timing, toggleExpr, windows } from './common.ts';
import type { UiEvents } from './steps.ts';

const sl = (name: string, def: number, min: number, max: number, extra: Partial<Extract<PseudoParam, { kind: 'slider' }>> = {}): PseudoParam => ({ kind: 'slider', name, default: def, min, max, precision: 2, ...extra });
const col = (name: string, c: number[]): PseudoParam => ({ kind: 'color', name, default: [...c, 1] });
const state = (...names: string[]): PseudoParam => ({ kind: 'group', name: 'State', params: names.map((n) => sl(n, 0, 0, 1)) });
const lit = (v: number) => +v.toFixed(3);
/** AE path of the size of the Rect named "Body" in the shape group `group`. */
const RECT_SIZE = (group: string) => `ADBE Root Vectors Group/${group}/ADBE Vectors Group/Body/ADBE Vector Rect Size`;

// ---------- Button ----------
/** "aec Button": fill, hover/press styling, and the Hover/Press state curves (from the layer's markers). */
export const BUTTON_FX: PseudoEffectDef = { name: 'aec Button', params: [
  col('Fill', [0.357, 0.549, 1]), col('Hover Color', [1, 1, 1]),
  sl('Hover Tint', 10, 0, 100, { display: 'percent', precision: 0 }), sl('Press Shade', 14, 0, 100, { display: 'percent', precision: 0 }),
  sl('Idle Opacity', 100, 0, 100, { display: 'percent', precision: 0 }), sl('Hover Opacity', 100, 0, 100, { display: 'percent', precision: 0 }),
  sl('Hover Lift', 1.5, 0, 10, { display: 'percent', precision: 1 }), sl('Press Depth', 4, 0, 20, { display: 'percent', precision: 1 }),
  state('Hover', 'Press'),
] };

export interface ButtonProps extends UiBase, Pick<UiEvents, 'clickAt' | 'hover'> {
  label?: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  /** Fixed width; default: fits the label (live: retype the label in AE and the button follows). */
  width?: number;
  pill?: boolean;
  /** Fill override (default from the variant). */
  color?: UiColor;
  labelColor?: UiColor;
}

const BTN = { sm: { h: 34, pad: 14, fs: 13, r: 9 }, md: { h: 44, pad: 20, fs: 15, r: 12 }, lg: { h: 54, pad: 26, fs: 17, r: 14 } };

/**
 * A button: rounded-rect shape + label. `clickAt` (or uiSteps clicks) become "press" markers, `hover` windows become
 * "hover" markers; the "Button" effect turns them into Hover/Press curves that tint, lift and press the button.
 */
export function Button(p: ButtonProps) {
  const { t, s, name } = resolve(p, 'Button');
  const ev = events(p);
  const z = BTN[p.size ?? 'md'];
  const h = z.h * s, pad = z.pad * s, fs = z.fs * s;
  const label = p.label ?? 'Get started';
  const v = p.variant ?? 'primary';
  const fill = p.color ?? (v === 'primary' ? t.accent : v === 'danger' ? t.danger : v === 'ghost' ? t.text : t.surface);
  const fg = p.labelColor ?? (v === 'primary' || v === 'danger' ? t.onAccent : v === 'ghost' ? t.accent : t.text);
  const w = p.width ?? Math.max(h * 1.6, textWidth(label, fs, 'semibold') + 2 * pad);
  const r = p.pill ? h / 2 : z.r * s * (t.radius / 12);
  const labelId = `${p.id}.label`;
  const fx = { def: BUTTON_FX, name: 'Button', values: {
    Fill: fill, 'Hover Color': v === 'primary' || v === 'danger' ? '#ffffff' : t.text,
    'Hover Tint': v === 'primary' || v === 'danger' ? 10 : 6, 'Press Shade': v === 'secondary' ? 8 : 14,
    'Idle Opacity': v === 'ghost' ? 0 : 100, 'Hover Opacity': v === 'ghost' ? 10 : 100,
    Hover: expr(hoverExpr()), Press: expr(pressExpr()),
  } };
  const fillColor = expr([
    '// ae-compose ui: button fill = Fill, tinted toward Hover Color while hovered, shaded while pressed ("Button" effect)',
    'var e = effect("Button"), c = L.mixv(e("Fill").value, e("Hover Color").value, e("Hover").value * e("Hover Tint").value / 100);',
    'L.mixv(c, [0, 0, 0, 1], e("Press").value * e("Press Shade").value / 100);',
  ].join('\n'));
  const fillOpacity = expr('var e = effect("Button");\nL.lerp(e("Idle Opacity").value, e("Hover Opacity").value, e("Hover").value);');
  // The Rect keeps a static size (the build-time layout measures it); without a fixed width an expression on the
  // same Rect fits the label live.
  const fit = p.width !== undefined ? undefined : { [RECT_SIZE('Button')]: [
    '// ae-compose ui: the button fits its label (retype it in AE and the button follows)',
    `var r = __AEC_LAYER(${labelId})__.sourceRectAtTime(time, false);`,
    `[Math.max(r.width + ${lit(2 * pad)}, ${lit(h * 1.6)}), ${lit(h)}];`,
  ].join('\n') };
  const mo = motion(p, s);
  const bg = jsx(Shape, {
    id: p.id, name, ...timing(p), ...mo, tags: ['ui', 'button'],
    markers: [...at(ev.clickAt, 'press'), ...windows(ev.hover, 'hover')],
    scale: expr('// ae-compose ui: hover lift and press ("Button" effect)\nvar e = effect("Button");\nmul(value, 1 + (e("Hover Lift").value * e("Hover").value - e("Press Depth").value * e("Press").value) / 100);'),
    ...(fit ? { expressions: fit } : {}),
    children: [
      jsx(Group, { name: 'Button', children: [
        jsx(Rect, { name: 'Body', size: [px(w), px(h)], roundness: px(r) }),
        ...(v === 'secondary' ? [jsx(Stroke, { color: t.border, width: Math.max(1, s) })] : []),
        jsx(Fill, { color: fillColor, opacity: fillOpacity }),
      ] }),
      jsx(RigEffect, fx),
    ],
  });
  const text = jsx(Text, {
    id: labelId, name: `${name} Label`, ...timing(p), ...noScale(mo), font: t.fonts.semibold, size: px(fs), color: fg, text: label,
    scale: expr(`// ae-compose ui: follows the button's press and hover\n__AEC_LAYER(${p.id})__.transform.scale;`),
  });
  return place(p.position, overlay([bg, text]));
}

/** Entrance/exit keys without the scale part (for layers whose scale copies another layer). */
function noScale(m: { animate?: Record<string, Anim> }) {
  if (!m.animate) return {};
  const { scale: _s, ...rest } = m.animate;
  return Object.keys(rest).length ? { animate: rest } : {};
}

// ---------- Toggle ----------
export const TOGGLE_FX: PseudoEffectDef = { name: 'aec Toggle', params: [
  { kind: 'checkbox', name: 'Start On', default: false }, col('On Color', [0.357, 0.549, 1]), col('Off Color', [0.17, 0.2, 0.26]), state('Value'),
] };

export interface ToggleProps extends UiBase, Pick<UiEvents, 'clickAt'> {
  /** Start state (default off). Every click flips it. */
  on?: boolean;
  /** Times it flips (in addition to clicks). */
  toggleAt?: number[];
  label?: string;
  /** Settings-row width: label at the left edge, switch at the right. */
  width?: number;
  onColor?: UiColor;
}

/** An iOS-style switch; each click (or `toggleAt`) flips it with a springy knob that stretches as it travels. */
export function Toggle(p: ToggleProps) {
  const { t, s, name } = resolve(p, 'Toggle');
  const ev = events(p);
  const W = 51 * s, H = 31 * s, k = 27 * s, dx = (W - k) / 2 - 2 * s;
  const flips = [...(ev.clickAt ?? []), ...(p.toggleAt ?? [])].sort((a, b) => a - b);
  const mo = motion(p, s);
  const sw = jsx(Shape, {
    id: p.id, name, ...timing(p), ...mo, tags: ['ui', 'toggle'], markers: at(flips, 'toggle'),
    children: [
      jsx(Group, { name: 'Knob', position: expr(`// ae-compose ui: knob travel ("Toggle" effect Value)\nvar v = effect("Toggle")("Value").value;\n[L.lerp(${lit(-dx)}, ${lit(dx)}, v), 0];`), children: [
        jsx(Ellipse, { size: expr(`// stretches mid-travel\nvar v = L.clamp(effect("Toggle")("Value").value, 0, 1);\n[${lit(k)} + ${lit(10 * s)} * 4 * v * (1 - v), ${lit(k)}];`) }),
        jsx(Fill, { color: '#ffffff' }),
      ] }),
      jsx(Group, { name: 'Track', children: [
        jsx(Rect, { size: [px(W), px(H)], roundness: px(H / 2) }),
        jsx(Fill, { color: expr('var e = effect("Toggle");\nL.mixv(e("Off Color").value, e("On Color").value, L.clamp(e("Value").value, 0, 1));') }),
      ] }),
      jsx(RigEffect, { def: TOGGLE_FX, name: 'Toggle', values: { 'Start On': !!p.on, 'On Color': p.onColor ?? t.accent, 'Off Color': t.track, Value: expr(toggleExpr('Toggle', 'Start On')) } }),
    ],
  });
  if (!p.label) return place(p.position, sw);
  const text = jsx(Text, { id: `${p.id}.label`, name: `${name} Label`, ...timing(p), ...noScale(mo), font: t.fonts.regular, size: px(16 * s), color: t.text, align: 'left', anchor: 'left', text: p.label });
  const r = jsx(Stack, { direction: 'row', gap: 12 * s, align: 'center', ...(p.width ? { width: p.width, justify: 'spaceBetween' } : {}), children: [text, sw] });
  return place(p.position, r);
}

// ---------- Checkbox ----------
export const CHECKBOX_FX: PseudoEffectDef = { name: 'aec Checkbox', params: [
  { kind: 'checkbox', name: 'Start Checked', default: false }, col('Check Color', [0.357, 0.549, 1]), col('Box Color', [0.08, 0.1, 0.14]), state('Value'),
] };

export interface CheckboxProps extends UiBase, Pick<UiEvents, 'clickAt'> {
  checked?: boolean;
  toggleAt?: number[];
  label?: string;
}

/** A checkbox: the box fills with the accent and the check mark draws on (Trim) when clicked; label to the right. */
export function Checkbox(p: CheckboxProps) {
  const { t, s, name } = resolve(p, 'Checkbox');
  const ev = events(p);
  const b = 22 * s;
  const flips = [...(ev.clickAt ?? []), ...(p.toggleAt ?? [])].sort((a, c) => a - c);
  const mo = motion(p, s);
  const V = 'L.clamp(effect("Checkbox")("Value").value, 0, 1)';
  const box = jsx(Shape, {
    id: p.id, name, ...timing(p), ...mo, tags: ['ui', 'checkbox'], markers: at(flips, 'toggle'),
    scale: expr(`// ae-compose ui: a small squeeze while it flips\nvar v = ${V};\nmul(value, 1 - 0.08 * 4 * v * (1 - v));`),
    children: [
      jsx(Group, { name: 'Check', children: [
        jsx(Path, { closed: false, points: [{ p: [lit(-0.27 * b), lit(0.01 * b)] }, { p: [lit(-0.08 * b), lit(0.2 * b)] }, { p: [lit(0.29 * b), lit(-0.2 * b)] }] }),
        jsx(Trim, { end: expr(`${V} * 100;`) }),
        jsx(Stroke, { color: t.onAccent, width: px(2.4 * s), cap: 'round', join: 'round' }),
      ] }),
      jsx(Group, { name: 'Box', children: [
        jsx(Rect, { size: [px(b), px(b)], roundness: px(6 * s) }),
        jsx(Stroke, { color: t.border, width: Math.max(1, 1.5 * s), opacity: expr(`(1 - ${V}) * 100;`) }),
        jsx(Fill, { color: expr(`var e = effect("Checkbox");\nL.mixv(e("Box Color").value, e("Check Color").value, ${V});`) }),
      ] }),
      jsx(RigEffect, { def: CHECKBOX_FX, name: 'Checkbox', values: { 'Start Checked': !!p.checked, 'Check Color': t.accent, 'Box Color': t.surface, Value: expr(toggleExpr('Checkbox', 'Start Checked')) } }),
    ],
  });
  if (!p.label) return place(p.position, box);
  const text = jsx(Text, { id: `${p.id}.label`, name: `${name} Label`, ...timing(p), ...noScale(mo), font: t.fonts.regular, size: px(15 * s), color: t.text, align: 'left', anchor: 'left', text: p.label });
  return place(p.position, row([box, text], 10 * s));
}

// ---------- values (Slider, ProgressBar) ----------
/** Value keys: the start value, then each event (null = hold the current value), eased between. */
function valueAnim(initial: number, ev: UiEvents['valueAt'], easing = 'easeInOutCubic'): number | Anim {
  if (!ev?.length) return initial;
  const ks: { t: number; v: number; easing?: any }[] = [{ t: 0, v: initial, easing }];
  let cur = initial;
  for (const e of [...ev].sort((a, b) => a.t - b.t)) {
    const v = e.v ?? cur;
    const last = ks[ks.length - 1];
    if (Math.abs(last.t - e.t) < 1e-4) last.v = v; else ks.push({ t: e.t, v, easing });
    cur = v;
  }
  return keys(...ks);
}

/** Label/value header row over a bar: "Volume ··· 64%". */
function barHeader(p: { label?: string; showValue?: boolean; unit?: string; id: string }, name: string, ref: string, w: number, t: any, s: number, tm: any, mo: any) {
  const parts: any[] = [];
  const fs = px(14 * s);
  if (p.label) parts.push(jsx(Text, { id: `${p.id}.label`, name: `${name} Label`, ...tm, ...mo, font: t.fonts.medium, size: fs, color: t.text, align: 'left', anchor: 'left', text: p.label }));
  if (p.showValue) parts.push(jsx(Text, {
    id: `${p.id}.value`, name: `${name} Value`, ...tm, ...mo, font: t.fonts.medium, size: fs, color: t.muted, align: 'right', anchor: 'right', text: `100${p.unit ?? '%'}`,
    layout: { width: textWidth(`100${p.unit ?? '%'}`, fs, 'medium') + 2 },
    expressions: { 'ADBE Text Properties/ADBE Text Document': `// ae-compose ui: shows the bar's value\nMath.round(${ref}) + ${JSON.stringify(p.unit ?? '%')};` },
  }));
  if (!parts.length) return null;
  return jsx(Stack, { direction: 'row', width: w, justify: parts.length > 1 ? 'spaceBetween' : p.label ? 'start' : 'end', align: 'center', children: parts });
}

export const SLIDER_FX: PseudoEffectDef = { name: 'aec Slider', params: [sl('Value', 50, 0, 100, { precision: 1 }), state('Drag')] };

export interface SliderProps extends UiBase, Pick<UiEvents, 'valueAt' | 'dragging'> {
  /** 0–100 (default 40). Animate with valueAt (or uiSteps drags with `value`). */
  value?: number;
  width?: number;
  label?: string;
  showValue?: boolean;
  unit?: string;
}

/** Thumb position on a slider at `position` of `width` for `value` 0–100 (for uiSteps drag targets). */
export function sliderPoint(position: [number, number], value: number, width = 240): [number, number] {
  return [position[0] - width / 2 + (width * value) / 100, position[1]];
}

/** A slider: track, accent fill and a thumb, driven by the "Slider" effect's Value (keys); the thumb grows while dragged. */
export function Slider(p: SliderProps) {
  const { t, s, name } = resolve(p, 'Slider');
  const ev = events(p);
  const W = (p.width ?? 240) * (p.width ? 1 : s), th = 4 * s, d = 22 * s;
  const V = 'effect("Slider")("Value").value / 100';
  const mo = motion(p, s);
  const bar = jsx(Shape, {
    id: p.id, name, ...timing(p), ...mo, tags: ['ui', 'slider'], markers: windows(ev.dragging, 'drag'),
    children: [
      jsx(Group, { name: 'Thumb',
        position: expr(`// ae-compose ui: thumb at the "Slider" effect's Value\nvar v = L.clamp(${V}, 0, 1);\n[${lit(-W / 2)} + ${lit(W)} * v, 0];`),
        scale: expr('// grows while dragged\nvar d = effect("Slider")("Drag").value;\n[100 + 18 * d, 100 + 18 * d];'),
        children: [jsx(Ellipse, { size: [px(d), px(d)] }), jsx(Stroke, { color: '#000000', width: Math.max(0.5, 0.5 * s), opacity: 18 }), jsx(Fill, { color: '#ffffff' })] }),
      jsx(Group, { name: 'Fill', children: [
        jsx(Rect, { size: expr(`var v = L.clamp(${V}, 0, 1);\n[Math.max(${lit(W)} * v, 0.01), ${lit(th)}];`), position: expr(`var v = L.clamp(${V}, 0, 1);\n[${lit(-W / 2)} + ${lit(W)} * v / 2, 0];`), roundness: px(th / 2) }),
        jsx(Fill, { color: t.accent }),
      ] }),
      jsx(Group, { name: 'Track', children: [jsx(Rect, { size: [px(W), px(th)], roundness: px(th / 2) }), jsx(Fill, { color: t.track })] }),
      jsx(RigEffect, { def: SLIDER_FX, name: 'Slider', values: { Value: valueAnim(p.value ?? 40, ev.valueAt), Drag: expr(hoverExpr('drag')) } }),
    ],
  });
  const head = barHeader(p, name, `__AEC_LAYER(${p.id})__.effect("Slider")("Value").value`, W, t, s, timing(p), noScale(mo));
  return place(p.position, head ? column([head, bar], 10 * s, 'center') : bar);
}

export const PROGRESS_FX: PseudoEffectDef = { name: 'aec Progress', params: [sl('Progress', 0, 0, 100, { precision: 1 })] };

export interface ProgressBarProps extends UiBase, Pick<UiEvents, 'valueAt'> {
  /** 0–100. Default: fills 0 → 100 from 0.3 s to 2.6 s. */
  value?: number;
  width?: number;
  height?: number;
  label?: string;
  showValue?: boolean;
  unit?: string;
  color?: UiColor;
}

/** A progress bar: the "Progress" effect's Progress (keys) sets the fill; optional label and live percentage. */
export function ProgressBar(p: ProgressBarProps) {
  const { t, s, name } = resolve(p, 'ProgressBar');
  const ev = events(p);
  const W = p.width ?? 280 * s, H = p.height ?? 8 * s;
  const prog = ev.valueAt?.length ? valueAnim(p.value ?? 0, ev.valueAt) : p.value !== undefined ? p.value : keys({ t: 0.3, v: 0, easing: 'easeInOutCubic' }, { t: 2.6, v: 100 });
  const P = 'L.clamp(effect("Progress")("Progress").value / 100, 0, 1)';
  const mo = motion(p, s);
  const bar = jsx(Shape, {
    id: p.id, name, ...timing(p), ...mo, tags: ['ui', 'progress'],
    children: [
      jsx(Group, { name: 'Fill', children: [
        jsx(Rect, { size: expr(`// ae-compose ui: fill at the "Progress" effect's Progress\nvar v = ${P};\n[Math.max(${lit(W)} * v, 0.01), ${lit(H)}];`), position: expr(`var v = ${P};\n[${lit(-W / 2)} + ${lit(W)} * v / 2, 0];`), roundness: px(H / 2) }),
        jsx(Fill, { color: p.color ?? t.accent }),
      ] }),
      jsx(Group, { name: 'Track', children: [jsx(Rect, { size: [px(W), px(H)], roundness: px(H / 2) }), jsx(Fill, { color: t.track })] }),
      jsx(RigEffect, { def: PROGRESS_FX, name: 'Progress', values: { Progress: prog } }),
    ],
  });
  const head = barHeader(p, name, `__AEC_LAYER(${p.id})__.effect("Progress")("Progress").value`, W, t, s, timing(p), noScale(mo));
  return place(p.position, head ? column([head, bar], 10 * s, 'center') : bar);
}

// ---------- Input ----------
export const INPUT_FX: PseudoEffectDef = { name: 'aec Input', params: [
  sl('Typing Speed', 14, 1, 60, { precision: 1 }), sl('Caret Blink', 1.1, 0, 5, { precision: 2 }), col('Border Color', [0.165, 0.192, 0.251]), col('Focus Color', [0.357, 0.549, 1]), state('Focus'),
] };

export interface InputProps extends UiBase, Pick<UiEvents, 'clickAt' | 'typeAt'> {
  /** The text that gets typed (or shown). */
  text?: string;
  placeholder?: string;
  label?: string;
  width?: number;
  /** Focus time (default: the first click, else just before typing). */
  focusAt?: number;
  blurAt?: number;
  /** Show bullets instead of the text. */
  secure?: boolean;
  /** Characters per second (default 14; the Input effect's Typing Speed). */
  typingSpeed?: number;
}

/**
 * A text field. Typing reveals the text layer's own text from the field's "type" marker at the "Input" effect's
 * Typing Speed (L.typed), with a caret that blinks while focused ("focus" … "blur" markers) and a focus ring.
 */
export function Input(p: InputProps) {
  const { t, s, name } = resolve(p, 'Input');
  const ev = events(p);
  const W = p.width ?? 300 * s, H = 48 * s, pad = 14 * s, fs = 16 * s;
  const text = p.text ?? '';
  const typing = (ev.typeAt?.length ?? 0) > 0;
  const focusAt = p.focusAt ?? ev.clickAt?.[0] ?? (typing ? Math.max(0, ev.typeAt![0] - 0.25) : undefined);
  const F = `__AEC_LAYER(${p.id})__`;
  const mo = motion(p, s);
  const field = jsx(Shape, {
    id: p.id, name, ...timing(p), ...mo, tags: ['ui', 'input'],
    markers: [...at(focusAt !== undefined ? [focusAt] : [], 'focus'), ...at(ev.typeAt, 'type'), ...at(p.blurAt !== undefined ? [p.blurAt] : [], 'blur')],
    children: [
      jsx(Group, { name: 'Field', children: [
        jsx(Rect, { size: [px(W), px(H)], roundness: px(t.radius * s * 0.85) }),
        jsx(Stroke, { color: expr('// ae-compose ui: focus ring ("Input" effect)\nvar e = effect("Input");\nL.mixv(e("Border Color").value, e("Focus Color").value, e("Focus").value);'), width: expr(`${lit(Math.max(1, s))} + ${lit(0.6 * s)} * effect("Input")("Focus").value;`) }),
        jsx(Fill, { color: t.surface }),
      ] }),
      jsx(RigEffect, { def: INPUT_FX, name: 'Input', values: { 'Typing Speed': p.typingSpeed ?? 14, 'Border Color': t.border, 'Focus Color': t.accent, Focus: expr([
        '// ae-compose ui: focus (0–1) from this layer\'s "focus" marker until a later "blur" marker',
        'var M = thisLayer.marker, f = -1, b = 1e6;',
        'for (var k = 1; k <= M.numKeys; k++) { var m = M.key(k); if (m.comment.indexOf("focus") == 0 && m.time <= time) f = m.time; }',
        'for (var k = 1; k <= M.numKeys; k++) { var m = M.key(k); if (m.comment.indexOf("blur") == 0 && m.time > f && f >= 0) { b = m.time; break; } }',
        'f < 0 ? 0 : L.smooth(0, 1, Math.min(L.clamp((time - f) / 0.15, 0, 1), 1 - L.clamp((time - b) / 0.2, 0, 1)));',
      ].join('\n')) } }),
    ],
  });
  const slot = { layout: { width: W - 2 * pad }, align: 'left' as const, anchor: 'left' as const, size: px(fs), ...timing(p), ...noScale(mo) };
  const parts: any[] = [field];
  if (p.placeholder && (typing || !text)) parts.push(jsx(Text, {
    id: `${p.id}.placeholder`, name: `${name} Placeholder`, ...slot, font: t.fonts.regular, color: t.muted, text: p.placeholder,
    // On the Opacity expression (`value * …`), so it multiplies an entrance fade's keys instead of replacing them.
    ...(typing ? { expressions: { 'ADBE Transform Group/ADBE Opacity': [
      '// ae-compose ui: hidden once the first character is typed',
      `var F = ${F}, M = F.marker, t0 = -1;`,
      'for (var k = 1; k <= M.numKeys; k++) { var m = M.key(k); if (m.comment.indexOf("type") == 0 && m.time <= time) t0 = m.time; }',
      'value * (t0 < 0 || (time - t0) * F.effect("Input")("Typing Speed").value < 1 ? 1 : 0);',
    ].join('\n') } } : {}),
  }));
  if (text) parts.push(jsx(Text, {
    id: `${p.id}.text`, name: `${name} Text`, ...slot, font: t.fonts.regular, color: t.text, text,
    expressions: { 'ADBE Text Properties/ADBE Text Document': [
      '// ae-compose ui: typing (the field\'s "type" marker, at the "Input" effect\'s Typing Speed) and a caret while focused; retype this text freely',
      `var F = ${F}, e = F.effect("Input"), M = F.marker, t0 = -1, any = false;`,
      'for (var k = 1; k <= M.numKeys; k++) { var m = M.key(k); if (m.comment.indexOf("type") == 0) { any = true; if (m.time <= time) t0 = m.time; } }',
      'var s = "" + value;',
      p.secure ? 's = new Array(s.length + 1).join("\\u2022");' : '',
      'var p = !any ? 1 : t0 < 0 ? 0 : (time - t0) * e("Typing Speed").value / Math.max(s.length, 1);',
      'L.typed(s, p, e("Focus").value > 0.5 ? "|" : "", time, e("Caret Blink").value);',
    ].filter(Boolean).join('\n') },
  }));
  const box = overlay(parts);
  if (!p.label) return place(p.position, box);
  const lab = jsx(Text, { id: `${p.id}.label`, name: `${name} Label`, ...timing(p), ...noScale(mo), font: t.fonts.medium, size: px(13 * s), color: t.muted, align: 'left', anchor: 'left', text: p.label });
  return place(p.position, column([lab, box], 8 * s, 'start'));
}

// ---------- Tabs ----------
export const TABS_FX: PseudoEffectDef = { name: 'aec Tabs', params: [sl('Start Tab', 1, 1, 12, { precision: 0, validMin: 1 }), state('Position')] };

export interface TabsProps extends UiBase, Pick<UiEvents, 'selectAt'> {
  tabs?: string[];
  /** Start tab (0-based). */
  selected?: number;
  /** 'segmented' (default: a raised pill slides between tabs) or 'underline'. */
  variant?: 'segmented' | 'underline';
  tabWidth?: number;
}

/** Tabs: the indicator springs to the tab named by each "select N" marker (1-based); other labels dim. */
export function Tabs(p: TabsProps) {
  const { t, s, name } = resolve(p, 'Tabs');
  const ev = events(p);
  const tabs = p.tabs ?? ['Overview', 'Activity', 'Settings'];
  const fs = 14 * s, h = 36 * s, pad = 3 * s;
  const tw = p.tabWidth ?? Math.max(...tabs.map((x) => textWidth(x, fs, 'semibold'))) + 28 * s;
  const W = tabs.length * tw + 2 * pad;
  const seg = (p.variant ?? 'segmented') === 'segmented';
  const mo = motion(p, s);
  const indY = seg ? 0 : h / 2 - 1.5 * s;
  const shape = jsx(Shape, {
    id: p.id, name, ...timing(p), ...mo, tags: ['ui', 'tabs'], markers: (ev.selectAt ?? []).map((x) => ({ t: x.t, comment: `select ${x.index + 1}` })),
    children: [
      jsx(Group, { name: 'Indicator', position: expr(`// ae-compose ui: slides to the selected tab ("Tabs" effect Position)\nvar x = effect("Tabs")("Position").value;\n[${lit(-W / 2 + pad + tw / 2)} + x * ${lit(tw)}, ${lit(indY)}];`), children: [
        jsx(Rect, { size: seg ? [px(tw), px(h - 2 * pad)] : [px(tw - 24 * s), px(2.5 * s)], roundness: seg ? px(t.radius * s * 0.75) : px(1.25 * s) }),
        jsx(Fill, { color: seg ? t.raised : t.accent }),
      ] }),
      jsx(Group, { name: 'Track', children: seg
        ? [jsx(Rect, { size: [px(W), px(h)], roundness: px(t.radius * s) }), jsx(Fill, { color: t.mode === 'dark' ? t.surface : t.track })]
        : [jsx(Rect, { size: [px(W), Math.max(1, s)], position: [0, px(h / 2)] }), jsx(Fill, { color: t.border }), jsx(Rect, { size: [px(W), px(h)], name: 'Bounds' }), jsx(Fill, { color: '#000000', opacity: 0, name: 'Bounds Fill' })] }),
      jsx(RigEffect, { def: TABS_FX, name: 'Tabs', values: { 'Start Tab': (p.selected ?? 0) + 1, Position: expr([
        '// ae-compose ui: selected tab position (0-based, springs) from this layer\'s "select N" markers (N is 1-based)',
        'var M = thisLayer.marker, cur = Math.round(effect("Tabs")("Start Tab").value) - 1, prev = cur, last = -1;',
        'for (var k = 1; k <= M.numKeys; k++) { var m = M.key(k); if (m.comment.indexOf("select") == 0 && m.time <= time) { var n = parseInt(m.comment.substr(7), 10); if (!isNaN(n)) { prev = cur; cur = n - 1; last = m.time; } } }',
        'last < 0 ? cur : L.lerp(prev, cur, L.spring(time - last, 1 / thisComp.frameDuration, 18, 220, 1));',
      ].join('\n')) } }),
    ],
  });
  const labels = tabs.map((x, i) => jsx(Text, {
    id: `${p.id}.tab${i}`, name: `${name} ${x}`, ...timing(p), ...noScale(mo), font: t.fonts.semibold, size: px(fs), color: t.text, text: x, layout: { width: tw },
    opacity: expr(`// ae-compose ui: dims unless selected\nvar x = __AEC_LAYER(${p.id})__.effect("Tabs")("Position").value;\nvalue * (0.55 + 0.45 * L.clamp(1 - Math.abs(x - ${i}), 0, 1));`),
  }));
  return place(p.position, overlay([shape, jsx(Stack, { direction: 'row', gap: 0, align: 'center', children: labels })]));
}
