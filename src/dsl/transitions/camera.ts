// Camera-and-depth transitions: ZoomThrough (the outgoing beat zooms through one of its elements into the next scene),
// PushThrough (a 3D camera pushes through the outgoing beat's plane to the next one behind it) and ParallaxSplit (the
// outgoing beat's layers part from the centre line at different speeds and the next beat opens in the gap).
import { jsx } from '../jsx-runtime.ts';
import { Camera, Fill, Null, Rect, Shape, Text } from '../primitives.ts';
import { expr } from '../anim.ts';
import { dslWarn } from '../warn.ts';
import { addExpression, controller, coverInFrame, ctlName, defineTransition, head, isBackdrop, kindOf, mapLayers, matteAll, parentAll, r3, separated, slider, tagsOf, withProps } from './core.ts';
import type { El, TransitionBase, TransitionDef } from './core.ts';
import { silhouetteContents, silhouetteOf } from './geometry.ts';
import type { Silhouette } from './geometry.ts';

const TG = 'ADBE Transform Group';

// ---------- ZoomThrough ----------
export interface ZoomThroughProps extends TransitionBase {
  /**
   * The element of the outgoing beat to fly through (a <Shape>, or a <Text> with `focus`): pass the same element you
   * render there, positioned explicitly (not inside a layout container). The next beat shows through its silhouette.
   */
  through: El;
  /** Comp point to zoom into (default: the shape's centre). Must be inside the element's fill (for text: on a letter). */
  focus?: [number, number];
  /** Final zoom of the outgoing beat, × (default: enough for the element to cover the frame, ×1.15; text 40). */
  zoom?: number;
  /** The next beat's starting scale, % (it settles to 100 as the zoom arrives; default 85). */
  settle?: number;
  /** Share of the window over which the next beat fades in inside the element (0–1, default 0.25). */
  fadeIn?: number;
}

const ZOOM_THROUGH: TransitionDef<ZoomThroughProps> = {
  kind: 'zoom-through', label: 'Zoom Through', defaultDuration: 0.9,
  build(p, io) {
    const el = p.through;
    const k = kindOf(el);
    if (k !== 'shape' && k !== 'text') throw new Error(`<ZoomThrough id="${p.id}">: through= must be a <Shape> or <Text> element of the outgoing beat`);
    let S: Silhouette | null = null, F: [number, number], zoom = p.zoom;
    if (k === 'shape') {
      S = silhouetteOf(el, io.w, io.h);
      F = p.focus ?? [S.pos[0], S.pos[1]];
      if (zoom === undefined) {
        // Scale about the focus: its point in the shape's layer space.
        const rad = (-S.rotation * Math.PI) / 180, dx = F[0] - S.pos[0], dy = F[1] - S.pos[1];
        const local: [number, number] = [S.center[0] + (dx * Math.cos(rad) - dy * Math.sin(rad)) / (S.scale[0] / 100), S.center[1] + (dx * Math.sin(rad) + dy * Math.cos(rad)) / (S.scale[1] / 100)];
        const c = coverInFrame(S, io, 'uniform', { local, comp: F }, 1.15);
        if (!c) dslWarn(`<ZoomThrough id="${p.id}">: the focus is outside the shape's fill, so the zoom is a guess (40×); set focus inside it, or zoom`);
        zoom = c ? Math.max(c[0], c[1]) / Math.max(S.scale[0], S.scale[1]) : 40;
      }
    } else {
      const ep = el.props;
      F = p.focus ?? (Array.isArray(ep.position) ? [ep.position[0], ep.position[1]] : [typeof ep.x === 'number' ? ep.x : io.w / 2, typeof ep.y === 'number' ? ep.y : io.h / 2]);
      if (!p.focus) dslWarn(`<ZoomThrough id="${p.id}">: through a text, set focus to a point on a letter's stroke (the text's centre is often a gap)`);
      zoom = zoom ?? 40;
    }
    const z = Math.max(1.01, zoom!);
    const settle = p.settle ?? 85, fade = Math.min(1, Math.max(0.01, p.fadeIn ?? 0.25));
    const ctl = controller(ZOOM_THROUGH, p, io, [slider('Zoom', r3(z), 1, Math.max(100, Math.ceil(z * 2)), { precision: 2 }), slider('Settle', settle, 10, 200, { display: 'percent' }), slider('Fade In', fade * 100, 1, 100, { display: 'percent' })],
      { Zoom: r3(z), Settle: settle, 'Fade In': fade * 100 },
      { extra: { anchor: F, position: F, scale: expr(`${head(ZOOM_THROUGH, p, 'zooms the outgoing beat (its layers are parented here)', true)}\nvar s = 100 * Math.pow(Math.max(e("Zoom").value, 1), P);\n[s, s];`) } });
    const inId = `${p.id}.in`, winId = `${p.id}.window`;
    const settleNull = jsx(Null, { id: inId, name: `${ctlName(ZOOM_THROUGH, p)} Settle`, from: 0, duration: io.dur, anchor: F, position: F,
      scale: expr(`${head(ZOOM_THROUGH, p, 'the incoming beat settles from Settle to 100 % (its layers are parented here)')}\nvar q = L.clamp(P / 0.85, 0, 1), s = L.lerp(e("Settle").value, 100, q);\n[s, s];`) });
    const fadeExpr = expr(`${head(ZOOM_THROUGH, p, 'the window fades in, then zooms with the outgoing beat')}\n100 * L.clamp(P / Math.max(e("Fade In").value / 100, 0.001), 0, 1);`);
    const window = S
      ? jsx(Shape, { id: winId, name: `${ctlName(ZOOM_THROUGH, p)} Window`, tags: tagsOf(ZOOM_THROUGH), parent: p.id, from: 0, duration: io.after, position: [r3(S.pos[0]), r3(S.pos[1])], anchor: [r3(S.center[0]), r3(S.center[1])], rotation: S.rotation, scale: [r3(S.scale[0]), r3(S.scale[1])], opacity: fadeExpr, children: silhouetteContents(el.props.children, '#ffffff') })
      : (() => { const { animate: _a, effects: _e, id: _i, name: _n, from: _f, duration: _d, matte: _m, parent: _p, markers: _k, expressions: _x, tags: _t, eg: _g, layout: _l, ...tp } = el.props; return jsx(Text, { ...tp, id: winId, name: `${ctlName(ZOOM_THROUGH, p)} Window`, tags: tagsOf(ZOOM_THROUGH), parent: p.id, from: 0, duration: io.after, opacity: fadeExpr }); })();
    const who = `<ZoomThrough id="${p.id}">`;
    // Full-frame backgrounds stay at 100 % (at the settle scale their edges would show through the window).
    const incoming = matteAll(parentAll(io.incoming, inId, who, { carrier: true, keepBackgrounds: true }), winId, {}, who);
    return { outgoing: parentAll(io.outgoing, p.id, who, { adopt: io.adopt }), incoming, under: [ctl, settleNull, window] };
  },
};
/**
 * Zoom through an element: the outgoing beat zooms (one scale, about `focus`) into one of its own elements, whose
 * silhouette is the window the next beat shows through; the next beat settles as the window covers the frame.
 */
export const ZoomThrough = defineTransition(ZOOM_THROUGH);

// ---------- PushThrough ----------
export interface PushThroughProps extends TransitionBase {
  /** Distance behind the outgoing plane where the next beat sits, px (default 1.5 × the camera's framing distance). */
  depth?: number;
  /** Camera lens, mm (default 50: the same framing as AE's default camera). */
  lens?: number;
  /** Outgoing layers fade between these Progress shares (default: from half of the plane crossing to just before it). */
  fade?: [number, number];
  /** Layer ids that stay 2D (a HUD, a shared background). */
  flat?: string[];
}

const PUSH_THROUGH: TransitionDef<PushThroughProps> = {
  kind: 'push-through', label: 'Push Through', defaultDuration: 1.0,
  build(p, io) {
    const lens = p.lens ?? 50, zoomPx = (lens / 36) * io.w;
    const D = p.depth ?? Math.round(zoomPx * 1.5);
    if (D <= zoomPx) dslWarn(`<PushThrough id="${p.id}">: depth ${D} ≤ the camera distance (${Math.round(zoomPx)}): the camera reaches the outgoing plane only at the end`);
    const cross = Math.min(1, zoomPx / D);
    const fade = p.fade ?? [cross * 0.5, cross * 0.95];
    const flat = new Set(p.flat ?? []);
    const ctl = controller(PUSH_THROUGH, p, io, [slider('Fade Start', r3(fade[0] * 100), 0, 100, { display: 'percent' }), slider('Fade End', r3(fade[1] * 100), 0, 100, { display: 'percent' })],
      { 'Fade Start': r3(fade[0] * 100), 'Fade End': r3(fade[1] * 100) }, { extra: { threeD: true } });
    const cam = jsx(Camera, { id: `${p.id}.cam`, name: `${ctlName(PUSH_THROUGH, p)} Camera`, oneNode: true, lens, from: 0, duration: io.after,
      position: expr(`${head(PUSH_THROUGH, p, `camera travels ${D} px through the outgoing plane`)}\n[thisComp.width / 2, thisComp.height / 2, -cameraOption.zoom + P * ${D}];`) });
    const who = `<PushThrough id="${p.id}">`;
    const to3D = (node: El[], dz: number, fadeOut: boolean) => {
      // A layer parented to another layer of the same beat inherits its depth: pushing it too would double it.
      const ids = new Set<string>();
      mapLayers(node, (el) => { if (el.props.id) ids.add(el.props.id); return el; });
      return mapLayers(node, (el) => {
      const k = kindOf(el), q = el.props;
      if (k === 'camera' || k === 'light' || (q.id && flat.has(q.id))) return el;
      let out = withProps(el, { threeD: true });
      if (dz && !(q.parent && ids.has(q.parent))) {
        if (Array.isArray(q.position)) out = withProps(out, { position: [q.position[0], q.position[1], (q.position[2] ?? 0) + dz] });
        else out = withProps(out, { z: (typeof q.z === 'number' ? q.z : 0) + dz });
        if (q.animate?.position || (q.z !== undefined && typeof q.z !== 'number')) dslWarn(`${who}: ${q.id ?? q.name ?? k} animates its position/z; check it lands at depth ${dz}`);
      }
      if (fadeOut) out = addExpression(out, `${TG}/ADBE Opacity`, `${head(PUSH_THROUGH, p, 'fades as the camera reaches this plane')}\nvalue * (1 - L.smooth(e("Fade Start").value / 100, e("Fade End").value / 100, P));`, who) ?? out;
      return out;
      });
    };
    return { outgoing: to3D(io.outgoing, 0, true), incoming: to3D(io.incoming, D, false), under: [ctl], over: [cam] };
  },
};
/**
 * Push through the plane: both beats become 3D, the next one `depth` px behind; a camera dollies through the outgoing
 * layers (they fade as it reaches them) and arrives framing the next beat 1:1. A shared background kept outside the
 * beats (2D, below) stays put while the layers fly past.
 */
export const PushThrough = defineTransition(PUSH_THROUGH);

// ---------- ParallaxSplit ----------
export interface ParallaxSplitProps extends TransitionBase {
  /** 'horizontal' (layers part left/right from a vertical centre line, default) or 'vertical' (up/down). */
  direction?: 'horizontal' | 'vertical';
  /** Travel of the slowest layer, px (default 0.7 × the frame size along the split). */
  distance?: number;
  /** Extra speed of the front layer over the back one, % (default 80). */
  spread?: number;
}

const PARALLAX_SPLIT: TransitionDef<ParallaxSplitProps> = {
  kind: 'parallax-split', label: 'Parallax Split', defaultDuration: 0.8,
  build(p, io) {
    const hor = (p.direction ?? 'horizontal') === 'horizontal', ax = hor ? 0 : 1;
    const dist = p.distance ?? Math.round((hor ? io.w : io.h) * 0.7), spread = p.spread ?? 80;
    const ctl = controller(PARALLAX_SPLIT, p, io, [slider('Distance', dist, 0, 6000, { display: 'pixel' }), slider('Spread', spread, 0, 300, { display: 'percent' })], { Distance: dist, Spread: spread }, { extra: {} });
    const who = `<ParallaxSplit id="${p.id}">`;
    // Movers: unparented, non-backdrop layers in stack order (bottom first): the front one gets the most speed.
    // (Expand components once, so element identities are stable between the two passes.)
    const tree = mapLayers(io.outgoing, (el) => el);
    const movers: El[] = [];
    // Layers parented to a carrier at rest (a ZoomThrough settle null) move too: their parent space is the comp's.
    mapLayers(tree, (el) => { const k = kindOf(el); if (k !== 'camera' && k !== 'light' && (!el.props.parent || el.props.carrierParent) && !isBackdrop(el)) movers.push(el); return el; });
    const n = movers.length;
    let i = 0;
    const outgoing = mapLayers(tree, (el) => {
      if (!movers.includes(el)) return el;
      const f = n > 1 ? i / (n - 1) : 0, alt = i % 2 ? 1 : -1;
      i++;
      const sep = separated(el.props), threeD = !!el.props.threeD;
      const size = hor ? 'width' : 'height', edge = hor ? 'left' : 'top';
      const lines = [
        head(PARALLAX_SPLIT, p, `parts from the centre line (layer ${i} of ${n}: speed × ${r3(1 + (spread / 100) * f)})`),
        'var pk = e("Progress"), t0 = pk.numKeys ? pk.key(1).time : time, v0 = valueAtTime(t0);',
        `var r = sourceRectAtTime(t0, false), a = transform.anchorPoint.valueAtTime(t0), sc = transform.scale.valueAtTime(t0);`,
        `var c = ${sep ? 'v0' : `v0[${ax}]`} + (r.${edge} + r.${size} / 2 - a[${ax}]) * sc[${ax}] / 100, m = thisComp.${size} / 2;`,
        `var s = c < m - 2 ? -1 : c > m + 2 ? 1 : ${alt};`,
        `var d = s * e("Distance").value * (1 + e("Spread").value / 100 * ${r3(f)}) * P;`,
        sep ? 'value + d;' : `add(value, [${hor ? 'd, 0' : '0, d'}${threeD ? ', 0' : ''}]);`,
      ];
      const path = sep ? `${TG}/ADBE Position_${ax}` : `${TG}/ADBE Position`;
      return addExpression(el, path, lines.join('\n'), who) ?? el;
    });
    const gapId = `${p.id}.gap`;
    const gap = jsx(Shape, {
      id: gapId, name: `${ctlName(PARALLAX_SPLIT, p)} Gap`, tags: tagsOf(PARALLAX_SPLIT), space: 'comp', from: 0, duration: io.after,
      children: [jsx(Rect, { position: [io.w / 2, io.h / 2], size: expr(`${head(PARALLAX_SPLIT, p, 'the gap the next beat opens in')}\n${hor ? '[(thisComp.width + 200) * P, thisComp.height + 400]' : '[thisComp.width + 400, (thisComp.height + 200) * P]'};`) }), jsx(Fill, { color: '#ffffff' })],
    });
    return { outgoing, incoming: matteAll(io.incoming, gapId, {}, who), under: [ctl, gap] };
  },
};
/**
 * Parallax split: the outgoing layers part from the centre line (each to its own side) at different speeds, front
 * layers fastest, and the next beat opens in the widening gap. Backgrounds stay; positions are read live in AE, so
 * laid-out layers work.
 */
export const ParallaxSplit = defineTransition(PARALLAX_SPLIT);
