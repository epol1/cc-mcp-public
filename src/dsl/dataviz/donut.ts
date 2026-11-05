// Donut and pie charts (K2). Each segment is a shape layer: an ellipse stroked as thick as the ring, trimmed (Trim
// Paths) to its share of the live total; the trim's start/end come from every value in the rig effect, so changing
// one number re-flows the whole ring. Segments grow one after another (stagger) or the ring sweeps around once
// (sweep). Outside labels count up their percentage; a donut can count the total in its centre. Highlight pulls a
// segment out (and thickens a donut's), dimming the others.
import { Fragment, jsx } from '../jsx-runtime.ts';
import type { AecElement } from '../jsx-runtime.ts';
import { Ellipse, Shape, Stroke, Text, Trim } from '../primitives.ts';
import { expr } from '../anim.ts';
import { dslWarn } from '../warn.ts';
import type { ChartAnimation, ChartBox, ChartTheme, DataProps, EaseName, LayerTiming, NumberFormat } from './common.ts';
import { box, dataDecimals, formatNumber, jsFormat, normalizeData, r3, textWidth } from './common.ts';
import type { Frame } from './frame.ts';
import { controller, legend, themeOf } from './frame.ts';
import type { HighlightSpec } from './rig.ts';
import { ChartRig, buildRig } from './rig.ts';

export interface DonutChartProps extends DataProps, ChartBox, LayerTiming {
  id: string;
  name?: string;
  /** 'stagger' (default): segments grow one after another. 'sweep': the ring draws around once. */
  style?: 'stagger' | 'sweep';
  /** Outer radius px (default: fits the box with room for the labels). Live: "Radius". */
  radius?: number;
  /** Ring thickness px (default 30 % of the radius; a pie is solid). Live: "Thickness". */
  thickness?: number;
  /** Gap between segments in degrees (default 1.5). Live: "Gap". */
  gap?: number;
  /** Where the first segment starts, degrees clockwise from 12 o'clock (default 0). Live: "Start Angle". */
  startAngle?: number;
  /** Labels outside the ring (value + name, default true). */
  segmentLabels?: boolean;
  /** What the outside labels count to: 'percent' (default) or 'value' (with `format`). */
  labelValue?: 'percent' | 'value';
  /** Total counted up in the centre (donut default true): true, or { label, format }. */
  center?: boolean | { label?: string; format?: NumberFormat };
  /** Legend instead of / besides the outside labels (default: when segmentLabels is false). */
  legend?: boolean;
  format?: NumberFormat;
  highlight?: HighlightSpec;
  animation?: ChartAnimation;
  theme?: Partial<ChartTheme>;
}

const PRESETS: Record<'stagger' | 'sweep', { delay: number; stagger: number; duration: number; easing: EaseName }> = {
  stagger: { delay: 0.4, stagger: 0.16, duration: 0.8, easing: 'easeOutQuint' },
  sweep: { delay: 0.4, stagger: 0.1, duration: 1.3, easing: 'easeInOutCubic' },
};

function ring(p: DonutChartProps, pie: boolean): AecElement {
  const kind = pie ? 'Pie Chart' : 'Donut Chart';
  if (!p.id) throw new Error(`<${kind.replace(' ', '')}> needs an id (every layer id derives from it)`);
  const who = `<${kind.replace(' ', '')} id="${p.id}">`;
  const data = normalizeData(p, who);
  if (data.series.length > 1) dslWarn(`${who}: a ${kind.toLowerCase()} shows one series; using "${data.series[0].name}"`);
  const vals = data.series[0].values;
  if (vals.some((v) => v < 0)) dslWarn(`${who}: negative values are drawn as 0`);
  const N = vals.length;
  const total = vals.reduce((a, v) => a + Math.max(0, v), 0);
  const theme = themeOf(p.theme);
  const labelValue = p.labelValue ?? 'percent';
  const decimals = p.format?.decimals ?? (labelValue === 'percent' ? 0 : dataDecimals(vals));
  const fmt: NumberFormat = labelValue === 'percent' ? { suffix: '%', ...p.format, decimals } : { ...p.format, decimals };
  const style = p.style ?? 'stagger';
  const anim = { ...PRESETS[style], exit: 'auto' as const, exitDuration: 0.45, ...(p.animation ?? {}) };
  const labels = p.segmentLabels !== false;
  const b = box(p);
  const cx = r3(b.w / 2), cy = r3(b.h / 2);
  const nameW = Math.max(...data.labels.map((l) => textWidth(l, theme.labelSize) * 1.04), ...vals.map((v) => textWidth(formatNumber(labelValue === 'percent' ? (v / (total || 1)) * 100 : v, fmt), theme.valueSize, true)));
  const radius = p.radius ?? Math.max(40, Math.floor(labels ? Math.min(b.w / 2 - nameW - 44, b.h / 2 - theme.valueSize - theme.labelSize - 40) : Math.min(b.w, b.h) / 2 - 8));
  const thickness = pie ? (p.thickness ?? radius) : (p.thickness ?? Math.round(radius * 0.3));
  const center = pie ? (p.center ? (p.center === true ? {} : p.center) : null) : p.center === false ? null : p.center === true || p.center === undefined ? {} : p.center;

  const title = p.name ?? p.id;
  const ctl = `${p.id}.ctl`;
  const R = new ChartRig(ctl, kind, title, kind.toLowerCase());
  R.land = style === 'sweep' ? 'T0 + D' : `T0 + ${N - 1} * S + D`;
  const rig = buildRig({
    kind, data: { labels: data.labels, series: [data.series[0]] }, categoryColors: true, palette: p.colors, decimals, anim, highlight: p.highlight,
    highlightColor: false, defaultHighlightColor: theme.text,
    look: [
      { param: { kind: 'slider', name: 'Radius', default: radius, min: 10, max: 1000, validMin: 1, display: 'pixel', precision: 0 }, value: radius },
      { param: { kind: 'slider', name: 'Thickness', default: thickness, min: 1, max: 1000, validMin: 0, display: 'pixel', precision: 0 }, value: thickness },
      { param: { kind: 'slider', name: 'Gap', default: p.gap ?? 1.5, min: 0, max: 20, validMin: 0, precision: 1 }, value: p.gap ?? 1.5 },
      { param: { kind: 'angle', name: 'Start Angle', default: p.startAngle ?? 0 }, value: p.startAngle ?? 0 },
    ],
  });
  const f: Frame = { id: p.id, title, ctl, rig: R, theme, base: { parent: ctl, from: p.from, duration: p.duration, tags: [`group:${p.id}`] }, plot: { L: 0, T: 0, W: b.w, H: b.h, B: b.h, R: b.w }, horizontal: false, scale: { min: 0, max: 1, step: 1, ticks: [0, 1], decimals: 0 } };

  // Segment i: s0/s1 (trim fractions), th (mid angle °), cp (count progress), pull (highlight pull-out px).
  const seg = (i: number) => [
    `var V = [${data.labels.map((_, k) => R.P(rig.val(0, k))).join(', ')}], T = 0, A = 0;`,
    `for (var k = 0; k < V.length; k++) { T += Math.max(V[k], 0); if (k < ${i}) A += Math.max(V[k], 0); }`,
    `T = T || 1; A /= T; var Bn = A + Math.max(V[${i}], 0) / T, g = Math.min(${R.P('Gap')} / 360, (Bn - A) * 0.5);`,
    style === 'sweep'
      ? 'var P = Math.min(prog(0), 1), s0 = Math.min(A + g / 2, P), s1 = Math.max(s0, Math.min(Bn - g / 2, P)), cp = L.clamp((P - A) / Math.max(Bn - A, 0.001), 0, 1);'
      : `var cp = Math.min(prog(${i} * S), 1), s0 = A + g / 2, s1 = Math.max(s0, A + (Bn - A) * cp - g / 2);`,
    's1 = s0 + (s1 - s0) * X;',
    `var th = (A + Bn) / 2 * 360 + ${R.P('Start Angle')}, rad = th * Math.PI / 180, pull = ${R.P('Radius')} * ${pie ? 0.08 : 0.05} * (hi == ${i} ? hk : 0);`,
  ];
  const pre = (what: string, i: number) => [...R.head(what), ...R.timing(), ...R.exit(), ...R.emphasis(), ...seg(i)];

  const segs: AecElement[] = [], texts: AecElement[] = [];
  const vh = Math.round(theme.valueSize * 0.75), nh = Math.round(theme.labelSize * 0.75), H = vh + 10 + nh;
  data.labels.forEach((label, i) => {
    segs.push(jsx(Shape, {
      ...f.base, id: `${p.id}.seg${i}`, name: `${title} Segment ${label}`, position: [cx, cy],
      opacity: expr([...R.head(`segment ${label} dim`), ...R.timing(), ...R.emphasis(), `${R.dim(i)} * 100;`].join('\n')),
      expressions: { 'ADBE Transform Group/ADBE Position': [...pre(`segment ${label} pull-out`, i), '[value[0] + Math.sin(rad) * pull, value[1] - Math.cos(rad) * pull];'].join('\n') },
      children: [
        jsx(Ellipse, { name: 'Ring', size: expr([...R.head(`segment ${label} ring size`), `var d = Math.max(2 * ${R.P('Radius')} - ${R.P('Thickness')}, 0);`, '[d, d];'].join('\n')) }),
        jsx(Trim, {
          start: expr([...pre(`segment ${label} start`, i), 's0 * 100;'].join('\n')),
          end: expr([...pre(`segment ${label} end`, i), 's1 * 100;'].join('\n')),
          offset: expr([...R.head(`segment ${label} start angle`), `${R.P('Start Angle')};`].join('\n')),
        }),
        jsx(Stroke, {
          color: expr([...R.head(`segment ${label} color`), `${R.P(rig.color(i))};`].join('\n')),
          width: expr([...R.head(`segment ${label} thickness`), ...R.timing(), ...R.emphasis(), `${R.P('Thickness')} * (hi == ${i} ? 1 + ${pie ? 0 : 0.12} * hk + ${pie ? 0 : 1} * ${R.P('Punch')} / 100 * hb : 1);`].join('\n')),
          cap: 'butt',
        }),
      ],
    }));
    if (!labels) return;
    // Label block (value over name) pushed out along the segment's mid angle, clear of the ring.
    const place = (dy: string) => [...pre(`label ${label} position`, i),
      `var RO = ${R.P('Radius')} + 26 + pull, bx = ${cx} + Math.sin(rad) * RO, by = ${cy} - Math.cos(rad) * RO, w = thisLayer.sourceRectAtTime(time, false).width;`,
      `[bx + Math.sin(rad) * w / 2, by - Math.cos(rad) * ${H / 2} + ${dy}];`].join('\n');
    const fade = expr([...pre(`label ${label} fade`, i), `L.clamp(cp * 2.5, 0, 1) * X * ${R.dim(i)} * 100;`].join('\n'));
    const shown = labelValue === 'percent' ? `Math.max(V[${i}], 0) / T * 100 * cp` : `V[${i}] * cp`;
    texts.push(jsx(Text, {
      ...f.base, id: `${p.id}.pct${i}`, name: `${title} Value ${label}`, font: theme.boldFont, size: theme.valueSize, color: theme.text,
      position: [cx, cy], text: formatNumber(labelValue === 'percent' ? (Math.max(vals[i], 0) / (total || 1)) * 100 : vals[i], fmt), opacity: fade,
      expressions: {
        'ADBE Transform Group/ADBE Position': place(`${-(H / 2 - vh / 2)}`),
        'ADBE Text Properties/ADBE Text Document': [...pre(`label ${label} count-up`, i), `${jsFormat(shown, fmt, `Math.round(${R.P('Decimals')})`)};`].join('\n'),
      },
    }));
    texts.push(jsx(Text, {
      ...f.base, id: `${p.id}.name${i}`, name: `${title} Label ${label}`, font: theme.font, size: theme.labelSize, color: theme.muted, tracking: 40,
      position: [cx, cy], text: label, opacity: fade,
      expressions: { 'ADBE Transform Group/ADBE Position': place(`${H / 2 - nh / 2}`) },
    }));
  });

  if (center) {
    const cf: NumberFormat = center.format ?? { ...p.format, decimals: p.format?.decimals ?? dataDecimals(vals), suffix: labelValue === 'percent' ? p.format?.suffix : fmt.suffix };
    const inner = 2 * (radius - thickness);
    const size = Math.max(32, Math.round(Math.min(radius * 0.36, inner * 0.3)));
    const span = style === 'sweep' ? 'D' : `${N - 1} * S + D`;
    const cnt = [...R.head('centre total count-up'), ...R.timing(), ...R.exit(),
      `var V = [${data.labels.map((_, k) => R.P(rig.val(0, k))).join(', ')}], T = 0; for (var k = 0; k < V.length; k++) T += Math.max(V[k], 0);`,
      `var cp = L.eased([0.16, 1, 0.3, 1], (time - inPoint - T0) / (${span}));`];
    const fade = expr([...R.head('centre fade'), ...R.timing(), ...R.exit(), 'L.clamp((time - inPoint - T0) / 0.4, 0, 1) * X * 100;'].join('\n'));
    const ty = center.label ? r3(cy - theme.labelSize * 0.55) : cy;
    texts.push(jsx(Text, {
      ...f.base, id: `${p.id}.total`, name: `${title} Total`, font: theme.boldFont, size, color: theme.text, x: cx, y: ty, text: formatNumber(total, cf), opacity: fade,
      expressions: { 'ADBE Text Properties/ADBE Text Document': [...cnt, `${jsFormat('T * cp', cf)};`].join('\n') },
    }));
    if (center.label) texts.push(jsx(Text, { ...f.base, id: `${p.id}.totalLabel`, name: `${title} Total Label`, font: theme.font, size: theme.labelSize, color: theme.muted, tracking: 40, x: cx, y: r3(ty + size * 0.5 + theme.labelSize * 0.6), text: center.label, opacity: fade }));
  }

  const out: AecElement[] = [...segs, ...texts];
  if (p.legend ?? !labels) out.unshift(...legend(f, data.labels, rig.color));
  out.push(controller(f, rig, b, p));
  return jsx(Fragment, { children: out });
}

/** Donut chart: a ring of segments, a total counted up in the centre, labels with percentages. */
export function DonutChart(p: DonutChartProps): AecElement { return ring(p, false); }
/** Pie chart: solid wedges (a donut as thick as its radius), labels with percentages. */
export function PieChart(p: DonutChartProps): AecElement { return ring(p, true); }
