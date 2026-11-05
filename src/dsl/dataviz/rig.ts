// Data viz rig (K2): every chart carries ONE pseudo effect ("aec Bar Chart", "aec Line Chart", …) on its controller
// null, holding the data values, axis range, colors, timing, highlight and callout timing. Every bar, point,
// segment, label and gridline reads it through an expression, so a designer changes a number in Effect Controls and
// the chart (including its animated build) follows. This module builds that definition and the expression snippets
// the components share.
import type { PseudoEffectDef, PseudoParam } from '../../compile/ffx/pseudo.ts';
import { parseColor } from '@ae-mcp/core/units.ts';
import type { ChartAnimation, ChartData, EaseName, NiceScale } from './common.ts';
import { EASES, PALETTE, easeIndex, paramName } from './common.ts';

export interface Emphasis {
  /** Category to emphasize (index or label). */
  at: number | string;
  /** Color the highlighted bar/point turns to (single-series bar and line charts). Default: the theme text color. */
  color?: string;
  /** Opacity % the other bars/points/segments dim to (default 35). */
  dim?: number;
  /** Scale punch in % (default 8). */
  punch?: number;
  /** Seconds after the data lands (default 0.25). */
  after?: number;
}
export type HighlightSpec = number | string | Emphasis;

/** Resolves a category reference (index or label) to an index. */
export function categoryIndex(at: number | string, labels: string[], who: string): number {
  const i = typeof at === 'number' ? at : labels.indexOf(String(at));
  if (!(i >= 0 && i < labels.length && Number.isInteger(i))) throw new Error(`${who}: no category ${JSON.stringify(at)} (labels: ${labels.join(', ')}; or an index 0–${labels.length - 1})`);
  return i;
}

export interface RigInput {
  /** "Bar Chart", "Line Chart", "Donut Chart", "Pie Chart": the effect's instance name (definition "aec <kind>"). */
  kind: string;
  data: ChartData;
  /** One color per category (donut, pie) instead of one per series. */
  categoryColors?: boolean;
  /** Category colors (default: the kit palette from the series color). */
  palette?: string[];
  scale?: NiceScale;
  look: { param: PseudoParam; value: any }[];
  anim: Required<Omit<ChartAnimation, 'exit'>> & { exit: boolean | 'auto' };
  highlight?: HighlightSpec;
  /** Highlight color param (single-series bars and lines). */
  highlightColor: boolean;
  defaultHighlightColor: string;
  callout?: { after: number };
  decimals: number;
}

export interface Rig {
  def: PseudoEffectDef;
  values: Record<string, any>;
  /** Param name of series s, category i. */
  val: (s: number, i: number) => string;
  /** Param name of the color of series s (or category s with categoryColors). */
  color: (s: number) => string;
}

const sl = (name: string, def: number, min: number, max: number, extra: Partial<Extract<PseudoParam, { kind: 'slider' }>> = {}): PseudoParam => ({ kind: 'slider', name, default: def, min, max, precision: 2, ...extra });

/** The chart's rig definition and the values it is built with. */
export function buildRig(o: RigInput): Rig {
  const { data } = o;
  const NS = data.series.length, N = data.labels.length;
  const fixed: PseudoParam[][] = [];
  const values: Record<string, any> = {};
  const add = (list: PseudoParam[], p: PseudoParam, v: any) => { list.push(p); values[p.name] = v; };

  const scale: PseudoParam[] = [];
  if (o.scale) {
    const span = Math.max(Math.abs(o.scale.max), Math.abs(o.scale.min), 1);
    add(scale, sl('Axis Min', o.scale.min, Math.min(0, o.scale.min * 2), span * 2, { validMin: -1e9, validMax: 1e9 }), o.scale.min);
    add(scale, sl('Axis Max', o.scale.max, 0, span * 4, { validMin: -1e9, validMax: 1e9 }), o.scale.max);
  }
  const anim: PseudoParam[] = [];
  add(anim, sl('Delay', o.anim.delay, 0, 10, { validMin: 0 }), o.anim.delay);
  add(anim, sl('Stagger', o.anim.stagger, 0, 1, { validMin: 0, precision: 3 }), o.anim.stagger);
  add(anim, sl('Duration', o.anim.duration, 0.05, 4, { validMin: 0.01 }), o.anim.duration);
  add(anim, { kind: 'popup', name: 'Easing', items: EASES.map((e) => e.label), default: 1 }, easeIndex(o.anim.easing as EaseName, 'easeOutExpo'));
  add(anim, { kind: 'popup', name: 'Exit', items: ['Auto', 'On', 'Off'], default: 1 }, o.anim.exit === 'auto' ? 1 : o.anim.exit ? 2 : 3);
  add(anim, sl('Exit Duration', o.anim.exitDuration, 0, 2, { validMin: 0 }), o.anim.exitDuration);

  const h = o.highlight === undefined ? undefined : typeof o.highlight === 'object' ? o.highlight : { at: o.highlight };
  const hiIndex = h ? categoryIndex(h.at, data.labels, o.kind) : -1;
  const emph: PseudoParam[] = [];
  add(emph, { kind: 'popup', name: 'Highlight', items: ['None', ...data.labels.map((l, i) => (paramName(l) || `Item ${i + 1}`))], default: 1 }, hiIndex + 2);
  if (o.highlightColor) add(emph, { kind: 'color', name: 'Highlight Color', default: parseColor(h?.color ?? o.defaultHighlightColor) }, h?.color ?? o.defaultHighlightColor);
  add(emph, sl('Others Opacity', h?.dim ?? 35, 0, 100, { display: 'percent', validMin: 0, validMax: 100, precision: 0 }), h?.dim ?? 35);
  add(emph, sl('Punch', h?.punch ?? 8, 0, 40, { display: 'percent', precision: 1 }), h?.punch ?? 8);
  add(emph, sl('Highlight After', h?.after ?? 0.25, 0, 5, { validMin: 0 }), h?.after ?? 0.25);

  const callout: PseudoParam[] = [];
  if (o.callout) add(callout, sl('Callout After', o.callout.after, 0, 5, { validMin: 0 }), o.callout.after);
  const labels: PseudoParam[] = [];
  add(labels, sl('Decimals', o.decimals, 0, 4, { validMin: 0, validMax: 6, precision: 0 }), o.decimals);
  const look: PseudoParam[] = [];
  for (const l of o.look) add(look, l.param, l.value);
  fixed.push(scale, look, anim, emph, callout, labels);

  // Names: fixed params first, then group names, colors and values (labels become param names when they can).
  const used = new Set<string>(fixed.flat().map((p) => p.name));
  const claim = (want: string, fallback: string) => {
    const w = paramName(want);
    if (w && !used.has(w)) { used.add(w); return w; }
    let f = paramName(fallback), k = 2;
    while (used.has(f)) f = paramName(`${fallback} ${k++}`);
    used.add(f);
    return f;
  };
  const groupNames = ['Data', 'Scale', 'Look', 'Animation', 'Emphasis', 'Callout', 'Labels'];
  groupNames.forEach((g) => used.add(g));
  const seriesGroups = data.series.map((s, k) => (NS > 1 ? claim(s.name, `Series ${k + 1}`) : 'Data'));
  const colorNames: string[] = [];
  const nColors = o.categoryColors ? N : NS;
  for (let k = 0; k < nColors; k++) {
    const base = o.categoryColors ? data.labels[k] : NS > 1 ? data.series[k].name : (o.kind.split(' ')[0]);
    colorNames.push(claim(`${base} Color`, `Color ${k + 1}`));
  }
  const valNames = data.series.map((s, k) => data.labels.map((l, i) => claim(NS > 1 ? `${s.name} ${l}` : l, NS > 1 ? `S${k + 1} ${i + 1}` : `Value ${i + 1}`)));

  const dataGroups: PseudoParam[] = [];
  const valueDecimals = Math.min(3, o.decimals);
  data.series.forEach((s, k) => {
    const lo = Math.min(0, ...s.values), hi = Math.max(...s.values, 1);
    const ps: PseudoParam[] = s.values.map((v, i) => sl(valNames[k][i], v, lo < 0 ? lo * 2 : 0, hi * 2, { validMin: -1e9, validMax: 1e9, precision: valueDecimals }));
    ps.forEach((p, i) => { values[p.name] = s.values[i]; });
    dataGroups.push({ kind: 'group', name: seriesGroups[k], params: ps });
  });
  const colorParams: PseudoParam[] = colorNames.map((n, k) => {
    const c = o.categoryColors ? (data.series[0].colors[k] ?? o.palette?.[k] ?? PALETTE_AT(k, data)) : data.series[k].color;
    values[n] = c;
    return { kind: 'color', name: n, default: parseColor(c) };
  });
  const params: PseudoParam[] = [...dataGroups];
  if (scale.length) params.push({ kind: 'group', name: 'Scale', params: scale });
  params.push({ kind: 'group', name: 'Look', params: [...colorParams, ...look] });
  params.push({ kind: 'group', name: 'Animation', params: anim });
  params.push({ kind: 'group', name: 'Emphasis', params: emph });
  if (callout.length) params.push({ kind: 'group', name: 'Callout', params: callout });
  params.push({ kind: 'group', name: 'Labels', params: labels, collapsed: true });
  return { def: { name: `aec ${o.kind}`, params }, values, val: (s, i) => valNames[s][i], color: (s) => colorNames[s] };
}

// Category colors (donut/pie) cycle the series' color through the palette unless a datum fixes one.
const PALETTE_AT = (k: number, data: ChartData) => (k === 0 ? data.series[0].color : PALETTE[k % PALETTE.length]);

/** Expression builder for one chart: the shared lines every chart expression starts with. */
export class ChartRig {
  /** Expression (in T0, S, D) for when the data has landed: highlight and callout count from it. */
  land = 'T0 + D';
  constructor(readonly ctl: string, readonly fx: string, readonly title: string, readonly kind: string) {}
  /** Header comment + `e`, the rig effect. */
  head(what: string): string[] {
    const t = this.title.replace(/[\r\n]+/g, ' ');
    return [`// ae-compose ${this.kind.toLowerCase()} "${t}": ${what} (live: the "${this.fx}" effect on layer "${t}")`, `var e = __AEC_LAYER(${this.ctl})__.effect(${JSON.stringify(this.fx)});`];
  }
  /** `e("Name").value` */
  P(name: string): string { return `e(${JSON.stringify(name)}).value`; }
  /** T0, S, D; ease(u) = eased progress u seconds after the data starts; prog(d) = progress of an item delayed d. */
  timing(): string[] {
    const ez = EASES.filter((x) => x.bezier).map((x) => `[${x.bezier!.join(', ')}]`).join(', ');
    return [
      `var T0 = ${this.P('Delay')}, S = ${this.P('Stagger')}, D = Math.max(${this.P('Duration')}, 0.01), ez = Math.round(${this.P('Easing')});`,
      `var EZ = [${ez}];`,
      'function ease(u) { return u <= 0 ? 0 : ez > EZ.length ? L.spring(u / D, 1 / thisComp.frameDuration, 13, 140, 1) : L.eased(EZ[Math.max(ez, 1) - 1], u / D); }',
      'function prog(d) { return ease(time - inPoint - T0 - d); }',
    ];
  }
  /** X: 1 while the chart holds, easing to 0 over the exit (easeInCubic, ending at the layer's out point). */
  exit(): string[] {
    return [
      `var XD = ${this.P('Exit Duration')}, xm = Math.round(${this.P('Exit')});`,
      'var X = XD > 0 && (xm == 2 || (xm == 1 && outPoint < thisComp.duration - thisComp.frameDuration / 2)) ? 1 - L.eased([0.3333, 0, 0.6667, 0], (time - outPoint + thisComp.frameDuration + XD) / XD) : 1;',
    ];
  }
  /** ax(d, len): axis/label arrival (expo out), draw(d, len): gridline draw-on (in-out cubic); both start just before the data. */
  axis(): string[] {
    return [
      'var TA = inPoint + Math.max(0, T0 - 0.45);',
      'function ax(d, len) { return L.eased([0.16, 1, 0.3, 1], (time - TA - d) / len); }',
      'function draw(d, len) { return L.eased([0.65, 0, 0.35, 1], (time - TA - d) / len); }',
    ];
  }
  /** Axis range: A0, A1, AR (span), B0 (the baseline value: 0 clamped into the range). */
  scale(): string[] {
    return [`var A0 = ${this.P('Axis Min')}, A1 = ${this.P('Axis Max')}, AR = (A1 - A0) || 1, B0 = L.clamp(0, Math.min(A0, A1), Math.max(A0, A1));`];
  }
  /** hi: highlighted category (-1 none), hk: its 0→1 ease, hb: a 0→1→0 punch bump (sin², eased at both ends). Needs timing(). */
  emphasis(): string[] {
    return [
      `var hi = Math.round(${this.P('Highlight')}) - 2, hu = time - inPoint - (${this.land}) - ${this.P('Highlight After')};`,
      'var hk = hi < 0 ? 0 : L.eased([0.16, 1, 0.3, 1], hu / 0.5), hb = hi < 0 || hu <= 0 ? 0 : Math.pow(Math.sin(Math.PI * L.clamp(hu / 0.5, 0, 1)), 2);',
    ];
  }
  /** Opacity factor of category i while another one is highlighted. */
  dim(i: number | string): string {
    return `(hi >= 0 && hi != ${i} ? L.lerp(1, ${this.P('Others Opacity')} / 100, hk) : 1)`;
  }
  /** cu: seconds since the callout started. Needs timing(). */
  callout(): string[] {
    return [`var cu = time - inPoint - (${this.land}) - ${this.P('Callout After')};`];
  }
}
