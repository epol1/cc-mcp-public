// Transitions library (K4): transitions built from elements of the outgoing scene, each timed from a beat boundary.
// Use them between <Beat>s inside <Beats> (timing from the boundary), or standalone with `at` (window start relative
// to where they are placed), `outgoing` (the outgoing beat's layers) and children (the incoming beat's layers).
export { Beats, Beat, beatTimeline } from './beats.ts';
export type { BeatProps, BeatsProps } from './beats.ts';
export { HandOff } from './handoff.ts';
export type { HandOffProps, Pose } from './handoff.ts';
export { ShapeWipe, LiquidWipe, SliceWipe, GridWipe, liquidKeys } from './wipes.ts';
export type { ShapeWipeProps, LiquidWipeProps, SliceWipeProps, GridWipeProps } from './wipes.ts';
export { ZoomThrough, PushThrough, ParallaxSplit } from './camera.ts';
export type { ZoomThroughProps, PushThroughProps, ParallaxSplitProps } from './camera.ts';
export { LightLeakCut } from './leak.ts';
export type { LightLeakCutProps } from './leak.ts';
export { defineTransition } from './core.ts';
export type { TransitionBase, TransitionDef, TransitionIO, TransitionParts, TransitionTiming } from './core.ts';
