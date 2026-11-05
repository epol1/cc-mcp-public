// Wipes that reveal the incoming beat through a matte grown from the scene: ShapeWipe (a shape on screen grows to
// cover the frame), LiquidWipe (a blob path morphs across), SliceWipe (slices of the next scene sweep in) and
// GridWipe (tiles of it grow from dots). The incoming beat's layers are matted to the transition's matte layer, which
// stays (covering) until the incoming beat ends; optional accent layers run slightly ahead in a color.
import { jsx } from '../jsx-runtime.ts';
import { Fill, Group, Path, Rect, Shape } from '../primitives.ts';
import { expr } from '../anim.ts';
import type { ControlRef } from '../control.ts';
import { dslWarn } from '../warn.ts';
import type { ColorSpec } from '../../shared/units.ts';
import { bezierOf, controller, ctlName, defineTransition, head, lit, matteAll, r3, slider, tagsOf } from './core.ts';
import type { El, TransitionBase, TransitionDef, TransitionIO } from './core.ts';
import { coverScale, paintColor, silhouetteContents, silhouetteOf } from './geometry.ts';

type Dir = 'left' | 'right' | 'up' | 'down';
const DIR_ANGLE: Record<Dir, number> = { right: 0, down: 90, left: 180, up: 270 };

// ---------- ShapeWipe ----------
export interface ShapeWipeProps extends TransitionBase {
  /** The <Shape> on screen in the outgoing beat (pass the same element you render there; static pose). */
  shape: El;
  /**
   * How it grows to cover the frame: 'uniform' (keeps its aspect: circles, logos, any path), 'fit' (each axis to the
   * frame: a bar becomes a panel), 'xy' (stretches across, then opens up) or 'yx'. Default: 'fit' for a Rect, else
   * 'uniform'.
   */
  grow?: 'uniform' | 'fit' | 'xy' | 'yx';
  /** Show the shape (filled) while it grows; the next beat appears inside it (default true). False: invisible matte. */
  show?: boolean;
  /** Fill of the growing shape (default: the shape's own fill or stroke color). */
  color?: ColorSpec | ControlRef;
  /** Final scale (absolute %, overrides the computed cover). */
  scaleTo?: number | [number, number];
  /** 'xy' / 'yx': share of the window spent on the first axis (default 0.45). */
  split?: number;
}

const SHAPE_WIPE: TransitionDef<ShapeWipeProps> = {
  kind: 'shape-wipe', label: 'Shape Wipe', defaultDuration: 0.7,
  build(p, io) {
    const S = silhouetteOf(p.shape, io.w, io.h);
    const firstGeom = (p.shape.props.children ? [p.shape.props.children].flat(4) : []).find((c: any) => c?.type?.aec && ['rect', 'ellipse', 'star', 'path', 'group'].includes(c.type.aec));
    const mode = p.grow ?? (firstGeom?.type?.aec === 'rect' ? 'fit' : 'uniform');
    let cover: [number, number] | null = p.scaleTo !== undefined ? (Array.isArray(p.scaleTo) ? [p.scaleTo[0], p.scaleTo[1]] : [p.scaleTo, p.scaleTo]) : coverScale(S, io.w, io.h, mode === 'uniform' ? 'uniform' : 'fit');
    if (!cover) {
      dslWarn(`<ShapeWipe id="${p.id}">: the shape's outline doesn't contain its own centre, so the cover scale is a guess; set scaleTo`);
      const k = (Math.hypot(io.w, io.h) / Math.max(1, Math.min(S.bbox.w, S.bbox.h))) * 100;
      cover = [S.scale[0] * k / 100, S.scale[1] * k / 100];
    }
    const split = Math.min(0.9, Math.max(0.1, p.split ?? 0.45));
    const hi = Math.ceil((Math.max(cover[0], cover[1]) * 2) / 100) * 100;
    const ctl = controller(SHAPE_WIPE, p, io, [slider('Cover X', r3(cover[0]), 0, hi, { display: 'percent' }), slider('Cover Y', r3(cover[1]), 0, hi, { display: 'percent' }), slider('Split', split * 100, 0, 100, { display: 'percent' })],
      { 'Cover X': r3(cover[0]), 'Cover Y': r3(cover[1]), Split: split * 100 });
    const stage = mode === 'xy' ? 'var px = L.clamp(P / Math.max(k, 0.001), 0, 1), py = L.clamp((P - k) / Math.max(1 - k, 0.001), 0, 1);'
      : mode === 'yx' ? 'var py = L.clamp(P / Math.max(k, 0.001), 0, 1), px = L.clamp((P - k) / Math.max(1 - k, 0.001), 0, 1);' : 'var px = P, py = P;';
    const scale = [head(SHAPE_WIPE, p, `grows from the scene to cover the frame (${mode})`), 'var k = e("Split").value / 100;', stage,
      `[L.lerp(${r3(S.scale[0])}, e("Cover X").value, px), L.lerp(${r3(S.scale[1])}, e("Cover Y").value, py)];`].join('\n');
    const show = p.show !== false;
    const matteId = `${p.id}.shape`;
    const matte = jsx(Shape, {
      id: matteId, name: `${ctlName(SHAPE_WIPE, p)} Shape`, tags: tagsOf(SHAPE_WIPE), from: 0, duration: io.after,
      position: [r3(S.pos[0]), r3(S.pos[1])], anchor: [r3(S.center[0]), r3(S.center[1])], rotation: S.rotation, scale: expr(scale),
      children: silhouetteContents(p.shape.props.children, p.color ?? paintColor(p.shape.props.children)),
    });
    return { outgoing: io.outgoing, incoming: matteAll(io.incoming, matteId, { showSource: show }, `<ShapeWipe id="${p.id}">`), under: [ctl, matte] };
  },
};
/**
 * Wipe with a shape from the scene: a shape on screen in the outgoing beat (an accent bar, a dot, a logo) grows to
 * cover the frame, and the incoming beat is matted to it, so the next scene appears inside the shape.
 */
export const ShapeWipe = defineTransition(SHAPE_WIPE);

// ---------- shared: accent ("lead") layers and the progress of a lead ----------
const LEAD_P = 'P = Math.min(1, P * (1 + e("Lead").value / 100));';

// ---------- LiquidWipe ----------
export interface LiquidWipeProps extends TransitionBase {
  /** Direction the liquid travels (default 'right'). */
  direction?: Dir;
  /** Wave height of the edge, px (default 140). */
  amplitude?: number;
  /** Waves along the edge (default 1.25). */
  waves?: number;
  /** A liquid lead in this color runs ahead of the reveal. */
  color?: ColorSpec | ControlRef;
  /** How far the lead runs ahead (0–0.6 of the window, default 0.18). */
  lead?: number;
  /** Shifts the wave phase (variants). */
  seed?: number;
}

/** Blob keys: a wavy leading edge sweeping across the frame (closed path, same vertex count every key). */
export function liquidKeys(w: number, h: number, dir: Dir, amplitude: number, waves: number, seed: number, keys = 7, edge = 7): { p: [number, number]; in: [number, number]; out: [number, number] }[][] {
  const along = dir === 'left' || dir === 'right' ? w : h, across = dir === 'left' || dir === 'right' ? h : w;
  const m = 60, A = amplitude, phi0 = seed * 1.7;
  const tail = -m - A * 3.2 - 80;
  const map = (u: number, v: number): [number, number] => (dir === 'right' ? [u, v] : dir === 'left' ? [w - u, v] : dir === 'down' ? [v, u] : [v, h - u]);
  const mapT = (du: number, dv: number): [number, number] => (dir === 'right' ? [du, dv] : dir === 'left' ? [-du, dv] : dir === 'down' ? [dv, du] : [dv, -du]);
  const out: { p: [number, number]; in: [number, number]; out: [number, number] }[][] = [];
  for (let k = 0; k < keys; k++) {
    const t = k / (keys - 1);
    const base = -m - A * 1.6 - 20 + (along + 2 * m + A * 3.2 + 40) * t;
    const amp = A * (0.45 + 0.55 * Math.sin(Math.PI * t)), ph = phi0 + 2 * Math.PI * 0.55 * t;
    const E: [number, number][] = [];
    for (let j = 0; j < edge; j++) {
      const v = -m + ((across + 2 * m) * j) / (edge - 1);
      const u = base + amp * Math.sin((2 * Math.PI * waves * v) / across + ph) + A * 0.3 * Math.sin(Math.PI * t) * Math.sin((2 * Math.PI * 2.1 * waves * v) / across - ph * 1.3);
      E.push([u, v]);
    }
    const pts: { p: [number, number]; in: [number, number]; out: [number, number] }[] = [{ p: map(tail, -m), in: [0, 0], out: [0, 0] }];
    for (let j = 0; j < edge; j++) {
      const prev = E[Math.max(0, j - 1)], next = E[Math.min(edge - 1, j + 1)];
      const div = j === 0 || j === edge - 1 ? 3 : 6;
      const tu = (next[0] - prev[0]) / div, tv = (next[1] - prev[1]) / div;
      pts.push({ p: map(E[j][0], E[j][1]).map(r3) as [number, number], in: j === 0 ? [0, 0] : mapT(-r3(tu), -r3(tv)), out: j === edge - 1 ? [0, 0] : mapT(r3(tu), r3(tv)) });
    }
    pts.push({ p: map(tail, across + m), in: [0, 0], out: [0, 0] });
    out.push(pts);
  }
  return out;
}

const LIQUID_WIPE: TransitionDef<LiquidWipeProps> = {
  kind: 'liquid-wipe', label: 'Liquid Wipe', defaultDuration: 0.9,
  build(p, io) {
    const dir = p.direction ?? 'right';
    const keys = liquidKeys(io.w, io.h, dir, p.amplitude ?? 140, p.waves ?? 1.25, p.seed ?? 0);
    const ctl = controller(LIQUID_WIPE, p, io, [slider('Lead', (p.lead ?? 0.18) * 100, 0, 60, { display: 'percent' })], { Lead: (p.lead ?? 0.18) * 100 }, { extra: {} });
    const blob = (id: string, name: string, lead: boolean, color: any, duration: number | undefined) => {
      const code = [head(LIQUID_WIPE, p, `${lead ? 'liquid lead' : 'reveal matte'}: the blob's path keys, played by Progress`), ...(lead ? [LEAD_P] : []),
        'var t0 = key(1).time, t1 = key(numKeys).time;', 'valueAtTime(t0 + (t1 - t0) * L.clamp(P, 0, 1));'].join('\n');
      return jsx(Shape, {
        id, name, tags: tagsOf(LIQUID_WIPE), space: 'comp', from: 0, duration,
        expressions: { 'ADBE Root Vectors Group/Liquid/ADBE Vector Shape': code },
        children: [jsx(Path, { name: 'Liquid', closed: true, points: keys[0], morph: keys.map((pts, k) => ({ t: (k / (keys.length - 1)) * io.dur, points: pts, easing: 'linear' })) }), jsx(Fill, { color })],
      });
    };
    const matteId = `${p.id}.liquid`;
    const under: El[] = [ctl];
    if (p.color !== undefined) under.push(blob(`${p.id}.lead`, `${ctlName(LIQUID_WIPE, p)} Lead`, true, p.color, io.dur));
    under.push(blob(matteId, `${ctlName(LIQUID_WIPE, p)} Matte`, false, '#ffffff', io.after));
    return { outgoing: io.outgoing, incoming: matteAll(io.incoming, matteId, {}, `<LiquidWipe id="${p.id}">`), under };
  },
};
/** A liquid edge (a blob path that morphs across) reveals the next beat; `color` adds a liquid lead running ahead. */
export const LiquidWipe = defineTransition(LIQUID_WIPE);

// ---------- slices and tiles ----------
type Order = 'start' | 'end' | 'center' | 'edges' | 'random';
function ranks(n: number, order: Order, seed: number): number[] {
  if (n <= 1) return [0];
  const c = (n - 1) / 2;
  if (order === 'random') {
    const idx = Array.from({ length: n }, (_, i) => i);
    let s = seed * 9301 + 49297;
    for (let i = n - 1; i > 0; i--) { s = (s * 9301 + 49297) % 233280; const j = Math.floor((s / 233280) * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    const r = Array(n).fill(0);
    idx.forEach((k, pos) => { r[k] = pos / (n - 1); });
    return r;
  }
  return Array.from({ length: n }, (_, k) => (order === 'end' ? (n - 1 - k) / (n - 1) : order === 'center' ? Math.abs(k - c) / c : order === 'edges' ? 1 - Math.abs(k - c) / c : k / (n - 1)));
}

/** Per-piece progress lines: linear rig Progress → staggered, eased local progress `q`. */
function pieceLines(rank: number, bez: number[]): string[] {
  return [`var S = e("Stagger").value / 100, u = L.clamp((P - ${r3(rank)} * S) / Math.max(1 - S, 0.001), 0, 1);`, `var q = L.eased(${lit(bez)}, u);`];
}

export interface SliceWipeProps extends TransitionBase {
  /** Number of slices (default 6). */
  count?: number;
  /** Direction each slice sweeps in (default 'right'). */
  direction?: Dir;
  /** Tilt of the slices in degrees (default 0; e.g. 12 for diagonal slices). */
  tilt?: number;
  /** Share of the window the start times spread over (0–0.9, default 0.45). */
  stagger?: number;
  /** Which slice goes first (default 'start'). */
  order?: Order;
  seed?: number;
  /** Accent slices in this color run ahead of the reveal. */
  color?: ColorSpec | ControlRef;
  lead?: number;
}

const SLICE_WIPE: TransitionDef<SliceWipeProps> = {
  kind: 'slice-wipe', label: 'Slice Wipe', defaultDuration: 0.8,
  build(p, io) {
    const n = Math.max(1, Math.round(p.count ?? 6));
    const D = Math.ceil(Math.hypot(io.w, io.h) + 80), hb = D / n;
    const rk = ranks(n, p.order ?? 'start', p.seed ?? 7), bez = bezierOf(p.easing, 'easeInOutCubic');
    const stagger = Math.min(0.9, Math.max(0, p.stagger ?? 0.45));
    const ctl = controller(SLICE_WIPE, p, io, [slider('Stagger', stagger * 100, 0, 90, { display: 'percent' }), slider('Lead', (p.lead ?? 0.15) * 100, 0, 60, { display: 'percent' })],
      { Stagger: stagger * 100, Lead: (p.lead ?? 0.15) * 100 }, { linear: true });
    const layer = (id: string, name: string, lead: boolean, color: any, duration: number | undefined) => {
      const bands = Array.from({ length: n }, (_, k) => {
        const y = -D / 2 + (k + 0.5) * hb;
        const code = [head(SLICE_WIPE, p, `slice ${k + 1} of ${n}${lead ? ' (accent)' : ''}`), ...(lead ? [LEAD_P] : []), ...pieceLines(rk[k], bez), '[100 * q, 100];'].join('\n');
        return jsx(Group, { name: `Slice ${k + 1}`, anchor: [r3(-D / 2), r3(y)], position: [r3(-D / 2), r3(y)], scale: expr(code), children: [jsx(Rect, { size: [D, r3(hb + 2)], position: [0, r3(y)] }), jsx(Fill, { color })] });
      });
      return jsx(Shape, { id, name, tags: tagsOf(SLICE_WIPE), space: 'comp', from: 0, duration, children: [jsx(Group, { name: 'Slices', position: [io.w / 2, io.h / 2], rotation: DIR_ANGLE[p.direction ?? 'right'] + (p.tilt ?? 0), children: bands })] });
    };
    const matteId = `${p.id}.slices`;
    const under: El[] = [ctl];
    if (p.color !== undefined) under.push(layer(`${p.id}.lead`, `${ctlName(SLICE_WIPE, p)} Accent`, true, p.color, io.dur));
    under.push(layer(matteId, `${ctlName(SLICE_WIPE, p)} Matte`, false, '#ffffff', io.after));
    return { outgoing: io.outgoing, incoming: matteAll(io.incoming, matteId, {}, `<SliceWipe id="${p.id}">`), under };
  },
};
/** Slices of the next scene sweep in one after another (staggered, optionally tilted, with accent slices ahead). */
export const SliceWipe = defineTransition(SLICE_WIPE);

export interface GridWipeProps extends TransitionBase {
  /** Columns (default 8); rows default to square tiles. */
  columns?: number;
  rows?: number;
  /** The tiles grow outward from this comp point (e.g. where the outgoing beat's logo sits; default the centre), or 'random'. */
  origin?: [number, number] | 'random';
  /** Share of the window the start times spread over (0–0.9, default 0.55). */
  stagger?: number;
  /** Tiles start as dots and square off as they grow (default true). */
  round?: boolean;
  seed?: number;
  color?: ColorSpec | ControlRef;
  lead?: number;
}

const GRID_WIPE: TransitionDef<GridWipeProps> = {
  kind: 'grid-wipe', label: 'Grid Wipe', defaultDuration: 0.9,
  build(p, io) {
    const cols = Math.max(1, Math.round(p.columns ?? 8));
    const rows = Math.max(1, Math.round(p.rows ?? Math.round((cols * io.h) / io.w)));
    const tw = io.w / cols, th = io.h / rows, n = cols * rows;
    const centres = Array.from({ length: n }, (_, k) => [(k % cols + 0.5) * tw, (Math.floor(k / cols) + 0.5) * th]);
    let rk: number[];
    if (p.origin === 'random') rk = ranks(n, 'random', p.seed ?? 7);
    else {
      const o = p.origin ?? [io.w / 2, io.h / 2];
      const ds = centres.map((c) => Math.hypot(c[0] - o[0], c[1] - o[1])), lo = Math.min(...ds), hiD = Math.max(...ds);
      rk = ds.map((d) => (hiD - lo > 1e-6 ? (d - lo) / (hiD - lo) : 0));
    }
    const bez = bezierOf(p.easing, 'easeOutCubic'), round = p.round !== false;
    const stagger = Math.min(0.9, Math.max(0, p.stagger ?? 0.55));
    const ctl = controller(GRID_WIPE, p, io, [slider('Stagger', stagger * 100, 0, 90, { display: 'percent' }), slider('Lead', (p.lead ?? 0.12) * 100, 0, 60, { display: 'percent' })],
      { Stagger: stagger * 100, Lead: (p.lead ?? 0.12) * 100 }, { linear: true });
    const layer = (id: string, name: string, lead: boolean, color: any, duration: number | undefined) => {
      const tiles = centres.map((c, k) => {
        const lines = [head(GRID_WIPE, p, `tile ${k + 1} of ${n}${lead ? ' (accent)' : ''}`), ...(lead ? [LEAD_P] : []), ...pieceLines(rk[k], bez)];
        return jsx(Group, {
          name: `Tile ${Math.floor(k / cols) + 1}-${(k % cols) + 1}`, position: [r3(c[0]), r3(c[1])], scale: expr([...lines, '[100 * q, 100 * q];'].join('\n')),
          children: [jsx(Rect, { size: [r3(tw + 1.5), r3(th + 1.5)], roundness: round ? expr([...lines, `L.lerp(${r3(Math.min(tw, th) / 2)}, 0, q);`].join('\n')) : 0 }), jsx(Fill, { color })],
        });
      });
      return jsx(Shape, { id, name, tags: tagsOf(GRID_WIPE), space: 'comp', from: 0, duration, children: tiles });
    };
    const matteId = `${p.id}.tiles`;
    const under: El[] = [ctl];
    if (p.color !== undefined) under.push(layer(`${p.id}.lead`, `${ctlName(GRID_WIPE, p)} Accent`, true, p.color, io.dur));
    under.push(layer(matteId, `${ctlName(GRID_WIPE, p)} Matte`, false, '#ffffff', io.after));
    return { outgoing: io.outgoing, incoming: matteAll(io.incoming, matteId, {}, `<GridWipe id="${p.id}">`), under };
  },
};
/** Tiles of the next scene grow from dots, rippling out from a point of the outgoing scene. */
export const GridWipe = defineTransition(GRID_WIPE);

export type { TransitionIO };
