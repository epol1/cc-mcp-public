// Data viz kit (K2) shared pieces: data normalization (numbers, {label, value} rows, multi-series), nice-number
// scales, number formatting (mirrors the expression library's L.num), the palette, the theme, the easing table the
// rig's "Easing" popup offers, and the chart box (title-safe by default).
import type { Time } from '@ae-mcp/core/units.ts';

/** One value: a number, or a row with a label (and an optional fixed color). */
export type Datum = number | { label?: string; value: number; color?: string };
/** A named series of values (multi-series charts: grouped, stacked, several lines). */
export interface SeriesSpec { name: string; values: Datum[]; color?: string }

export interface DataProps {
  /** Values: numbers, `{ label, value }` rows, or rows with several numeric columns (one series per column, see `keys`). */
  data?: Datum[] | Record<string, any>[];
  /** Several series (alternative to `data`). Category labels come from `labels` or the rows' labels. */
  series?: SeriesSpec[];
  /** Category labels (default: the rows' `label`, else 1, 2, 3…). */
  labels?: string[];
  /** Columns of `data` rows to chart as series (default: every numeric column except `value`). */
  keys?: string[];
  /** Series colors (default: the kit palette). */
  colors?: string[];
}

export interface ChartSeries { name: string; color: string; values: number[]; colors: (string | undefined)[] }
export interface ChartData { labels: string[]; series: ChartSeries[] }

export const PALETTE = ['#4683c4', '#ffd23f', '#ee4266', '#3bceac', '#9b7bff', '#ff8c42', '#62c6f2', '#f28dc2'];

const isNum = (v: any) => typeof v === 'number' && Number.isFinite(v);

/** Normalizes the data props of a chart into category labels and numeric series. */
export function normalizeData(p: DataProps, who: string): ChartData {
  let labels: string[] | undefined = p.labels?.map(String);
  const series: ChartSeries[] = [];
  const color = (s: number, c?: string) => c ?? p.colors?.[s] ?? PALETTE[s % PALETTE.length];
  const datum = (d: Datum, where: string): { v: number; label?: string; color?: string } => {
    if (isNum(d)) return { v: d as number };
    if (d && typeof d === 'object' && isNum((d as any).value)) return { v: (d as any).value, label: (d as any).label !== undefined ? String((d as any).label) : undefined, color: (d as any).color };
    throw new Error(`${who}: ${where} is not a number or { label, value } (got ${JSON.stringify(d)})`);
  };
  if (p.series?.length) {
    p.series.forEach((s, k) => {
      if (!s || !Array.isArray(s.values)) throw new Error(`${who}: series[${k}] needs { name, values: [...] }`);
      const ds = s.values.map((d, i) => datum(d, `series[${k}].values[${i}]`));
      if (!labels && ds.every((d) => d.label !== undefined)) labels = ds.map((d) => d.label!);
      series.push({ name: String(s.name ?? `Series ${k + 1}`), color: color(k, s.color), values: ds.map((d) => d.v), colors: ds.map((d) => d.color) });
    });
  } else if (p.data?.length) {
    const rows = p.data as any[];
    const single = rows.every((r) => isNum(r) || (r && typeof r === 'object' && isNum(r.value)));
    if (single) {
      const ds = rows.map((d, i) => datum(d, `data[${i}]`));
      if (!labels && ds.every((d) => d.label !== undefined)) labels = ds.map((d) => d.label!);
      series.push({ name: 'Value', color: color(0), values: ds.map((d) => d.v), colors: ds.map((d) => d.color) });
    } else {
      const bad = rows.findIndex((r) => !isNum(r) && !(r && typeof r === 'object'));
      if (bad >= 0) throw new Error(`${who}: data[${bad}] is ${JSON.stringify(rows[bad])}; give numbers, { label, value } rows, or objects with numeric columns`);
      if (rows.some(isNum)) throw new Error(`${who}: data mixes numbers and rows; use one form`);
      const keys = p.keys ?? Object.keys(rows[0]).filter((k) => k !== 'label' && k !== 'name' && k !== 'color' && isNum(rows[0][k]));
      if (!keys.length) throw new Error(`${who}: data rows have no numeric columns; give { label, value } rows or keys: [...]`);
      if (!labels) labels = rows.map((r, i) => String(r.label ?? r.name ?? i + 1));
      keys.forEach((k, s) => {
        const values = rows.map((r, i) => { if (!isNum(r[k])) throw new Error(`${who}: data[${i}].${k} is not a number (got ${JSON.stringify(r[k])})`); return r[k] as number; });
        series.push({ name: k, color: color(s), values, colors: values.map(() => undefined) });
      });
    }
  } else throw new Error(`${who}: give data={[...]} (numbers or { label, value } rows) or series={[{ name, values }]}`);
  const n = series[0].values.length;
  if (!n) throw new Error(`${who}: the data is empty`);
  for (const s of series) if (s.values.length !== n) throw new Error(`${who}: series "${s.name}" has ${s.values.length} values, but "${series[0].name}" has ${n}; every series needs one value per category`);
  labels = labels ?? Array.from({ length: n }, (_, i) => String(i + 1));
  if (labels.length !== n) throw new Error(`${who}: ${labels.length} labels for ${n} values`);
  return { labels, series };
}

export interface ScaleOpts {
  /** Fixed axis minimum (default: 0, or the data minimum when lower). */
  min?: number;
  /** Fixed axis maximum (default: a nice number above the data maximum). */
  max?: number;
  /** About how many intervals between gridlines (default 5). With a fixed min and max, exactly this many. */
  ticks?: number;
  /** Include zero in the axis (default true). */
  zero?: boolean;
}
export interface NiceScale { min: number; max: number; step: number; ticks: number[]; decimals: number }

const decimalsOf = (x: number) => { const s = String(+x.toFixed(10)); const k = s.indexOf('.'); return k < 0 ? 0 : s.length - k - 1; };

/**
 * Nice-number axis: steps of 1, 2, 2.5 or 5 × 10^k, about `ticks` intervals, the smallest headroom. 0–128 gives
 * 0/25/…/150; 0–96 gives 0/20/…/100; 0–0.73 gives 0/0.2/…/0.8. A fixed `min` and `max` split into exactly `ticks`.
 */
export function niceScale(dataMin: number, dataMax: number, opts: ScaleOpts = {}, maxIntervals = 8): NiceScale {
  const zero = opts.zero !== false;
  let lo = opts.min ?? (zero ? Math.min(0, dataMin) : dataMin);
  let hi = opts.max ?? (zero ? Math.max(0, dataMax) : dataMax);
  if (!(hi > lo)) hi = lo + (Math.abs(lo) || 1);
  const target = Math.max(1, Math.round(opts.ticks ?? 5));
  if (opts.min !== undefined && opts.max !== undefined) {
    const step = (hi - lo) / target;
    return { min: lo, max: hi, step, ticks: Array.from({ length: target + 1 }, (_, k) => +(lo + step * k).toFixed(10)), decimals: Math.min(3, decimalsOf(step)) };
  }
  const span = hi - lo;
  const mag = 10 ** Math.floor(Math.log10(span / target));
  let best: { a: number; b: number; step: number; score: number } | null = null;
  for (const m of [mag / 10, mag, mag * 10]) for (const f of [1, 2, 2.5, 5]) {
    const step = +(f * m).toPrecision(12);
    const a = opts.min !== undefined ? lo : Math.floor(lo / step + 1e-9) * step;
    const b = opts.max !== undefined ? hi : Math.ceil(hi / step - 1e-9) * step;
    const n = (b - a) / step;
    if (Math.abs(n - Math.round(n)) > 1e-6 || n < Math.min(2, maxIntervals) || n > maxIntervals) continue;
    const score = Math.abs(n - target) + ((b - a) - span) / span;
    if (!best || score < best.score - 1e-9) best = { a, b, step, score };
  }
  if (!best) { const step = span / target; best = { a: lo, b: hi, step, score: 0 }; }
  const n = Math.round((best.b - best.a) / best.step);
  return { min: +best.a.toFixed(10), max: +best.b.toFixed(10), step: best.step, ticks: Array.from({ length: n + 1 }, (_, k) => +(best!.a + best!.step * k).toFixed(10)), decimals: Math.min(3, decimalsOf(best.step)) };
}

/**
 * The value axis for a plot `room` px long: the nice scale with as many intervals as fit (about 5) without tick labels
 * crowding (vertical: 1.8 x tick size apart; horizontal: the widest label + 24 px). Returns the tick format too.
 */
export function fitScale(lo: number, hi: number, opts: ScaleOpts | undefined, room: number, tickSize: number, horizontal: boolean, tickFmt: (s: NiceScale) => NumberFormat): { scale: NiceScale; tickFmt: NumberFormat } {
  const want = Math.max(1, Math.round(opts?.ticks ?? 5));
  const fixed = opts?.min !== undefined && opts?.max !== undefined;
  let best: { scale: NiceScale; tickFmt: NumberFormat } | null = null;
  for (let n = Math.min(want + 1, 8); n >= 1; n--) {
    const scale = niceScale(lo, hi, { ...opts, ticks: Math.min(want, n) }, fixed ? 64 : n);
    const tf = tickFmt(scale), k = scale.ticks.length - 1;
    const need = horizontal ? Math.max(...scale.ticks.map((t) => textWidth(formatNumber(t, tf), tickSize))) + 24 : tickSize * 1.8;
    best = { scale, tickFmt: tf };
    if (room / Math.max(k, 1) >= need) return best;
  }
  return best!;
}

/** Number formatting for value labels, ticks and counters (prefix, suffix, decimals, thousands separator). */
export interface NumberFormat { prefix?: string; suffix?: string; decimals?: number; separator?: string; decimalMark?: string }

/** L.num of the expression library, line for line (tests check parity), so build-time text equals the live text. */
function num(v: number, decimals: number, sep: string, dec: string): string {
  const d = decimals || 0, neg = v < 0, x = Math.abs(v).toFixed(d), parts = x.split('.'), ip = parts[0];
  let out = '';
  for (let i = 0; i < ip.length; i++) { if (i > 0 && (ip.length - i) % 3 === 0) out += sep; out += ip.charAt(i); }
  return (neg ? '-' : '') + out + (d > 0 ? (dec || '.') + parts[1] : '');
}
export function formatNumber(v: number, f: NumberFormat = {}): string {
  return `${f.prefix ?? ''}${num(v, f.decimals ?? 0, f.separator ?? ',', f.decimalMark ?? '.')}${f.suffix ?? ''}`;
}
/** The same formatting as an expression: `jsFormat('v', f)` → `"$" + L.num(v, 0, ",", ".") + "M"`. */
export function jsFormat(expr: string, f: NumberFormat = {}, decimalsExpr?: string): string {
  const parts: string[] = [];
  if (f.prefix) parts.push(JSON.stringify(f.prefix));
  parts.push(`L.num(${expr}, ${decimalsExpr ?? f.decimals ?? 0}, ${JSON.stringify(f.separator ?? ',')}, ${JSON.stringify(f.decimalMark ?? '.')})`);
  if (f.suffix) parts.push(JSON.stringify(f.suffix));
  return parts.join(' + ');
}
/** Decimals needed to show these values (at most 2). */
export const dataDecimals = (vals: number[]) => Math.min(2, Math.max(0, ...vals.map(decimalsOf)));

/** Easings the rig's "Easing" popup offers (bezier from src/shared/easing.ts; Spring is the library's closed form). */
export type EaseName = 'easeOutExpo' | 'easeOutQuint' | 'easeOutCubic' | 'easeOutBack' | 'easeInOutCubic' | 'spring';
export const EASES: { name: EaseName; label: string; bezier: number[] | null }[] = [
  { name: 'easeOutExpo', label: 'Expo Out', bezier: [0.16, 1, 0.3, 1] },
  { name: 'easeOutQuint', label: 'Quint Out', bezier: [0.22, 1, 0.36, 1] },
  { name: 'easeOutCubic', label: 'Cubic Out', bezier: [0.3333, 1, 0.6667, 1] },
  { name: 'easeOutBack', label: 'Back Out', bezier: [0.34, 1.56, 0.64, 1] },
  { name: 'easeInOutCubic', label: 'In-Out Cubic', bezier: [0.65, 0, 0.35, 1] },
  { name: 'spring', label: 'Spring', bezier: null },
];
export function easeIndex(name: EaseName | undefined, def: EaseName): number {
  const n = name ?? def;
  const i = EASES.findIndex((e) => e.name === n);
  if (i < 0) throw new Error(`easing "${n}" is not one of ${EASES.map((e) => e.name).join(', ')}`);
  return i + 1;
}

/** Chart animation timing (all live on the chart's rig effect). */
export interface ChartAnimation {
  /** Seconds after the chart's start before the data animates (axes arrive just before). */
  delay?: number;
  /** Seconds between consecutive bars / points / segments. */
  stagger?: number;
  /** Seconds each bar / point / segment takes (draw-on: the whole line). */
  duration?: number;
  easing?: EaseName;
  /**
   * Exit (arrive → hold → leave): 'auto' (default) plays it at the end of the chart's layers only when they end
   * before the comp does (a chart in a Sequence leaves; a final chart holds); true always; false never.
   */
  exit?: boolean | 'auto';
  /** Exit length in seconds (default 0.45). */
  exitDuration?: number;
}

export interface ChartTheme {
  /** Value labels, callouts. */
  text: string;
  /** Category and tick labels, legend. */
  muted: string;
  /** Gridlines. */
  grid: string;
  font: string;
  boldFont: string;
  labelSize: number;
  tickSize: number;
  valueSize: number;
  legendSize: number;
  calloutSize: number;
}
export const DARK_THEME: ChartTheme = { text: '#f2f4f8', muted: '#8b95a5', grid: '#ffffff', font: 'Inter-Medium', boldFont: 'Inter-Bold', labelSize: 28, tickSize: 26, valueSize: 36, legendSize: 28, calloutSize: 36 };

/** Box in comp pixels (default: title-safe area of 1920×1080). */
export interface ChartBox { x?: number; y?: number; width?: number; height?: number }
export function box(p: ChartBox): { x: number; y: number; w: number; h: number } {
  const b = { x: p.x ?? 192, y: p.y ?? 108, w: p.width ?? 1536, h: p.height ?? 864 };
  if (!(b.w > 0 && b.h > 0)) throw new Error(`chart box needs a positive width and height (got ${b.w}×${b.h})`);
  return b;
}

/** Rough text width (Inter, px) for layout reserves; AE measures the real one for anchors. */
export const textWidth = (s: string, size: number, bold = false) => [...s].reduce((w, ch) => w + (ch === ' ' ? 0.28 : /[0-9]/.test(ch) ? 0.6 : /[A-Z]/.test(ch) ? 0.66 : /[.,:;'|!]/.test(ch) ? 0.28 : 0.55), 0) * size * (bold ? 1.04 : 1);

/** Pseudo-effect param name: no "/" or "|", at most 31 bytes. */
export function paramName(s: string): string {
  let out = String(s).replace(/[/|]/g, '-').replace(/\s+/g, ' ').trim();
  while (Buffer.byteLength(out, 'utf8') > 31) out = out.slice(0, -1);
  return out.trim();
}

export const r3 = (v: number) => +v.toFixed(3);

/** Layer timing every chart layer shares (relative to the enclosing Sequence). */
export interface LayerTiming { from?: Time; duration?: Time }
