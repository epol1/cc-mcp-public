// Primitive components. Each is a marker function tagged with `.aec = <kind>`; the compiler reads props.
// Layer order follows JSX/Remotion: LATER siblings render ON TOP. Shape children follow AE's Contents
// order instead: first child is frontmost, and Fill/Stroke paint the paths listed above them.
import type { Anim, TextUnitsAnim, Vec } from './anim.ts';
import type { ControlRef } from './control.ts';
import type { EasingSpec } from '../shared/easing.ts';
import type { ColorSpec, Time } from '../shared/units.ts';
import type { FieldRef } from './field.ts';
import { jsx } from './jsx-runtime.ts';

/** A prop value: static, animated, a live control, or a field (exposed in the comp's Essential Graphics). */
type V<T> = T | Anim | ControlRef | FieldRef<T>;
type Children = any;

/** Props shared by every layer. Values may be static, animation descriptors, or control(...) refs. */
export interface LayerProps {
  /** Stable id for edits/rebuilds. Defaults to a path-derived id. */
  id?: string;
  /**
   * Style-lint hints (D78): 'bg' (background), 'persistent' (a logo bug or progress line that is meant to stay),
   * 'hero', 'transition:<kind>' (transitions library: repeats are flagged). Not visible in AE.
   */
  tags?: string[];
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
  /**
   * Motion blur: true/'native' = layer switch (comp switch is turned on automatically);
   * 'force' = CC Force Motion Blur (sub-frame sampling: works for effects, particles, precomps, Advanced 3D);
   * 'pixel' = Pixel Motion Blur (optical flow, good for footage). Object form sets samples/shutter.
   */
  motionBlur?: boolean | 'native' | 'force' | 'pixel' | { mode?: 'native' | 'force' | 'pixel'; samples?: number; shutterAngle?: number; shutterPhase?: number };
  /** Layer start/end inside its Sequence (seconds or "1.2s"). */
  from?: Time;
  duration?: Time;
  /** Use another layer as track matte. AE hides the matte layer; `showSource: true` keeps it visible (e.g. a shine matted to a logo). */
  matte?: { layer: string; type?: 'alpha' | 'alphaInverted' | 'luma' | 'lumaInverted'; showSource?: boolean };
  hidden?: boolean;
  shy?: boolean;
  guide?: boolean;
  label?: number;
  markers?: { t: Time; comment?: string; duration?: Time }[];
  /** Raw property overrides by AE path (matchName or display name segments), e.g. {"ADBE Transform Group/ADBE Opacity": 50}. */
  props?: Record<string, V<any>>;
  /** Raw expressions by AE path. */
  expressions?: Record<string, string>;
  /** Inside layout containers: share of leftover space, self-alignment, explicit slot size. */
  layout?: { grow?: number; align?: 'start' | 'center' | 'end' | 'stretch'; width?: number; height?: number; offset?: [number, number] };
  /** Effects as a list (needed on <Precomp>, whose children are its contents). Same as <Effect> children. */
  effects?: any[];
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
  /** Comp motion blur switch, or { shutterAngle, shutterPhase, samples, adaptiveLimit }. */
  motionBlur?: boolean | { enabled?: boolean; shutterAngle?: number; shutterPhase?: number; samples?: number; adaptiveLimit?: number };
  shutterAngle?: number;
  /** Comp markers (cues for expressions, e.g. a particle burst at { marker: 'hit' }); with `duration` they are scenes. */
  markers?: { t: Time; comment: string; duration?: Time }[];
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
  /** Expose this text in Essential Graphics (editable in the EG panel / Premiere); true = layer name. */
  eg?: boolean | string;
  /** Animate each letter in 3D (needed for rotationX/Y text animation). */
  perCharacter3D?: boolean;
  /**
   * Text on a path: an SVG path `d` (or pen points) in comp pixels, unless the layer is positioned (then relative
   * to its position). It becomes a mask (mode None) that Path Options follow.
   */
  path?: string | PathPoint[];
  /** Path Options. `firstMargin` / `lastMargin` (px along the path) are animatable: tween firstMargin to run text along the curve. */
  pathOptions?: { firstMargin?: V<number>; lastMargin?: V<number>; reverse?: boolean; perpendicular?: boolean; forceAlign?: boolean };
}
export const Text = prim<TextProps>('text');

export interface ShapeProps extends LayerProps {
  /**
   * Coordinate space of the contents. "layer" (default): path/shape coordinates are relative to the layer's
   * position (default comp centre), so <Rect> at [0, 0] is centred. "comp": coordinates are comp pixels (top-left
   * 0,0, like SVG); use it for paths drawn at absolute positions (rules, charts, guides).
   */
  space?: 'layer' | 'comp';
}
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
/** Comp markers (times relative to the enclosing Sequence): beat grids, cue points that expressions read. */
export const CompMarkers = prim<{ markers: { t: Time; comment?: string; duration?: Time }[] }>('compMarkers');
export interface VectorProps extends Omit<FootageProps, 'fit' | 'speed' | 'trim' | 'loop' | 'muted' | 'crop'> {
  /** Vector artwork to convert: .ai, .eps or .pdf (imported, then turned into an editable shape layer). */
  src: string;
  /** Target width in px of the artwork (keeps aspect); default: its own size. */
  width?: number;
}
/**
 * Illustrator / EPS / PDF artwork as an editable shape layer: AE imports the file and runs Layer > Create Shapes from
 * Vector Layer, then the source layer is removed. Every path is a shape path you can animate (Trim, morph, color).
 * For .svg use <Svg> (converted in Node, with draw-on and fill controls).
 */
export function Vector(p: VectorProps) {
  return jsx(Footage as any, { ...p, fit: 'none', toShapes: true, vectorWidth: p.width });
}

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
/**
 * A rig effect (D74): one pseudo effect holding exactly the given controls, shown in Effect Controls under `name`.
 * Expressions read it with effect("<name>")("<param>"). Rig components (Cloner, CameraMove, live text reveals) add
 * their own; use this for your own rigs.
 */
export interface RigEffectProps {
  def: import('../compile/ffx/pseudo.ts').PseudoEffectDef;
  /** Instance name (default: the definition's name). Unique per layer. */
  name?: string;
  /** Param values by param name; numbers, colors, booleans, popup labels, animations or controls. */
  values?: Record<string, V<any>>;
}
export const RigEffect = prim<RigEffectProps>('rigEffect');
export interface MaskProps { path?: string; points?: PathPoint[]; rect?: { x: number; y: number; width: number; height: number; roundness?: number }; mode?: 'add' | 'subtract' | 'intersect' | 'none' | 'lighten' | 'darken' | 'difference'; feather?: V<Vec>; expansion?: V<number>; opacity?: V<number>; inverted?: boolean; name?: string }
export const Mask = prim<MaskProps>('mask');

// ---------- 3D ----------
export interface MaterialProps {
  /** true/false or "only" (casts shadows only, invisible itself). */
  castsShadows?: boolean | 'only';
  acceptsShadows?: boolean | 'only';
  acceptsLights?: boolean;
  appearsInReflections?: boolean;
  ambient?: V<number>; diffuse?: V<number>; specular?: V<number>; shininess?: V<number>; metal?: V<number>;
  reflection?: V<number>; reflectionSharpness?: V<number>; reflectionRolloff?: V<number>;
  transparency?: V<number>; transparencyRolloff?: V<number>; ior?: V<number>; lightTransmission?: V<number>;
  shadowColor?: ColorSpec;
}
export interface GeometryProps {
  /** Extrusion depth in px (text/shape; Advanced 3D or Cinema 4D renderer). */
  extrusion?: V<number>;
  bevel?: { style?: 'none' | 'angular' | 'concave' | 'convex'; depth?: V<number>; direction?: 'inward' | 'outward' | 'center' };
  holeBevelDepth?: V<number>;
  /** Footage planes: curvature (-100..100) and segments. */
  curvature?: V<number>;
  segments?: number;
}
export interface Layer3DProps {
  material?: MaterialProps;
  geometry?: GeometryProps;
  autoOrient?: 'none' | 'path' | 'camera' | 'characters';
}
// Interface merging: every layer accepts the 3D props.
export interface LayerProps extends Layer3DProps {}

export interface CameraProps extends LayerProps {
  /** Focal length in mm (36 mm film width), e.g. 24 wide, 50 normal, 85 portrait. Alternative to zoom. */
  lens?: number;
  zoom?: V<number>;
  /** Two-node camera target (default comp centre). Ignored when oneNode. */
  pointOfInterest?: V<Vec>;
  oneNode?: boolean;
  /** Aim the camera at a layer (by id) via expression. */
  lookAt?: string;
  dof?: boolean;
  focusDistance?: V<number>;
  /** Keep focus on a layer (by id) via expression (rack focus = animate which layer, or animate focusDistance). */
  focusOn?: string;
  /** Aperture in px; or give fStop (aperture = zoom / fStop). */
  aperture?: V<number>;
  fStop?: number;
  blurLevel?: V<number>;
  iris?: { shape?: 'fastRectangle' | 'triangle' | 'square' | 'pentagon' | 'hexagon' | 'heptagon' | 'octagon' | 'nonagon' | 'decagon'; rotation?: number; roundness?: number; aspect?: number; diffraction?: number; highlightGain?: number; highlightThreshold?: number; highlightSaturation?: number };
}
export const Camera = prim<CameraProps>('camera');

export interface LightProps extends LayerProps {
  kind?: 'parallel' | 'spot' | 'point' | 'ambient' | 'environment';
  intensity?: V<number>;
  color?: V<ColorSpec>;
  coneAngle?: V<number>;
  coneFeather?: V<number>;
  falloff?: 'none' | 'smooth' | 'inverseSquare';
  radius?: V<number>;
  falloffDistance?: V<number>;
  castsShadows?: boolean;
  shadowDarkness?: V<number>;
  shadowDiffusion?: V<number>;
  pointOfInterest?: V<Vec>;
  lookAt?: string;
  /** Environment light image (equirectangular .hdr/.exr/.png). Advanced 3D only. */
  hdri?: string;
  backgroundVisible?: boolean;
  backgroundOpacity?: V<number>;
  backgroundBlur?: V<number>;
}
export const Light = prim<LightProps>('light');

export interface ModelProps extends LayerProps {
  /** .glb / .gltf / .obj file (absolute or relative to the scene). Advanced 3D renderer. */
  src: string;
}
export const Model = prim<ModelProps>('model');

// ---------- Motion blur helper ----------
export interface MotionBlurProps { mode?: 'force' | 'pixel'; samples?: number; shutterAngle?: number; shutterPhase?: number; name?: string; id?: string; from?: Time; duration?: Time }
/**
 * Adjustment layer that forces motion blur on everything below it (CC Force Motion Blur by default,
 * or Pixel Motion Blur). Use when layer motion blur has no effect (particles, effects, Advanced 3D comps).
 */
export const MotionBlur = (p: MotionBlurProps) => ({ $$aec: 'element' as const, type: Adjustment, props: { name: p.name ?? 'Force Motion Blur', id: p.id, from: p.from, duration: p.duration, motionBlur: { mode: p.mode ?? 'force', samples: p.samples, shutterAngle: p.shutterAngle, shutterPhase: p.shutterPhase } } });
(MotionBlur as any).displayName = 'MotionBlur';
