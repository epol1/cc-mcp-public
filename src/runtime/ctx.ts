// Per-request context: current IR node (for error attribution), warnings, and id → layer maps.
import { now } from './util';

export interface Ctx {
  cur: string; // id of the IR node being processed (errors report it)
  warnings: string[];
  layers: { [id: string]: Layer }; // IR layer id → AE layer (current comp)
  comps: { [id: string]: CompItem };
  items: { [id: string]: Item }; // asset id → project item
  t0: number;
  scene: string;
  /** Properties to add to the current comp's Essential Graphics (PropSpec.eg), by layer and index path. */
  eg: { layer: Layer; path: number[]; name: string }[];
}

export function newCtx(scene: string): Ctx {
  return { cur: '', warnings: [], layers: {}, comps: {}, items: {}, t0: now(), scene: scene, eg: [] };
}

export function warn(ctx: Ctx, msg: string): void {
  ctx.warnings[ctx.warnings.length] = (ctx.cur ? '[' + ctx.cur + '] ' : '') + msg;
}

export class AecError {
  message: string;
  node: string;
  constructor(message: string, node: string) {
    this.message = message;
    this.node = node;
  }
}

export function fail(ctx: Ctx, msg: string): never {
  throw new AecError(msg, ctx.cur);
}
