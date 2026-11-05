// UI kit theme tokens (K1): colors, fonts, radius and a metric scale shared by every UI component. Two built-in
// themes (dark default, light); override any token, or derive one from brand() tokens. Colors may be control()
// refs (brand `live` colors): they stay live wherever the kit uses them as a property value.
import type { ColorSpec } from '../../shared/units.ts';
import { parseColor } from '../../shared/units.ts';
import type { ControlRef } from '../control.ts';
import { isControl } from '../control.ts';
import type { Brand } from '../brand.ts';

/** A theme color: a plain color or a live color control. */
export type UiColor = ColorSpec | ControlRef;

export interface UiFonts { regular: string; medium: string; semibold: string; bold: string }

export interface UiTheme {
  mode: 'dark' | 'light';
  /** App/screen background. */
  bg: UiColor;
  /** Cards, inputs, list rows. */
  surface: UiColor;
  /** Popovers: toasts, modals, tooltips, the selected tab. */
  raised: UiColor;
  border: UiColor;
  text: UiColor;
  /** Secondary text, placeholders, icons. */
  muted: UiColor;
  accent: UiColor;
  /** Text and marks on the accent color. */
  onAccent: UiColor;
  /** Inactive tracks (toggle off, slider/progress background). */
  track: UiColor;
  success: UiColor;
  danger: UiColor;
  warning: UiColor;
  /** Modal scrim color (drawn at ~55 %). */
  scrim: UiColor;
  /** Avatar background palette (picked by a hash of the name). */
  avatars: string[];
  /** Base corner radius for controls (cards use 1.6×). */
  radius: number;
  /** Metric multiplier: 1 = app points (a phone screen is 390 wide, a web page 1280); 2 for UI shown big on a 1080p canvas. */
  scale: number;
  fonts: UiFonts;
}

const FONTS: UiFonts = { regular: 'Inter-Regular', medium: 'Inter-Medium', semibold: 'Inter-SemiBold', bold: 'Inter-Bold' };
const AVATARS = ['#5b8cff', '#9b7bff', '#f06ba8', '#f59f4c', '#34c58f', '#25b9d6'];

export const darkTheme: UiTheme = {
  mode: 'dark', bg: '#0b0d12', surface: '#151a23', raised: '#1d2330', border: '#2a3140', text: '#eef1f6', muted: '#8b95a5',
  accent: '#5b8cff', onAccent: '#ffffff', track: '#2b3242', success: '#3ecf8e', danger: '#ff5a5f', warning: '#f5b544', scrim: '#05070a',
  avatars: AVATARS, radius: 12, scale: 1, fonts: FONTS,
};

export const lightTheme: UiTheme = {
  mode: 'light', bg: '#f4f6fa', surface: '#ffffff', raised: '#ffffff', border: '#dfe3ea', text: '#0f141c', muted: '#667085',
  accent: '#3d6df2', onAccent: '#ffffff', track: '#e3e7ee', success: '#16a34a', danger: '#e5484d', warning: '#d97706', scrim: '#0b0d12',
  avatars: AVATARS, radius: 12, scale: 1, fonts: FONTS,
};

export type UiThemeOverrides = Partial<Omit<UiTheme, 'fonts'>> & { base?: 'dark' | 'light'; fonts?: Partial<UiFonts> };
/** 'dark' (default), 'light', a full theme, or overrides on top of a base. */
export type ThemeInput = 'dark' | 'light' | UiThemeOverrides | UiTheme;

/** Resolves a theme input: uiTheme('light'), uiTheme({ base: 'light', accent: '#ff5a00', scale: 2 }). */
export function uiTheme(t?: ThemeInput): UiTheme {
  if (t === undefined || t === 'dark') return darkTheme;
  if (t === 'light') return lightTheme;
  const o = t as UiThemeOverrides;
  const base = (o.base ?? o.mode) === 'light' ? lightTheme : darkTheme;
  const out: UiTheme = { ...base, ...o, fonts: { ...base.fonts, ...(o.fonts ?? {}) } } as UiTheme;
  delete (out as any).base;
  return out;
}

const pickKey = (o: Record<string, any>, names: string[]) => names.find((n) => o[n] !== undefined);

/**
 * Theme overrides from brand() tokens: accent ← accent|primary|brand, bg ← bg|background|ink, text ← text|fg|paper|white,
 * surface ← surface|card; fonts ← regular|body, medium, semibold|label, bold|display. Live brand colors stay live.
 */
export function themeFromBrand(b: Brand<any, any, any>, base: 'dark' | 'light' = 'dark'): UiThemeOverrides {
  const c = b.colors as Record<string, UiColor>;
  const f = b.fonts as Record<string, string>;
  const o: UiThemeOverrides = { base };
  const map: [keyof UiTheme, string[]][] = [['accent', ['accent', 'primary', 'brand']], ['bg', ['bg', 'background', 'ink']], ['text', ['text', 'fg', 'paper']], ['surface', ['surface', 'card']], ['muted', ['muted', 'secondary']], ['border', ['border', 'line']]];
  for (const [tok, names] of map) { const k = pickKey(c, names); if (k) (o as any)[tok] = c[k]; }
  const fonts: Partial<UiFonts> = {};
  const fm: [keyof UiFonts, string[]][] = [['regular', ['regular', 'body']], ['medium', ['medium']], ['semibold', ['semibold', 'label']], ['bold', ['bold', 'display', 'heading']]];
  for (const [tok, names] of fm) { const k = pickKey(f, names); if (k) fonts[tok] = f[k]; }
  if (Object.keys(fonts).length) o.fonts = fonts;
  return o;
}

/** The plain value of a theme color (a control's default), for places that can't be live (shadows, expressions). */
export function plain(c: UiColor): string | readonly number[] {
  return isControl(c) ? (c.default as any) : (c as ColorSpec);
}

/** [r, g, b] in 0–1 of a theme color, rounded for readable expressions. */
export function rgb3(c: UiColor): number[] {
  return parseColor(plain(c) as ColorSpec).slice(0, 3).map((v) => +v.toFixed(4));
}

/** Mixes two plain colors (t = 0 → a), returned as a hex string. */
export function mixHex(a: UiColor, b: UiColor, t: number): string {
  const x = parseColor(plain(a) as ColorSpec), y = parseColor(plain(b) as ColorSpec);
  return '#' + [0, 1, 2].map((i) => Math.round((x[i] + (y[i] - x[i]) * t) * 255).toString(16).padStart(2, '0')).join('');
}
