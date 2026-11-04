// Spec for the shared layout solver (src/shared/es3/layout.ts): flexbox-like stacks, grids, boxes,
// align/padding/overlay nodes, safe areas — and proof that the same source runs as ES3 (ExtendScript).
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { frameCenter, safeArea, solveLayout } from '../../src/shared/es3/layout.ts';
import type { Frame, LayoutNode } from '../../src/shared/es3/layout.ts';

const HD: Frame = { x: 0, y: 0, w: 1920, h: 1080 };
const leaf = (id: string, w: number, h: number, extra: Partial<LayoutNode> = {}): LayoutNode => ({ id, kind: 'leaf', size: [w, h], ...extra });

function expectFrame(f: Frame | undefined, x: number, y: number, w: number, h: number) {
  expect(f, 'frame exists').toBeDefined();
  expect(f!.x).toBeCloseTo(x, 9);
  expect(f!.y).toBeCloseTo(y, 9);
  expect(f!.w).toBeCloseTo(w, 9);
  expect(f!.h).toBeCloseTo(h, 9);
}

function allIds(n: LayoutNode, acc: string[] = []): string[] {
  acc.push(n.id);
  for (const c of n.children ?? []) allIds(c, acc);
  return acc;
}

describe('stack', () => {
  it('column stack is centred in a 1920×1080 area, children centred on the cross axis, with gap', () => {
    const tree: LayoutNode = { id: 'col', kind: 'stack', gap: 20, children: [leaf('a', 400, 100), leaf('b', 200, 50), leaf('c', 300, 80)] };
    const f = solveLayout(tree, HD);
    // content: 400 × (100 + 50 + 80 + 2·20 = 270)
    expectFrame(f.col, 760, 405, 400, 270);
    expectFrame(f.a, 760, 405, 400, 100);
    expectFrame(f.b, 860, 525, 200, 50);
    expectFrame(f.c, 810, 595, 300, 80);
    expect(frameCenter(f.a)).toEqual([960, 455]);
    expect(frameCenter(f.col)).toEqual([960, 540]);
  });

  it('row with justify spaceBetween spans a fixed-width box', () => {
    const tree: LayoutNode = {
      id: 'box', kind: 'box', width: 1200, height: 200,
      children: [{ id: 'row', kind: 'stack', direction: 'row', justify: 'spaceBetween', children: [leaf('l1', 100, 50), leaf('l2', 200, 80), leaf('l3', 100, 50)] }],
    };
    const f = solveLayout(tree, HD);
    expectFrame(f.box, 360, 440, 1200, 200);
    // the row wants to fill its main axis (justify set), so it takes the box's width; height stays 80, centred
    expectFrame(f.row, 360, 500, 1200, 80);
    expectFrame(f.l1, 360, 515, 100, 50);
    expectFrame(f.l2, 860, 500, 200, 80); // 360 + 100 + 400
    expectFrame(f.l3, 1460, 515, 100, 50); // right edge = box right edge (1560)
  });

  it('justify center / end / spaceAround / spaceEvenly distribute leftover space', () => {
    const kids = () => [leaf('p', 100, 10), leaf('q', 100, 10)];
    const solve = (justify: LayoutNode['justify']) =>
      solveLayout({ id: 'r', kind: 'stack', direction: 'row', width: 1000, gap: 0, justify, children: kids() }, { x: 0, y: 0, w: 1000, h: 10 });
    // free = 800
    expect([solve('start').p.x, solve('start').q.x]).toEqual([0, 100]);
    expect([solve('center').p.x, solve('center').q.x]).toEqual([400, 500]);
    expect([solve('end').p.x, solve('end').q.x]).toEqual([800, 900]);
    expect([solve('spaceAround').p.x, solve('spaceAround').q.x]).toEqual([200, 700]); // 800/4 ends, 800/2 between
    const ev = solve('spaceEvenly');
    expect(ev.p.x).toBeCloseTo(800 / 3, 9);
    expect(ev.q.x).toBeCloseTo(100 + (2 * 800) / 3, 9);
  });

  it('overflow: spaceBetween falls back to start, spaceEvenly to center', () => {
    const tree = (justify: LayoutNode['justify']): LayoutNode => ({ id: 'r', kind: 'stack', direction: 'row', width: 100, justify, children: [leaf('p', 100, 10), leaf('q', 100, 10)] });
    const area = { x: 0, y: 0, w: 100, h: 10 };
    expect(solveLayout(tree('spaceBetween'), area).p.x).toBe(0);
    expect(solveLayout(tree('spaceEvenly'), area).p.x).toBe(-50);
  });

  it('grow shares leftover main-axis space in proportion', () => {
    const tree: LayoutNode = {
      id: 'row', kind: 'stack', direction: 'row', width: 1000,
      children: [leaf('a', 100, 50, { grow: 1 }), leaf('b', 200, 50), leaf('c', 100, 50, { grow: 3 })],
    };
    const f = solveLayout(tree, HD);
    expectFrame(f.row, 460, 515, 1000, 50);
    expectFrame(f.a, 460, 515, 250, 50); // +150
    expectFrame(f.b, 710, 515, 200, 50);
    expectFrame(f.c, 910, 515, 550, 50); // +450
  });

  it('grow respects maxWidth and leaves the rest to justify', () => {
    const tree: LayoutNode = {
      id: 'row', kind: 'stack', direction: 'row', width: 1000, justify: 'end',
      children: [leaf('a', 100, 50, { grow: 1, maxWidth: 300 }), leaf('b', 100, 50)],
    };
    const f = solveLayout(tree, { x: 0, y: 0, w: 1000, h: 50 });
    expectFrame(f.a, 600, 0, 300, 50);
    expectFrame(f.b, 900, 0, 100, 50);
  });

  it('align stretch sets cross size to the container, except explicit sizes', () => {
    const tree: LayoutNode = {
      id: 'col', kind: 'stack', align: 'stretch',
      children: [leaf('a', 300, 50), leaf('b', 100, 50), leaf('c', 50, 50, { width: 80 }), leaf('d', 50, 50, { maxWidth: 200 })],
    };
    const f = solveLayout(tree, HD);
    expectFrame(f.col, 810, 440, 300, 200);
    expectFrame(f.a, 810, 440, 300, 50);
    expectFrame(f.b, 810, 490, 300, 50); // stretched from 100
    expectFrame(f.c, 810, 540, 80, 50); // explicit width: not stretched, sits at start
    expectFrame(f.d, 810, 590, 200, 50); // stretched but clamped by maxWidth
  });

  it("a leaf's own align overrides the stack's align (align-self)", () => {
    const tree: LayoutNode = { id: 'col', kind: 'stack', align: 'start', children: [leaf('wide', 400, 10), leaf('r', 100, 10, { align: 'end' }), leaf('l', 100, 10)] };
    const f = solveLayout(tree, { x: 0, y: 0, w: 400, h: 30 });
    expect(f.r.x).toBe(300);
    expect(f.l.x).toBe(0);
  });

  it('an align child fills the cross axis of its stack (per-child alignment); the stack still hugs its content', () => {
    const tree: LayoutNode = {
      id: 'col', kind: 'stack', gap: 10,
      children: [{ id: 'al', kind: 'align', at: 'left', children: [leaf('t', 200, 40)] }, leaf('u', 300, 40)],
    };
    const f = solveLayout(tree, HD);
    expectFrame(f.col, 810, 495, 300, 90);
    expectFrame(f.al, 810, 495, 300, 40);
    expectFrame(f.t, 810, 495, 200, 40); // left edge of the column, not of the comp
    expectFrame(f.u, 810, 545, 300, 40);
  });

  it('a nested row with justify fills its parent column across', () => {
    const tree: LayoutNode = {
      id: 'col', kind: 'stack',
      children: [leaf('title', 800, 100), { id: 'row', kind: 'stack', direction: 'row', justify: 'spaceBetween', children: [leaf('x1', 100, 20), leaf('x2', 100, 20)] }],
    };
    const f = solveLayout(tree, HD);
    expectFrame(f.col, 560, 480, 800, 120);
    expectFrame(f.row, 560, 580, 800, 20); // spans the title's width, not the comp's
    expect(f.x2.x + f.x2.w).toBe(1360);
  });
});

describe('align, padding, overlay, box', () => {
  it('align bottomLeft inside the title-safe area, with offset on the aligned child', () => {
    const area = safeArea(1920, 1080, 'title');
    expect(area).toEqual({ x: 192, y: 108, w: 1536, h: 864 });
    const tree: LayoutNode = {
      id: 'lt', kind: 'align', at: 'bottomLeft',
      children: [{ id: 'lower', kind: 'stack', align: 'start', gap: 10, offset: [0, -20], children: [leaf('t1', 600, 80), leaf('t2', 400, 40)] }],
    };
    const f = solveLayout(tree, area);
    expectFrame(f.lt, 192, 108, 1536, 864); // a root align fills its area
    expectFrame(f.lower, 192, 822, 600, 130); // bottom-left (y 842) then offset −20
    expectFrame(f.t1, 192, 822, 600, 80); // the offset carries the subtree
    expectFrame(f.t2, 192, 912, 400, 40);
  });

  it('all nine anchors of an align node', () => {
    const cases: [NonNullable<LayoutNode['at']>, number, number][] = [
      ['topLeft', 0, 0], ['top', 450, 0], ['topRight', 900, 0],
      ['left', 0, 450], ['center', 450, 450], ['right', 900, 450],
      ['bottomLeft', 0, 900], ['bottom', 450, 900], ['bottomRight', 900, 900],
    ];
    for (const [at, x, y] of cases) {
      const f = solveLayout({ id: 'al', kind: 'align', at, children: [leaf('k', 100, 100)] }, { x: 0, y: 0, w: 1000, h: 1000 });
      expect([f.k.x, f.k.y], at).toEqual([x, y]);
    }
  });

  it('padding node adds insets around its child', () => {
    const tree: LayoutNode = { id: 'pad', kind: 'padding', padding: [10, 20, 30, 40], children: [leaf('p1', 100, 50)] };
    const f = solveLayout(tree, HD);
    expectFrame(f.pad, 880, 495, 160, 90);
    expectFrame(f.p1, 920, 505, 100, 50);
  });

  it('padding on a container (CSS shorthand) is part of its size and insets its children', () => {
    const tree: LayoutNode = { id: 'col', kind: 'stack', padding: [20], gap: 0, children: [leaf('a', 100, 50), leaf('b', 100, 50)] };
    const f = solveLayout(tree, { x: 0, y: 0, w: 140, h: 140 });
    expectFrame(f.col, 0, 0, 140, 140);
    expectFrame(f.a, 20, 20, 100, 50);
    expectFrame(f.b, 20, 70, 100, 50);
    const two = solveLayout({ id: 'p', kind: 'padding', padding: [5, 10], children: [leaf('z', 10, 10)] }, { x: 0, y: 0, w: 30, h: 20 });
    expectFrame(two.p, 0, 0, 30, 20);
    expectFrame(two.z, 10, 5, 10, 10);
  });

  it('overlay is the max of its children; children centred unless they say otherwise', () => {
    const tree: LayoutNode = { id: 'ov', kind: 'overlay', children: [leaf('bg', 400, 200), leaf('fg', 100, 50), leaf('tag', 20, 20, { at: 'topRight' })] };
    const f = solveLayout(tree, { x: 0, y: 0, w: 400, h: 200 });
    expectFrame(f.ov, 0, 0, 400, 200);
    expectFrame(f.fg, 150, 75, 100, 50);
    expectFrame(f.tag, 380, 0, 20, 20);
  });

  it('box with align stretch fills its children; a box without size hugs its content', () => {
    const f = solveLayout({ id: 'b', kind: 'box', width: 300, height: 100, align: 'stretch', children: [leaf('fill', 10, 10)] }, HD);
    expectFrame(f.fill, f.b.x, f.b.y, 300, 100);
    const g = solveLayout({ id: 'b2', kind: 'box', children: [leaf('k', 120, 40)] }, HD);
    expectFrame(g.b2, 900, 520, 120, 40);
  });

  it('offset on a container translates the whole subtree after placement', () => {
    const base: LayoutNode = { id: 'row', kind: 'stack', direction: 'row', gap: 10, children: [leaf('a', 100, 100), leaf('b', 100, 100)] };
    const f0 = solveLayout(base, HD);
    const f1 = solveLayout({ ...base, offset: [30, -40] }, HD);
    for (const id of ['row', 'a', 'b']) {
      expect(f1[id].x - f0[id].x).toBe(30);
      expect(f1[id].y - f0[id].y).toBe(-40);
    }
  });

  it('min/maxWidth clamp containers; leaves are never squashed', () => {
    const f = solveLayout({ id: 'col', kind: 'stack', maxWidth: 300, children: [leaf('wide', 500, 10, { maxWidth: 100 })] }, { x: 0, y: 0, w: 300, h: 10 });
    expect(f.col.w).toBe(300);
    expect(f.wide.w).toBe(500); // overflows the clamped column, centred
    expect(f.wide.x).toBe(-100);
    const g = solveLayout({ id: 'col', kind: 'stack', minWidth: 600, children: [leaf('n', 100, 10, { minWidth: 150 })] }, { x: 0, y: 0, w: 600, h: 10 });
    expect(g.col.w).toBe(600);
    expect(g.n.w).toBe(150);
  });
});

describe('grid', () => {
  it('nested stack inside a 3-column grid; cells centred unless the child aligns itself', () => {
    const tree: LayoutNode = {
      id: 'g', kind: 'grid', columns: 3, gap: 20,
      children: [
        leaf('c0', 200, 100),
        { id: 'c1', kind: 'stack', gap: 10, children: [leaf('s1', 100, 40), leaf('s2', 60, 30)] },
        leaf('c2', 150, 120),
        leaf('c3', 180, 60, { align: 'end' }),
        leaf('c4', 220, 90),
      ],
    };
    const f = solveLayout(tree, HD);
    // columns 200 | 220 | 150, rows 120 | 90, gaps 20 → 610 × 230
    expectFrame(f.g, 655, 425, 610, 230);
    expectFrame(f.c0, 655, 435, 200, 100);
    expectFrame(f.c1, 935, 445, 100, 80);
    expectFrame(f.s1, 935, 445, 100, 40);
    expectFrame(f.s2, 955, 495, 60, 30);
    expectFrame(f.c2, 1115, 425, 150, 120);
    expectFrame(f.c3, 675, 595, 180, 60); // bottom-right of its 200 × 90 cell
    expectFrame(f.c4, 875, 565, 220, 90);
  });

  it('separate row/col gaps and a fixed-width grid with equal (1fr-like) tracks', () => {
    const tree: LayoutNode = {
      id: 'g', kind: 'grid', columns: 3, width: 1000, colGap: 20, rowGap: 5,
      children: [leaf('a', 200, 50), leaf('b', 220, 50), leaf('c', 150, 50), leaf('d', 100, 30)],
    };
    const f = solveLayout(tree, { x: 0, y: 0, w: 1000, h: 85 });
    expectFrame(f.g, 0, 0, 1000, 85); // rows 50 + 5 + 30
    // avail 1000 − 40 = 960 → 320 per column
    expectFrame(f.a, 60, 0, 200, 50);
    expectFrame(f.b, 340 + 50, 0, 220, 50);
    expectFrame(f.c, 680 + 85, 0, 150, 50);
    expectFrame(f.d, 110, 55, 100, 30);
  });

  it('track growth never shrinks a wide column below its content', () => {
    const tree: LayoutNode = { id: 'g', kind: 'grid', columns: 3, width: 400, children: [leaf('a', 250, 10), leaf('b', 10, 10), leaf('c', 30, 10)] };
    const f = solveLayout(tree, { x: 0, y: 0, w: 400, h: 10 });
    // a keeps 250; b and c share the remaining 150 → 75 each
    expect(f.a.x).toBe(0);
    expect(f.b.x).toBe(250 + (75 - 10) / 2);
    expect(f.c.x).toBe(325 + (75 - 30) / 2);
  });

  it('default columns = ceil(sqrt(n))', () => {
    const kids: LayoutNode[] = [];
    for (let i = 0; i < 5; i++) kids.push(leaf('k' + i, 10, 10));
    const f = solveLayout({ id: 'g', kind: 'grid', children: kids }, { x: 0, y: 0, w: 30, h: 20 });
    expect(f.g.w).toBe(30); // 3 columns
    expect(f.g.h).toBe(20); // 2 rows
    expect([f.k3.x, f.k3.y]).toEqual([0, 10]);
  });
});

describe('leaves, ids, errors', () => {
  it('leaf with explicit width/height overrides size', () => {
    const f = solveLayout(leaf('t', 100, 40, { width: 500 }), HD);
    expectFrame(f.t, 710, 520, 500, 40);
    const g = solveLayout({ id: 'u', kind: 'leaf', size: [100, 40], height: 60 }, HD);
    expectFrame(g.u, 910, 510, 100, 60);
    const h = solveLayout({ id: 'v', kind: 'leaf' }, HD);
    expectFrame(h.v, 960, 540, 0, 0);
  });

  it('returns a frame for every node id (containers too)', () => {
    const tree: LayoutNode = {
      id: 'root', kind: 'align', at: 'top', padding: [40],
      children: [{
        id: 'main', kind: 'stack', gap: 24, children: [
          { id: 'head', kind: 'padding', padding: [8, 16], children: [leaf('title', 900, 120)] },
          { id: 'cards', kind: 'grid', columns: 2, gap: 12, children: [
            { id: 'card1', kind: 'box', width: 300, height: 200, children: [leaf('img1', 280, 160), leaf('cap1', 200, 30, { at: 'bottom' })] },
            { id: 'card2', kind: 'overlay', children: [leaf('img2', 250, 180), { id: 'badge', kind: 'align', at: 'topRight', children: [leaf('dot', 20, 20)] }] },
            { id: 'card3', kind: 'stack', direction: 'row', gap: 6, children: [leaf('i3', 40, 40), leaf('t3', 200, 40, { grow: 1 })] },
          ] },
          { id: 'foot', kind: 'stack', direction: 'row', justify: 'spaceEvenly', offset: [0, 10], children: [leaf('f1', 60, 20), leaf('f2', 60, 20)] },
        ],
      }],
    };
    const f = solveLayout(tree, safeArea(1920, 1080, 'action'));
    expect(Object.keys(f).sort()).toEqual(allIds(tree).sort());
    for (const id of allIds(tree)) {
      for (const k of ['x', 'y', 'w', 'h'] as const) expect(Number.isFinite(f[id][k]), id + '.' + k).toBe(true);
    }
    expectFrame(f.root, 96, 54, 1728, 972);
    expect(f.main.y).toBe(54 + 40); // align top, inside the padding
  });

  it('rejects duplicate ids, missing ids and unknown kinds with a pointed message', () => {
    expect(() => solveLayout({ id: 'a', kind: 'stack', children: [leaf('x', 1, 1), leaf('x', 1, 1)] }, HD)).toThrow(/duplicate node id "x"/);
    expect(() => solveLayout({ id: '', kind: 'leaf' }, HD)).toThrow(/string id/);
    expect(() => solveLayout({ id: 'q', kind: 'flex' as LayoutNode['kind'] }, HD)).toThrow(/unknown kind "flex" on node "q"/);
  });
});

describe('safeArea / frameCenter', () => {
  it('action = 5 %, title = 10 %, explicit insets [t, r, b, l]', () => {
    expect(safeArea(1920, 1080, 'action')).toEqual({ x: 96, y: 54, w: 1728, h: 972 });
    expect(safeArea(1920, 1080, 'title')).toEqual({ x: 192, y: 108, w: 1536, h: 864 });
    expect(safeArea(3840, 2160, 'title')).toEqual({ x: 384, y: 216, w: 3072, h: 1728 });
    expect(safeArea(1920, 1080, [10, 20, 30, 40])).toEqual({ x: 40, y: 10, w: 1860, h: 1040 });
    expect(safeArea(1920, 1080, [50])).toEqual({ x: 50, y: 50, w: 1820, h: 980 });
    expect(() => safeArea(1920, 1080, 'broadcast' as 'title')).toThrow(/unknown safe area/);
  });

  it('frameCenter is the box centre (AE Position for a box-centred anchor)', () => {
    expect(frameCenter({ x: 10, y: 20, w: 101, h: 50 })).toEqual([60.5, 45]);
    expect(frameCenter(safeArea(1920, 1080, 'title'))).toEqual([960, 540]);
  });
});

describe('ES3 (ExtendScript) compatibility', () => {
  it('compiles with the runtime Babel options, passes the ES3 post-pass and runs without ES5 built-ins', async () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const babelCfgUrl = pathToFileURL(path.join(root, 'build/babel.config.mjs')).href;
    const postPassUrl = pathToFileURL(path.join(root, 'build/es3-postpass.mjs')).href;
    const { es3BabelOptions } = await import(babelCfgUrl);
    const { es3PostPass } = await import(postPassUrl);
    const babel = await import('@babel/core');

    const src = fs.readFileSync(path.join(root, 'src/shared/es3/layout.ts'), 'utf8').replace(/^export /gm, '');
    const res = await babel.transformAsync(src, { ...es3BabelOptions, cwd: root, filename: 'layout.ts', sourceType: 'script' });
    const wrapped = '(function () {\n' + res!.code + '\n__out.solveLayout = solveLayout; __out.safeArea = safeArea; __out.frameCenter = frameCenter;\n})();';
    const pp = es3PostPass(wrapped); // throws unless the output parses as strict ES3
    expect(pp.problems).toEqual([]);
    expect(pp.code).not.toContain('__es3_'); // no ES5 statics needed ponyfilling

    const tree: LayoutNode = {
      id: 'root', kind: 'align', at: 'bottomLeft', children: [{
        id: 'col', kind: 'stack', align: 'start', gap: 10, offset: [5, -5], children: [
          { id: 'g', kind: 'grid', columns: 2, gap: 4, width: 400, children: [leaf('a', 50, 50), leaf('b', 80, 20, { align: 'end' }), leaf('c', 30, 30)] },
          { id: 'r', kind: 'stack', direction: 'row', justify: 'spaceBetween', children: [leaf('d', 10, 10, { grow: 1 }), leaf('e', 10, 10)] },
          { id: 'p', kind: 'padding', padding: [1, 2, 3, 4], children: [{ id: 'o', kind: 'overlay', children: [leaf('f', 20, 20, { at: 'right' })] }] },
        ],
      }],
    };
    const ctx = createContext({ __out: {} });
    runInContext(`(function (g) {
      var i, A = Array.prototype, S = String.prototype;
      var a = ['map','forEach','filter','reduce','reduceRight','indexOf','lastIndexOf','some','every','find','findIndex','includes','fill','flat','flatMap','keys','values','entries','at'];
      for (i = 0; i < a.length; i++) delete A[a[i]];
      var o = ['keys','assign','create','defineProperty','defineProperties','entries','values','freeze','getPrototypeOf','setPrototypeOf','getOwnPropertyNames'];
      for (i = 0; i < o.length; i++) delete Object[o[i]];
      var s = ['trim','includes','startsWith','endsWith','padStart','padEnd','repeat'];
      for (i = 0; i < s.length; i++) delete S[s[i]];
      delete Array.isArray; delete Array.from; delete Array.of; delete Function.prototype.bind; delete Date.now;
      var gl = ['JSON','Symbol','Map','Set','WeakMap','WeakSet','Promise','Reflect','Proxy'];
      for (i = 0; i < gl.length; i++) delete g[gl[i]];
    })(this);`, ctx);
    expect(runInContext('typeof [].map + typeof [].forEach + typeof Object.keys + typeof JSON + typeof Map', ctx)).toBe('undefined'.repeat(5));
    runInContext(pp.code, ctx);
    // the fixture is built inside the sandbox so its arrays have no ES5 methods either
    runInContext('var __tree = ' + JSON.stringify(tree) + ';', ctx);
    const es3Frames = runInContext('__out.solveLayout(__tree, __out.safeArea(1920, 1080, "title"))', ctx);
    const nodeFrames = solveLayout(tree, safeArea(1920, 1080, 'title'));
    expect(JSON.stringify(es3Frames)).toBe(JSON.stringify(nodeFrames));
    expect(JSON.stringify(runInContext('__out.frameCenter(__out.safeArea(1920, 1080, [10, 20, 30, 40]))', ctx))).toBe('[970,530]');
  }, 60_000);
});
