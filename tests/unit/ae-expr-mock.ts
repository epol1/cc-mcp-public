// A small AE expression environment for unit tests (no AE): runs generated expressions in Node with mocked layers,
// rig effects and AE's vector helpers, so tests can check that every expression parses and evaluates to finite values,
// and spot-check what it computes. Not a full emulation: just the API surface the transitions and path tools use.

export interface MockOpts {
  /** Transition progress 0–1 (the rig's Progress param reads P × 100). */
  P?: number;
  time?: number;
  /** The property's pre-expression value. */
  value?: any;
  /** Rig param values by name (default: Progress from P, points [100, 200], numbers 50). */
  params?: Record<string, any>;
  /** Key times of keyed params / properties [first, last] (default [0, 1]). */
  keys?: [number, number];
  /** Comp layer names that exist (others throw). Undefined: any name. */
  layerNames?: Set<string>;
  inPoint?: number;
  outPoint?: number;
  compSize?: [number, number];
  /** Pre-expression value of this property at a time (valueAtTime on itself). */
  valueAtTime?: (t: number) => any;
}

const vec = {
  add: (a: any, b: any) => (Array.isArray(a) ? a.map((x: number, i: number) => x + (b[i] ?? 0)) : a + b),
  sub: (a: any, b: any) => (Array.isArray(a) ? a.map((x: number, i: number) => x - (b[i] ?? 0)) : a - b),
  mul: (a: any, k: number) => (Array.isArray(a) ? a.map((x: number) => x * k) : a * k),
  length: (a: any, b?: any) => { const d = b ? a.map((x: number, i: number) => x - b[i]) : a; return Math.hypot(...d); },
  clamp: (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi),
};

/** A mock layer: identity space transforms, a fixed source rect, a straight 100 px path, keyed transform probes. */
function mockLayer(name: string, o: MockOpts, param: (fx: string, p: string) => any): any {
  const prop = (f: (t: number) => any) => ({ valueAtTime: f, value: f(o.time ?? 0) });
  return {
    name,
    effect: (fx: string) => (p: string) => param(fx, p),
    toComp: (p: number[]) => [p[0], p[1]],
    fromComp: (p: number[]) => [p[0], p[1]],
    sourceRectAtTime: () => ({ left: -60, top: -20, width: 120, height: 40 }),
    transform: {
      anchorPoint: prop(() => [0, 0]),
      // Probes: position x = the time it was read at; rotation = 2 × time; opacity 80.
      position: prop((t: number) => [t, 7]),
      rotation: prop((t: number) => 2 * t),
      scale: prop(() => [100, 100]),
      opacity: prop(() => 80),
    },
    content: (_n: string) => ({ path: { pointOnPath: (u: number) => [u * 100, 0], tangentOnPath: () => [0, 1] } }),
  };
}

const runner = new Function('scope', 'code', 'with (scope) { return eval(code); }') as (s: any, c: string) => any;

export function runExpr(code: string, o: MockOpts = {}): any {
  const P = o.P ?? 0;
  const keys = o.keys ?? [0, 1];
  const param = (_fx: string, p: string) => {
    const v = o.params && p in o.params ? o.params[p] : p === 'Progress' ? P * 100 : /^(From|To)$/.test(p) ? [100, 200] : p === 'Color' ? [1, 0.5, 0.2, 1] : /Orient/.test(p) ? 1 : 50;
    return { value: v, numKeys: p === 'Progress' ? 2 : 0, key: (i: number) => ({ time: i === 1 ? keys[0] : keys[1] }) };
  };
  const [w, h] = o.compSize ?? [1920, 1080];
  const self = mockLayer('self', o, param);
  const scope = {
    ...vec,
    time: o.time ?? 0, inPoint: o.inPoint ?? 0, outPoint: o.outPoint ?? 10, value: o.value ?? [0, 0],
    numKeys: 2, key: (i: number) => ({ time: i === 1 ? keys[0] : keys[1] }),
    valueAtTime: o.valueAtTime ?? ((t: number) => ({ at: t })),
    thisComp: { width: w, height: h, duration: 10, frameDuration: 1 / 30, layer: (n: string) => {
      if (o.layerNames && !o.layerNames.has(n)) throw new Error(`no layer named ${n}`);
      const L = mockLayer(n, o, param);
      // The scene's Controls null: effect("<control>")(1) is the control's value.
      return n === 'Controls' ? { ...L, effect: () => () => 1 } : L;
    } },
    effect: self.effect, transform: self.transform, sourceRectAtTime: self.sourceRectAtTime, toComp: self.toComp, fromComp: self.fromComp,
    hasParent: false, parent: null, cameraOption: { zoom: (50 / 36) * w },
  };
  return runner(scope, code);
}

export const isFinite = (x: any): boolean => (typeof x === 'boolean' ? true : typeof x === 'number' ? Number.isFinite(x) : Array.isArray(x) ? x.every(isFinite) : x && typeof x === 'object' ? Object.values(x).every(isFinite) : false);

/** Every expression in the comp's layers (props and shape groups), with the layer it belongs to. */
export function expressionsOf(comp: any): { layer: any; p: string; expr: string; v: any }[] {
  const out: { layer: any; p: string; expr: string; v: any }[] = [];
  const visit = (L: any, o: any, p: string) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach((x) => visit(L, x, p)); return; }
    if (typeof o.expr === 'string') out.push({ layer: L, p: o.p ?? p, expr: o.expr, v: o.v });
    for (const k of Object.keys(o)) if (k !== 'expr') visit(L, o[k], o.p ?? p);
  };
  for (const L of comp.layers) { visit(L, L.props, ''); visit(L, L.groups, ''); }
  return out;
}
