// Transitions library (K4) core: the shape every transition shares, the controller rig, element-tree helpers and the
// standalone renderer. A transition is a definition with `build(props, io)`: given the outgoing beat's layers, the
// incoming beat's layers and the window (start, length), it returns both beats transformed (matted, parented,
// moved to 3D…) plus its own layers. Each transition has ONE controller null carrying its rig effect
// ("aec Shape Wipe", …) with a keyed `Progress` (0–100 %, the transition's timing and easing) and the kind's live
// amounts; its layers read it through short expressions, so a designer retimes or re-eases the whole transition by
// moving two keys, and ripple edits (which remap keys) keep it attached to the beat boundary. Layers that start at
// the window carry tags ['transition:<kind>'] so the style lint sees repeats.
import { Fragment, childrenOf, isElement, jsx } from '../jsx-runtime.ts';
import type { AecElement } from '../jsx-runtime.ts';
import { Null, RigEffect, Sequence } from '../primitives.ts';
import { isAnim, tween } from '../anim.ts';
import { isControl } from '../control.ts';
import { dslWarn } from '../warn.ts';
import type { PseudoEffectDef, PseudoParam } from '../../compile/ffx/pseudo.ts';
import { resolveEasing } from '../../shared/easing.ts';
import type { EasingSpec } from '../../shared/easing.ts';
import { parseTime } from '../../shared/units.ts';
import type { Time } from '../../shared/units.ts';

export type El = AecElement;

/** Timing every transition takes. */
export interface TransitionTiming {
  /**
   * Window start, relative to where the transition is placed (its Sequence, or the comp). Inside <Beats> it is set
   * from the beat boundary. Default 0.
   */
  at?: Time;
  /** Window length (default per kind, 0.5–0.9 s). */
  duration?: Time;
  /** Easing of the move (the Progress keys). Default per kind. */
  easing?: EasingSpec;
}

export interface TransitionBase extends TransitionTiming {
  /** Required: prefixes every layer id the transition makes (the controller null gets exactly this id). */
  id: string;
  /** Controller layer name (default "<Kind>: <id>"). Must be unique in the comp (expressions read it). */
  name?: string;
  /** Standalone use: the outgoing beat's layers (timed in the enclosing time base; not shifted). */
  outgoing?: any;
  /** Standalone use: the incoming beat's layers, timed from the window start (cut kinds: from the cut). */
  children?: any;
  /** Comp size used for geometry (default: the scene's comp when the compiler exposes it, else 1920×1080). */
  size?: [number, number];
}

/** What a transition gets to work with. Times in seconds. */
export interface TransitionIO {
  outgoing: El[];
  incoming: El[];
  /** Window start in the outgoing beat's time base. */
  outAt: number;
  /** Window start in the incoming beat's time base (0 for overlap kinds, −cut·duration for cut kinds). */
  inAt: number;
  /** From the start of the outgoing beat (or the enclosing start) to the window start. */
  before: number;
  /** From the window start to the end of the incoming beat; undefined = to the enclosing end. */
  after?: number;
  dur: number;
  w: number;
  h: number;
  fps: number;
  /**
   * <Beats> only: re-parent a carrier null made by an earlier transition (e.g. ZoomThrough's settle null) to `parent`,
   * so layers already parented to it follow this transition too.
   */
  adopt?: (carrier: string, parent: string) => void;
}

/** A transition's result. `under`/`over` layers are timed from the window start (0); `over` sits above the incoming beat. */
export interface TransitionParts {
  outgoing: El[];
  incoming: El[];
  under: El[];
  over?: El[];
}

export interface TransitionDef<P extends TransitionBase = any> {
  kind: string;
  /** Human label: rig effect name ("aec <label>"), default layer names. */
  label: string;
  defaultDuration: number;
  /**
   * Cut kinds (light leak): the beats don't overlap; the outgoing beat ends and the incoming one starts at this
   * fraction of the window. Undefined: the incoming beat starts at the window start and the beats overlap by the
   * whole window.
   */
  cut?: number;
  build(p: P, io: TransitionIO): TransitionParts;
}

/** A transition component: callable standalone, recognised by <Beats> through `.transition`. */
export type TransitionComponent<P extends TransitionBase> = ((p: P) => El) & { transition: TransitionDef<P> };

// ---------- comp info ----------
/** Comp size and fps: `globalThis.__AEC_COMP__` when the compiler exposes it, else 1920×1080 @ 30. */
export function compInfo(size?: [number, number]): { w: number; h: number; fps: number } {
  const g = (globalThis as any).__AEC_COMP__ as { w?: number; h?: number; fps?: number } | undefined;
  return { w: size?.[0] ?? g?.w ?? 1920, h: size?.[1] ?? g?.h ?? 1080, fps: g?.fps ?? 30 };
}

export const sec = (t: Time | undefined, fps: number, d = 0): number => (t === undefined ? d : parseTime(t, fps));
export const r3 = (v: number) => Math.round(v * 1000) / 1000;
export const lit = (v: number[]) => `[${v.map(r3).join(', ')}]`;

/** Cubic-bezier control points of an easing (falls back to easeInOutCubic for springs/custom curves). */
export function bezierOf(e: EasingSpec | undefined, fallback: EasingSpec = 'easeInOutCubic'): [number, number, number, number] {
  const c = resolveEasing(e ?? fallback);
  if (c.bezier) return [c.bezier[0], c.bezier[1], c.bezier[2], c.bezier[3]];
  dslWarn(`transitions: easing "${c.name}" is not a cubic bezier; per-piece easing uses easeInOutCubic instead`);
  return [0.65, 0, 0.35, 1];
}

// ---------- element helpers ----------
const LAYER_KINDS = new Set(['solid', 'null', 'adjustment', 'text', 'shape', 'footage', 'precomp', 'camera', 'light', 'model']);
export const kindOf = (el: any): string | undefined => el?.type?.aec;
export const isLayerEl = (el: any) => isElement(el) && LAYER_KINDS.has(kindOf(el) ?? '');
export const withProps = (el: El, extra: Record<string, any>): El => ({ ...el, props: { ...el.props, ...extra } });

/** Flattens children to elements, calling function components (so their layers can be transformed). */
export function expand(node: any): El[] {
  const out: El[] = [];
  for (const c of childrenOf(node)) {
    if (typeof c === 'string') { if (c.trim()) dslWarn(`transitions: stray text "${c.trim().slice(0, 30)}" outside <Text> was ignored`); continue; }
    if (!kindOf(c) && typeof c.type === 'function') { out.push(...expand(c.type({ ...c.props }))); continue; }
    out.push(c);
  }
  return out;
}

/**
 * Maps every layer element in a beat's tree (through Sequences, Series, layout containers and components) with `f`.
 * Non-layer elements and other kinds pass through unchanged.
 */
export function mapLayers(node: any, f: (el: El) => El | El[] | null): El[] {
  const out: El[] = [];
  for (const c of expand(node)) {
    const k = kindOf(c);
    if (k && LAYER_KINDS.has(k)) { const r = f(c); if (r) out.push(...(Array.isArray(r) ? r : [r])); continue; }
    if (k === 'sequence' || k === 'series.sequence' || (k && k.startsWith('layout.'))) { out.push(withProps(c, { children: mapLayers(c.props.children, f) })); continue; }
    if (k === 'series') { out.push(withProps(c, { children: childrenOf(c.props.children).map((s: any) => (isElement(s) ? withProps(s, { children: mapLayers(s.props.children, f) }) : s)) })); continue; }
    out.push(c);
  }
  return out;
}

/** Every layer element in a tree, in JSX order (bottom → top). */
export function layersOf(node: any): El[] {
  const out: El[] = [];
  mapLayers(node, (el) => { out.push(el); return el; });
  return out;
}

/** Full-frame backdrops: solids without a size, footage, adjustment layers, or layers tagged 'bg'. */
export function isBackdrop(el: El): boolean {
  const k = kindOf(el), p = el.props;
  if (p.tags?.includes('bg')) return true;
  return (k === 'solid' && p.width === undefined && p.height === undefined) || k === 'footage' || k === 'adjustment';
}

/** Position is split into X/Y(/Z) Position in AE (an animated or control-driven x, y or z). */
export function separated(p: Record<string, any>): boolean {
  if (p.position !== undefined || p.animate?.position !== undefined) return false;
  const live = (v: any) => isAnim(v) || isControl(v);
  return ['x', 'y', 'z'].some((k) => live(p.animate?.[k]) || live(p[k]));
}

/** Adds an expression by AE path, refusing to replace one the element already sets there. */
export function addExpression(el: El, path: string, code: string, who: string): El | null {
  if (el.props.expressions?.[path] !== undefined) { dslWarn(`${who}: layer ${el.props.id ?? el.props.name ?? kindOf(el)} already has an expression on ${path.split('/').pop()}; left as is`); return null; }
  return withProps(el, { expressions: { ...(el.props.expressions ?? {}), [path]: code } });
}

/** Mattes every layer of a beat to `layer` (cameras, lights and nulls are skipped). */
export function matteAll(node: any, layer: string, opts: { type?: 'alpha' | 'alphaInverted' | 'luma' | 'lumaInverted'; showSource?: boolean } = {}, who = 'transition'): El[] {
  return mapLayers(node, (el) => {
    const k = kindOf(el);
    if (k === 'camera' || k === 'light' || k === 'null') return el;
    if (el.props.matte) { dslWarn(`${who}: layer ${el.props.id ?? el.props.name ?? k} already has a track matte; it is not revealed by the transition`); return el; }
    return withProps(el, { matte: { layer, type: opts.type ?? 'alpha', ...(opts.showSource ? { showSource: true } : {}) } });
  });
}

/**
 * Parents every unparented layer of a beat (except cameras and lights) to `parent`. `carrier` marks the new parent as
 * a transition carrier that is at rest (identity) outside its window: later transitions may move such layers, and
 * (in <Beats>) re-parent the carrier itself through io.adopt.
 */
export function parentAll(node: any, parent: string, who = 'transition', opts: { carrier?: boolean; adopt?: TransitionIO['adopt'] } = {}): El[] {
  return mapLayers(node, (el) => {
    const k = kindOf(el);
    if (k === 'camera' || k === 'light') return el;
    if (el.props.parent) {
      if (el.props.parent === parent) return el;
      if (el.props.carrierParent && opts.adopt) { opts.adopt(el.props.parent, parent); return el; }
      dslWarn(`${who}: layer ${el.props.id ?? el.props.name ?? k} already has a parent (${el.props.parent}); it does not follow the transition`);
      return el;
    }
    return withProps(el, opts.carrier ? { parent, carrierParent: true } : { parent });
  });
}

// ---------- the controller rig ----------
export const slider = (name: string, def: number, min: number, max: number, extra: Partial<Extract<PseudoParam, { kind: 'slider' }>> = {}): PseudoParam => ({ kind: 'slider', name, default: def, min, max, precision: 1, ...extra });
export const PROGRESS = slider('Progress', 0, 0, 100, { display: 'percent', precision: 2 });

/** "aec <label>" rig definition: Progress plus the kind's params. */
export function rigDef(label: string, params: PseudoParam[]): PseudoEffectDef {
  return { name: `aec ${label}`, params: [PROGRESS, ...params] };
}

/** Controller layer name. */
export const ctlName = (def: TransitionDef, p: TransitionBase) => p.name ?? `${def.label}: ${p.id}`;
export const tagsOf = (def: TransitionDef) => [`transition:${def.kind}`];

/** Expression reference to a rig param on the controller (from any layer in the comp). */
export const rigParam = (p: TransitionBase, label: string, param: string) => `__AEC_LAYER(${p.id})__.effect(${JSON.stringify(label)})(${JSON.stringify(param)}).value`;

/** First expression lines of a transition layer: comment + `e` (rig) + `P` (progress 0–1). */
export function head(def: TransitionDef, p: TransitionBase, what: string, local = false): string {
  const e = local ? `effect(${JSON.stringify(def.label)})` : `__AEC_LAYER(${p.id})__.effect(${JSON.stringify(def.label)})`;
  return `// ae-compose ${def.kind} "${p.id}": ${what} (rig: "${def.label}" on "${ctlName(def, p)}")\nvar e = ${e}, P = e("Progress").value / 100;`;
}

/**
 * The controller null: spans the window (so the style lint sees the transition there), holds the rig with keyed
 * Progress (eased, or linear when pieces carry their own easing), and is tagged.
 */
export function controller(def: TransitionDef, p: TransitionBase, io: TransitionIO, params: PseudoParam[], values: Record<string, any>, opts: { linear?: boolean; extra?: Record<string, any> } = {}): El {
  const progress = tween({ from: 0, to: 100, duration: io.dur, easing: opts.linear ? 'linear' : p.easing ?? 'easeInOutCubic' });
  return jsx(Null, {
    id: p.id, name: ctlName(def, p), tags: tagsOf(def), from: 0, duration: io.dur, ...(opts.extra ?? {}),
    children: jsx(RigEffect, { def: rigDef(def.label, params), name: def.label, values: { Progress: progress, ...values } }),
  });
}

// ---------- rendering ----------
/** Standalone placement: outgoing layers as given, the transition's layers and the incoming beat from `at`. */
export function renderStandalone<P extends TransitionBase>(def: TransitionDef<P>, p: P & { start?: Time; end?: Time }): El {
  if (!p.id) throw new Error(`<${def.label.replace(/ /g, '')}> needs an id (it prefixes the transition's layers)`);
  const { w, h, fps } = compInfo(p.size);
  const d = sec(p.duration, fps, def.defaultDuration), at = sec(p.at, fps, 0);
  const cIn = def.cut ?? 0;
  const io: TransitionIO = {
    outgoing: expand(p.outgoing), incoming: expand(p.children), outAt: at, inAt: -cIn * d,
    before: at - sec(p.start, fps, 0), after: p.end !== undefined ? sec(p.end, fps) - at : undefined, dur: d, w, h, fps,
  };
  const r = def.build(p, io);
  const inc = cIn ? [jsx(Sequence, { from: cIn * d, children: r.incoming })] : r.incoming;
  return jsx(Fragment, { children: [...r.outgoing, jsx(Sequence, { from: at, children: [...r.under, ...inc, ...(r.over ?? [])] })] });
}

/** Wraps a definition as a JSX component (standalone render) that <Beats> also recognises. */
export function defineTransition<P extends TransitionBase>(def: TransitionDef<P>): TransitionComponent<P> {
  const C: any = (p: P) => renderStandalone(def, p as any);
  C.transition = def;
  C.displayName = def.label.replace(/ /g, '');
  return C;
}
