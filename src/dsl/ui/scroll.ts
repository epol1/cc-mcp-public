// UI kit ScrollView (K1): a masked viewport precomp whose content (one editable "Content" precomp) scrolls with eased
// position keys between `stops`. Feeds go inside as a <Feed> (a Cloner of list rows filled from data).
import { jsx } from '../jsx-runtime.ts';
import { Mask, Precomp, Solid } from '../primitives.ts';
import { keys } from '../anim.ts';
import type { Anim } from '../anim.ts';
import type { EasingSpec } from '../../shared/easing.ts';
import type { UiColor } from './theme.ts';
import { plain } from './theme.ts';
import type { UiBase } from './common.ts';
import { events, motion, place, resolve, timing } from './common.ts';
import type { UiEvents } from './steps.ts';

export interface ScrollViewProps extends UiBase, Pick<UiEvents, 'scrollAt'> {
  /** Viewport size (default 390 × 600 at theme scale). */
  size?: [number, number];
  /** Content height (default 2 × the viewport). Content is laid out in a precomp of width × contentHeight. */
  contentHeight?: number;
  /** Scroll offsets in px (default [0, contentHeight − height]); stop 0 is where it starts. */
  stops?: number[];
  /** Arrival times of stops 1, 2, … when no scrollAt events are given (default 1.2 s, then every 1.6 s). */
  stopTimes?: number[];
  /** Each scroll's length (default 0.8 s) and easing (default easeInOutQuart). */
  scrollDuration?: number;
  easing?: EasingSpec;
  radius?: number;
  /** Viewport background (default theme bg; false for none). */
  bg?: UiColor | false;
  children?: any;
}

/** Content position keys: hold at each stop, eased scroll into the next one. */
export function scrollKeys(w: number, H: number, stops: number[], scrolls: { t: number; stop: number; duration?: number }[], dur: number, easing: EasingSpec): Anim | [number, number] {
  const pos = (off: number): [number, number] => [w / 2, H / 2 - off];
  if (!scrolls.length) return pos(stops[0] ?? 0);
  const ks: { t: number; v: [number, number]; easing?: EasingSpec; hold?: boolean }[] = [{ t: 0, v: pos(stops[0] ?? 0), hold: true }];
  let cur = stops[0] ?? 0;
  for (const e of [...scrolls].sort((a, b) => a.t - b.t)) {
    const target = stops[e.stop];
    if (target === undefined) throw new Error(`<ScrollView>: scroll to stop ${e.stop}, but stops are [${stops.join(', ')}]`);
    const prev = ks[ks.length - 1];
    const start = Math.max(prev.t, e.t - (e.duration ?? dur));
    if (start > prev.t + 1e-3) ks.push({ t: start, v: pos(cur), easing });
    else { prev.hold = false; prev.easing = easing; }
    ks.push({ t: Math.max(e.t, start + 1e-3), v: pos(target), hold: true });
    cur = target;
  }
  return keys(...ks);
}

/**
 * A scrolling area: the viewport is a precomp masked to a rounded rect, its content one precomp ("<name> Content",
 * edit it like any comp) moved by eased keys from stop to stop. Children are the content (laid out in the content
 * precomp: wrap them in <Align at="top"> to start at the top, or use a <Feed>).
 */
export function ScrollView(p: ScrollViewProps) {
  const { t, s, name } = resolve(p, 'ScrollView');
  const ev = events(p);
  const [w, h] = p.size ?? [390 * s, 600 * s];
  const H = Math.max(h, p.contentHeight ?? 2 * h);
  const stops = p.stops ?? [0, H - h];
  const scrolls = ev.scrollAt?.length ? ev.scrollAt : stops.slice(1).map((_, k) => ({ t: p.stopTimes?.[k] ?? 1.2 + 1.6 * k, stop: k + 1 }));
  const r = p.radius ?? 0;
  const view = jsx(Precomp, {
    id: p.id, name, width: Math.round(w), height: Math.round(h), collapse: true, ...timing(p), ...motion(p, s), tags: ['ui', 'scroll'],
    // Collapsed (vectors stay sharp when scaled), so the mask is what clips the content.
    effects: [jsx(Mask, { name: 'Viewport', rect: { x: 0, y: 0, width: Math.round(w), height: Math.round(h), roundness: r } })],
    children: [
      ...(p.bg === false ? [] : [jsx(Solid, { id: `${p.id}.bg`, name: `${name} Background`, color: plain(p.bg ?? t.bg) })]),
      jsx(Precomp, {
        id: `${p.id}.content`, name: `${name} Content`, width: Math.round(w), height: Math.round(H), collapse: true,
        position: scrollKeys(w, H, stops, scrolls, p.scrollDuration ?? 0.8, p.easing ?? 'easeInOutQuart'),
        children: p.children,
      }),
    ],
  });
  return place(p.position, view);
}
