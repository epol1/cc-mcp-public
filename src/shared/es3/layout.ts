// Layout solver: stacks, grids, boxes, overlays, align and padding nodes -> one frame per node id.
// Shared by Node (dry-run, lint, tests, with estimated metrics) and the ES3 runtime in AE (with real
// metrics from sourceRectAtTime), so it follows docs/research/toolchain.md section 6.8: plain `for` loops, no ES5
// built-ins (map/forEach/indexOf/Object.keys/JSON/...), no imports, no getters/async/rest, no nested ?:.
// Pure and deterministic. Numbers are never rounded (AE handles subpixels). Recursion depth = tree depth.
//
// CONVENTIONS
//   Frames are top-left origin, comp pixels. AE layers are box-centred, so Position = frameCenter(frame).
//   width/height are OUTER sizes (padding included). padding is [top, right, bottom, left]; the CSS
//   shorthands [all], [vertical, horizontal] and [top, horizontal, bottom] are accepted too. Padding insets
//   the content area of every container (it is ignored when measuring leaves).
//
// 1. MEASURE (bottom-up): the intrinsic outer size of each node.
//    leaf      width/height when set, else size [w, h] (0 when missing). minWidth can widen a leaf;
//              nothing narrows it (maxWidth is a wrapping hint for the measurer, not a squash).
//    stack     main = sum of child main sizes + gap * (n - 1); cross = max child cross size; + padding.
//    grid      `columns` tracks (default ceil(sqrt(n))), children row-major; a column is as wide as its
//              widest cell, a row as tall as its tallest cell; + colGap * (cols - 1) + rowGap * (rows - 1)
//              (colGap/rowGap default to gap) + padding. All `columns` tracks exist even if a row is short.
//    box       width/height; a missing one falls back to the overlay size of its children.
//    overlay, align, padding   max child width / max child height + padding.
//    Every container: explicit width/height replace the measured size; then min/maxWidth clamp the
//    width (minWidth wins a conflict).
//
// 2. FILL WISHES (bottom-up). A node "wants to fill" an axis when it would use spare room on it:
//    align     both axes (an Align fills its area);
//    stack     its main axis only, when `justify` is set and is not 'start', or when a child has
//              grow > 0 (on the cross axis a stack shrink-wraps its children, like CSS);
//    overlay, box, padding   every axis one of their children wants to fill (they pass wishes up);
//    leaf, grid   never.
//    An explicit width (height) cancels the wish on x (y). A filling node gets exactly the offered size on
//    that axis (width still clamped by min/maxWidth), even when that is smaller than its content.
//    Errors (thrown, with the node id): missing/empty id, duplicate id, unknown kind.
//
// 3. PLACE (top-down). Every node gets a frame; then its `offset` [dx, dy] shifts that frame and therefore
//    its whole subtree (siblings are unaffected). Children are laid out inside frame minus padding.
//    root      placed in `area` like a lone cell child (rule below, no parent): an align fills `area`;
//              any other node keeps its measured size and is centred (or sits at its own `at`), except
//              along axes it wants to fill.
//    stack     direction 'row' (main = x) or 'column' (default, main = y).
//              Main axis: positive leftover space is shared by children with grow > 0, in proportion
//              (a grown width is clamped by the child's min/maxWidth); any leftover after that is
//              positioned by `justify` (default 'start'): start | center | end | spaceBetween (a single
//              child sits at start) | spaceAround (half-size gaps at both ends) | spaceEvenly. On overflow
//              (leftover < 0) spaceBetween behaves as start, spaceAround/spaceEvenly as center.
//              Cross axis: the stack's `align` (default 'center'); a LEAF child's own `align` overrides it
//              (align-self). 'stretch' gives the child the stack's inner cross size (a stretched width is
//              clamped by min/maxWidth). Children that want to fill the cross axis get it as well.
//              A child with an explicit cross size is never stretched; under 'stretch' it sits at start.
//    grid      cells row-major. Content-sized grids keep the measured tracks; spare room grows tracks like
//              CSS 1fr (equal tracks, none smaller than its content); overflow starts at the top-left.
//              Each child is placed in its cell by the cell rule (default: centred).
//    align     its child (normally one) is placed in it by the cell rule with the align's `at` first.
//    box, overlay, padding (and a malformed leaf with children)   children placed by the cell rule.
//    CELL RULE anchor = the align parent's `at` -> the child's `at` -> a leaf child's `align` -> the
//              parent's `align` -> 'center'. `at` is a 9-point anchor. align values apply to both axes
//              ('start' = top-left, 'end' = bottom-right); 'stretch' fills the cell on each axis without
//              an explicit size (and anchors top-left where it cannot). On axes the child wants to fill it
//              gets the cell's size; elsewhere it keeps its measured size and sits at the anchor.
//    Leaves keep their measured size (never squashed) except when stretched or grown.
//    `at` on a stack child is ignored (wrap the child in an align node instead).

export interface LayoutNode {
  /** Unique id; leaves are AE layers (id = IR layer id). */
  id: string;
  kind: 'stack' | 'grid' | 'leaf' | 'box' | 'align' | 'padding' | 'overlay';
  /** Stack direction (default 'column'). */
  direction?: 'row' | 'column';
  /** Stack/grid spacing (px). */
  gap?: number;
  /** Cross-axis alignment of children (stack default 'center'); cell alignment for grid/box/overlay/padding
   *  children; a leaf's own align is its self-alignment. For 'align' nodes see `at`. */
  align?: 'start' | 'center' | 'end' | 'stretch';
  /** Main-axis distribution (default 'start'). */
  justify?: 'start' | 'center' | 'end' | 'spaceBetween' | 'spaceAround' | 'spaceEvenly';
  /** Grid columns (default ceil(sqrt(children))). */
  columns?: number;
  rowGap?: number;
  colGap?: number;
  /** [top, right, bottom, left] (CSS shorthands of 1-3 values accepted). */
  padding?: number[];
  /** Fixed outer size for box/containers; for leaves an explicit size overrides `size`. */
  width?: number;
  height?: number;
  minWidth?: number;
  maxWidth?: number;
  /** 'align' node: where its child sits inside the area. Elsewhere: the node's own anchor inside a cell. */
  at?: 'center' | 'top' | 'bottom' | 'left' | 'right' | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';
  /** [dx, dy] applied after placement (moves the node and its subtree). */
  offset?: number[];
  /** Stack child: share of leftover main-axis space. */
  grow?: number;
  /** Leaf intrinsic [w, h] (measured text/shape/footage size). */
  size?: number[];
  children?: LayoutNode[];
}

/** Top-left origin, comp pixels. */
export interface Frame { x: number; y: number; w: number; h: number }

/** A node with its measured size, fill wishes and (for grids) measured tracks. */
interface Measured {
  node: LayoutNode;
  w: number;
  h: number;
  fillX: boolean;
  fillY: boolean;
  kids: Measured[];
  cols: number;
  colW: number[];
  rowH: number[];
}

type FrameMap = { [id: string]: Frame };

function num(v: number | undefined, d: number): number {
  return typeof v === 'number' && v === v ? v : d;
}

function isNum(v: number | undefined): boolean {
  return typeof v === 'number' && v === v;
}

function pad4(p: number[] | undefined): number[] {
  if (!p || p.length === 0) return [0, 0, 0, 0];
  const a = num(p[0], 0);
  if (p.length === 1) return [a, a, a, a];
  const b = num(p[1], 0);
  if (p.length === 2) return [a, b, a, b];
  const c = num(p[2], 0);
  if (p.length === 3) return [a, b, c, b];
  return [a, b, c, num(p[3], 0)];
}

function clampW(n: LayoutNode, w: number): number {
  if (isNum(n.maxWidth) && w > (n.maxWidth as number)) w = n.maxWidth as number;
  if (isNum(n.minWidth) && w < (n.minWidth as number)) w = n.minWidth as number;
  return w;
}

function max0(v: number): number {
  return v > 0 ? v : 0;
}

/** 0 / 0.5 / 1 for start / center / end. */
function alignFrac(a: string | undefined): number {
  if (a === 'start' || a === 'stretch') return 0;
  if (a === 'end') return 1;
  return 0.5;
}

/** [fx, fy, stretch(0|1)] for an `at` value. */
function atAnchor(at: string): number[] {
  let fx = 0.5;
  let fy = 0.5;
  if (at === 'left' || at === 'topLeft' || at === 'bottomLeft') fx = 0;
  if (at === 'right' || at === 'topRight' || at === 'bottomRight') fx = 1;
  if (at === 'top' || at === 'topLeft' || at === 'topRight') fy = 0;
  if (at === 'bottom' || at === 'bottomLeft' || at === 'bottomRight') fy = 1;
  return [fx, fy, 0];
}

/** [fx, fy, stretch(0|1)] for an `align` value used as a 2D cell alignment. */
function alignAnchor(a: string): number[] {
  const f = alignFrac(a);
  return [f, f, a === 'stretch' ? 1 : 0];
}

function measure(n: LayoutNode, seen: { [key: string]: boolean }): Measured {
  if (!n || typeof n.id !== 'string' || n.id === '') throw new Error('layout: every node needs a non-empty string id');
  if (seen['$' + n.id] === true) throw new Error('layout: duplicate node id "' + n.id + '"');
  seen['$' + n.id] = true;
  const kids: Measured[] = [];
  const ch = n.children;
  if (ch) {
    for (let i = 0; i < ch.length; i++) kids.push(measure(ch[i], seen));
  }
  const m: Measured = { node: n, w: 0, h: 0, fillX: false, fillY: false, kids: kids, cols: 0, colW: [], rowH: [] };
  const k = n.kind;

  if (k === 'leaf') {
    const s = n.size;
    m.w = num(n.width, s ? num(s[0], 0) : 0);
    m.h = num(n.height, s ? num(s[1], 0) : 0);
    if (isNum(n.minWidth) && m.w < (n.minWidth as number)) m.w = n.minWidth as number;
    return m;
  }

  let cw = 0;
  let chh = 0;
  if (k === 'stack') {
    const row = n.direction === 'row';
    let main = 0;
    let cross = 0;
    let grows = false;
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i];
      main += row ? c.w : c.h;
      const cc = row ? c.h : c.w;
      if (cc > cross) cross = cc;
      if (num(c.node.grow, 0) > 0) grows = true;
    }
    if (kids.length > 1) main += num(n.gap, 0) * (kids.length - 1);
    cw = row ? main : cross;
    chh = row ? cross : main;
    // Only the main axis: on the cross axis a stack shrink-wraps its children (CSS-like), and children
    // that want to fill it get the stack's own cross size, not the stack's parent's.
    const mainFill = grows || (n.justify !== undefined && n.justify !== 'start');
    if (row) m.fillX = mainFill;
    else m.fillY = mainFill;
  } else if (k === 'grid') {
    const count = kids.length;
    let cols = Math.floor(num(n.columns, Math.ceil(Math.sqrt(count))));
    if (!(cols >= 1)) cols = 1;
    const rows = Math.ceil(count / cols);
    const colW: number[] = [];
    const rowH: number[] = [];
    for (let c = 0; c < cols; c++) colW.push(0);
    for (let r = 0; r < rows; r++) rowH.push(0);
    for (let i = 0; i < count; i++) {
      const c = i % cols;
      const r = Math.floor(i / cols);
      if (kids[i].w > colW[c]) colW[c] = kids[i].w;
      if (kids[i].h > rowH[r]) rowH[r] = kids[i].h;
    }
    m.cols = cols;
    m.colW = colW;
    m.rowH = rowH;
    if (count > 0) {
      const gap = num(n.gap, 0);
      for (let c = 0; c < cols; c++) cw += colW[c];
      for (let r = 0; r < rows; r++) chh += rowH[r];
      cw += num(n.colGap, gap) * (cols - 1);
      chh += num(n.rowGap, gap) * (rows - 1);
    }
  } else if (k === 'overlay' || k === 'box' || k === 'align' || k === 'padding') {
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i];
      if (c.w > cw) cw = c.w;
      if (c.h > chh) chh = c.h;
      if (c.fillX) m.fillX = true;
      if (c.fillY) m.fillY = true;
    }
    if (k === 'align') {
      m.fillX = true;
      m.fillY = true;
    }
  } else {
    throw new Error('layout: unknown kind "' + k + '" on node "' + n.id + '"');
  }

  const p = pad4(n.padding);
  m.w = clampW(n, num(n.width, cw + p[1] + p[3]));
  m.h = num(n.height, chh + p[0] + p[2]);
  if (isNum(n.width)) m.fillX = false;
  if (isNum(n.height)) m.fillY = false;
  return m;
}

/** CSS-1fr-like track growth: tracks smaller than an equal share grow to it; none shrinks. */
function growTracks(sizes: number[], avail: number): number[] {
  const out: number[] = [];
  let total = 0;
  for (let i = 0; i < sizes.length; i++) {
    out.push(sizes[i]);
    total += sizes[i];
  }
  if (!(avail > total) || sizes.length === 0) return out;
  const frozen: boolean[] = [];
  for (let i = 0; i < sizes.length; i++) frozen.push(false);
  for (let guard = 0; guard <= sizes.length; guard++) {
    let remaining = avail;
    let count = 0;
    for (let i = 0; i < sizes.length; i++) {
      if (frozen[i]) remaining -= sizes[i];
      else count++;
    }
    if (count === 0) break;
    const share = remaining / count;
    let changed = false;
    for (let i = 0; i < sizes.length; i++) {
      if (!frozen[i] && sizes[i] > share) {
        frozen[i] = true;
        changed = true;
      }
    }
    if (!changed) {
      for (let i = 0; i < sizes.length; i++) {
        if (!frozen[i]) out[i] = share;
      }
      break;
    }
  }
  return out;
}

function place(m: Measured, f: Frame, out: FrameMap): void {
  const n = m.node;
  const o = n.offset;
  const fr: Frame = { x: f.x + (o ? num(o[0], 0) : 0), y: f.y + (o ? num(o[1], 0) : 0), w: f.w, h: f.h };
  out[n.id] = fr;
  const kids = m.kids;
  if (kids.length === 0) return;
  const p = pad4(n.padding);
  const inner: Frame = { x: fr.x + p[3], y: fr.y + p[0], w: max0(fr.w - p[1] - p[3]), h: max0(fr.h - p[0] - p[2]) };
  if (n.kind === 'stack') placeStack(m, inner, out);
  else if (n.kind === 'grid') placeGrid(m, inner, out);
  else {
    for (let i = 0; i < kids.length; i++) placeCell(kids[i], inner, n, out);
  }
}

/** Places `c` inside `cell` (grid cell, box/overlay/padding/align content area, or the root area). */
function placeCell(c: Measured, cell: Frame, parent: LayoutNode | null, out: FrameMap): void {
  const n = c.node;
  let a: number[] | null = null;
  if (parent && parent.kind === 'align' && parent.at) a = atAnchor(parent.at);
  if (!a && n.at) a = atAnchor(n.at);
  if (!a && n.kind === 'leaf' && n.align) a = alignAnchor(n.align);
  if (!a && parent && parent.align) a = alignAnchor(parent.align);
  if (!a) a = [0.5, 0.5, 0];
  const stretch = a[2] === 1;
  let w = c.w;
  let h = c.h;
  if (c.fillX || (stretch && !isNum(n.width))) w = clampW(n, cell.w);
  if (c.fillY || (stretch && !isNum(n.height))) h = cell.h;
  place(c, { x: cell.x + (cell.w - w) * a[0], y: cell.y + (cell.h - h) * a[1], w: w, h: h }, out);
}

function placeStack(m: Measured, inner: Frame, out: FrameMap): void {
  const n = m.node;
  const kids = m.kids;
  const count = kids.length;
  const row = n.direction === 'row';
  const gap = num(n.gap, 0);
  const mainAvail = row ? inner.w : inner.h;
  const crossAvail = row ? inner.h : inner.w;
  const mainStart = row ? inner.x : inner.y;
  const crossStart = row ? inner.y : inner.x;

  const mains: number[] = [];
  let growSum = 0;
  let used = gap * (count - 1);
  for (let i = 0; i < count; i++) {
    mains.push(row ? kids[i].w : kids[i].h);
    used += mains[i];
    const g = num(kids[i].node.grow, 0);
    if (g > 0) growSum += g;
  }
  let free = mainAvail - used;
  if (free > 0 && growSum > 0) {
    const share = free;
    for (let i = 0; i < count; i++) {
      const g = num(kids[i].node.grow, 0);
      if (g <= 0) continue;
      let grown = mains[i] + (share * g) / growSum;
      if (row) grown = clampW(kids[i].node, grown);
      free -= grown - mains[i];
      mains[i] = grown;
    }
  }

  let lead = 0;
  let between = gap;
  const j = n.justify;
  if (free !== 0) {
    if (j === 'center') lead = free / 2;
    else if (j === 'end') lead = free;
    else if (j === 'spaceBetween') {
      if (free > 0 && count > 1) between = gap + free / (count - 1);
    } else if (j === 'spaceAround') {
      if (free > 0) {
        lead = free / (2 * count);
        between = gap + free / count;
      } else lead = free / 2;
    } else if (j === 'spaceEvenly') {
      if (free > 0) {
        lead = free / (count + 1);
        between = gap + free / (count + 1);
      } else lead = free / 2;
    }
  }

  let pos = mainStart + lead;
  for (let i = 0; i < count; i++) {
    const c = kids[i];
    const cn = c.node;
    let al: string | undefined = n.align;
    if (cn.kind === 'leaf' && cn.align) al = cn.align;
    if (!al) al = 'center';
    const explicitCross = row ? isNum(cn.height) : isNum(cn.width);
    const wantsCross = row ? c.fillY : c.fillX;
    let cs = row ? c.h : c.w;
    if (wantsCross || (al === 'stretch' && !explicitCross)) {
      cs = crossAvail;
      if (!row) cs = clampW(cn, cs);
    }
    const cpos = crossStart + (crossAvail - cs) * alignFrac(al);
    if (row) place(c, { x: pos, y: cpos, w: mains[i], h: cs }, out);
    else place(c, { x: cpos, y: pos, w: cs, h: mains[i] }, out);
    pos += mains[i] + between;
  }
}

function placeGrid(m: Measured, inner: Frame, out: FrameMap): void {
  const n = m.node;
  const kids = m.kids;
  const cols = m.cols;
  const rows = m.rowH.length;
  const gap = num(n.gap, 0);
  const cg = num(n.colGap, gap);
  const rg = num(n.rowGap, gap);
  const colW = growTracks(m.colW, inner.w - cg * (cols - 1));
  const rowH = growTracks(m.rowH, inner.h - rg * (rows - 1));
  const xs: number[] = [];
  const ys: number[] = [];
  let x = inner.x;
  for (let c = 0; c < cols; c++) {
    xs.push(x);
    x += colW[c] + cg;
  }
  let y = inner.y;
  for (let r = 0; r < rows; r++) {
    ys.push(y);
    y += rowH[r] + rg;
  }
  for (let i = 0; i < kids.length; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    placeCell(kids[i], { x: xs[c], y: ys[r], w: colW[c], h: rowH[r] }, n, out);
  }
}

/** Solves the tree inside `area`; returns a frame for EVERY node id (containers too). */
export function solveLayout(root: LayoutNode, area: Frame): { [id: string]: Frame } {
  const out: FrameMap = {};
  const m = measure(root, {});
  placeCell(m, { x: area.x, y: area.y, w: area.w, h: area.h }, null, out);
  return out;
}

/** Centre point of a frame (what AE layer Position is set to, since anchors are box-centred). */
export function frameCenter(f: Frame): number[] {
  return [f.x + f.w / 2, f.y + f.h / 2];
}

/** Comp safe areas: kind 'action' = 5% inset, 'title' = 10% inset, or explicit insets [t,r,b,l]. */
export function safeArea(w: number, h: number, kind: 'action' | 'title' | number[]): Frame {
  let p: number[];
  if (kind === 'action' || kind === 'title') {
    const pct = kind === 'action' ? 5 : 10;
    const ix = (w * pct) / 100;
    const iy = (h * pct) / 100;
    p = [iy, ix, iy, ix];
  } else if (typeof kind === 'string') {
    throw new Error('layout: unknown safe area "' + kind + '" (use "action", "title" or [t, r, b, l])');
  } else {
    p = pad4(kind);
  }
  return { x: p[3], y: p[0], w: w - p[1] - p[3], h: h - p[0] - p[2] };
}
