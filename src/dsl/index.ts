// Public authoring API: `import { scene, Text, spring, ... } from 'ae-compose'`.
export { scene } from './scene.ts';
export type { SceneConfig, SceneDef } from './scene.ts';
export { Fragment } from './jsx-runtime.ts';
export * from './primitives.ts';
export { tween, spring, keys, seq, wiggle, loop, expr, sample, fade, slideIn, popIn, perChar, perWord, perLine, textPresets } from './anim.ts';
export type { Anim, TextUnitsAnim, TextUnitFrom, Vec } from './anim.ts';
export { control } from './control.ts';
export type { ControlRef } from './control.ts';
export { Easing } from '../shared/easing.ts';
export type { EasingSpec } from '../shared/easing.ts';
