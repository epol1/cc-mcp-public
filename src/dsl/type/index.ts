// Typography kit (K3): captions with karaoke, emphasis marks, decode, typewriter, split-flap, font-weight steps
// and auto-fit. Every component is native text plus one rig effect of live values (docs/TOOLKIT.md §5 K3).
export { Captions, captionPlan, captionStyles } from './captions.ts';
export type { CaptionsProps, CaptionCueInput, CaptionStyle, CaptionPlan, CaptionBox, KaraokeOptions } from './captions.ts';
export { Emphasis, emphasize } from './emphasis.ts';
export type { EmphasisProps, EmphasisOptions, EmphasisKind } from './emphasis.ts';
export { Decode, Typewriter, SplitFlap, VariableFont, typingProgress } from './effects.ts';
export type { DecodeProps, TypewriterProps, SplitFlapProps, VariableFontProps } from './effects.ts';
export { AutoFit, autoFitLines } from './autofit.ts';
export type { AutoFitProps, FitResult } from './autofit.ts';
export { measureHelpers, measureCopyExpr, boundsCode, wordScan } from './measure.ts';
export type { MeasureOptions } from './measure.ts';
