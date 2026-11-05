// Chart frame (K2): the pieces every axis chart shares. A controller null at the box's top-left carries the rig
// effect, and every chart layer is parented to it (move or scale the null and the whole chart follows; child
// coordinates are box-local). Gridlines draw on, tick labels read the live axis range, category labels and the legend
// arrive just before the data, and everything leaves with the chart's exit.
import { jsx } from '../jsx-runtime.ts';
import type { AecElement } from '../jsx-runtime.ts';
import { Group, Null, Path, Rect, RigEffect, Shape, Stroke, Text, Trim, Fill } from '../primitives.ts';
import { expr } from '../anim.ts';
import type { ChartAnimation, ChartBox, ChartTheme, DataProps, LayerTiming, NiceScale, NumberFormat, ScaleOpts } from './common.ts';
import { DARK_THEME, formatNumber, jsFormat, r3, textWidth } from './common.ts';
import type { ChartRig, HighlightSpec, Rig } from './rig.ts';

/** A callout: a leader line and text that arrive after the data lands and hold until the chart leaves. */
export interface AnnotateSpec {
  /** Category (index or label) the callout points at. */
  at: number | string;
  text: string;
  /** Series the point belongs to (line charts; default 0). */
  series?: number;
  /** Leader end relative to the data point, px (default [70, -90]: up and to the right). */
  offset?: [number, number];
  /** Seconds after the data lands (default 0.45, after the highlight). */
  after?: number;
  color?: string;
  size?: number;
}

/** Props every chart takes. */
export interface ChartProps extends DataProps, ChartBox, LayerTiming {
  /** Unique id; every layer id derives from it (`<id>.bar0`, `<id>.grid`…). */
  id: string;
  /** Controller layer name, also the chart's name in expressions (unique in the comp). Default: the id. */
  name?: string;
  scale?: ScaleOpts;
  /** Gridlines (default true). */
  grid?: boolean;
  /** Tick labels on the value axis (default true). */
  axis?: boolean;
  /** Category labels (default true). */
  categories?: boolean;
  /** Series legend (default: when there is more than one series). */
  legend?: boolean;
  /** Value labels that count up with their bar/point. */
  valueLabels?: boolean;
  /** Value label / counter format (decimals default to the data's). */
  format?: NumberFormat;
  /** Tick label format (default: `format`'s prefix/suffix with the scale's decimals). */
  tickFormat?: NumberFormat;
  /** Emphasize one category after the data lands: color, scale punch, the others dim. Switchable live in the rig. */
  highlight?: HighlightSpec;
  annotate?: AnnotateSpec;
  animation?: ChartAnimation;
  theme?: Partial<ChartTheme>;
}

export interface Plot { L: number; T: number; W: number; H: number; B: number; R: number }

/** Everything the chart's parts need. */
export interface Frame {
  id: string;
  title: string;
  ctl: string;
  rig: ChartRig;
  theme: ChartTheme;
  /** Props every chart layer gets: parent and layer timing. */
  base: { parent: string; from?: any; duration?: any };
  plot: Plot;
  horizontal: boolean;
  scale: NiceScale;
}

export const themeOf = (t?: Partial<ChartTheme>): ChartTheme => ({ ...DARK_THEME, ...(t ?? {}) });

/** The controller null (box top-left, anchor 0,0) with the rig effect. */
export function controller(f: Frame, rig: Rig, at: { x: number; y: number }, timing: LayerTiming): AecElement {
  return jsx(Null, { id: f.ctl, name: f.title, position: [at.x, at.y], anchor: [0, 0], from: timing.from, duration: timing.duration, children: jsx(RigEffect, { def: rig.def, name: f.rig.fx, values: rig.values }) });
}

/** Opacity expression: `body` (a 0–1 factor) × 100, with the timing/exit/axis/emphasis prelude it needs. */
export function opacityExpr(f: Frame, what: string, body: string, extra: string[] = []): any {
  const R = f.rig;
  return expr([...R.head(what), ...R.timing(), ...R.exit(), ...R.axis(), ...R.emphasis(), ...extra, `L.clamp(${body}, 0, 1) * 100;`].join('\n'));
}

/** Gridlines (one shape layer, a group per tick), drawn on from the axis. */
export function gridLayer(f: Frame): AecElement {
  const { plot: p, scale, rig: R, theme } = f;
  const n = scale.ticks.length - 1;
  const zeroK = scale.ticks.findIndex((t) => Math.abs(t) < 1e-9);
  const groups = scale.ticks.map((_, k) => {
    const strong = k === (zeroK >= 0 ? zeroK : 0);
    const pts: [number, number][] = f.horizontal
      ? [[r3(p.L + (p.W * k) / n), p.B], [r3(p.L + (p.W * k) / n), p.T]]
      : [[p.L, r3(p.B - (p.H * k) / n)], [p.R, r3(p.B - (p.H * k) / n)]];
    const end = expr([...R.head(`gridline ${k + 1} draw-on`), ...R.timing(), ...R.axis(), `draw(${r3(k * 0.06)}, 0.8) * 100;`].join('\n'));
    return jsx(Group, { name: `Grid ${k + 1}`, children: [
      jsx(Path, { name: 'Line', points: pts.map((q) => ({ p: q })), closed: false }),
      jsx(Trim, { end }),
      jsx(Stroke, { color: theme.grid, width: strong ? 3 : 2, opacity: strong ? 55 : 14 }),
    ] });
  });
  return jsx(Shape, { ...f.base, id: `${f.id}.grid`, name: `${f.title} Grid`, space: 'comp', opacity: expr([...R.head('gridlines (exit)'), ...R.exit(), 'X * 100;'].join('\n')), children: groups });
}

/** Tick labels: live (they read Axis Min/Max), on the left (vertical) or under the plot (horizontal). */
export function tickLabels(f: Frame, fmt: NumberFormat): AecElement[] {
  const { plot: p, scale, theme } = f;
  const n = scale.ticks.length - 1;
  return scale.ticks.map((t, k) => {
    const pos = f.horizontal ? { x: r3(p.L + (p.W * k) / n), y: p.B + 16, anchor: 'top', align: 'center' } : { x: p.L - 18, y: r3(p.B - (p.H * k) / n), anchor: 'right', align: 'right' };
    const R = f.rig;
    return jsx(Text, {
      ...f.base, id: `${f.id}.tick${k}`, name: `${f.title} Tick ${k + 1}`, font: theme.font, size: theme.tickSize, color: theme.muted,
      x: pos.x, y: pos.y, anchor: pos.anchor, align: pos.align, text: formatNumber(t, fmt),
      opacity: opacityExpr(f, `tick ${k + 1} fade`, `ax(${r3(0.1 + k * 0.04)}, 0.5) * X`),
      expressions: { 'ADBE Text Properties/ADBE Text Document': [...R.head(`tick ${k + 1} value`), ...R.scale(), `${jsFormat(`A0 + (A1 - A0) * ${k} / ${n}`, fmt)};`].join('\n') },
    });
  });
}

/** Category labels under the bars/points (vertical) or left of the bars (horizontal); they dim with the highlight. */
export function categoryLabels(f: Frame, labels: string[], centers: number[]): AecElement[] {
  const { plot: p, theme, rig: R } = f;
  return labels.map((l, i) => {
    const q = `ax(0.15 + ${i} * S, 0.6)`;
    const pos = f.horizontal ? { x: p.L - 20, y: centers[i], anchor: 'right', align: 'right' } : { x: centers[i], y: p.B + 20, anchor: 'top', align: 'center' };
    const move = f.horizontal ? '[value[0] - (1 - q) * 16, value[1]]' : '[value[0], value[1] + (1 - q) * 16]';
    return jsx(Text, {
      ...f.base, id: `${f.id}.cat${i}`, name: `${f.title} Label ${l}`, font: theme.font, size: theme.labelSize, color: theme.muted, tracking: 40,
      x: pos.x, y: pos.y, anchor: pos.anchor, align: pos.align, text: l,
      opacity: opacityExpr(f, `label ${l} fade`, `${q} * X * ${R.dim(i)}`),
      expressions: { 'ADBE Transform Group/ADBE Position': [...R.head(`label ${l} rise`), ...R.timing(), ...R.axis(), `var q = ${q};`, `${move};`].join('\n') },
    });
  });
}

/** Series legend at the top-left of the box: swatches read the live series colors. */
export function legend(f: Frame, names: string[], colorParam: (s: number) => string): AecElement[] {
  const { theme, rig: R } = f;
  const y = Math.round(theme.legendSize * 0.6);
  let x = 0;
  const out: AecElement[] = [];
  names.forEach((n, s) => {
    const fade = opacityExpr(f, `legend ${n} fade`, `ax(${r3(s * 0.08)}, 0.5) * X`);
    out.push(jsx(Shape, { ...f.base, id: `${f.id}.key${s}`, name: `${f.title} Key ${n}`, position: [x + 9, y], opacity: fade, children: [
      jsx(Rect, { size: [18, 18], roundness: 5 }),
      jsx(Fill, { color: expr([...R.head(`legend ${n} color`), `${R.P(colorParam(s))};`].join('\n')) }),
    ] }));
    out.push(jsx(Text, { ...f.base, id: `${f.id}.keyText${s}`, name: `${f.title} Key ${n} Text`, font: theme.font, size: theme.legendSize, color: theme.muted, align: 'left', anchor: 'left', x: x + 30, y, text: n, opacity: fade }));
    x += 30 + textWidth(n, theme.legendSize) + 44;
  });
  return out;
}

/**
 * Callout for a data point: `point` is expression code setting `px`, `py` (box-local) after the shared prelude
 * (timing, exit, scale). A leader line draws on, then the text slides in beside its end.
 */
export function calloutLayers(f: Frame, a: AnnotateSpec, point: string[], label: string): AecElement[] {
  const R = f.rig, { theme } = f;
  const [dx, dy] = a.offset ?? [70, -90];
  const sgn = dx >= 0 ? 1 : -1;
  const color = a.color ?? theme.text;
  const pre = (what: string) => [...R.head(`callout at ${label}: ${what}`), ...R.timing(), ...R.exit(), ...R.scale(), ...R.callout(), ...point];
  const len = Math.hypot(dx, dy) || 1;
  const gap = 10;
  return [
    jsx(Shape, { ...f.base, id: `${f.id}.callout`, name: `${f.title} Callout Line`,
      position: expr([...pre('leader position'), '[px, py];'].join('\n')),
      opacity: expr([...pre('leader fade'), 'X * 100;'].join('\n')),
      children: [
        jsx(Path, { name: 'Leader', points: [{ p: [r3((dx * gap) / len), r3((dy * gap) / len)] }, { p: [dx, dy] }], closed: false }),
        jsx(Trim, { end: expr([...R.head(`callout at ${label}: leader draw-on`), ...R.timing(), ...R.callout(), 'L.eased([0.65, 0, 0.35, 1], cu / 0.45) * 100;'].join('\n')) }),
        jsx(Stroke, { color, width: 3, cap: 'round' }),
      ] }),
    jsx(Text, { ...f.base, id: `${f.id}.calloutText`, name: `${f.title} Callout`, font: 'Inter-SemiBold', size: a.size ?? theme.calloutSize, color,
      align: sgn > 0 ? 'left' : 'right', anchor: sgn > 0 ? 'left' : 'right', text: a.text,
      position: expr([...pre('text position'), 'var q = L.eased([0.16, 1, 0.3, 1], (cu - 0.25) / 0.6);', `[px + ${dx} + ${sgn} * (14 + (1 - q) * 24), py + ${dy}];`].join('\n')),
      opacity: expr([...R.head(`callout at ${label}: text fade`), ...R.timing(), ...R.exit(), ...R.callout(), 'L.clamp(L.eased([0.16, 1, 0.3, 1], (cu - 0.25) / 0.6), 0, 1) * X * 100;'].join('\n')),
    }),
  ];
}
