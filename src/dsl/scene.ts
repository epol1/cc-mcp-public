// scene(): the default export of a scene file. Params feed variants; seed is always a param.
import type { ColorSpec, Time } from '../shared/units.ts';
import type { AecElement } from './jsx-runtime.ts';

export interface SceneConfig<P = Record<string, any>> {
  /** Comp name prefix: comps are named "<name>_v###" (variants add "_A", "_B"...). */
  name: string;
  width?: number; // default 1920
  height?: number; // default 1080
  fps?: number; // default 30
  duration: Time;
  bg?: ColorSpec;
  renderer?: 'advanced3d' | 'cinema4d' | 'classic3d';
  motionBlur?: boolean;
  /** Default params (overridden per variant). `seed` drives every random/particle seed. */
  params?: P & { seed?: number };
  /** Variant param overrides: { A: {...}, B: {...} } → sibling comps Name_v###_A/B. */
  variants?: Record<string, Partial<P & { seed?: number }>>;
  /** Also build a Compare comp that grids the variants side by side. */
  compare?: boolean;
  /** Version number for the comp name (default: next free). */
  version?: number;
}

export interface SceneDef<P = Record<string, any>> {
  $scene: true;
  config: SceneConfig<P>;
  render: (params: P & { seed: number }) => AecElement;
}

export function scene<P = Record<string, any>>(config: SceneConfig<P>, render: (params: P & { seed: number }) => AecElement): SceneDef<P> {
  if (!config || !config.name) throw new Error('scene(config, render): config.name is required');
  if (config.duration === undefined) throw new Error(`scene "${config.name}": config.duration is required (e.g. "6s")`);
  return { $scene: true, config, render };
}

export function isScene(x: any): x is SceneDef {
  return !!x && x.$scene === true;
}
