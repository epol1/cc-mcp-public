// UI kit device frames (K1): PhoneFrame, TabletFrame, LaptopFrame, BrowserFrame, drawn with built-in shapes, and
// ScreenInsert (a screen recording with a cursor-follow zoom). A frame is one device precomp (bezel, screen, island
// or browser chrome; animate it as one layer, collapsed so it stays sharp when scaled) holding a screen precomp
// ("<name> Screen", masked to the display) where its children are laid out in screen points.
import { Fragment, jsx } from '../jsx-runtime.ts';
import type { AecElement } from '../jsx-runtime.ts';
import { Effect, Ellipse, Fill, Footage, Group, Mask, Null, Path, Precomp, Rect, RigEffect, Shape, Solid, Stroke, Text } from '../primitives.ts';
import type { FootageProps, LayerProps } from '../primitives.ts';
import { expr, keys } from '../anim.ts';
import type { Anim } from '../anim.ts';
import type { PseudoEffectDef } from '../../compile/ffx/pseudo.ts';
import type { ThemeInput, UiColor, UiTheme } from './theme.ts';
import { plain, uiTheme } from './theme.ts';
import { motion } from './common.ts';

export interface FrameProps extends Omit<LayerProps, 'children' | 'id'> {
  id: string;
  theme?: ThemeInput;
  /** Screen size in points (content is laid out at this size). */
  screen?: [number, number];
  /** Screen background (default theme bg; false for none). */
  screenBg?: UiColor | false;
  /** Soft drop shadow under the device (default true). */
  shadow?: boolean;
  /** Entrance/exit (rise + fade; settle on exit). Your own `animate` wins per prop. */
  enterAt?: number;
  exitAt?: number;
  /** Screen content. */
  children?: any;
}

interface DeviceSpec {
  kind: string;
  size: [number, number];
  screen: [number, number];
  screenCenter: [number, number];
  mask: any;
  body: AecElement[];
  over?: AecElement[];
  screenTop?: AecElement[];
}

const rr = (v: number) => Math.round(v * 2) / 2;

function device(p: FrameProps, t: UiTheme, d: DeviceSpec): AecElement {
  const { id, name: nm, theme: _t, screen: _s, screenBg, shadow, enterAt, exitAt, children, animate, ...layer } = p as FrameProps & Record<string, any>;
  for (const k of ['statusBar', 'portrait', 'url', 'notch', 'screenRadius']) delete (layer as any)[k];
  const name = nm ?? `${d.kind} ${id}`;
  const mo = motion({ enterAt, exitAt }, 1.6);
  const anim = { ...(mo.animate ?? {}), ...(animate ?? {}) };
  const [sw, sh] = d.screen;
  const screen = jsx(Precomp, {
    id: `${id}.screen`, name: `${name} Screen`, width: sw, height: sh, collapse: true, position: d.screenCenter,
    effects: [jsx(Mask, { name: 'Display', ...d.mask })],
    children: [
      ...(screenBg === false ? [] : [jsx(Solid, { id: `${id}.screenBg`, name: `${name} Screen BG`, color: plain(screenBg ?? t.bg) })]),
      children,
      ...(d.screenTop ?? []),
    ],
  });
  return jsx(Precomp, {
    ...layer, id, name, width: Math.ceil(d.size[0]), height: Math.ceil(d.size[1]), collapse: true, tags: ['ui', 'frame'],
    ...(Object.keys(anim).length ? { animate: anim } : {}),
    effects: shadow === false ? [] : [jsx(Effect, { name: 'Drop Shadow', label: 'Device Shadow', params: { 'Shadow Color': '#000000', Opacity: t.mode === 'dark' ? 55 : 22, Direction: 180, Distance: 24, Softness: 70 } })],
    children: [...d.body, screen, ...(d.over ?? [])],
  });
}

const ink = (t: UiTheme) => t.text;

// ---------- Phone ----------
export interface PhoneFrameProps extends FrameProps {
  /** Status bar (9:41, signal, battery) and home indicator (default true). */
  statusBar?: boolean;
  screenRadius?: number;
}

/** A modern phone: 390 × 844 pt screen, thin black bezel, metal edge, side buttons, Dynamic Island, status bar. */
export function PhoneFrame(p: PhoneFrameProps) {
  const t = uiTheme(p.theme);
  const [sw, sh] = p.screen ?? [390, 844];
  const b = 12, R = p.screenRadius ?? 55;
  const bw = sw + 2 * b, bh = sh + 2 * b, DW = bw + 8, DH = bh;
  const name = p.name ?? `Phone ${p.id}`;
  const btn = (x: number, y: number, h: number) => jsx(Group, { name: 'Button', position: [x, rr(-bh / 2 + y + h / 2)], children: [jsx(Rect, { size: [4, h], roundness: 2 }), jsx(Fill, { color: '#2a2d33' })] });
  const body = jsx(Shape, { id: `${p.id}.body`, name: `${name} Body`, children: [
    jsx(Group, { name: 'Body', children: [jsx(Rect, { size: [bw, bh], roundness: R + b }), jsx(Stroke, { color: '#3b4048', width: 3 }), jsx(Fill, { color: '#050607' })] }),
    jsx(Group, { name: 'Buttons', children: [btn(-bw / 2 - 1, 120, 30), btn(-bw / 2 - 1, 180, 62), btn(-bw / 2 - 1, 255, 62), btn(bw / 2 + 1, 220, 96)] }),
  ] });
  const island = jsx(Shape, { id: `${p.id}.island`, name: `${name} Island`, position: [DW / 2, (DH - sh) / 2 + 29], children: [jsx(Rect, { size: [122, 36], roundness: 18 }), jsx(Fill, { color: '#000000' })] });
  const top: AecElement[] = p.statusBar === false ? [] : [
    jsx(Text, { id: `${p.id}.time`, name: `${name} Time`, font: t.fonts.semibold, size: 17, color: ink(t), text: '9:41', position: [64, 30] }),
    jsx(Shape, { id: `${p.id}.icons`, name: `${name} Status Icons`, position: [sw - 66, 30], children: [
      jsx(Group, { name: 'Battery', position: [16, 0], children: [
        jsx(Group, { name: 'Cap', position: [14.5, 0], children: [jsx(Rect, { size: [1.6, 4.5], roundness: 0.8 }), jsx(Fill, { color: ink(t), opacity: 45 })] }),
        jsx(Group, { name: 'Level', children: [jsx(Rect, { size: [21, 9], roundness: 2 }), jsx(Fill, { color: ink(t) })] }),
        jsx(Group, { name: 'Case', children: [jsx(Rect, { size: [26, 13], roundness: 4 }), jsx(Stroke, { color: ink(t), width: 1, opacity: 45 })] }),
      ] }),
      jsx(Group, { name: 'Signal', position: [-22, 0], children: [0, 1, 2, 3].map((i) => jsx(Group, { name: `Bar ${i + 1}`, position: [i * 5 - 7.5, rr(5.5 - (4 + i * 2.4) / 2)], children: [jsx(Rect, { size: [3, rr(4 + i * 2.4)], roundness: 1 }), jsx(Fill, { color: ink(t) })] })) }),
    ] }),
    jsx(Shape, { id: `${p.id}.home`, name: `${name} Home Indicator`, position: [sw / 2, sh - 9], children: [jsx(Rect, { size: [134, 5], roundness: 2.5 }), jsx(Fill, { color: ink(t), opacity: 85 })] }),
  ];
  return device(p, t, { kind: 'Phone', size: [DW, DH], screen: [sw, sh], screenCenter: [DW / 2, DH / 2], mask: { rect: { x: 0, y: 0, width: sw, height: sh, roundness: R } }, body: [body], over: [island], screenTop: top });
}

// ---------- Tablet ----------
export interface TabletFrameProps extends FrameProps {
  /** Portrait (820 × 1180 pt) instead of the default landscape (1180 × 820 pt). */
  portrait?: boolean;
}

/** A tablet: even bezel, rounded display, front camera on the top bezel. */
export function TabletFrame(p: TabletFrameProps) {
  const t = uiTheme(p.theme);
  const portrait = !!p.portrait;
  const [sw, sh] = p.screen ?? (portrait ? [820, 1180] : [1180, 820]);
  const b = 20, R = 18;
  const bw = sw + 2 * b, bh = sh + 2 * b;
  const name = p.name ?? `Tablet ${p.id}`;
  const body = jsx(Shape, { id: `${p.id}.body`, name: `${name} Body`, children: [
    jsx(Group, { name: 'Camera', position: [0, -bh / 2 + b / 2], children: [jsx(Group, { name: 'Lens', children: [jsx(Ellipse, { size: [3.5, 3.5] }), jsx(Fill, { color: '#2e3542' })] }), jsx(Ellipse, { size: [8, 8] }), jsx(Fill, { color: '#1b1e24' })] }),
    jsx(Group, { name: 'Body', children: [jsx(Rect, { size: [bw, bh], roundness: R + b }), jsx(Stroke, { color: '#33373e', width: 3 }), jsx(Fill, { color: '#0c0d10' })] }),
  ] });
  return device(p, t, { kind: 'Tablet', size: [bw, bh], screen: [sw, sh], screenCenter: [bw / 2, bh / 2], mask: { rect: { x: 0, y: 0, width: sw, height: sh, roundness: R } }, body: [body] });
}

// ---------- Laptop ----------
export interface LaptopFrameProps extends FrameProps {
  /** Camera notch at the top of the display (default true). */
  notch?: boolean;
}

/** A laptop: thin-bezel lid with a camera notch and a wide base with a thumb groove. Screen 1280 × 800 pt. */
export function LaptopFrame(p: LaptopFrameProps) {
  const t = uiTheme(p.theme);
  const [sw, sh] = p.screen ?? [1280, 800];
  const side = 14, top = 16, bottom = 18;
  const lw = sw + 2 * side, lh = sh + top + bottom, baseW = Math.round(lw * 1.13), baseH = 14;
  const DW = baseW, DH = lh + baseH;
  const name = p.name ?? `Laptop ${p.id}`;
  const body = jsx(Shape, { id: `${p.id}.body`, name: `${name} Body`, children: [
    jsx(Group, { name: 'Base', position: [0, DH / 2 - baseH / 2], children: [
      jsx(Group, { name: 'Groove', position: [0, -baseH / 2 + 2.5], children: [jsx(Rect, { size: [170, 5], roundness: 2.5 }), jsx(Fill, { color: '#25282d' })] }),
      jsx(Group, { name: 'Lip', position: [0, -baseH / 2 + 1], children: [jsx(Rect, { size: [baseW - 8, 2] }), jsx(Fill, { color: '#7a7f88' })] }),
      jsx(Rect, { size: [baseW, baseH], roundness: 7 }), jsx(Fill, { color: '#4a4f57' }),
    ] }),
    jsx(Group, { name: 'Lid', position: [0, -DH / 2 + lh / 2], children: [jsx(Rect, { size: [lw, lh], roundness: 16 }), jsx(Stroke, { color: '#30343b', width: 2 }), jsx(Fill, { color: '#08090b' })] }),
  ] });
  const over = p.notch === false ? [] : [jsx(Shape, { id: `${p.id}.notch`, name: `${name} Notch`, position: [DW / 2, top + 1], children: [jsx(Rect, { size: [150, 20], roundness: 7 }), jsx(Fill, { color: '#08090b' })] })];
  return device(p, t, { kind: 'Laptop', size: [DW, DH], screen: [sw, sh], screenCenter: [DW / 2, top + sh / 2], mask: { rect: { x: 0, y: 0, width: sw, height: sh, roundness: 6 } }, body: [body], over });
}

// ---------- Browser ----------
export interface BrowserFrameProps extends FrameProps {
  url?: string;
}

/** A browser window: chrome bar with traffic-light dots and a URL pill, page area below (1280 × 760 pt viewport). */
export function BrowserFrame(p: BrowserFrameProps) {
  const t = uiTheme(p.theme);
  const [sw, sh] = p.screen ?? [1280, 760];
  const bar = 44, r = 12;
  const DW = sw, DH = sh + bar;
  const name = p.name ?? `Browser ${p.id}`;
  const dark = t.mode === 'dark';
  const chrome = dark ? '#1b1f27' : '#eceff3', pill = dark ? '#262b35' : '#ffffff';
  const uw = Math.min(520, Math.round(sw * 0.42));
  const url = p.url ?? 'app.example.com';
  const dot = (i: number, c: string) => jsx(Group, { name: `Dot ${i + 1}`, position: [-DW / 2 + 22 + 20 * i, -DH / 2 + bar / 2], children: [jsx(Ellipse, { size: [12, 12] }), jsx(Fill, { color: c })] });
  const body = jsx(Shape, { id: `${p.id}.chrome`, name: `${name} Chrome`, children: [
    jsx(Group, { name: 'URL Bar', position: [0, -DH / 2 + bar / 2], children: [jsx(Rect, { size: [uw, 28], roundness: 8 }), jsx(Fill, { color: pill })] }),
    jsx(Group, { name: 'Dots', children: [dot(0, '#ff5f57'), dot(1, '#febc2e'), dot(2, '#28c840')] }),
    jsx(Group, { name: 'Divider', position: [0, -DH / 2 + bar - 0.5], children: [jsx(Rect, { size: [DW, 1] }), jsx(Fill, { color: t.border })] }),
    jsx(Group, { name: 'Window', children: [jsx(Rect, { size: [DW, DH], roundness: r }), jsx(Stroke, { color: t.border, width: 1 }), jsx(Fill, { color: chrome })] }),
  ] });
  const lockX = DW / 2 - (url.length * 3.6) - 14;
  const over = [
    jsx(Text, { id: `${p.id}.url`, name: `${name} URL`, font: t.fonts.regular, size: 13, color: t.muted, text: url, position: [DW / 2, bar / 2] }),
    jsx(Shape, { id: `${p.id}.lock`, name: `${name} Lock`, position: [rr(lockX), bar / 2 + 1], children: [
      jsx(Group, { name: 'Shackle', children: [jsx(Path, { closed: false, d: 'M-2.6 -1 V-3 C-2.6 -6.4 2.6 -6.4 2.6 -3 V-1' }), jsx(Stroke, { color: t.muted, width: 1.3 })] }),
      jsx(Group, { name: 'Lock Body', position: [0, 1.5], children: [jsx(Rect, { size: [8, 6.5], roundness: 1.5 }), jsx(Fill, { color: t.muted })] }),
    ] }),
  ];
  const k = r * 0.45;
  const mask = { path: `M0 0 H${sw} V${sh - r} C${sw} ${sh - k} ${sw - k} ${sh} ${sw - r} ${sh} H${r} C${k} ${sh} 0 ${sh - k} 0 ${sh - r} Z` };
  return device(p, t, { kind: 'Browser', size: [DW, DH], screen: [sw, sh], screenCenter: [DW / 2, bar + sh / 2], mask, body: [body], over });
}

// ---------- ScreenInsert ----------
/** "aec Screen Zoom": the zoom amount (keys) and how much the focus point is smoothed (s). */
export const SCREEN_ZOOM_FX: PseudoEffectDef = { name: 'aec Screen Zoom', params: [
  { kind: 'slider', name: 'Zoom', default: 100, min: 100, max: 400, precision: 1, display: 'percent' },
  { kind: 'slider', name: 'Smoothing', default: 0.25, min: 0, max: 2, precision: 2 },
] };

export interface ScreenInsertProps extends Omit<FootageProps, 'children' | 'id' | 'fit'> {
  id: string;
  /** Zoom moves: zoom to `scale` (default 1.8×) at `at` over `duration` (0.8 s), hold `hold` (1.5 s), zoom back out. */
  zooms?: { at: number; scale?: number; duration?: number; hold?: number }[];
  /** Focus point keys (screen px) or one point; default the centre. Drag the "<name> Focus" null in AE. */
  focus?: [number, number] | { t: number; p: [number, number] }[];
  /** Follow a layer instead (id in the same comp, e.g. a Cursor): the focus null tracks its anchor. */
  follow?: string;
  smoothing?: number;
}

/** Zoom keys for the "Screen Zoom" effect. */
function zoomKeys(z: NonNullable<ScreenInsertProps['zooms']>): number | Anim {
  if (!z.length) return 100;
  const ks: { t: number; v: number; easing?: any; hold?: boolean }[] = [{ t: 0, v: 100, hold: true }];
  for (const m of [...z].sort((a, b) => a.at - b.at)) {
    const d = m.duration ?? 0.8, h = m.hold ?? 1.5, sc = (m.scale ?? 1.8) * 100;
    const prev = ks[ks.length - 1];
    if (m.at < prev.t) throw new Error(`<ScreenInsert>: zoom at ${m.at}s overlaps the previous zoom (ends ${prev.t}s)`);
    if (m.at > prev.t + 1e-3) ks.push({ t: m.at, v: 100, easing: 'easeInOutCubic' }); else { prev.hold = false; prev.easing = 'easeInOutCubic'; }
    ks.push({ t: m.at + d, v: sc, hold: true }, { t: m.at + d + h, v: sc, easing: 'easeInOutCubic' }, { t: m.at + d + h + d * 0.9, v: 100, hold: true });
  }
  return keys(...ks);
}

/**
 * A screen recording that fills its comp (put it in a frame's screen) with a cursor-follow zoom: the "Screen Zoom"
 * effect's Zoom scales the footage around the "<name> Focus" null (smoothed), so the focus point stays where it is on
 * screen while the view closes in and the edges never show. Animate Zoom, drag/keyframe the null, or `follow` a cursor.
 */
export function ScreenInsert(p: ScreenInsertProps) {
  const { id, zooms, focus, follow, smoothing, name: nm, muted, ...foot } = p;
  if (!id) throw new Error('<ScreenInsert> needs an id');
  if (!p.src && !p.item) throw new Error(`<ScreenInsert id="${id}"> needs src (a screen recording) or item`);
  const name = nm ?? `Screen ${id}`;
  const fId = `${id}.focus`;
  let fpos: any = expr('[thisComp.width / 2, thisComp.height / 2];');
  if (follow) fpos = expr(`// ae-compose ui: follows ${follow}\nvar C = __AEC_LAYER(${follow})__;\nC.toComp(C.anchorPoint);`);
  else if (Array.isArray(focus) && typeof focus[0] === 'number') fpos = focus;
  else if (Array.isArray(focus) && focus.length) fpos = (focus as { t: number; p: [number, number] }[]).length === 1 ? (focus as any)[0].p : keys(...(focus as { t: number; p: [number, number] }[]).map((f) => ({ t: f.t, v: f.p, easing: 'easeInOutCubic' as const })));
  const footage = jsx(Footage, {
    ...foot, id, name, fit: 'cover', muted: muted ?? true, tags: ['ui', 'screen'],
    scale: expr('// ae-compose ui: zoom ("Screen Zoom" effect; value is the cover-fit scale)\nmul(value, effect("Screen Zoom")("Zoom").value / 100);'),
    position: expr([
      `// ae-compose ui: zoom around the "${name} Focus" null (smoothed), which stays put on screen while the view scales`,
      `var e = effect("Screen Zoom"), z = e("Zoom").value / 100, F = __AEC_LAYER(${fId})__.transform.position, sm = e("Smoothing").value, f = [0, 0];`,
      'for (var k = 0; k < 6; k++) f = add(f, mul(F.valueAtTime(time - sm * k / 5), 1 / 6));',
      'add(value, mul(sub(value, f), z - 1));',
    ].join('\n')),
    children: [jsx(RigEffect, { def: SCREEN_ZOOM_FX, name: 'Screen Zoom', values: { Zoom: zoomKeys(zooms ?? []), Smoothing: smoothing ?? 0.25 } })],
  });
  return jsx(Fragment, { children: [footage, jsx(Null, { id: fId, name: `${name} Focus`, guide: true, position: fpos })] });
}
