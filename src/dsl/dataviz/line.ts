// Line and area charts (K2). Each series is one shape layer whose path is an expression (createPath) over the live
// values in the chart's rig effect, drawn on with Trim Paths; points pop on (spring) exactly when the line reaches
// them (the trim progress is inverted over the path's chord lengths). Areas fill under the line, rising point by
// point behind the line's head, with a solid fill (live color and opacity) or a gradient to transparent.
import { Fragment, jsx } from '../jsx-runtime.ts';
import type { AecElement } from '../jsx-runtime.ts';
import { Ellipse, Fill, GradientFill, Group, Path, Shape, Stroke, Text, Trim } from '../primitives.ts';
import { expr } from '../anim.ts';
import type { EaseName, NumberFormat } from './common.ts';
import { PALETTE, box, dataDecimals, fitScale, formatNumber, jsFormat, normalizeData, r3, textWidth } from './common.ts';
import type { ChartProps, Frame } from './frame.ts';
import { calloutLayers, categoryLabels, controller, gridLayer, legend, themeOf, tickLabels } from './frame.ts';
import { ChartRig, buildRig, categoryIndex } from './rig.ts';

export interface LineChartProps extends ChartProps {
  /** 'draw' (default): the line draws on with Trim Paths and points pop as it reaches them. 'rise': points rise from the baseline with a stagger. */
  style?: 'draw' | 'rise';
  /** 'smooth' (default): a monotone curve through the points; 'linear': straight segments. */
  curve?: 'linear' | 'smooth';
  /** Fill under each line: true, or { gradient (default true: color → transparent), opacity % (default 35) }. */
  area?: boolean | { gradient?: boolean; opacity?: number };
  /** Dots on the data points (default true). */
  points?: boolean;
  /** Stroke width px (default 6). Live: "Line Width". */
  lineWidth?: number;
}

const PRESETS: Record<'draw' | 'rise', { delay: number; stagger: number; duration: number; easing: EaseName }> = {
  draw: { delay: 0.5, stagger: 0.06, duration: 1.6, easing: 'easeInOutCubic' },
  rise: { delay: 0.5, stagger: 0.06, duration: 0.9, easing: 'easeOutExpo' },
};

/** A line chart (one line per series) in a box, with gridlines, tick labels, category labels and optional areas. */
export function LineChart(p: LineChartProps): AecElement {
  if (!p.id) throw new Error('<LineChart> needs an id (every layer id derives from it)');
  const who = `<LineChart id="${p.id}">`;
  const data = normalizeData(p, who);
  const NS = data.series.length, N = data.labels.length;
  const all = data.series.flatMap((s) => s.values);
  const theme = themeOf(p.theme);
  const decimals = p.format?.decimals ?? dataDecimals(all);
  const fmt: NumberFormat = { ...p.format, decimals };
  const style = p.style ?? 'draw';
  const anim = { ...PRESETS[style], exit: 'auto' as const, exitDuration: 0.45, ...(p.animation ?? {}) };
  const showLegend = p.legend ?? NS > 1;
  const area = p.area ? { gradient: true, opacity: 35, ...(typeof p.area === 'object' ? p.area : {}) } : null;
  const lw = p.lineWidth ?? 6;
  const dotD = Math.max(12, Math.round(lw * 3.4));
  const valueLabels = p.valueLabels ?? false;
  const b = box(p);

  const top = (showLegend ? Math.round(theme.legendSize * 1.2) + 20 : 0) + (valueLabels ? theme.valueSize + 20 : 0) + Math.round(dotD * 0.9) + 8;
  const bottom = p.categories === false ? Math.ceil(dotD) : theme.labelSize + 34;
  const { scale, tickFmt } = fitScale(Math.min(...all), Math.max(...all), p.scale, b.h - top - bottom, theme.tickSize, false,
    (s) => p.tickFormat ?? { prefix: fmt.prefix, suffix: fmt.suffix, separator: fmt.separator, decimalMark: fmt.decimalMark, decimals: s.decimals });
  const tickW = Math.max(...scale.ticks.map((t) => textWidth(formatNumber(t, tickFmt), theme.tickSize)));
  const left = p.axis === false ? Math.ceil(dotD) : Math.ceil(tickW) + 24;
  const plot = { L: left, T: top, W: b.w - left - 8, H: b.h - top - bottom, B: b.h - bottom, R: b.w - 8 };
  if (plot.W < 60 || plot.H < 60) throw new Error(`${who}: the box (${b.w}×${b.h}) leaves only ${Math.round(plot.W)}×${Math.round(plot.H)} px for the plot; make it larger or turn off legend/axis/labels`);
  const slot = plot.W / N;
  const xs = data.labels.map((_, i) => r3(plot.L + slot * (i + 0.5)));

  const title = p.name ?? p.id;
  const ctl = `${p.id}.ctl`;
  const kind = area && p.area ? 'Area Chart' : 'Line Chart';
  const R = new ChartRig(ctl, kind, title, kind.toLowerCase());
  R.land = style === 'draw' ? 'T0 + D + 0.2' : `T0 + ${N - 1} * S + D`;
  const look: { param: any; value: any }[] = [{ param: { kind: 'slider', name: 'Line Width', default: lw, min: 0, max: 30, validMin: 0, precision: 1 }, value: lw }];
  if (area && !area.gradient) look.push({ param: { kind: 'slider', name: 'Area Opacity', default: area.opacity, min: 0, max: 100, validMin: 0, validMax: 100, display: 'percent', precision: 0 }, value: area.opacity });
  const rig = buildRig({
    kind, data, scale, decimals, anim, highlight: p.highlight, highlightColor: NS === 1,
    defaultHighlightColor: data.series[0].color === PALETTE[1] ? PALETTE[0] : PALETTE[1],
    callout: p.annotate ? { after: p.annotate.after ?? 0.45 } : undefined, look,
  });
  const f: Frame = { id: p.id, title, ctl, rig: R, theme, base: { parent: ctl, from: p.from, duration: p.duration, tags: [`group:${p.id}`] }, plot, horizontal: false, scale };

  const rise = style === 'rise';
  const smooth = (p.curve ?? 'smooth') === 'smooth';
  // P: the series' points (box-local), rising from the baseline in 'rise' style; YB: the baseline's y.
  const points = (s: number) => [
    ...R.scale(),
    `var V = [${data.labels.map((_, i) => R.P(rig.val(s, i))).join(', ')}], XS = [${xs.join(', ')}];`,
    `var YB = ${plot.B} - (B0 - A0) / AR * ${r3(plot.H)};`,
    `function yAt(v, q) { return ${plot.B} - (B0 + (L.clamp(v, Math.min(A0, A1), Math.max(A0, A1)) - B0) * q - A0) / AR * ${r3(plot.H)}; }`,
    `var P = []; for (var k = 0; k < V.length; k++) P.push([XS[k], yAt(V[k], ${rise ? 'prog(k * S)' : '1'})]);`,
  ];
  const tangents = [
    'function tang(Q) { var I = [], O = [];',
    `  for (var k = 0; k < Q.length; k++) { if (!${smooth}) { I.push([0, 0]); O.push([0, 0]); continue; }`,
    '    var a = Q[Math.max(k - 1, 0)], c = Q[Math.min(k + 1, Q.length - 1)], m = (c[1] - a[1]) / ((c[0] - a[0]) || 1);',
    '    if (k > 0 && k < Q.length - 1 && (Q[k][1] - a[1]) * (c[1] - Q[k][1]) <= 0) m = 0;',
    '    var dl = k > 0 ? (Q[k][0] - a[0]) / 3 : 0, dr = k < Q.length - 1 ? (c[0] - Q[k][0]) / 3 : 0;',
    '    I.push([-dl, -m * dl]); O.push([dr, m * dr]); }',
    '  return [I, O]; }',
  ];
  // hit(k): seconds after the start when the drawing line reaches point k (chord-length fraction of the trim).
  const hits = rise ? ['function hit(k) { return k * S; }'] : [
    'var CL = [0]; for (var k = 1; k < P.length; k++) CL.push(CL[k - 1] + Math.sqrt(Math.pow(P[k][0] - P[k - 1][0], 2) + Math.pow(P[k][1] - P[k - 1][1], 2)));',
    'function hit(k) { var u = CL[k] / (CL[CL.length - 1] || 1); if (u <= 0) return 0; var a = 0, b = D * 3; for (var j = 0; j < 24; j++) { var m = (a + b) / 2; if (ease(m) >= u) b = m; else a = m; } return b; }',
  ];
  const pre = (what: string, s: number) => [...R.head(what), ...R.timing(), ...R.exit(), ...R.emphasis(), ...points(s)];

  const areas: AecElement[] = [], lines: AecElement[] = [], dots: AecElement[] = [], vals: AecElement[] = [];
  data.series.forEach((ser, s) => {
    const sid = NS > 1 ? String(s) : '';
    const sname = NS > 1 ? ` ${ser.name}` : '';
    const color = R.P(rig.color(s));
    const finalPts = ser.values.map((v, i) => ({ p: [xs[i], r3(plot.B - ((Math.min(Math.max(v, scale.min), scale.max) - scale.min) / (scale.max - scale.min)) * plot.H)] as [number, number] }));
    if (area) {
      const yb = r3(plot.B - ((Math.min(Math.max(0, scale.min), scale.max) - scale.min) / (scale.max - scale.min)) * plot.H);
      const body = [...pre(`area${sname} shape`, s), ...tangents, ...hits,
        `var Q = []; for (var k = 0; k < P.length; k++) { var r = ${rise ? '1' : 'L.eased([0.16, 1, 0.3, 1], (time - inPoint - T0 - hit(k)) / 0.7)'}; Q.push([P[k][0], YB + (P[k][1] - YB) * r * X]); }`,
        'var t = tang(Q), n = Q.length;',
        'createPath(Q.concat([[Q[n - 1][0], YB], [Q[0][0], YB]]), t[0].concat([[0, 0], [0, 0]]), t[1].concat([[0, 0], [0, 0]]), true);'];
      const paint = area.gradient
        ? jsx(GradientFill, { type: 'linear', start: [0, plot.T], end: [0, plot.B], stops: [{ offset: 0, color: ser.color, opacity: Math.min(1, area.opacity / 60) }, { offset: 1, color: ser.color, opacity: 0 }] })
        : jsx(Fill, { color: expr([...R.head(`area${sname} color`), `${color};`].join('\n')), opacity: expr([...R.head(`area${sname} opacity`), `${R.P('Area Opacity')};`].join('\n')) });
      areas.push(jsx(Shape, {
        ...f.base, id: `${p.id}.area${sid}`, name: `${title} Area${sname}`, space: 'comp',
        expressions: { 'ADBE Root Vectors Group/Area/ADBE Vector Shape': body.join('\n') },
        children: [jsx(Path, { name: 'Area', points: [...finalPts, { p: [xs[N - 1], yb] }, { p: [xs[0], yb] }], closed: true }), paint],
      }));
    }
    const pathBody = [...pre(`line${sname} points`, s), ...tangents, 'var t = tang(P);', 'createPath(P, t[0], t[1], false);'];
    lines.push(jsx(Shape, {
      ...f.base, id: `${p.id}.line${sid}`, name: `${title} Line${sname}`, space: 'comp',
      expressions: { 'ADBE Root Vectors Group/Line/ADBE Vector Shape': pathBody.join('\n') },
      children: [
        jsx(Path, { name: 'Line', points: finalPts, closed: false }),
        jsx(Trim, {
          start: expr([...R.head(`line${sname} exit (erase)`), ...R.exit(), '(1 - X) * 100;'].join('\n')),
          end: expr([...R.head(`line${sname} draw-on`), ...R.timing(), rise ? 'L.clamp(prog(0) * 50, 0, 1) * 100;' : 'L.clamp(prog(0), 0, 1) * 100;'].join('\n')),
        }),
        jsx(Stroke, { color: expr([...R.head(`line${sname} color`), `${color};`].join('\n')), width: expr([...R.head(`line${sname} width`), `${R.P('Line Width')};`].join('\n')), cap: 'round', join: 'round' }),
      ],
    }));
    ser.values.forEach((v, i) => {
      const what = `${NS > 1 ? `${ser.name} ` : ''}${data.labels[i]}`;
      const did = NS > 1 ? `${p.id}.dot${s}_${i}` : `${p.id}.dot${i}`;
      const pop = [...hits, `var pop = L.spring(time - inPoint - T0 - hit(${i}), 1 / thisComp.frameDuration, 12, 200, 1);`];
      if (p.points !== false) {
        const fillC = NS === 1 ? `var c = ${color};\nhi == ${i} ? L.mixv(c, ${R.P('Highlight Color')}, hk) : c;` : `${color};`;
        const cExpr = () => expr([...R.head(`point ${what} color`), ...R.timing(), ...R.emphasis(), fillC].join('\n'));
        dots.push(jsx(Shape, {
          ...f.base, id: did, name: `${title} Point ${what}`,
          position: expr([...pre(`point ${what} position`, s), `P[${i}];`].join('\n')),
          scale: expr([...pre(`point ${what} pop`, s), ...pop, `var k = 100 * pop * X * (hi == ${i} ? 1 + 0.4 * hk + ${R.P('Punch')} / 50 * hb : 1);`, '[k, k];'].join('\n')),
          opacity: expr([...R.head(`point ${what} dim`), ...R.timing(), ...R.emphasis(), `${R.dim(i)} * 100;`].join('\n')),
          children: [
            jsx(Ellipse, { name: 'Dot', size: [dotD, dotD] }),
            jsx(Fill, { color: cExpr() }),
            jsx(Group, { name: 'Halo', children: [jsx(Ellipse, { size: [Math.round(dotD * 1.7), Math.round(dotD * 1.7)] }), jsx(Fill, { color: cExpr(), opacity: 25 })] }),
          ],
        }));
      }
      if (valueLabels) vals.push(jsx(Text, {
        ...f.base, id: NS > 1 ? `${p.id}.val${s}_${i}` : `${p.id}.val${i}`, name: `${title} Value ${what}`,
        font: theme.boldFont, size: theme.valueSize, color: theme.text, anchor: 'bottom', position: finalPts[i].p, text: formatNumber(v, fmt),
        opacity: expr([...pre(`value ${what} fade`, s), ...pop, `L.clamp(pop * 2, 0, 1) * X * ${R.dim(i)} * 100;`].join('\n')),
        expressions: {
          'ADBE Transform Group/ADBE Position': [...pre(`value ${what} position`, s), `[P[${i}][0], P[${i}][1] - ${Math.round(dotD * 0.85) + 10}];`].join('\n'),
          'ADBE Text Properties/ADBE Text Document': [...R.head(`value ${what} text`), `${jsFormat(R.P(rig.val(s, i)), fmt, `Math.round(${R.P('Decimals')})`)};`].join('\n'),
        },
      }));
    });
  });

  const out: AecElement[] = [];
  if (p.grid !== false) out.push(gridLayer(f));
  if (p.axis !== false) out.push(...tickLabels(f, tickFmt));
  if (p.categories !== false) out.push(...categoryLabels(f, data.labels, xs));
  if (showLegend) out.push(...legend(f, data.series.map((s) => s.name), rig.color));
  out.push(...areas, ...lines, ...dots, ...vals);
  if (p.annotate) {
    const i = categoryIndex(p.annotate.at, data.labels, who);
    const s = Math.min(p.annotate.series ?? 0, NS - 1);
    const clear = Math.round(dotD * 0.85) + 10 + (valueLabels ? theme.valueSize + 8 : 0);
    out.push(...calloutLayers(f, p.annotate, [...points(s), `var px = P[${i}][0], py = P[${i}][1] - ${clear};`], data.labels[i]));
  }
  out.push(controller(f, rig, b, p));
  return jsx(Fragment, { children: out });
}

/** Area chart: a line chart with the area under each line filled (gradient to transparent by default). */
export function AreaChart(p: LineChartProps): AecElement {
  return LineChart({ ...p, area: p.area ?? true });
}
