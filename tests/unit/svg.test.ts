// <Svg> import: tree walk with transforms, inherited paint, <use>, gradients, strokes, fill rules.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseTransform, readSvg, Svg } from '../../src/dsl/svg.ts';

const write = (body: string) => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aec-svg-')), 't.svg');
  fs.writeFileSync(f, `<?xml version="1.0"?><!-- c --><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">${body}</svg>`);
  return f;
};
const kidsOf = (el: any) => (Array.isArray(el.props.children) ? el.props.children : [el.props.children]).filter(Boolean);

describe('svg transforms', () => {
  it('parses translate/scale/rotate/matrix chains', () => {
    expect(parseTransform('translate(10 20) scale(2)')).toEqual([2, 0, 0, 2, 10, 20]);
    const r = parseTransform('rotate(90 10 10)');
    expect(r.map((x) => Math.round(x * 1e6) / 1e6)).toEqual([0, 1, -1, 0, 20, 0]);
    expect(parseTransform('matrix(1 0 0 1 5 6)')).toEqual([1, 0, 0, 1, 5, 6]);
  });
});

describe('readSvg', () => {
  it('walks groups, inherits paint, applies transforms, skips defs, expands <use>', () => {
    const f = write(`<defs><rect id="r" width="10" height="10"/></defs>
      <g transform="translate(100 0)" fill="#ff0000" stroke="#00ff00" stroke-width="2" opacity="0.5">
        <line x1="0" y1="0" x2="10" y2="0"/>
        <rect x="0" y="20" width="40" height="20" rx="5" fill-opacity="0.5"/>
      </g>
      <use href="#r" x="5" y="5"/>
      <path d="M0 0 L10 0 L10 10 Z M2 2 L8 2 L8 8 Z" fill-rule="evenodd" style="fill:#0000ff"/>
      <g style="display:none"><circle r="5"/></g>`);
    const { els } = readSvg(f);
    expect(els).toHaveLength(4);
    const [line, rect, use, p] = els;
    expect(line.m).toEqual([1, 0, 0, 1, 100, 0]);
    expect(line.paint.fill).toBe('#ff0000');
    expect(line.paint.stroke).toBe('#00ff00');
    expect(rect.d).toMatch(/A5 5/); // rounded corners
    expect(parseFloat(rect.paint.opacity!)).toBeCloseTo(0.5);
    expect(use.m).toEqual([1, 0, 0, 1, 5, 5]);
    expect(p.paint.fill).toBe('#0000ff');
    expect(p.paint['fill-rule']).toBe('evenodd');
  });
  it('resolves linear gradients with stops and href inheritance', () => {
    const f = write(`<defs><linearGradient id="a"><stop offset="0" stop-color="#000"/><stop offset="100%" style="stop-color:#fff;stop-opacity:0.5"/></linearGradient>
      <linearGradient id="b" href="#a" x1="0" y1="0" x2="0" y2="1"/></defs><rect width="10" height="10" fill="url(#b)"/>`);
    const { gradients } = readSvg(f);
    expect(gradients.b.stops).toEqual([{ offset: 0, color: '#000', opacity: 1 }, { offset: 1, color: '#fff', opacity: 0.5 }]);
    expect([gradients.b.x2, gradients.b.y2]).toEqual([0, 1]);
  });
});

describe('<Svg> element tree', () => {
  it('emits the SVG stroke (scaled), the fill rule, opacity and a native gradient fill', () => {
    const f = write(`<defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient></defs>
      <path d="M0 0 L100 0 L100 50 Z" stroke="#123456" stroke-width="4" fill="none"/>
      <rect x="100" y="0" width="100" height="100" fill="url(#g)"/>
      <path d="M0 60 L10 60 L10 70 Z" fill-rule="evenodd" fill="#00ff00" opacity="0.5"/>`);
    const el = Svg({ src: f, width: 400 }) as any; // drawing is 200 wide → scale 2
    const groups = kidsOf(el);
    expect(groups).toHaveLength(3);
    const stroke = kidsOf(groups[0]).find((k: any) => k.type?.displayName === 'stroke' || k.props.width !== undefined && k.props.color === '#123456');
    expect(stroke.props.width).toBe(8);
    expect(kidsOf(groups[0]).some((k: any) => k.props.rule)).toBe(false); // fill="none": no fill
    const grad = kidsOf(groups[1]).find((k: any) => Array.isArray(k.props.stops));
    expect(grad.props.type).toBe('linear');
    expect(grad.props.stops.map((s: any) => s.color)).toEqual(['#f00', '#00f']);
    const fill = kidsOf(groups[2]).find((k: any) => k.props.rule);
    expect(fill.props.rule).toBe('evenOdd');
    expect(fill.props.opacity).toBe(50);
  });
  it('color prop overrides every fill', () => {
    const f = write(`<path d="M0 0 L10 0 L10 10 Z" fill="#ff0000"/><path d="M20 0 L30 0 L30 10 Z"/>`);
    const groups = kidsOf(Svg({ src: f, color: '#abcdef' }) as any);
    for (const g of groups) expect(kidsOf(g).find((k: any) => k.props.rule).props.color).toBe('#abcdef');
  });
});
