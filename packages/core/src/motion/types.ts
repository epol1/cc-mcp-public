// Motion analysis types: the transform samples the AE sampler takes per layer (MotionData), what analyzeMotion
// derives from them (moves, holds, arrivals, exits, comp activity) and the style-lint issue shape. Pure data.

export type MotionKind = 'text' | 'shape' | 'solid' | 'footage' | 'precomp' | 'null' | 'camera' | 'light' | 'adjustment' | 'other';

export interface MotionLayer {
  name: string;
  /** ae-compose id when the layer was built by ae-compose. */
  id?: string | null;
  kind: MotionKind;
  /** Seconds, top-comp time. */
  in: number;
  out: number;
  /**
   * One entry per MotionData.times: null when the layer is inactive/hidden, else [x, y, scaleX, scaleY, rotation, opacity]
   * in comp space (x,y = anchor point in comp pixels, scale %, rotation deg, opacity 0–100 including parents' opacity when known).
   */
  s: (number[] | null)[];
  /** Optional comp-space bounds per sample [x0, y0, x1, y1] (text and shapes). */
  b?: (number[] | null)[];
  text?: string;
  /** Free tags the compiler attaches: 'bg', 'controls', 'cloner', 'transition:<kind>', 'persistent' (asked for), 'hero'. */
  tags?: string[];
  /** Keyed segments of transform props as built: per segment the easing name when known ('easeOutExpo', 'spring', 'linear', 'hold', 'bezier'). */
  segments?: { prop: string; t0: number; t1: number; ease: string }[];
}

export interface MotionData {
  comp: string; w: number; h: number; fps: number; dur: number; step: number;
  times: number[];
  layers: MotionLayer[];
  scenes: { name: string; t: number; dur: number }[];
  transitions?: { kind: string; t: number; dur: number; layer?: string }[];
  /** Beat-grid marker times (BeatMarkers): cuts are checked against them (off-beat). */
  beats?: number[];
}

/**
 * How a move feels, judged from its normalized progress curve:
 * - ease-out: fast start, long settle (arrivals); ease-in: slow start, fast end (exits);
 * - ease-in-out: slow at both ends (moves between two rests, drifts); linear: constant speed;
 * - overshoot: passes the target once and comes back; anticipate: backs up first, then goes;
 * - spring-like: oscillates around the target (two or more visible reversals);
 * - step: too few samples to judge (a jump between samples, or a move shorter than 3 sample intervals).
 */
export type EasingClass = 'ease-out' | 'ease-in' | 'ease-in-out' | 'linear' | 'overshoot' | 'anticipate' | 'spring-like' | 'step';
export const EASING_CLASSES: EasingClass[] = ['ease-out', 'ease-in', 'ease-in-out', 'linear', 'overshoot', 'anticipate', 'spring-like', 'step'];

export type MoveChannel = 'position' | 'scale' | 'rotation' | 'opacity';

export interface Move {
  /** Start and end, seconds (sample times). */
  t0: number; t1: number;
  /** Peak speed in px/s (position plus the scale and rotation terms), or %/s for a fade-only move. */
  peak: number;
  /** When the peak happens, and where in the move (0 = at the start, 1 = at the end). */
  peakAt: number; peakRatio: number;
  ease: EasingClass;
  /** Channels that change during the move; `dominant` is the one the easing class is judged from. */
  channels: MoveChannel[];
  dominant: MoveChannel;
  /** Path length in px (opacity points for a fade-only move). */
  distance: number;
  /** How far past the target the move goes, as a fraction of the distance (overshoot / spring-like), or how far it backs up first (anticipate). */
  overshoot?: number;
  /** Easing name from the build (MotionLayer.segments) when one overlaps the move. */
  built?: string;
  /** A long constant move (camera drift, ticker, loop): linear by design. */
  drift: boolean;
}

export interface Hold {
  t0: number; t1: number; dur: number;
  /** True when the hold keeps subtle life (a slow drift well below the layer's moves). */
  drift?: boolean;
}

export interface LayerMotion {
  name: string; id?: string | null; kind: MotionKind; tags: string[];
  /** Index in MotionData.layers. */
  index: number;
  /** Not judged as an element: background, controls, null, camera, light or adjustment layer. */
  content: boolean;
  /** Cloner instances share one group key (they count as one element); others use their own index. */
  group: string;
  /** Per sample: speed px/s, opacity change %/s, visible (on screen, opacity > threshold), and inside a move. */
  speed: number[]; opacityRate: number[]; visible: boolean[]; moving: boolean[];
  /** Per sample: still (visible and not inside a move, drifts allowed). */
  still: boolean[];
  moves: Move[];
  /** Still and visible for at least MotionOptions.minHold. */
  holds: Hold[];
  /** The entrance: the first move (or chain of moves) that starts as the layer appears and ends in stillness. */
  arrival: Move | null;
  /** The departure: the last move (or chain) that starts from stillness and after which the layer is gone. */
  exit: Move | null;
  /** First and last moment the layer is visible (null when never visible). */
  appear: number | null; vanish: number | null;
  /** Highest speed (px/s) and total time inside moves (s). */
  peak: number; activeTime: number;
  /** Half-diagonal at 100 % scale used for the scale and rotation speed terms (px). */
  radius: number;
}

export interface MotionAnalysis {
  comp: string; w: number; h: number; fps: number; dur: number; step: number;
  times: number[];
  layers: LayerMotion[];
  /** Per sample, over elements (cloner instances count once): how many move (constant drifts excluded), how many are visible, whether a camera moves. */
  activity: { moving: number[]; visible: number[]; camera: boolean[]; peak: number; peakAt: number };
  scenes: MotionData['scenes'];
  transitions: NonNullable<MotionData['transitions']>;
}

export interface MotionOptions {
  /** Translation below this is still, px/s (default 8). */
  minSpeed?: number;
  /** Scale change below this is still, %/s (default 2). */
  minScaleRate?: number;
  /** Rotation below this is still, °/s (default 2). */
  minRotationRate?: number;
  /** Opacity change below this is still, %/s (default 3). */
  minOpacityRate?: number;
  /** A run of change slower than this at its peak (px/s) and fading less than 10 points is a drift, not a move (default 30). */
  minPeakSpeed?: number;
  /** Inside a move, a stretch below this fraction of the move's peak that stays flat for minHold is a drift during a hold (default 0.03). */
  quietFraction?: number;
  /** Shortest hold reported, seconds (default 0.2). */
  minHold?: number;
  /** Opacity at or below this counts as invisible (default 5). */
  visibleOpacity?: number;
}

export type StyleRule = 'transition-repeat' | 'crowded-entrance' | 'short-hold' | 'easing-monotony' | 'linear-move' | 'slide-furniture' | 'short-end-hold' | 'everything-moves' | 'dead-air' | 'off-beat';
export const STYLE_RULES: StyleRule[] = ['transition-repeat', 'crowded-entrance', 'short-hold', 'easing-monotony', 'linear-move', 'slide-furniture', 'short-end-hold', 'everything-moves', 'dead-air', 'off-beat'];

/** Same shape as LintIssue (src/lint/index.ts), with style rules. */
export interface StyleIssue {
  rule: StyleRule;
  severity: 'warn' | 'info';
  message: string;
  layer?: string;
  layers?: string[];
  t?: [number, number];
}
