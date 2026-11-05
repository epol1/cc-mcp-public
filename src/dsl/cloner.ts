// The cloner (P1/P2, MASH-style): `of` becomes one master precomp; `count` precomp layers of it are its instances.
// A controller null carries one "Cloner" rig effect (D74) with every live parameter: distribution, motion, seed,
// randomness, falloff, stagger, step, palette. Instance 1 is built with index-based expressions
// (i = n − (index − controller index): copies stack above instance 1) that call the expression library (D73), and AE duplicates it, so every
// instance shares one expression and a designer edits the master, drags a slider, or moves the controller
// (instances are parented to it) with no rebuild. Only `count` needs a rebuild. Per-instance data goes to
// Essential Properties overrides (fields) or to arrays embedded in the expressions (transform channels).
import fs from 'node:fs';
import path from 'node:path';
import { Fragment, jsx } from './jsx-runtime.ts';
import type { AecElement } from './jsx-runtime.ts';
import { Effect, Group, Null, Path, Precomp, Repeater, RigEffect, Shape } from './primitives.ts';
import type { LayerProps } from './primitives.ts';
import { expr } from './anim.ts';
import type { Anim } from './anim.ts';
import { dslWarn } from './warn.ts';
import type { PseudoEffectDef, PseudoParam } from '../compile/ffx/pseudo.ts';
import { parseColor } from '@cc-mcp/core/units.ts';
import type { Time } from '@cc-mcp/core/units.ts';

// ---------- distributions ----------
export type Distribution =
  | { kind: 'line'; spacing?: number; angle?: number; centered?: boolean }
  | { kind: 'grid'; columns?: number; gap?: number | [number, number] }
  | { kind: 'circle'; radius?: number; start?: number; arc?: number; orient?: boolean }
  | { kind: 'path'; d: string; start?: number; end?: number; orient?: boolean; closed?: boolean; show?: boolean }
  | { kind: 'scatter'; width?: number; height?: number; jitter?: number }
  | { kind: 'sphere'; radius?: number }
  | { kind: 'helix'; radius?: number; height?: number; turns?: number };

/** Instances in a row, `spacing` px apart along `angle` degrees (centred on the cloner). */
export const line = (o: Omit<Extract<Distribution, { kind: 'line' }>, 'kind'> = {}): Distribution => ({ kind: 'line', ...o });
/** Rows of `columns`, `gap` px apart ([x, y] or one number), centred. */
export const grid = (o: Omit<Extract<Distribution, { kind: 'grid' }>, 'kind'> = {}): Distribution => ({ kind: 'grid', ...o });
/** On a circle of `radius`; `arc` < 360 spreads them over an arc starting at `start` (0 = top, clockwise). */
export const circle = (o: Omit<Extract<Distribution, { kind: 'circle' }>, 'kind'> = {}): Distribution => ({ kind: 'circle', ...o });
/** Along an SVG path (comp pixels), from `start` to `end` % of its length; `orient` turns them along the path. */
export const onPath = (o: Omit<Extract<Distribution, { kind: 'path' }>, 'kind'>): Distribution => ({ kind: 'path', ...o });
/** Seeded scatter over a `width` × `height` area with even spacing (jittered grid; `jitter` 0–1). */
export const scatter = (o: Omit<Extract<Distribution, { kind: 'scatter' }>, 'kind'> = {}): Distribution => ({ kind: 'scatter', ...o });
/** 3D: evenly over a sphere of `radius` (Fibonacci sphere). */
export const sphere = (o: Omit<Extract<Distribution, { kind: 'sphere' }>, 'kind'> = {}): Distribution => ({ kind: 'sphere', ...o });
/** 3D: a helix of `radius`, `height` and `turns`. */
export const helix = (o: Omit<Extract<Distribution, { kind: 'helix' }>, 'kind'> = {}): Distribution => ({ kind: 'helix', ...o });

// ---------- effectors ----------
export type Effector =
  | { kind: 'noise'; position?: number; rotation?: number; scale?: number; opacity?: number; z?: number; speed?: number }
  | { kind: 'falloff'; shape?: 'radial' | 'linear'; center?: [number, number] | [number, number, number]; radius?: number; softness?: number; angle?: number; width?: number; scale?: [number, number]; opacity?: [number, number]; blur?: [number, number]; brightness?: [number, number] }
  | { kind: 'stagger'; each?: number; order?: 'start' | 'end' | 'center' | 'edges' | 'random'; by?: 'index' | 'distance' | 'random' }
  | { kind: 'follow'; lag?: number }
  | { kind: 'step'; position?: number; rotation?: number }
  | { kind: 'color'; field: string; palette: string[]; mode?: 'cycle' | 'random' | 'gradient' };

/** Seeded variation: position (px), rotation (°), scale and opacity (%), z (px, 3D); `speed` > 0 makes it wobble (Hz). */
export const noise = (o: Omit<Extract<Effector, { kind: 'noise' }>, 'kind'> = {}): Effector => ({ kind: 'noise', ...o });
/**
 * Scale/opacity/blur/brightness by distance from a field: a draggable "<name> Field" null (radial, or a line at `angle` for
 * linear). Values are [outside, inside], e.g. scale: [80, 115] = cards grow as they pass the field.
 */
export const falloff = (o: Omit<Extract<Effector, { kind: 'falloff' }>, 'kind'> = {}): Effector => ({ kind: 'falloff', ...o });
/** Time offset of the master's own animation per instance: by index (with `order`), distance from the field, or random. */
export const stagger = (o: Omit<Extract<Effector, { kind: 'stagger' }>, 'kind'> = {}): Effector => ({ kind: 'stagger', ...o });
/** Each instance trails the controller's motion `lag` s behind the previous one (animate the controller null). */
export const follow = (o: Omit<Extract<Effector, { kind: 'follow' }>, 'kind'> = {}): Effector => ({ kind: 'follow', ...o });
/** Quantize: position to a `position` px grid, rotation to `rotation` ° steps. */
export const step = (o: Omit<Extract<Effector, { kind: 'step' }>, 'kind'> = {}): Effector => ({ kind: 'step', ...o });
/** Palette on a master field (a color `field()`): cycle by index, seeded random, or a gradient across the instances. */
export const colorize = (o: Omit<Extract<Effector, { kind: 'color' }>, 'kind'>): Effector => ({ kind: 'color', ...o });

export interface ClonerMotion {
  /** Travel along `direction` in px/s (circle: °/s around it; path: % of the path per second). */
  speed?: number;
  /** Starting offset (same units); an animation (keys/tween) moves the whole stream, e.g. a rush out. */
  offset?: number | Anim;
  /** Direction of travel in degrees (0 = right, 90 = down). Ignored by circle and path. */
  direction?: number;
  /** Wrap length in px: instances leaving one end re-enter at the other (0 = no wrap). Path: wrap when closed. */
  wrap?: number;
  /** Per-instance speed variation, ±%. */
  variation?: number;
}

export interface ClonerProps extends Omit<LayerProps, 'children'> {
  /** Unique id (also prefixes the instance ids). */
  id: string;
  /** Instances (default: data rows, else 10). Changing it needs a rebuild; everything else is live. */
  count?: number;
  /** The master: any layers, built once as a precomp of `size`. */
  of: AecElement | AecElement[];
  /** Master comp size [w, h] (keep it tight around the content: every instance renders this area). */
  size: [number, number];
  /** Master comp duration (default: the cloner's span). */
  masterDuration?: Time;
  distribute?: Distribution;
  motion?: ClonerMotion;
  effectors?: Effector[];
  /**
   * One row per instance. Keys that name a master field set that instance's Essential Property (text, color, number);
   * x, y, z, rotation, scale, opacity and delay offset that instance (embedded in the expressions).
   */
  data?: Record<string, any>[];
  seed?: number;
  /** Base instance transform: scale %, rotation °, opacity % (each may be animated: they are rig params). */
  scale?: number | Anim;
  rotation?: number | Anim;
  opacity?: number | Anim;
  /** 3D instances (automatic for sphere and helix). */
  threeD?: boolean;
  /**
   * How `data` reaches master fields: 'expression' (default) puts each field's values in one expression on the
   * Essential Property (fast to build at any count); 'overrides' writes a static value per instance (slower to
   * build; a designer can retype one card's text directly).
   */
  dataMode?: 'expression' | 'overrides';
  /**
   * 'layers' (default): one precomp layer per instance, every effector and field available. 'repeater': for large
   * counts of a shape-only master: one shape layer with native Repeaters (line, grid, circle), much faster to render,
   * count live, but no effectors, data or fields. Measured (docs/DSL.md "Cloner performance").
   */
  mode?: 'layers' | 'repeater';
  /** Cloner position (default comp centre via the controller null). */
  position?: [number, number] | [number, number, number];
}

const DATA_CHANNELS = ['x', 'y', 'z', 'rotation', 'scale', 'opacity', 'delay'] as const;

/** CSV text or file → rows (numbers parsed; first line is the header). Paths are relative to the scene file. */
export function csv(src: string): Record<string, any>[] {
  const text = /[\n,]/.test(src) && !fs.existsSync(src) ? src : fs.readFileSync(path.isAbsolute(src) ? src : path.resolve((globalThis as any).__AEC_SCENE_DIR__ ?? process.cwd(), src), 'utf8');
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((c) => c !== '')) rows.push(row); row = []; }
    else cell += ch;
  }
  row.push(cell); if (row.some((c) => c !== '')) rows.push(row);
  const [head, ...body] = rows;
  if (!head) return [];
  return body.map((r) => Object.fromEntries(head.map((h, k) => { const v = (r[k] ?? '').trim(); return [h.trim(), v !== '' && !Number.isNaN(Number(v)) ? Number(v) : v]; })));
}

/** The "Cloner" rig definition for this configuration (only the groups it uses). */
function clonerDef(d: Distribution, motion: ClonerMotion | undefined, fx: Effector[], threeD: boolean): PseudoEffectDef {
  const sl = (name: string, def: number, min: number, max: number, extra: Partial<Extract<PseudoParam, { kind: 'slider' }>> = {}): PseudoParam => ({ kind: 'slider', name, default: def, min, max, precision: 1, ...extra });
  const dist: PseudoParam[] = {
    line: [sl('Spacing', 100, -500, 500, { display: 'pixel' }), { kind: 'angle', name: 'Angle', default: 0 } as PseudoParam, { kind: 'checkbox', name: 'Centered', default: true } as PseudoParam],
    grid: [sl('Columns', 5, 1, 30, { validMin: 1, precision: 0 }), sl('Gap X', 120, 0, 800, { display: 'pixel' }), sl('Gap Y', 120, 0, 800, { display: 'pixel' })],
    circle: [sl('Radius', 300, 0, 2000, { display: 'pixel' }), { kind: 'angle', name: 'Start Angle', default: 0 } as PseudoParam, sl('Arc', 360, 0, 360, { validMin: 0, validMax: 360 }), { kind: 'checkbox', name: 'Orient', default: false } as PseudoParam],
    path: [sl('Path Start', 0, 0, 100, { display: 'percent' }), sl('Path End', 100, 0, 100, { display: 'percent' }), { kind: 'checkbox', name: 'Orient', default: true } as PseudoParam],
    scatter: [sl('Area Width', 1600, 0, 4000, { display: 'pixel', validMin: 0 }), sl('Area Height', 900, 0, 4000, { display: 'pixel', validMin: 0 }), sl('Jitter', 80, 0, 100, { display: 'percent' })],
    sphere: [sl('Radius', 400, 0, 3000, { display: 'pixel' })],
    helix: [sl('Radius', 300, 0, 2000, { display: 'pixel' }), sl('Height', 600, -3000, 3000, { display: 'pixel' }), sl('Turns', 2, 0, 20)],
  }[d.kind];
  const params: PseudoParam[] = [
    sl('Seed', 1, 0, 1000, { precision: 0 }),
    sl('Scale', 100, 0, 400, { display: 'percent' }), { kind: 'angle', name: 'Rotation', default: 0 }, sl('Opacity', 100, 0, 100, { display: 'percent', validMin: 0, validMax: 100 }),
    { kind: 'group', name: 'Distribution', params: dist },
  ];
  if (motion) params.push({ kind: 'group', name: 'Motion', params: [sl('Offset', 0, -2000, 2000), sl('Speed', 0, -2000, 2000), { kind: 'angle', name: 'Direction', default: 0 }, sl('Wrap', 0, 0, 6000, { validMin: 0, display: 'pixel' }), sl('Speed Variation', 0, 0, 100, { display: 'percent' })] });
  for (const e of fx) {
    if (e.kind === 'noise') params.push({ kind: 'group', name: 'Randomness', params: [sl('Position Random', 0, 0, 500, { display: 'pixel' }), sl('Rotation Random', 0, 0, 180), sl('Scale Random', 0, 0, 100, { display: 'percent' }), sl('Opacity Random', 0, 0, 100, { display: 'percent' }), ...(threeD ? [sl('Z Random', 0, 0, 2000, { display: 'pixel' })] : []), sl('Noise Speed', 0, 0, 5, { precision: 2 })] });
    if (e.kind === 'falloff') params.push({ kind: 'group', name: 'Falloff', params: [
      ...(e.shape === 'linear' ? [{ kind: 'angle', name: 'Field Angle', default: 0 } as PseudoParam, sl('Field Width', 400, 1, 4000, { display: 'pixel', validMin: 1 })] : [sl('Falloff Radius', 400, 0, 3000, { display: 'pixel' }), sl('Falloff Softness', 300, 1, 3000, { display: 'pixel', validMin: 1 })]),
      sl('Inside Scale', 100, 0, 400, { display: 'percent' }), sl('Outside Scale', 100, 0, 400, { display: 'percent' }),
      sl('Inside Opacity', 100, 0, 100, { display: 'percent' }), sl('Outside Opacity', 100, 0, 100, { display: 'percent' }),
      ...(e.blur ? [sl('Inside Blur', 0, 0, 100), sl('Outside Blur', 0, 0, 100)] : []),
      ...(e.brightness ? [sl('Inside Brightness', 0, -150, 150), sl('Outside Brightness', 0, -150, 150)] : []),
    ] });
    if (e.kind === 'stagger') params.push({ kind: 'group', name: 'Stagger', params: [sl('Each', 0.05, 0, 2, { precision: 3, validMin: 0 }), { kind: 'popup', name: 'Order', items: ['Start', 'End', 'Center', 'Edges', 'Random'], default: 1 }, { kind: 'popup', name: 'Stagger By', items: ['Index', 'Distance', 'Random'], default: 1 }] });
    if (e.kind === 'follow') params.push({ kind: 'group', name: 'Follow', params: [sl('Lag', 0.08, 0, 2, { precision: 3, validMin: 0 })] });
    if (e.kind === 'step') params.push({ kind: 'group', name: 'Step', params: [sl('Position Step', 0, 0, 500, { display: 'pixel', validMin: 0 }), sl('Rotation Step', 0, 0, 180, { validMin: 0 })] });
    if (e.kind === 'color') params.push({ kind: 'group', name: 'Palette', params: [...e.palette.map((c, k): PseudoParam => ({ kind: 'color', name: `Color ${k + 1}`, default: parseColor(c) })), { kind: 'popup', name: 'Color Mode', items: ['Cycle', 'Random', 'Gradient'], default: 1 }] });
  }
  return { name: 'aec Cloner', params };
}

const r = (v: number) => +v.toFixed(4);

/**
 * Large counts (P5 scale): a shape-only master as ONE shape layer, copied by native Repeaters (line, grid = two
 * repeaters, circle = rotation around the layer origin). Renders far faster than layers (no per-instance expressions
 * or precomps), and even the count stays live (Copies). No effectors, data or fields: every copy is identical except
 * the repeater's step transform. Motion: Offset moves the copies along the line.
 */
function RepeaterCloner(p: ClonerProps, n: number, d: Distribution) {
  const { id, of, distribute: _d, motion, effectors, data, mode: _m, size: _s, seed: _seed, ...layer } = p as any;
  if (effectors?.length) throw new Error(`<Cloner id="${id}" mode="repeater">: effectors need mode "layers" (repeater copies can't vary individually)`);
  if (data?.length) throw new Error(`<Cloner id="${id}" mode="repeater">: data needs mode "layers"`);
  const shapes = (Array.isArray(of) ? of : [of]).flat();
  const groups = shapes.map((el: any, k: number) => {
    if (el?.type?.aec !== 'shape') throw new Error(`<Cloner id="${id}" mode="repeater">: the master must be <Shape> elements (got <${el?.type?.displayName ?? el?.type}>)`);
    const sp = el.props;
    const pos = sp.position ?? (sp.x !== undefined || sp.y !== undefined ? [sp.x ?? 0, sp.y ?? 0] : undefined);
    return jsx(Group, { name: sp.name ?? `Part ${k + 1}`, position: pos, scale: sp.animate?.scale ?? sp.scale, rotation: sp.animate?.rotation ?? sp.rotation, opacity: sp.animate?.opacity ?? sp.opacity, children: sp.children });
  });
  const speed = motion?.speed ?? 0;
  let content: any[];
  if (d.kind === 'line') {
    const sp = d.spacing ?? 100, a = ((d.angle ?? 0) * Math.PI) / 180, off = d.centered === false ? 0 : -(n - 1) / 2;
    const offset = speed ? expr(`// ae-compose cloner "${p.name ?? id}": repeater travel (${speed} px/s)
${r(off)} + (time - inPoint) * ${speed} / ${sp};`) : off;
    content = [jsx(Group, { name: 'Cloner Copies', children: [...groups, jsx(Repeater, { name: 'Cloner Repeater', copies: n, offset, position: [r(Math.cos(a) * sp), r(Math.sin(a) * sp)] })] })];
  } else if (d.kind === 'grid') {
    const cols = Math.max(1, Math.round(d.columns ?? Math.ceil(Math.sqrt(n)))), rows = Math.ceil(n / cols);
    const g = Array.isArray(d.gap) ? d.gap : [d.gap ?? 100, d.gap ?? 100];
    content = [jsx(Group, { name: 'Cloner Rows', children: [
      jsx(Group, { name: 'Cloner Columns', children: [...groups, jsx(Repeater, { name: 'Columns', copies: cols, offset: -(cols - 1) / 2, position: [g[0], 0] })] }),
      jsx(Repeater, { name: 'Rows', copies: rows, offset: -(rows - 1) / 2, position: [0, g[1]] }),
    ] })];
  } else if (d.kind === 'circle') {
    const full = d.arc === undefined || d.arc >= 360, arc = full ? 360 : d.arc!, stepA = full ? 360 / n : arc / Math.max(1, n - 1);
    const rot = speed ? expr(`// ae-compose cloner "${p.name ?? id}": repeater spin (${speed} °/s)
${r(d.start ?? 0)} + (time - inPoint) * ${speed};`) : d.start ?? 0;
    content = [jsx(Group, { name: 'Cloner Ring', rotation: rot, children: [jsx(Group, { name: 'Cloner Copies', position: [0, -(d.radius ?? 300)], children: groups }), jsx(Repeater, { name: 'Cloner Repeater', copies: n, position: [0, 0], rotation: r(stepA) })] })];
  } else throw new Error(`<Cloner id="${id}" mode="repeater">: ${d.kind} distributions need mode "layers" (repeater supports line, grid, circle)`);
  return jsx(Shape, { ...layer, id, name: p.name ?? id, children: content });
}

export function Cloner(p: ClonerProps) {
  const { id, of, size, distribute, motion, effectors = [], data, seed, scale, rotation, opacity, threeD: td, position, masterDuration, count: cnt, mode, dataMode: _dm, ...layer } = p;
  if (!id) throw new Error('<Cloner> needs an id');
  const n = Math.round(cnt ?? data?.length ?? 10);
  if (mode === 'repeater') return RepeaterCloner(p, n, distribute ?? line({ spacing: 100 }));
  if (!size || size.length !== 2) throw new Error(`<Cloner id="${id}"> needs size={[w, h]}: the master comp's size (keep it tight around the content)`);
  // Render cost (measured, D77): each distinct set of field values renders the master once per frame.
  const textFields = data ? [...new Set(data.flatMap((row) => Object.keys(row)))].filter((k) => typeof data.find((row) => row[k] !== undefined)?.[k] === 'string' && !(DATA_CHANNELS as readonly string[]).includes(k)) : [];
  if (textFields.length && n > 40) dslWarn(`<Cloner id="${id}">: ${n} instances with their own ${textFields.join(', ')} text: every instance renders the master separately (100 unique labels measured 5–20 s/frame); fine for a still or a short shot, otherwise reuse a few values or keep text out of the master`);
  if (n > 300) dslWarn(`<Cloner id="${id}">: ${n} instance layers: builds and renders slow down past ~300 (measured in docs/DSL.md "Cloner performance"); for identical shape copies use mode: 'repeater'`);
  if (n < 1) throw new Error(`<Cloner id="${id}">: count must be at least 1`);
  const d = distribute ?? line({ spacing: Math.round(size[0] * 1.2) });
  const kinds = new Set(effectors.map((e) => e.kind));
  for (const k of kinds) if (effectors.filter((e) => e.kind === k).length > 1 && k !== 'color') throw new Error(`<Cloner id="${id}">: one ${k} effector at most`);
  const threeD = td ?? (d.kind === 'sphere' || d.kind === 'helix');
  if (d.kind === 'path' && threeD) throw new Error(`<Cloner id="${id}">: path distribution is 2D`);
  const name = p.name ?? id;
  const ctl = `${id}.ctl`, inst = `${id}.inst`, fieldId = `${id}.field`, pathId = `${id}.path`;
  const fo = effectors.find((e) => e.kind === 'falloff') as Extract<Effector, { kind: 'falloff' }> | undefined;
  const nz = effectors.find((e) => e.kind === 'noise') as Extract<Effector, { kind: 'noise' }> | undefined;
  const st = effectors.find((e) => e.kind === 'stagger') as Extract<Effector, { kind: 'stagger' }> | undefined;
  const fl = effectors.find((e) => e.kind === 'follow') as Extract<Effector, { kind: 'follow' }> | undefined;
  const sp = effectors.find((e) => e.kind === 'step') as Extract<Effector, { kind: 'step' }> | undefined;
  const colors = effectors.filter((e) => e.kind === 'color') as Extract<Effector, { kind: 'color' }>[];
  if (colors.length > 1) throw new Error(`<Cloner id="${id}">: one colorize effector at most`);
  const def = clonerDef(d, motion, effectors, threeD);

  // Rig values from the props (everything else stays at the definition's defaults).
  const v: Record<string, any> = { Seed: seed ?? 1, Scale: scale ?? 100, Rotation: rotation ?? 0, Opacity: opacity ?? 100 };
  if (d.kind === 'line') Object.assign(v, { Spacing: d.spacing ?? Math.round(size[0] * 1.2), Angle: d.angle ?? 0, Centered: d.centered !== false });
  if (d.kind === 'grid') { const g = Array.isArray(d.gap) ? d.gap : [d.gap ?? Math.round(size[0] * 1.2), d.gap ?? Math.round(size[1] * 1.2)]; Object.assign(v, { Columns: d.columns ?? Math.ceil(Math.sqrt(n)), 'Gap X': g[0], 'Gap Y': g[1] }); }
  if (d.kind === 'circle') Object.assign(v, { Radius: d.radius ?? 300, 'Start Angle': d.start ?? 0, Arc: d.arc ?? 360, Orient: !!d.orient });
  if (d.kind === 'path') Object.assign(v, { 'Path Start': d.start ?? 0, 'Path End': d.end ?? 100, Orient: d.orient !== false });
  if (d.kind === 'scatter') Object.assign(v, { 'Area Width': d.width ?? 1600, 'Area Height': d.height ?? 900, Jitter: Math.round((d.jitter ?? 0.8) * 100) });
  if (d.kind === 'sphere') Object.assign(v, { Radius: d.radius ?? 400 });
  if (d.kind === 'helix') Object.assign(v, { Radius: d.radius ?? 300, Height: d.height ?? 600, Turns: d.turns ?? 2 });
  if (motion) Object.assign(v, { Offset: motion.offset ?? 0, Speed: motion.speed ?? 0, Direction: motion.direction ?? 0, Wrap: motion.wrap ?? 0, 'Speed Variation': motion.variation ?? 0 });
  if (nz) Object.assign(v, { 'Position Random': nz.position ?? 0, 'Rotation Random': nz.rotation ?? 0, 'Scale Random': nz.scale ?? 0, 'Opacity Random': nz.opacity ?? 0, ...(threeD ? { 'Z Random': nz.z ?? 0 } : {}), 'Noise Speed': nz.speed ?? 0 });
  if (fo) {
    Object.assign(v, fo.shape === 'linear' ? { 'Field Angle': fo.angle ?? 0, 'Field Width': fo.width ?? 400 } : { 'Falloff Radius': fo.radius ?? 400, 'Falloff Softness': fo.softness ?? 300 });
    Object.assign(v, { 'Outside Scale': fo.scale?.[0] ?? 100, 'Inside Scale': fo.scale?.[1] ?? 100, 'Outside Opacity': fo.opacity?.[0] ?? 100, 'Inside Opacity': fo.opacity?.[1] ?? 100 });
    if (fo.blur) Object.assign(v, { 'Outside Blur': fo.blur[0], 'Inside Blur': fo.blur[1] });
    if (fo.brightness) Object.assign(v, { 'Outside Brightness': fo.brightness[0], 'Inside Brightness': fo.brightness[1] });
  }
  if (st) Object.assign(v, { Each: st.each ?? 0.05, Order: ['start', 'end', 'center', 'edges', 'random'].indexOf(st.order ?? 'start') + 1, 'Stagger By': ['index', 'distance', 'random'].indexOf(st.by ?? 'index') + 1 });
  if (fl) Object.assign(v, { Lag: fl.lag ?? 0.08 });
  if (sp) Object.assign(v, { 'Position Step': sp.position ?? 0, 'Rotation Step': sp.rotation ?? 0 });
  if (colors[0]) { colors[0].palette.forEach((c, k) => { v[`Color ${k + 1}`] = c; }); v['Color Mode'] = ['cycle', 'random', 'gradient'].indexOf(colors[0].mode ?? 'cycle') + 1; }

  // Expressions (identical on every instance).
  const C = `__AEC_LAYER(${ctl})__`;
  // Instances stack below the controller with instance 1 at the bottom (later ones on top, like JSX order).
  const head = (what: string) => `// ae-compose cloner "${name}": ${what}\nvar C = ${C}, e = C.effect("Cloner"), n = ${n}, i = n - (index - C.index), s = e("Seed").value;`;
  const P = (x: string) => `e(${JSON.stringify(x)}).value`;
  const channels = DATA_CHANNELS.filter((k) => data?.some((row) => typeof row[k] === 'number'));
  const dataArr = (k: string) => `var D${k} = [${Array.from({ length: n }, (_, i) => (typeof data?.[i]?.[k] === 'number' ? r(data[i][k]) : k === 'scale' || k === 'opacity' ? 100 : 0)).join(', ')}];`;
  const toSpace = threeD ? 'toWorld' : 'toComp';
  // Position.
  const pos: string[] = [head(`position (${d.kind}${motion ? ', motion' : ''}${nz ? ', noise' : ''}${fl ? ', follow' : ''})`)];
  const flowT = '(time - inPoint)';
  const fs = motion ? `${P('Speed')} * (1 + L.srand(i, s + 5) * ${P('Speed Variation')} / 100)` : '0';
  const circleStart = motion ? `${P('Start Angle')} + ${P('Offset')} + ${fs} * ${flowT}` : P('Start Angle');
  const pathU = `L.lerp(${P('Path Start')}, ${P('Path End')}, n > 1 ? i / (n - 1) : 0) / 100${motion ? ` + (${P('Offset')} + ${fs} * ${flowT}) / 100` : ''}`;
  if (fl) {
    pos.push(`var a = C.transform.anchorPoint, p = sub(C.fromComp(C.toComp(a, time - i * ${P('Lag')})), a);`);
    if (!threeD) pos.push('p = [p[0], p[1]];');
  } else switch (d.kind) {
    case 'line': pos.push(`var p = L.line(i, n, ${P('Spacing')}, ${P('Angle')}, ${P('Centered')} != 0);`); break;
    case 'grid': pos.push(`var p = L.grid(i, n, ${P('Columns')}, ${P('Gap X')}, ${P('Gap Y')});`); break;
    case 'circle': pos.push(`var p = L.circle(i, n, ${P('Radius')}, ${circleStart}, ${P('Arc')});`); break;
    case 'scatter': pos.push(`var p = L.scatter(i, n, ${P('Area Width')}, ${P('Area Height')}, s, ${P('Jitter')} / 100);`); break;
    case 'sphere': pos.push(`var p = L.sphere(i, n, ${P('Radius')});`); break;
    case 'helix': pos.push(`var p = L.helix(i, n, ${P('Radius')}, ${P('Height')}, ${P('Turns')});`); break;
    case 'path': pos.push(`var S = __AEC_LAYER(${pathId})__, q = S.toComp(L.onPath(S.content("Cloner Path").path, ${pathU}, ${d.closed ? 'true' : 'false'}));`, 'var p = sub(C.fromComp(q), C.transform.anchorPoint);'); break;
  }
  // 2D distributions return [x, y]: in 3D, give them a z so noise and data can add to it.
  if (threeD) pos.push('if (p.length < 3) p = [p[0], p[1], 0];');
  if (motion && !fl && d.kind !== 'circle' && d.kind !== 'path') {
    pos.push(`var fa = ${P('Direction')} * Math.PI / 180, fw = ${P('Wrap')}, ca = Math.cos(fa), sa = Math.sin(fa);`);
    pos.push(`var u = p[0] * ca + p[1] * sa + ${P('Offset')} + ${fs} * ${flowT}, w = p[1] * ca - p[0] * sa;`);
    pos.push('if (fw > 0) u = L.wrap(u, -fw / 2, fw / 2);');
    pos.push('p[0] = u * ca - w * sa; p[1] = u * sa + w * ca;');
  }
  if (nz) {
    pos.push(`var na = ${P('Position Random')}, nt = time * ${P('Noise Speed')};`);
    pos.push(`p[0] += na * L.noise1(i * 7.31 + nt, s); p[1] += na * L.noise1(i * 3.17 + nt, s + 17);${threeD ? ` p[2] += ${P('Z Random')} * L.noise1(i * 5.03 + nt, s + 29);` : ''}`);
  }
  for (const k of channels.filter((c) => c === 'x' || c === 'y' || (c === 'z' && threeD))) pos.push(dataArr(k), `p[${'xyz'.indexOf(k)}] += D${k}[i];`);
  if (sp) pos.push(`var ps = ${P('Position Step')}; if (ps > 0) { p[0] = L.step(p[0], ps); p[1] = L.step(p[1], ps); }`);
  pos.push(threeD ? 'var a0 = C.transform.anchorPoint;\n[a0[0] + p[0], a0[1] + p[1], a0[2] + (p.length > 2 ? p[2] : 0)];' : 'var a0 = C.transform.anchorPoint;\n[a0[0] + p[0], a0[1] + p[1]];');

  // Falloff weight (shared by scale, opacity, blur and brightness): distance of this instance from the field.
  const weight = fo ? [
    `var F = __AEC_LAYER(${fieldId})__, q = C.${toSpace}(transform.position), c = F.${toSpace}(F.transform.anchorPoint);`,
    fo.shape === 'linear' ? `var w = L.linear(q, c, ${P('Field Angle')}, ${P('Field Width')});` : `var w = L.radial(q, c, ${P('Falloff Radius')}, ${P('Falloff Softness')});`,
  ] : [];

  const scl = [head(`scale${fo ? ' (falloff)' : ''}${nz ? ' (noise)' : ''}`), `var k = ${P('Scale')};`];
  if (nz) scl.push(`k *= 1 + ${P('Scale Random')} / 100 * L.srand(i, s + 41);`);
  if (fo) scl.push(...weight, `k *= L.lerp(${P('Outside Scale')}, ${P('Inside Scale')}, w) / 100;`);
  if (channels.includes('scale')) scl.push(dataArr('scale'), 'k *= Dscale[i] / 100;');
  scl.push(threeD ? '[k, k, k];' : '[k, k];');

  const rot = [head(`rotation${nz ? ' (noise)' : ''}`), `var a = ${P('Rotation')};`];
  if (d.kind === 'circle' && !fl) rot.push(`if (${P('Orient')} != 0) a += L.circleAngle(i, n, ${circleStart}, ${P('Arc')});`);
  if (d.kind === 'path' && !fl) rot.push(`var S = __AEC_LAYER(${pathId})__;`, `if (${P('Orient')} != 0) a += L.pathAngle(S.content("Cloner Path").path, ${pathU}, ${d.closed ? 'true' : 'false'});`);
  if (nz) rot.push(`a += ${P('Rotation Random')} * L.noise1(i * 5.71 + time * ${P('Noise Speed')}, s + 31);`);
  if (channels.includes('rotation')) rot.push(dataArr('rotation'), 'a += Drotation[i];');
  if (sp) rot.push(`var rs = ${P('Rotation Step')}; if (rs > 0) a = L.step(a, rs);`);
  rot.push('a;');

  const opa = [head(`opacity${fo ? ' (falloff)' : ''}`), `var o = ${P('Opacity')};`];
  if (nz) opa.push(`o *= 1 - ${P('Opacity Random')} / 100 * L.hash(i, s + 53);`);
  if (fo) opa.push(...weight, `o *= L.lerp(${P('Outside Opacity')}, ${P('Inside Opacity')}, w) / 100;`);
  if (channels.includes('opacity')) opa.push(dataArr('opacity'), 'o *= Dopacity[i] / 100;');
  opa.push('o;');

  const props: Record<string, string> = {};
  if (st || channels.includes('delay')) {
    const tr = [head('time (stagger)')];
    if (st) {
      tr.push(`var by = Math.round(${P('Stagger By')}), d = 0;`);
      tr.push(`if (by == 2) { var q = C.${toSpace}(transform.position), c = ${fo ? `__AEC_LAYER(${fieldId})__.${toSpace}(__AEC_LAYER(${fieldId})__.transform.anchorPoint)` : `C.${toSpace}(C.transform.anchorPoint)`}; d = length(q, c) / 100 * ${P('Each')}; }`);
      tr.push(`else d = L.stagger(i, n, ${P('Each')}, by == 3 ? 4 : Math.round(${P('Order')}) - 1, s);`);
    } else tr.push('var d = 0;');
    if (channels.includes('delay')) tr.push(dataArr('delay'), 'd += Ddelay[i];');
    tr.push('L.clamp(time - inPoint - d, 0, source.duration - thisComp.frameDuration);');
    props['ADBE Time Remapping'] = tr.join('\n');
  }
  const blurExpr = fo?.blur ? [head('blur (falloff)'), ...weight, `L.lerp(${P('Outside Blur')}, ${P('Inside Blur')}, w);`].join('\n') : undefined;
  const brightExpr = fo?.brightness ? [head('brightness (falloff)'), ...weight, `L.lerp(${P('Outside Brightness')}, ${P('Inside Brightness')}, w);`].join('\n') : undefined;
  if (colors[0]) {
    const c = colors[0];
    props[`ADBE Layer Overrides/${c.field}`] = [head('color (palette)'), `var P = [${c.palette.map((_, k) => P(`Color ${k + 1}`)).join(', ')}], m = Math.round(${P('Color Mode')});`, 'm == 1 ? L.palette(P, i) : m == 2 ? L.pick(P, i, s) : L.gradient(P, n > 1 ? i / (n - 1) : 0);'].join('\n');
  }

  // Per-instance field values: one expression per field on the Essential Property (copied with the instances, so
  // nothing is written per instance), or static override values with dataMode: 'overrides' (slower to build,
  // easier to hand-edit one card).
  const egKeys = data ? [...new Set(data.flatMap((row) => Object.keys(row)))].filter((k) => !(DATA_CHANNELS as readonly string[]).includes(k)) : [];
  if (colors[0] && egKeys.includes(colors[0].field)) throw new Error(`<Cloner id="${id}">: field "${colors[0].field}" is set by both data and colorize`);
  const fieldValue = (v: any) => (typeof v === 'string' && /^(#[0-9a-f]{3}([0-9a-f]{3})?$|(rgb|hsl)a?\()/i.test(v) && egColors.has(v) ? parseColor(v) : v);
  // A field is a color when every value in it parses as one (a "#001" label in a text field stays text).
  const egColors = new Set<string>();
  for (const k of egKeys) {
    const vals = data!.map((row) => row[k]).filter((x) => x !== undefined);
    if (vals.length && vals.every((x) => typeof x === 'string' && (() => { try { parseColor(x); return /^(#|rgb|hsl)/i.test(x); } catch { return false; } })()) && !vals.every((x) => /^#\d+$/.test(x))) vals.forEach((x) => egColors.add(x));
  }
  let overrides: ({ [k: string]: any } | null)[] | undefined;
  if (p.dataMode === 'overrides') overrides = egKeys.length ? Array.from({ length: n }, (_, i) => { const row = data?.[i]; if (!row) return null; const o: Record<string, any> = {}; for (const k of egKeys) if (row[k] !== undefined) o[k] = fieldValue(row[k]); return o; }) : undefined;
  else for (const k of egKeys) {
    const vals = Array.from({ length: n }, (_, i) => fieldValue(data?.[i]?.[k]));
    // Rows without the key keep the master's value (null in the array).
    const lit = (v: any) => (v === undefined ? 'null' : JSON.stringify(Array.isArray(v) ? v.map(r) : v));
    props[`ADBE Layer Overrides/${k}`] = [head(`field "${k}" from data`), `var D = [${vals.map(lit).join(', ')}];`, 'D[i] === null ? value : D[i];'].join('\n');
  }

  const instance = jsx(Precomp, {
    ...layer, id: inst, name: `${name} Master`, width: size[0], height: size[1], compDuration: masterDuration, threeD,
    parent: ctl,
    instances: { count: n, prefix: name, overrides, timeRemap: !!props['ADBE Time Remapping'] },
    position: expr(pos.join('\n')), scale: expr(scl.join('\n')), rotation: expr(rot.join('\n')), opacity: expr(opa.join('\n')),
    expressions: props,
    effects: blurExpr || brightExpr ? [
      ...(blurExpr ? [jsx(Effect, { name: 'Gaussian Blur', label: 'Cloner Blur', params: { Blurriness: expr(blurExpr), 'Repeat Edge Pixels': 0 } })] : []),
      ...(brightExpr ? [jsx(Effect, { name: 'Brightness & Contrast', label: 'Cloner Brightness', params: { Brightness: expr(brightExpr) } })] : []),
    ] : undefined,
    children: of,
  } as any);
  // JSX order is bottom → top: the path and field go below, so the controller sits directly above the instances
  // (the expressions count instances from the controller's index).
  const out: AecElement[] = [];
  if (d.kind === 'path') out.push(jsx(Shape, { id: pathId, name: `${name} Path`, space: 'comp', guide: !d.show, hidden: !d.show, children: jsx(Path, { name: 'Cloner Path', d: d.d, closed: !!d.closed }) }));
  if (fo) out.push(jsx(Null, { id: fieldId, name: `${name} Field`, threeD, position: fo.center ?? expr(threeD ? '[thisComp.width / 2, thisComp.height / 2, 0]' : '[thisComp.width / 2, thisComp.height / 2]'), guide: true }));
  out.push(instance);
  out.push(jsx(Null, { id: ctl, name, threeD, position: position ?? expr(threeD ? '[thisComp.width / 2, thisComp.height / 2, 0]' : '[thisComp.width / 2, thisComp.height / 2]'), children: jsx(RigEffect, { def, name: 'Cloner', values: v }) }));
  return jsx(Fragment, { children: out });
}
