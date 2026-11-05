// Data viz kit (K2): bar (vertical/horizontal, grouped, stacked), line, area, donut and pie charts, plus a Counter.
// Native shape and text layers; every value, the axis range, colors, timing and the highlight live on one rig effect
// per chart (on its controller null), so a designer edits numbers in Effect Controls and the chart follows.
export { BarChart, StackedBarChart } from './bar.ts';
export type { BarChartProps } from './bar.ts';
export { LineChart, AreaChart } from './line.ts';
export type { LineChartProps } from './line.ts';
export { DonutChart, PieChart } from './donut.ts';
export type { DonutChartProps } from './donut.ts';
export { Counter } from './counter.ts';
export type { CounterProps } from './counter.ts';
export { niceScale, formatNumber, PALETTE } from './common.ts';
export type { Datum, SeriesSpec, NumberFormat, ScaleOpts, ChartAnimation, ChartTheme, EaseName } from './common.ts';
export type { ChartProps, AnnotateSpec } from './frame.ts';
export type { HighlightSpec, Emphasis } from './rig.ts';
