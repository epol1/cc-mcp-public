// Motion previews and style lint (Phase 5 A1/A2, docs/TOOLKIT.md §6): analysis of sampled transforms, the speed
// graph, frame strips and GIFs, a text summary, and the craft rules as lint. Pure Node; the AE sampler that
// produces MotionData lives elsewhere.
export * from './types.ts';
export { activityScore, analyzeMotion, elementMoves, easeCounts, groupKey, isBackground, isDrift, isElement } from './analyze.ts';
export type { DriftOptions } from './analyze.ts';
export { classifyProgress, turningPoints } from './classify.ts';
export type { EaseJudgement } from './classify.ts';
export { speedGraph, speedGraphSvg, EASE_COLORS } from './graph.ts';
export type { SpeedGraphOptions, SpeedGraphResult } from './graph.ts';
export { gif, motionStrip, realtimeFps } from './strip.ts';
export type { GifOptions, StripFrame, StripOptions } from './strip.ts';
export { motionSummary, layerLine } from './summary.ts';
export type { SummaryOptions } from './summary.ts';
export { finalHold, formatStyleIssues, styleLint } from './style.ts';
export type { StyleOptions } from './style.ts';
