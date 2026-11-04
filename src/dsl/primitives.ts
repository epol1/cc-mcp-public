// Primitive components. Each is a marker function tagged with `.aec = <kind>`; the compiler reads props.
// Layer order follows JSX/Remotion: LATER siblings render ON TOP. Shape children follow AE's Contents
// order instead: first child is frontmost, and Fill/Stroke paint the paths listed above them.
import type { Anim, TextUnitsAnim, Vec } from './anim.ts';
import type { ControlRef } from './control.ts';
import type { EasingSpec } from '../shared/easing.ts';
import type { ColorSpec, Time } from '../shared/units.ts';

type V<T> = T | Anim | ControlRef;
type Children = any;

/** Props shared by every layer. Values may be static, animation descriptors, or control(...) refs. */
export interface LayerProps {
  /** Stable id for edits/rebuilds. Defaults to a path-derived id. */
  id?: string;
  /** Layer name in AE. */
  name?: string;
  x?: V<number>; y?: V<number>; z?: V<number>;
  position?: V<Vec>;
  /** Anchor point in layer pixels, or a box alignment ("center", "topLeft", "bottom"...; text/shape default "center"). */
  anchor?: Vec | 'center' | 'top' | 'bottom' | 'left' | 'right' | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';
  /** Percent; number for uniform. */
  scale?: V<Vec>;
  /** Degrees (Z rotation). */
  rotation?: V<number>;
  rotationX?: V<number>; rotationY?: V<number>;
  orientation?: V<Vec>;
  /** 0–100. */
  opacity?: V<number>;
  /** Alternative to per-prop animation: { y: spring({from: 80}), opacity: fade.in() }. Also `text: perWord(...)` on Text. */
  animate?: Record<string, Anim | TextUnitsAnim | TextUnitsAnim[]>;
  threeD?: boolean;
  /** id of the parent layer. */
  parent?: string;
  blend?: 'NORMAL' | 'ADD' | 'SCREEN' | 'MULTIPLY' | 'OVERLAY' | 'SOFT_LIGHT' | 'HARD_LIGHT' | 'COLOR_DODGE' | 'COLOR_BURN' | 'LIGHTEN' | 'DARKEN' | 'DIFFERENCE' | 'HUE' | 'SATURATION' | 'COLOR' | 'LUMINOSITY' | 'LINEAR_DODGE' | 'LINEAR_LIGHT' | 'VIVID_LIGHT' | 'PIN_LIGHT' | 'ALPHA_ADD' | 'SILHOUETE_ALPHA' | 'STENCIL_ALPHA';
  motionBlur?: boolean;
  /** Layer start/end inside its Sequence (seconds or "1.2s"). */
  from?: Time;
  duration?: Time;
  /** Use another layer as track matte. */
  matte?: { layer: string; type?: 'alpha' | 'alphaInverted' | 'luma' | 'lumaInverted' };
  hidden?: boolean;
  shy?: boolean;
  guide?: boolean;
  label?: number;
  markers?: { t: Time; comment?: string; duration?: Time }[];
  /** Raw property overrides by AE path (matchName or display name segments), e.g. {"ADBE Transform Group/ADBE Opacity": 50}. */
  props?: Record<string, V<any>>;
  /** Raw expressions by AE path. */
  expressions?: Record<string, string>;
  children?: Children;
}

function prim<P>(kind: string): ((props: P) => any) & { aec: string } {
  const f: any = (_props: P) => { throw new Error(`<${kind}> must be used as a JSX element inside a scene`); };
  f.aec = kind;
  f.displayName = kind;
  return f;
}

// ---------- Structure ----------
export interface CompositionProps {
  /** Background color (comp bg). */
  bg?: ColorSpec;
  renderer?: 'advanced3d' | 'cinema4d' | 'classic3d';
  motionBlur?: boolean;
  shutterAngle?: number;
  children?: Children;
}
export const Composition = prim<CompositionProps>('composition');

export interface SequenceProps { from?: Time; duration?: Time; name?: string; children?: Children }
/** Offsets its children in time (Remotion semantics): children's in/out and animation times shift by `from`. */
export const Sequence = prim<SequenceProps>('sequence');

export interface SeriesProps { children?: Children }
const SeriesBase = prim<SeriesProps>('series');
export interface SeriesSequenceProps { duration: Time; offset?: Time; name?: string; children?: Children }
/** Children play back to back. Use <Series.Sequence duration="2s"> for each step; `offset` overlaps (negative) or gaps. */
export const Series = Object.assign(SeriesBase, { Sequence: prim<SeriesSequenceProps>('series.sequence') });

export interface PrecompProps extends LayerProps { width?: number; height?: number; compDuration?: Time; bg?: ColorSpec; collapse?: boolean }
/** Children become a nested comp (in the scene's _parts folder) used as one layer. */
export const Precomp = prim<PrecompProps>('precomp');

// ---------- Layers ----------
export interface SolidProps extends LayerProps { color?: ColorSpec; width?: number; height?: number }
export const Solid = prim<SolidProps>('solid');
export const Null = prim<LayerProps>('null');
export interface AdjustmentProps extends LayerProps { width?: number; height?: number }
/** Adjustment layer: its <Effect> children apply to everything below. */
export const Adjustment = prim<AdjustmentProps>('adjustment');

export interface TextStyleRun { start: number; end: number; font?: string; size?: number; color?: ColorSpec; tracking?: number; baselineShift?: number }
export interface TextProps extends LayerProps {
  /** PostScript font name, e.g. "Inter-Bold", "Montserrat-SemiBold". */
  font?: string;
  size?: number;
  color?: V<ColorSpec>;
  stroke?: ColorSpec;
  strokeWidth?: number;
  strokeOverFill?: boolean;
  /** AE tracking units (1/1000 em). */
  tracking?: number;
  leading?: number | 'auto';
  align?: 'left' | 'center' | 'right' | 'justify';
  caps?: 'normal' | 'all' | 'small';
  fauxBold?: boolean;
  fauxItalic?: boolean;
  /** Paragraph (box) text of this width (and optional height); wraps. */
  box?: { width: number; height?: number };
  /** Per-character style ranges (0-based, end exclusive). */
  runs?: TextStyleRun[];
  /** The text (alternatively as JSX children). */
  text?: string;
  /** Animate each letter in 3D (needed for rotationX/Y text animation). */
  perCharacter3D?: boolean;
}
export const Text = prim<TextProps>('text');

export interface ShapeProps extends LayerProps {}
/** Shape layer. Children: Rect, Ellipse, Star, Path, Group, Fill, Stroke, Trim, Repeater, Merge, ... (AE Contents order). */
export const Shape = prim<ShapeProps>('shape');

export interface FootageProps extends LayerProps {
  /** File path to import (absolute, or relative to the scene file). */
  src?: string;
  /** Existing project item name. */
  item?: string;
  /** How to fit the comp/box (default "cover"). */
  fit?: 'cover' | 'contain' | 'fill' | 'none' | 'width' | 'height';
  /** [start, end] of the source to use (seconds or "2s"). */
  trim?: [Time, Time];
  /** Playback speed (1 = normal). */
  speed?: number;
  loop?: boolean;
  /** Mute audio. */
  muted?: boolean;
}
export const Footage = prim<FootageProps>('footage');

// ---------- Shape contents ----------
interface ShapeItemProps { name?: string; children?: Children }
export interface RectProps extends ShapeItemProps { size?: V<Vec>; position?: V<Vec>; roundness?: V<number> }
export const Rect = prim<RectProps>('rect');
export interface EllipseProps extends ShapeItemProps { size?: V<Vec>; position?: V<Vec> }
export const Ellipse = prim<EllipseProps>('ellipse');
export interface StarProps extends ShapeItemProps { type?: 'star' | 'polygon'; points?: V<number>; outerRadius?: V<number>; innerRadius?: V<number>; outerRoundness?: V<number>; innerRoundness?: V<number>; rotation?: V<number>; position?: V<Vec> }
export const Star = prim<StarProps>('star');
export interface PathPoint { p: [number, number]; in?: [number, number]; out?: [number, number] }
export interface PathProps extends ShapeItemProps {
  /** SVG path data ("M0 0 C 10 0 ..."). */
  d?: string;
  /** Pen points: position plus in/out tangents relative to the point. */
  points?: PathPoint[];
  closed?: boolean;
  /** Animate the path: list of {t, d|points}. */
  morph?: { t: Time; d?: string; points?: PathPoint[]; easing?: EasingSpec }[];
}
export const Path = prim<PathProps>('path');
export interface GroupProps extends ShapeItemProps { position?: V<Vec>; anchor?: V<Vec>; scale?: V<Vec>; rotation?: V<number>; opacity?: V<number>; skew?: V<number> }
export const Group = prim<GroupProps>('group');
export interface FillProps extends ShapeItemProps { color?: V<ColorSpec>; opacity?: V<number>; rule?: 'nonZero' | 'evenOdd' }
export const Fill = prim<FillProps>('fill');
export interface StrokeProps extends ShapeItemProps { color?: V<ColorSpec>; width?: V<number>; opacity?: V<number>; cap?: 'butt' | 'round' | 'square'; join?: 'miter' | 'round' | 'bevel'; dash?: number[]; dashOffset?: V<number>; taperStart?: number; taperEnd?: number }
export const Stroke = prim<StrokeProps>('stroke');
export interface GradientProps extends ShapeItemProps {
  type?: 'linear' | 'radial';
  /** Color stops: offset 0..1. */
  stops: { offset: number; color: ColorSpec; opacity?: number }[];
  start?: V<Vec>; end?: V<Vec>;
  opacity?: V<number>;
  width?: V<number>; // GradientStroke only
}
/** Gradient fill. Built through a generated animation preset (gradient stops are not scriptable in AE). */
export const GradientFill = prim<GradientProps>('gfill');
export const GradientStroke = prim<GradientProps>('gstroke');
export interface TrimProps extends ShapeItemProps { start?: V<number>; end?: V<number>; offset?: V<number>; individually?: boolean }
export const Trim = prim<TrimProps>('trim');
export interface RepeaterProps extends ShapeItemProps { copies?: V<number>; offset?: V<number>; position?: V<Vec>; scale?: V<Vec>; rotation?: V<number>; anchor?: V<Vec>; startOpacity?: V<number>; endOpacity?: V<number>; order?: 'below' | 'above' }
export const Repeater = prim<RepeaterProps>('repeater');
export interface MergeProps extends ShapeItemProps { mode?: 'merge' | 'add' | 'subtract' | 'intersect' | 'exclude' }
export const Merge = prim<MergeProps>('merge');
export const OffsetPaths = prim<ShapeItemProps & { amount?: V<number>; copies?: number; copyOffset?: V<number> }>('offset');
export const RoundCorners = prim<ShapeItemProps & { radius?: V<number> }>('roundCorners');
export const Twist = prim<ShapeItemProps & { angle?: V<number>; center?: V<Vec> }>('twist');
export const PuckerBloat = prim<ShapeItemProps & { amount?: V<number> }>('puckerBloat');
export const WigglePaths = prim<ShapeItemProps & { size?: V<number>; detail?: V<number>; points?: 'corner' | 'smooth'; wigglesPerSecond?: V<number>; seed?: number }>('wigglePaths');
export const ZigZag = prim<ShapeItemProps & { size?: V<number>; ridges?: V<number>; points?: 'corner' | 'smooth' }>('zigzag');

// ---------- Effects & masks ----------
export interface EffectProps {
  /** Display name ("Glow", "Gaussian Blur") or matchName ("ADBE Glo2"). */
  name: string;
  /** Name shown in Effect Controls. */
  label?: string;
  /** Params by display name ("Glow Radius") or matchName ("ADBE Glo2-0003"); values may be animated/controls. Layer refs: { layer: "id" }. */
  params?: Record<string, V<any>>;
  enabled?: boolean;
}
export const Effect = prim<EffectProps>('effect');
export interface MaskProps { path?: string; points?: PathPoint[]; rect?: { x: number; y: number; width: number; height: number; roundness?: number }; mode?: 'add' | 'subtract' | 'intersect' | 'none' | 'lighten' | 'darken' | 'difference'; feather?: V<Vec>; expansion?: V<number>; opacity?: V<number>; inverted?: boolean; name?: string }
export const Mask = prim<MaskProps>('mask');
