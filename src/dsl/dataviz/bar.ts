// Bar charts (K2): vertical or horizontal, single, grouped (several series side by side) or stacked. Each bar is a
// shape layer whose Rect size reads its value from the chart's rig effect and multiplies it by the bar's eased
// progress (delay + index × stagger), so values, range, colors, timing and the highlight stay live in AE. Bars grow
// from the baseline with rounded ends and square bases; value labels count up with their bar.
import { Fragment, jsx } from '../jsx-runtime.ts';
import type { AecElement } from '../jsx-runtime.ts';
import { Fill, Rect, Shape, Text } from '../primitives.ts';
import { expr } from '../anim.ts';
import { parseColor } from '@cc-mcp/core/units.ts';
import { dslWarn } from '../warn.ts';
import type { EaseName, NumberFormat } from './common.ts';
import { PALETTE, box, dataDecimals, fitScale, formatNumber, jsFormat, normalizeData, r3, textWidth } from './common.ts';
import type { ChartProps, Frame } from './frame.ts';
import { calloutLayers, categoryLabels, controller, gridLayer, legend, themeOf, tickLabels } from './frame.ts';
import { ChartRig, buildRig, categoryIndex } from './rig.ts';

export interface BarChartProps extends ChartProps {
  orientation?: 'vertical' | 'horizontal';
  /** Stack the series instead of grouping them side by side (value labels show the totals). */
  stacked?: boolean;
  /** 'grow' (default): bars grow from the baseline with easeOutExpo and a stagger. 'pop': springy growth. */
  style?: 'grow' | 'pop';
  /** Bar thickness, % of its slot (default 60; grouped bars 84 % of their share). Live: "Bar Width". */
  barWidth?: number;
  /** Corner radius of the bar's end, px (default 6; the base stays square). */
  roundness?: number;
}

const PRESETS: Record<'grow' | 'pop', { delay: number; stagger: number; duration: number; easing: EaseName }> = {
  grow: { delay: 0.5, stagger: 0.08, duration: 0.9, easing: 'easeOutExpo' },
  pop: { delay: 0.5, stagger: 0.07, duration: 1, easing: 'spring' },
};

/** A bar chart in a box (title-safe 1920×1080 by default) with gridlines, tick labels, labels and counters. */
export function BarChart(p: BarChartProps): AecElement {
  if (!p.id) throw new Error('<BarChart> needs an id (every layer id derives from it)');
  const who = `<BarChart id="${p.id}">`;
  const data = normalizeData(p, who);
  const NS = data.series.length, N = data.labels.length;
  const stacked = !!p.stacked && NS > 1;
  const horizontal = p.orientation === 'horizontal';
  if (stacked && data.series.some((s) => s.values.some((v) => v < 0))) dslWarn(`${who}: stacked bars take values ≥ 0; negative values are drawn as 0`);
  const all = data.series.flatMap((s) => s.values);
  const totals = data.labels.map((_, i) => data.series.reduce((a, s) => a + Math.max(0, s.values[i]), 0));
  const theme = themeOf(p.theme);
  const decimals = p.format?.decimals ?? dataDecimals(all);
  const fmt: NumberFormat = { ...p.format, decimals };
  const style = p.style ?? 'grow';
  const anim = { ...PRESETS[style], exit: 'auto' as const, exitDuration: 0.45, ...(p.animation ?? {}) };
  const valueLabels = p.valueLabels ?? (NS === 1 || stacked || NS * N <= 12);
  const showLegend = p.legend ?? NS > 1;
  const b = box(p);

  // Layout (box-local): reserves for legend, value labels, tick and category labels.
  const valSize = NS > 1 && !stacked ? Math.round(theme.valueSize * 0.8) : theme.valueSize;
  const top = (showLegend ? Math.round(theme.legendSize * 1.2) + 20 : 0) + (valueLabels && !horizontal ? valSize + 20 : 12);
  const labelW = Math.max(...data.labels.map((l) => textWidth(l, theme.labelSize) * 1.04));
  const valW = Math.max(...(stacked ? totals : all).map((v) => textWidth(formatNumber(v, fmt), valSize, true)));
  const bottom = horizontal ? (p.axis === false ? 8 : theme.tickSize + 30) : p.categories === false ? 8 : theme.labelSize + 34;
  const right = horizontal ? (valueLabels ? Math.ceil(valW) + 26 : 16) : 8;
  const hLeft = p.categories === false ? 0 : Math.ceil(labelW) + 30;
  // The axis takes as many ticks as fit along the plot (H doesn't depend on the scale; horizontal W neither).
  const { scale, tickFmt } = fitScale(stacked ? 0 : Math.min(...all), stacked ? Math.max(...totals) : Math.max(...all), p.scale,
    horizontal ? b.w - hLeft - right : b.h - top - bottom, theme.tickSize, horizontal,
    (s) => p.tickFormat ?? { prefix: fmt.prefix, suffix: fmt.suffix, separator: fmt.separator, decimalMark: fmt.decimalMark, decimals: s.decimals });
  const tickW = Math.max(...scale.ticks.map((t) => textWidth(formatNumber(t, tickFmt), theme.tickSize)));
  const left = horizontal ? hLeft : p.axis === false ? 0 : Math.ceil(tickW) + 24;
  const plot = { L: left, T: top, W: b.w - left - right, H: b.h - top - bottom, B: b.h - bottom, R: b.w - right };
  if (plot.W < 60 || plot.H < 60) throw new Error(`${who}: the box (${b.w}×${b.h}) leaves only ${Math.round(plot.W)}×${Math.round(plot.H)} px for the bars; make it larger or turn off legend/axis/labels`);
  const LEN = horizontal ? plot.W : plot.H;
  const slot = (horizontal ? plot.H : plot.W) / N;
  const centers = data.labels.map((_, i) => r3((horizontal ? plot.T : plot.L) + slot * (i + 0.5)));
  if (!horizontal && p.categories !== false && labelW > slot * 0.95) dslWarn(`${who}: category labels (up to ~${Math.round(labelW)} px) are wider than a bar slot (${Math.round(slot)} px) and may overlap; shorten them, widen the box, or use orientation: 'horizontal'`);
  const grouped = NS > 1 && !stacked;
  const sub = grouped ? (slot * 0.8) / NS : slot;
  const off = (s: number) => (grouped ? r3((s - (NS - 1) / 2) * sub) : 0);
  const barWidth = p.barWidth ?? (grouped ? 84 : 60);
  const rnd = Math.max(0, Math.min(p.roundness ?? 6, (sub * barWidth) / 200));

  const title = p.name ?? p.id;
  const ctl = `${p.id}.ctl`;
  const R = new ChartRig(ctl, 'Bar Chart', title, 'bar chart');
  R.land = stacked ? `T0 + ${N - 1} * S + ${r3((NS - 1) * 0.45)} * D + D` : `T0 + ${N - 1} * S + ${r3(grouped ? (NS - 1) * 0.5 : 0)} * S + D`;
  const hiColorDefault = data.series[0].color === PALETTE[1] ? PALETTE[0] : PALETTE[1];
  const rig = buildRig({
    kind: 'Bar Chart', data, scale, decimals, anim, highlight: p.highlight, highlightColor: NS === 1, defaultHighlightColor: hiColorDefault,
    callout: p.annotate ? { after: p.annotate.after ?? 0.45 } : undefined,
    look: [{ param: { kind: 'slider', name: 'Bar Width', default: barWidth, min: 5, max: 100, validMin: 1, validMax: 100, display: 'percent', precision: 0 }, value: barWidth }],
  });
  const f: Frame = { id: p.id, title, ctl, rig: R, theme, base: { parent: ctl, from: p.from, duration: p.duration, tags: [`group:${p.id}`] }, plot, horizontal, scale };

  const delay = (s: number, i: number) => (stacked ? `${i} * S + ${r3(s * 0.45)} * D` : grouped ? `${i} * S + ${r3(s * 0.5)} * S` : `${i} * S`);
  const valRef = (s: number, i: number) => R.P(rig.val(s, i));
  // z0/z1: the bar's two ends along the value axis, px from the plot's start; v: the value; pc: count-up progress.
  const geom = (s: number, i: number): string[] => {
    if (!stacked) return [
      `var vr = ${valRef(s, i)}, v = L.clamp(vr, Math.min(A0, A1), Math.max(A0, A1)), p = prog(${delay(s, i)}), pc = Math.min(p, 1);`,
      `var z0 = (B0 - A0) / AR * ${r3(LEN)}, z1 = (B0 + (v - B0) * p * X - A0) / AR * ${r3(LEN)};`,
    ];
    return [
      `var V = [${data.series.map((_, r) => valRef(r, i)).join(', ')}], lo = 0, z = 0, v = 0, pc = 1;`,
      `for (var r = 0; r < V.length; r++) { var pr = prog(${i} * S + r * 0.45 * D); v += Math.max(V[r], 0); pc = Math.min(pc, Math.min(pr, 1)); if (r < ${s}) lo += Math.max(V[r], 0) * pr; else if (r == ${s}) z = lo + Math.max(V[r], 0) * pr; }`,
      `var z0 = (L.clamp(lo * X, A0, A1) - A0) / AR * ${r3(LEN)}, z1 = (L.clamp(z * X, A0, A1) - A0) / AR * ${r3(LEN)};`,
    ];
  };
  const pre = (what: string, s: number, i: number) => [...R.head(what), ...R.timing(), ...R.exit(), ...R.scale(), ...R.emphasis(), ...geom(s, i)];
  const thick = (s: number) => `${r3(sub)} * ${R.P('Bar Width')} / 100`;

  const bars: AecElement[] = [], vals: AecElement[] = [];
  data.series.forEach((ser, s) => data.labels.forEach((label, i) => {
    const what = `${NS > 1 ? `${ser.name} ` : ''}${label}`;
    const isTop = !stacked || s === NS - 1;
    const r = isTop ? rnd : 0;
    // Vertical bars grow up (layer y = plot bottom), horizontal ones right (layer x = plot left).
    const size = horizontal ? `[Math.abs(z1 - z0), ${thick(s)}]` : `[${thick(s)}, Math.abs(z1 - z0)]`;
    const pos = horizontal ? '[(z0 + z1) / 2, 0]' : '[0, -(z0 + z1) / 2]';
    const baseLines = ['var h = Math.min(Math.abs(z1 - z0), ' + r3(r) + '), sg = z1 < z0 ? -1 : 1;'];
    const baseSize = horizontal ? `[h, ${thick(s)}]` : `[${thick(s)}, h]`;
    const basePos = horizontal ? '[z0 + sg * h / 2, 0]' : '[0, -(z0 + sg * h / 2)]';
    const own = ser.colors[i];
    const c = own ? `[${parseColor(own).map(r3).join(', ')}]` : R.P(rig.color(s));
    const fill = NS === 1 ? `var c = ${c};\nhi == ${i} ? L.mixv(c, ${R.P('Highlight Color')}, hk) : c;` : `${c};`;
    const shapes: AecElement[] = [jsx(Rect, { name: 'Bar', size: expr([...pre(`bar ${what} size`, s, i), `${size};`].join('\n')), position: expr([...pre(`bar ${what} position`, s, i), `${pos};`].join('\n')), roundness: r })];
    if (r > 0) shapes.push(jsx(Rect, { name: 'Square Base', size: expr([...pre(`bar ${what} base size`, s, i), ...baseLines, `${baseSize};`].join('\n')), position: expr([...pre(`bar ${what} base position`, s, i), ...baseLines, `${basePos};`].join('\n')) }));
    shapes.push(jsx(Fill, { color: expr([...R.head(`bar ${what} color`), ...R.timing(), ...R.emphasis(), fill].join('\n')) }));
    const at = horizontal ? [plot.L, r3(centers[i] + off(s))] : [r3(centers[i] + off(s)), plot.B];
    bars.push(jsx(Shape, {
      ...f.base, id: NS > 1 ? `${p.id}.bar${s}_${i}` : `${p.id}.bar${i}`, name: `${title} Bar ${what}`, position: at,
      opacity: expr([...R.head(`bar ${what} dim`), ...R.timing(), ...R.emphasis(), `${R.dim(i)} * 100;`].join('\n')),
      scale: expr([...R.head(`bar ${what} punch`), ...R.timing(), ...R.emphasis(), `var k = 100 + (hi == ${i} ? ${R.P('Punch')} * hb : 0);`, '[k, k];'].join('\n')),
      children: shapes,
    }));
    if (!valueLabels || (stacked && !isTop)) return;
    const shown = stacked ? 'v * pc' : 'B0 + (vr - B0) * pc';
    const posV = horizontal
      ? `z1 >= z0 ? [${plot.L} + z1 + 14, ${at[1]}] : [${plot.L} + z1 - 14 - thisLayer.sourceRectAtTime(time, false).width, ${at[1]}]`
      : `z1 >= z0 ? [${at[0]}, ${plot.B} - z1 - 14] : [${at[0]}, ${plot.B} - z1 + 14 + ${r3(valSize * 0.75)}]`;
    vals.push(jsx(Text, {
      ...f.base, id: NS > 1 && !stacked ? `${p.id}.val${s}_${i}` : `${p.id}.val${i}`, name: `${title} Value ${what}`,
      font: theme.boldFont, size: valSize, color: theme.text, align: horizontal ? 'left' : 'center', anchor: horizontal ? 'left' : 'bottom',
      position: at, text: formatNumber(stacked ? totals[i] : ser.values[i], fmt),
      opacity: expr([...pre(`value ${what} fade`, s, i), `L.clamp(pc * 4, 0, 1) * X * ${R.dim(i)} * 100;`].join('\n')),
      expressions: {
        'ADBE Transform Group/ADBE Position': [...pre(`value ${what} position`, s, i), `${posV};`].join('\n'),
        'ADBE Text Properties/ADBE Text Document': [...pre(`value ${what} count-up`, s, i), `${jsFormat(shown, fmt, `Math.round(${R.P('Decimals')})`)};`].join('\n'),
      },
    }));
  }));

  const out: AecElement[] = [];
  if (p.grid !== false) out.push(gridLayer(f));
  if (p.axis !== false) out.push(...tickLabels(f, tickFmt));
  if (p.categories !== false) out.push(...categoryLabels(f, data.labels, centers));
  if (showLegend) out.push(...legend(f, data.series.map((s) => s.name), rig.color));
  out.push(...bars, ...vals);
  if (p.annotate) {
    const i = categoryIndex(p.annotate.at, data.labels, who);
    const s = stacked ? NS - 1 : Math.min(p.annotate.series ?? 0, NS - 1);
    const clear = valueLabels ? (horizontal ? valW + 28 : valSize + 26) : 12;
    const point = horizontal
      ? [...geom(s, i), `var px = ${plot.L} + Math.max(z0, z1) + ${r3(clear)}, py = ${r3(centers[i] + off(s))};`]
      : [...geom(s, i), `var px = ${r3(centers[i] + off(s))}, py = ${plot.B} - Math.max(z0, z1) - ${r3(clear)};`];
    out.push(...calloutLayers(f, p.annotate, point, data.labels[i]));
  }
  out.push(controller(f, rig, b, p));
  return jsx(Fragment, { children: out });
}

/** Stacked bar chart: `<BarChart stacked />`. */
export function StackedBarChart(p: Omit<BarChartProps, 'stacked'>): AecElement {
  return BarChart({ ...p, stacked: true });
}

