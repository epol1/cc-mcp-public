// Custom JSX runtime (no React). Builds a plain element tree; components are plain functions.
// jsxDEV records source locations (file:line:col) so compile/runtime errors point at the TSX.

export interface SourceLoc { file: string; line: number; col: number }
export interface AecElement {
  $$aec: 'element';
  type: any; // primitive (function with .aec) or user component function, or Fragment
  props: Record<string, any>;
  key?: string | number;
  src?: SourceLoc;
}

export const Fragment = Symbol.for('aec.fragment');

function make(type: any, props: Record<string, any> | null, key?: any, src?: SourceLoc): AecElement {
  return { $$aec: 'element', type, props: props ?? {}, key: key ?? undefined, src };
}

export function jsx(type: any, props: Record<string, any>, key?: any): AecElement {
  return make(type, props, key);
}
export const jsxs = jsx;

export function jsxDEV(type: any, props: Record<string, any>, key: any, _isStatic: boolean, source?: { fileName?: string; lineNumber?: number; columnNumber?: number }): AecElement {
  return make(type, props, key, source?.fileName ? { file: source.fileName, line: source.lineNumber ?? 0, col: source.columnNumber ?? 0 } : undefined);
}

export function isElement(x: any): x is AecElement {
  return !!x && typeof x === 'object' && x.$$aec === 'element';
}

/** Flattens children (arrays, fragments, null/false) into a list of elements and strings. */
export function childrenOf(children: any): (AecElement | string)[] {
  const out: (AecElement | string)[] = [];
  const walk = (c: any) => {
    if (c === null || c === undefined || c === false || c === true) return;
    if (Array.isArray(c)) { c.forEach(walk); return; }
    if (isElement(c) && c.type === Fragment) { walk(c.props.children); return; }
    if (typeof c === 'string' || typeof c === 'number') { out.push(String(c)); return; }
    if (isElement(c)) { out.push(c); return; }
    throw new Error(`unsupported JSX child: ${typeof c} ${JSON.stringify(c)?.slice(0, 80)}`);
  };
  walk(children);
  return out;
}

export namespace JSX {
  export type Element = AecElement;
  export interface ElementChildrenAttribute { children: {} }
  export interface IntrinsicElements { [name: string]: never }
}
