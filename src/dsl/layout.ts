// Layout containers. Positions are solved INSIDE After Effects with real text/shape metrics (D23/D44),
// so <Stack><Text>…</Text><Text>…</Text></Stack> is centred and spaced exactly. Animations on laid-out
// layers are relative to their slot: y: spring({ from: 80 }) rises into place.
import type { Children } from './primitives-types.ts';

function prim<P>(kind: string): ((props: P) => any) & { aec: string } {
  const f: any = (_p: P) => { throw new Error(`<${kind}> must be used as a JSX element inside a scene`); };
  f.aec = kind;
  f.displayName = kind.replace('layout.', '');
  return f;
}

type Align = 'start' | 'center' | 'end' | 'stretch';
type Justify = 'start' | 'center' | 'end' | 'spaceBetween' | 'spaceAround' | 'spaceEvenly';
type At = 'center' | 'top' | 'bottom' | 'left' | 'right' | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';

interface Common { id?: string; padding?: number | number[]; width?: number; height?: number; minWidth?: number; maxWidth?: number; offset?: [number, number]; grow?: number; children?: Children }

export interface StackProps extends Common {
  direction?: 'row' | 'column';
  gap?: number;
  /** Cross-axis alignment of children (default "center"). */
  align?: Align;
  /** Main-axis distribution when the stack is wider/taller than its content. */
  justify?: Justify;
}
/** Vertical (default) or horizontal stack with gaps. */
export const Stack = prim<StackProps>('layout.stack');
export const Column = (p: Omit<StackProps, 'direction'>) => ({ $$aec: 'element', type: Stack, props: { ...p, direction: 'column' } });
export const Row = (p: Omit<StackProps, 'direction'>) => ({ $$aec: 'element', type: Stack, props: { ...p, direction: 'row' } });
(Column as any).displayName = 'Column';
(Row as any).displayName = 'Row';

export interface GridProps extends Common { columns?: number; gap?: number; rowGap?: number; colGap?: number; align?: Align }
/** Row-major grid; cells sized to the largest item per row/column. */
export const Grid = prim<GridProps>('layout.grid');

export interface AlignProps extends Common { at: At }
/** Places its child at a side/corner of the available area (comp, safe area, or parent cell). */
export const Align = prim<AlignProps>('layout.align');
/** Centres its child in the available area. */
export const Center = (p: Common) => ({ $$aec: 'element', type: Align, props: { ...p, at: 'center' } });
(Center as any).displayName = 'Center';

export const Padding = prim<Common>('layout.padding');
/** Fixed-size box; children are overlaid inside it. */
export const Box = prim<Common & { align?: Align }>('layout.box');
/** Children stacked on top of each other (same slot). */
export const Overlay = prim<Common & { align?: Align }>('layout.overlay');

export interface SafeAreaProps { kind?: 'action' | 'title' | [number, number, number, number]; children?: Children }
/** Constrains its children to the action-safe (5 %) or title-safe (10 %) area, or custom insets [t, r, b, l]. */
export const SafeArea = prim<SafeAreaProps>('layout.safe');
