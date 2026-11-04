// SVG path data → AE shape paths (vertices with in/out tangents relative to each vertex).
// Supports M/L/H/V/C/S/Q/T/A/Z (absolute + relative). Quadratics are raised to cubics; arcs are split
// into ≤90° cubic segments. Multiple subpaths → multiple shapes.

export interface AeShape { v: number[][]; i: number[][]; o: number[][]; c: boolean }

function arcToCubics(x1: number, y1: number, rx: number, ry: number, phi: number, fa: number, fs: number, x2: number, y2: number): number[][] {
  // Returns list of [c1x, c1y, c2x, c2y, x, y] (SVG implementation notes, F.6).
  if (rx === 0 || ry === 0) return [[x1, y1, x2, y2, x2, y2]];
  const sinp = Math.sin(phi), cosp = Math.cos(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cosp * dx + sinp * dy, y1p = -sinp * dx + cosp * dy;
  rx = Math.abs(rx); ry = Math.abs(ry);
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const sign = fa === fs ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const co = sign * Math.sqrt(Math.max(0, num / (rx * rx * y1p * y1p + ry * ry * x1p * x1p)));
  const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx;
  const cx = cosp * cxp - sinp * cyp + (x1 + x2) / 2, cy = sinp * cxp + cosp * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dt > 0) dt -= 2 * Math.PI; else if (fs && dt < 0) dt += 2 * Math.PI;
  const n = Math.ceil(Math.abs(dt) / (Math.PI / 2));
  const out: number[][] = [];
  const d = dt / n, k = (4 / 3) * Math.tan(d / 4);
  for (let s = 0; s < n; s++) {
    const a1 = t1 + s * d, a2 = a1 + d;
    const p = (a: number) => [cx + rx * Math.cos(a) * cosp - ry * Math.sin(a) * sinp, cy + rx * Math.cos(a) * sinp + ry * Math.sin(a) * cosp];
    const dp = (a: number) => [-rx * Math.sin(a) * cosp - ry * Math.cos(a) * sinp, -rx * Math.sin(a) * sinp + ry * Math.cos(a) * cosp];
    const [ax, ay] = p(a1), [bx, by] = p(a2), [dax, day] = dp(a1), [dbx, dby] = dp(a2);
    out.push([ax + k * dax, ay + k * day, bx - k * dbx, by - k * dby, bx, by]);
  }
  return out;
}

export function parseSvgPath(d: string, opts: { scale?: number; offset?: [number, number] } = {}): AeShape[] {
  const toks = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
  const sc = opts.scale ?? 1, [ox, oy] = opts.offset ?? [0, 0];
  const shapes: AeShape[] = [];
  let cur: AeShape | null = null;
  let x = 0, y = 0, sx = 0, sy = 0, lastC: [number, number] | null = null, lastQ: [number, number] | null = null;
  let i = 0, cmd = '';
  const n = () => parseFloat(toks[i++]);
  const P = (px: number, py: number) => [(px + ox) * sc, (py + oy) * sc];
  const moveTo = (px: number, py: number) => {
    if (cur && cur.v.length) shapes.push(cur);
    cur = { v: [P(px, py)], i: [[0, 0]], o: [[0, 0]], c: false };
    x = sx = px; y = sy = py;
  };
  const cubicTo = (c1x: number, c1y: number, c2x: number, c2y: number, px: number, py: number) => {
    if (!cur) moveTo(x, y);
    const c = cur as AeShape;
    const last = c.v.length - 1;
    const [lx, ly] = c.v[last];
    const [a1, b1] = P(c1x, c1y), [a2, b2] = P(c2x, c2y), [vx, vy] = P(px, py);
    c.o[last] = [a1 - lx, b1 - ly];
    c.v.push([vx, vy]); c.i.push([a2 - vx, b2 - vy]); c.o.push([0, 0]);
    x = px; y = py;
  };
  const lineTo = (px: number, py: number) => { if (!cur) moveTo(x, y); const c = cur as AeShape; c.v.push(P(px, py)); c.i.push([0, 0]); c.o.push([0, 0]); x = px; y = py; };
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const bx = rel ? x : 0, by = rel ? y : 0;
    switch (C) {
      case 'M': { moveTo(bx + n(), by + n()); cmd = rel ? 'l' : 'L'; lastC = lastQ = null; break; }
      case 'L': lineTo(bx + n(), by + n()); lastC = lastQ = null; break;
      case 'H': lineTo(bx + n() - (rel ? 0 : 0), y); lastC = lastQ = null; break;
      case 'V': lineTo(x, by + n()); lastC = lastQ = null; break;
      case 'C': { const a = [bx + n(), by + n(), bx + n(), by + n(), bx + n(), by + n()]; cubicTo(a[0], a[1], a[2], a[3], a[4], a[5]); lastC = [a[2], a[3]]; lastQ = null; break; }
      case 'S': { const r = lastC ? [2 * x - lastC[0], 2 * y - lastC[1]] : [x, y]; const a = [bx + n(), by + n(), bx + n(), by + n()]; cubicTo(r[0], r[1], a[0], a[1], a[2], a[3]); lastC = [a[0], a[1]]; lastQ = null; break; }
      case 'Q': { const q = [bx + n(), by + n()], e = [bx + n(), by + n()]; cubicTo(x + (2 / 3) * (q[0] - x), y + (2 / 3) * (q[1] - y), e[0] + (2 / 3) * (q[0] - e[0]), e[1] + (2 / 3) * (q[1] - e[1]), e[0], e[1]); lastQ = [q[0], q[1]]; lastC = null; break; }
      case 'T': { const q: number[] = lastQ ? [2 * x - lastQ[0], 2 * y - lastQ[1]] : [x, y]; const e = [bx + n(), by + n()]; cubicTo(x + (2 / 3) * (q[0] - x), y + (2 / 3) * (q[1] - y), e[0] + (2 / 3) * (q[0] - e[0]), e[1] + (2 / 3) * (q[1] - e[1]), e[0], e[1]); lastQ = [q[0], q[1]]; lastC = null; break; }
      case 'A': { const rx = n(), ry = n(), rot = (n() * Math.PI) / 180, fa = n(), fs = n(), ex = bx + n(), ey = by + n(); for (const s of arcToCubics(x, y, rx, ry, rot, fa, fs, ex, ey)) cubicTo(s[0], s[1], s[2], s[3], s[4], s[5]); lastC = lastQ = null; break; }
      case 'Z': {
        if (cur) {
          const c = cur as AeShape;
          // Closing segment that lands on the first vertex: fold the duplicate vertex into the first.
          if (c.v.length > 1) {
            const f = c.v[0], l = c.v[c.v.length - 1];
            if (Math.abs(f[0] - l[0]) < 1e-6 && Math.abs(f[1] - l[1]) < 1e-6) { c.i[0] = c.i[c.v.length - 1]; c.v.pop(); c.i.pop(); c.o.pop(); }
          }
          c.c = true;
          shapes.push(c);
          cur = null;
        }
        x = sx; y = sy; lastC = lastQ = null;
        break;
      }
      default: throw new Error(`unsupported SVG path command "${cmd}"`);
    }
  }
  if (cur && (cur as AeShape).v.length) shapes.push(cur);
  return shapes;
}

export function shapeBounds(shapes: AeShape[]): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of shapes) for (const v of s.v) { x0 = Math.min(x0, v[0]); y0 = Math.min(y0, v[1]); x1 = Math.max(x1, v[0]); y1 = Math.max(y1, v[1]); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
