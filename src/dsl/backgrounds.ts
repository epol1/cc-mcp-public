// Procedural backgrounds and textures (P4), built from vanilla effects and shape repeaters only: GradientField
// (rotating Gradient Ramp), MeshGradient (drifting 4-Color Gradient warped by Turbulent Displace, optional CC
// Kaleida), FilmGrain (Noise or Add Grain on an adjustment layer), LightSweep (CC Light Sweep passes over
// everything below), BokehField (soft drifting circles in two depth layers, or CC Particle World), DotGrid and
// LineGrid (shape Repeaters that scroll seamlessly). Each has one "aec <Name>" rig effect holding its palette and
// speed (plus a few look params), so a designer re-colors or retimes it live; palette entries may be brand()
// tokens or control()s (live brand colors stay linked). Effect params driven by the rig are expressions; the
// effects stay ordinary effects a designer can open and tweak.
import { Fragment, jsx } from './jsx-runtime.ts';
import type { AecElement } from './jsx-runtime.ts';
import { Adjustment, Effect, Ellipse, Fill, Group, Rect, Repeater, RigEffect, Shape, Solid } from './primitives.ts';
import type { LayerProps } from './primitives.ts';
import { expr } from './anim.ts';
import type { ControlRef } from './control.ts';
import { isControl } from './control.ts';
import type { ColorSpec } from '../shared/units.ts';
import { parseColor } from '../shared/units.ts';
import type { PseudoEffectDef, PseudoParam } from '../compile/ffx/pseudo.ts';
import { ParticleWorld, seedFrom } from './particles.ts';

type Color = ColorSpec | ControlRef;

export interface BackgroundProps extends Omit<LayerProps, 'children' | 'effects'> {
  /** Unique id (also seeds the randomness unless `seed` is given). */
  id: string;
  /** Colors (brand tokens and controls link live). Default: the brand's colors, else a preset palette. */
  palette?: Color[];
  /** A brand() whose colors become the palette when `palette` isn't given. */
  brand?: { colors: Record<string, Color> };
  /** Motion speed multiplier (1 = the preset's pace; 0 = still). Live: "Speed". */
  speed?: number;
  seed?: number;
  /** Layer size (default the comp size). */
  width?: number;
  height?: number;
}

const E_PARADE = 'ADBE Effect Parade';
const fxPath = (label: string, param: string) => `${E_PARADE}/${label}/${param}`;
const rig = (inst: string, layerId?: string) => `${layerId ? `__AEC_LAYER(${layerId})__.` : ''}effect(${JSON.stringify(inst)})`;
const sl = (name: string, def: number, min: number, max: number, precision = 2): PseudoParam => ({ kind: 'slider', name, default: def, min, max, precision });
const colorDefault = (c: Color): number[] => parseColor(isControl(c) ? (c.default as any) : (c as any));
const cp = (name: string, c: Color): PseudoParam => ({ kind: 'color', name, default: colorDefault(c) });

/** The palette: explicit, else the brand's colors, else `fallback`; cycled to `n` entries. */
export function bgPalette(p: Pick<BackgroundProps, 'palette' | 'brand'>, fallback: Color[], n: number): Color[] {
  const src = p.palette?.length ? p.palette : p.brand ? Object.values(p.brand.colors) : fallback;
  if (!src.length) throw new Error('background palette is empty');
  return Array.from({ length: n }, (_, i) => src[i % src.length]);
}

/** Layer props shared by every background (timing, blend, parenting...), tagged 'bg' for style lint. */
const OWN = ['palette', 'brand', 'speed', 'seed', 'angle', 'radial', 'spread', 'warp', 'softness', 'kaleido', 'amount', 'mode', 'color', 'at', 'sweep', 'every', 'direction', 'beam', 'intensity', 'count', 'frame', 'blur', 'gap', 'dot', 'line', 'axis', 'dotOpacity', 'lineOpacity', 'colorNoise'];
function layerProps(p: BackgroundProps, name: string): Record<string, any> {
  const rest: Record<string, any> = { ...p };
  for (const k of OWN) delete rest[k];
  return { ...rest, name: p.name ?? name, tags: [...(p.tags ?? []), 'bg'] };
}

const seedOf = (p: BackgroundProps) => p.seed ?? seedFrom(p.id);
const colorNames = (n: number) => Array.from({ length: n }, (_, i) => `Color ${i + 1}`);

// ---------------------------------------------------------------------------------------------------------

/** A soft two-color gradient whose axis slowly turns (Gradient Ramp, dithered with Ramp Scatter). */
export function GradientField(p: BackgroundProps & { angle?: number; radial?: boolean; spread?: number }) {
  const pal = bgPalette(p, ['#0e1a33', '#2b1d5c'], 2);
  const def: PseudoEffectDef = { name: 'aec Gradient Field', params: [cp('Color 1', pal[0]), cp('Color 2', pal[1]), sl('Speed', 1, 0, 20), sl('Angle', 0, -360, 360, 1), sl('Spread', 100, 10, 300, 1), sl('Scatter', 12, 0, 100, 1)] };
  const R = rig('Gradient Field');
  // Degrees per second at Speed 1: one turn in a minute.
  const pt = (sign: number) => `// ae-compose gradient field: the ramp's axis turns at Speed (Gradient Field effect)\nvar e = ${R}, a = (e("Angle").value + time * e("Speed").value * 6) * Math.PI / 180, r = Math.sqrt(width * width + height * height) * e("Spread").value / 200;\n${p.radial ? (sign < 0 ? '[width / 2 + Math.cos(a) * r * 0.25, height / 2 + Math.sin(a) * r * 0.25];' : '[width / 2 + Math.cos(a) * r * 1.25, height / 2 + Math.sin(a) * r * 1.25];') : `[width / 2 ${sign < 0 ? '-' : '+'} Math.cos(a) * r, height / 2 ${sign < 0 ? '-' : '+'} Math.sin(a) * r];`}`;
  return jsx(Solid, {
    ...layerProps(p, 'Gradient Field'),
    color: '#000000',
    expressions: {
      [fxPath('Gradient', 'ADBE Ramp-0001')]: pt(-1),
      [fxPath('Gradient', 'ADBE Ramp-0003')]: pt(1),
      [fxPath('Gradient', 'ADBE Ramp-0002')]: `${R}("Color 1").value;`,
      [fxPath('Gradient', 'ADBE Ramp-0004')]: `${R}("Color 2").value;`,
      [fxPath('Gradient', 'ADBE Ramp-0006')]: `${R}("Scatter").value;`,
    },
    children: [
      jsx(Effect, { name: 'Gradient Ramp', label: 'Gradient', params: { 'Ramp Shape': p.radial ? 'Radial Ramp' : 'Linear Ramp', 'Start Color': colorHex(pal[0]), 'End Color': colorHex(pal[1]) } }),
      jsx(RigEffect, { def, name: 'Gradient Field', values: { 'Color 1': pal[0], 'Color 2': pal[1], Speed: p.speed ?? 1, Angle: p.angle ?? 0, Spread: p.spread ?? 100 } }),
    ],
  });
}
(GradientField as any).displayName = 'GradientField';

const colorHex = (c: Color) => '#' + colorDefault(c).slice(0, 3).map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0')).join('');

/** An organic, mesh-like gradient: four drifting color points (4-Color Gradient) warped by Turbulent Displace. */
export function MeshGradient(p: BackgroundProps & { warp?: number; softness?: number; kaleido?: boolean | { mirroring?: string; size?: number } }) {
  const pal = bgPalette(p, ['#1b2a6b', '#5b2a86', '#0f6e8c', '#f28c6b'], 4);
  const seed = seedOf(p);
  const def: PseudoEffectDef = { name: 'aec Mesh Gradient', params: [...colorNames(4).map((n, i) => cp(n, pal[i])), sl('Speed', 1, 0, 20), sl('Drift', 18, 0, 60, 1), sl('Softness', 220, 5, 2000, 0), sl('Warp', 90, 0, 600, 1), sl('Warp Size', 320, 2, 1000, 0), sl('Seed', seed, 0, 99999, 0)] };
  const R = rig('Mesh Gradient');
  const base: [number, number][] = [[0.18, 0.2], [0.82, 0.16], [0.2, 0.84], [0.84, 0.8]];
  const ex: Record<string, string> = {};
  base.forEach(([bx, by], i) => {
    ex[fxPath('Mesh', `ADBE 4ColorGradient-000${2 * i + 1}`)] = `// ae-compose mesh gradient: point ${i + 1} drifts (Speed, Drift, Seed in the Mesh Gradient effect)\nvar e = ${R}, t = time * e("Speed").value * 0.12, d = e("Drift").value / 100, s = e("Seed").value;\n[width * (${bx} + d * L.noise1(t + ${(i * 3.1).toFixed(1)}, s)), height * (${by} + d * L.noise1(t + ${(i * 5.7 + 11).toFixed(1)}, s + 1))];`;
    ex[fxPath('Mesh', `ADBE 4ColorGradient-000${2 * i + 2}`)] = `${R}("Color ${i + 1}").value;`;
  });
  ex[fxPath('Mesh', 'ADBE 4ColorGradient-0009')] = `${R}("Softness").value;`;
  ex[fxPath('Warp', 'ADBE Turbulent Displace-0002')] = `${R}("Warp").value;`;
  ex[fxPath('Warp', 'ADBE Turbulent Displace-0003')] = `${R}("Warp Size").value;`;
  ex[fxPath('Warp', 'ADBE Turbulent Displace-0006')] = `// ae-compose mesh gradient: evolution at Speed\ntime * ${R}("Speed").value * 24;`;
  ex[fxPath('Warp', 'ADBE Turbulent Displace-0010')] = `${R}("Seed").value;`;
  const kids: AecElement[] = [
    jsx(Effect, { name: '4-Color Gradient', label: 'Mesh', params: Object.fromEntries(pal.map((c, i) => [`Color ${i + 1}`, colorHex(c)])) }),
    jsx(Effect, { name: 'Turbulent Displace', label: 'Warp', params: { Displacement: 'Turbulent Smoother', Complexity: 2, Pinning: 'Pin All', 'Antialiasing for Best Quality': 'High' } }),
  ];
  if (p.kaleido) {
    const k = p.kaleido === true ? {} : p.kaleido;
    ex[fxPath('Kaleida', 'CC Kaleida-0001')] = '[width / 2, height / 2];';
    ex[fxPath('Kaleida', 'CC Kaleida-0004')] = `// ae-compose mesh gradient: kaleidoscope turns at Speed\ntime * ${R}("Speed").value * 4;`;
    kids.push(jsx(Effect, { name: 'CC Kaleida', label: 'Kaleida', params: { Mirroring: k.mirroring ?? 'Flower', Size: k.size ?? 45 } }));
  }
  kids.push(jsx(RigEffect, { def, name: 'Mesh Gradient', values: { ...Object.fromEntries(pal.map((c, i) => [`Color ${i + 1}`, c])), Speed: p.speed ?? 1, Softness: p.softness ?? 220, Warp: p.warp ?? 90, Seed: seed } }));
  return jsx(Solid, { ...layerProps(p, 'Mesh Gradient'), color: '#000000', expressions: ex, children: kids });
}
(MeshGradient as any).displayName = 'MeshGradient';

/**
 * Grain over everything below (an adjustment layer). 'noise' (default) is the cheap Noise effect, new every frame;
 * 'film' is Add Grain (Final Output, tinted with the palette's first color), slower to render.
 */
export function FilmGrain(p: BackgroundProps & { amount?: number; mode?: 'noise' | 'film'; colorNoise?: boolean }) {
  const lp = layerProps(p, 'Film Grain');
  if (p.mode === 'film') {
    const tint = bgPalette(p, ['#ffffff'], 1)[0];
    const def: PseudoEffectDef = { name: 'aec Film Grain', params: [sl('Amount', 0.6, 0, 10), sl('Size', 1, 0, 10), sl('Softness', 1, 0, 10), sl('Speed', 1, 0, 1), cp('Tint', tint)] };
    const R = rig('Film Grain');
    return jsx(Adjustment, {
      ...lp,
      expressions: {
        [fxPath('Grain', 'VISINF Grain Implant-0008')]: `${R}("Amount").value;`,
        [fxPath('Grain', 'VISINF Grain Implant-0007')]: `${R}("Size").value;`,
        [fxPath('Grain', 'VISINF Grain Implant-0130')]: `${R}("Softness").value;`,
        [fxPath('Grain', 'VISINF Grain Implant-0039')]: `${R}("Speed").value;`,
        [fxPath('Grain', 'VISINF Grain Implant-0010')]: `${R}("Tint").value;`,
      },
      children: [
        jsx(Effect, { name: 'Add Grain', label: 'Grain', params: { 'Viewing Mode': 'Final Output', Monochromatic: p.colorNoise ? 0 : 1, 'Random Seed': seedOf(p) % 10000 } }),
        jsx(RigEffect, { def, name: 'Film Grain', values: { Amount: p.amount ?? 0.6, Speed: Math.max(0, Math.min(1, p.speed ?? 1)), Tint: tint } }),
      ],
    });
  }
  const def: PseudoEffectDef = { name: 'aec Film Grain', params: [sl('Amount', 6, 0, 100, 1), { kind: 'checkbox', name: 'Color Noise', default: !!p.colorNoise }] };
  const R = rig('Film Grain');
  return jsx(Adjustment, {
    ...lp,
    expressions: {
      [fxPath('Grain', 'ADBE Noise2-0001')]: `${R}("Amount").value;`,
      [fxPath('Grain', 'ADBE Noise2-0002')]: `${R}("Color Noise").value ? 1 : 0;`,
    },
    children: [
      jsx(Effect, { name: 'Noise', label: 'Grain', params: { 'Amount of Noise': p.amount ?? 6, 'Noise Type': p.colorNoise ? 1 : 0, Clipping: 1 } }),
      jsx(RigEffect, { def, name: 'Film Grain', values: { Amount: p.amount ?? 6, 'Color Noise': !!p.colorNoise } }),
    ],
  });
}
(FilmGrain as any).displayName = 'FilmGrain';

/**
 * A light sweep across everything below (an adjustment layer with CC Light Sweep): starts at `at` (s from the
 * layer start), crosses the frame in `sweep` s, and repeats every `every` s (0 = once).
 */
export function LightSweep(p: BackgroundProps & { at?: number; sweep?: number; every?: number; direction?: number; beam?: number; intensity?: number }) {
  const light = bgPalette(p, ['#fff6e8'], 1)[0];
  const def: PseudoEffectDef = { name: 'aec Light Sweep', params: [cp('Light Color', light), sl('Start', 0.5, 0, 60), sl('Duration', 1.4, 0.05, 20), sl('Interval', 0, 0, 60), sl('Speed', 1, 0.05, 10), sl('Direction', -25, -180, 180, 1), sl('Width', 140, 0, 2000, 0), sl('Intensity', 60, 0, 500, 0)] };
  const R = rig('Light Sweep');
  return jsx(Adjustment, {
    ...layerProps(p, 'Light Sweep'),
    expressions: {
      [fxPath('Sweep', 'CC Light Sweep-0001')]: [
        '// ae-compose light sweep: crosses the frame from Start over Duration ÷ Speed, repeating every Interval (Light Sweep effect)',
        `var e = ${R}, dur = Math.max(e("Duration").value / Math.max(e("Speed").value, 0.05), 0.01), gap = e("Interval").value;`,
        'var t = time - inPoint - e("Start").value, cyc = gap > 0 ? dur + gap : 1e9, u = t < 0 ? -1 : (t % cyc) / dur;',
        'var p = u < 0 ? 0 : u > 1 ? 1 : L.bezier(0.445, 0.05, 0.55, 0.95, u);',
        '[L.lerp(-0.35 * thisComp.width, 1.35 * thisComp.width, p), thisComp.height / 2];',
      ].join('\n'),
      [fxPath('Sweep', 'CC Light Sweep-0002')]: `${R}("Direction").value;`,
      [fxPath('Sweep', 'CC Light Sweep-0004')]: `${R}("Width").value;`,
      [fxPath('Sweep', 'CC Light Sweep-0005')]: `${R}("Intensity").value;`,
      [fxPath('Sweep', 'CC Light Sweep-0008')]: `${R}("Light Color").value;`,
    },
    children: [
      jsx(Effect, { name: 'CC Light Sweep', label: 'Sweep', params: { Shape: 'Smooth', 'Edge Intensity': 0, 'Light Reception': 'Add', 'Light Color': colorHex(light) } }),
      jsx(RigEffect, { def, name: 'Light Sweep', values: { 'Light Color': light, Start: p.at ?? 0.5, Duration: p.sweep ?? 1.4, Interval: p.every ?? 0, Speed: p.speed ?? 1, Direction: p.direction ?? -25, Width: p.beam ?? 140, Intensity: p.intensity ?? 60 } }),
    ],
  });
}
(LightSweep as any).displayName = 'LightSweep';

const hash = (i: number, k: number) => { const x = Math.sin(i * 127.1 + k * 311.7 + 74.7) * 43758.5453123; return x - Math.floor(x); };

/**
 * Soft out-of-focus lights. 'shapes' (default): seeded circles in two depth layers (far: small and sharper; near:
 * large and blurrier) that drift slowly; every circle is an editable shape group colored from the palette.
 * 'particles': CC Particle World (the dustBokeh preset) colored from the palette.
 */
export function BokehField(p: BackgroundProps & { count?: number; mode?: 'shapes' | 'particles'; frame?: [number, number]; blur?: number }) {
  const pal = bgPalette(p, ['#ffd8a8', '#9ec2ff', '#ffffff'], Math.min(4, Math.max(1, p.palette?.length ?? (p.brand ? Object.keys(p.brand.colors).length : 3))));
  const seed = seedOf(p);
  if (p.mode === 'particles') {
    const { count: _c, mode: _m, frame: _f, blur: _b, palette: _p, brand: _br, speed, ...rest } = p as any;
    return ParticleWorld({ ...rest, preset: 'dustBokeh', seed, blend: p.blend ?? 'SCREEN', tags: [...(p.tags ?? []), 'bg'], params: { 'Birth Color': colorHex(pal[0]), 'Death Color': colorHex(pal[1 % pal.length]), ...(speed !== undefined ? { Velocity: 0.04 * speed } : {}) } });
  }
  const W = p.frame?.[0] ?? (globalThis as any).__AEC_COMP__?.w ?? 1920, H = p.frame?.[1] ?? (globalThis as any).__AEC_COMP__?.h ?? 1080;
  const n = Math.max(2, Math.round(p.count ?? 26));
  const def: PseudoEffectDef = { name: 'aec Bokeh', params: [...colorNames(pal.length).map((nm, i) => cp(nm, pal[i])), sl('Speed', 1, 0, 20), sl('Drift', 60, 0, 600, 0), sl('Blur', p.blur ?? 18, 0, 200, 1), sl('Glow', 100, 0, 200, 0)] };
  const farId = `${p.id}`, nearId = `${p.id}.near`;
  const R = rig('Bokeh', farId);
  const layer = (near: boolean): AecElement => {
    const items: AecElement[] = [];
    const count = near ? Math.floor(n / 3) : n - Math.floor(n / 3);
    for (let i = 0; i < count; i++) {
      const k = i + (near ? 1000 : 0);
      const x = hash(k, seed) * W, y = hash(k, seed + 7) * H;
      const d = near ? 140 + hash(k, seed + 3) * 160 : 36 + hash(k, seed + 3) * 90;
      const op = near ? 10 + hash(k, seed + 5) * 22 : 18 + hash(k, seed + 5) * 35;
      const ci = Math.floor(hash(k, seed + 11) * pal.length) % pal.length;
      items.push(jsx(Group, {
        name: `Light ${i + 1}`,
        position: expr(`// ae-compose bokeh: drift (Speed, Drift in the Bokeh effect)\nvar e = ${R}, t = time * e("Speed").value * ${near ? 0.05 : 0.03}, d = e("Drift").value * ${near ? 1.4 : 1};\n[${x.toFixed(1)} + d * L.noise1(t + ${(i * 1.37).toFixed(2)}, ${seed + k}), ${y.toFixed(1)} + d * L.noise1(t + ${(i * 2.11 + 40).toFixed(2)}, ${seed + k + 1})];`),
        opacity: expr(`${op.toFixed(1)} * ${R}("Glow").value / 100;`),
        children: [jsx(Ellipse, { size: [Math.round(d), Math.round(d)] }), jsx(Fill, { color: expr(`${R}("Color ${ci + 1}").value;`) })],
      }));
    }
    return jsx(Shape, {
      ...layerProps(near ? { ...p, id: nearId, name: `${p.name ?? 'Bokeh'} Near` } : p, 'Bokeh'),
      id: near ? nearId : farId,
      space: 'comp',
      blend: p.blend ?? 'SCREEN',
      expressions: { [fxPath('Defocus', 'ADBE Gaussian Blur 2-0001')]: `${R}("Blur").value * ${near ? 1.8 : 0.6};` },
      children: [
        ...items,
        jsx(Effect, { name: 'Gaussian Blur', label: 'Defocus', params: { 'Repeat Edge Pixels': 0 } }),
        ...(near ? [] : [jsx(RigEffect, { def, name: 'Bokeh', values: { ...Object.fromEntries(pal.map((c, i) => [`Color ${i + 1}`, c])), Speed: p.speed ?? 1, Blur: p.blur ?? 18 } })]),
      ],
    });
  };
  // Far behind near (JSX: later = on top).
  return jsx(Fragment, { children: [layer(false), layer(true)] });
}
(BokehField as any).displayName = 'BokehField';

interface GridOpts { gap?: number; angle?: number }

/** Shared expressions for the scrolling grids: Gap, Speed and Angle from the rig; enough copies to cover the frame. */
const gridCode = (R: string) => ({
  cols: `var g = Math.max(${R}("Gap").value, 2); Math.ceil(thisComp.width / g) + 4;`,
  rows: `var g = Math.max(${R}("Gap").value, 2); Math.ceil(thisComp.height / g) + 4;`,
  start: (dx: boolean, dy: boolean) => [
    `// ae-compose grid: scrolls at Speed px/s along Angle, wrapping every Gap (seamless)`,
    `var e = ${R}, g = Math.max(e("Gap").value, 2), c = Math.ceil(thisComp.width / g) + 4, r = Math.ceil(thisComp.height / g) + 4;`,
    'var a = e("Angle").value * Math.PI / 180, s = time * e("Speed").value;',
    `[${dx ? '-(c - 1) / 2 * g + (s * Math.cos(a)) % g' : '0'}, ${dy ? '-(r - 1) / 2 * g + (s * Math.sin(a)) % g' : '0'}];`,
  ].join('\n'),
});

/** A grid of dots (one ellipse, two Repeaters) that scrolls seamlessly. */
export function DotGrid(p: BackgroundProps & GridOpts & { dot?: number; dotOpacity?: number }) {
  const color = bgPalette(p, ['#ffffff'], 1)[0];
  const def: PseudoEffectDef = { name: 'aec Dot Grid', params: [cp('Color', color), sl('Gap', p.gap ?? 48, 2, 1000, 0), sl('Dot Size', p.dot ?? 6, 0, 200, 1), sl('Dot Opacity', p.dotOpacity ?? 22, 0, 100, 0), sl('Speed', 12, -500, 500, 1), sl('Angle', p.angle ?? 35, -360, 360, 1)] };
  const R = rig('Dot Grid');
  const G = gridCode(R);
  return jsx(Shape, {
    ...layerProps(p, 'Dot Grid'),
    children: [
      jsx(Group, {
        name: 'Row',
        children: [
          jsx(Ellipse, { name: 'Dot', size: expr(`var s = ${R}("Dot Size").value; [s, s];`), position: expr(G.start(true, true)) }),
          jsx(Fill, { color: expr(`${R}("Color").value;`), opacity: expr(`${R}("Dot Opacity").value;`) }),
          jsx(Repeater, { name: 'Columns', copies: expr(G.cols), position: expr(`[Math.max(${R}("Gap").value, 2), 0];`) }),
        ],
      }),
      jsx(Repeater, { name: 'Rows', copies: expr(G.rows), position: expr(`[0, Math.max(${R}("Gap").value, 2)];`) }),
      jsx(RigEffect, { def, name: 'Dot Grid', values: { Color: color, Speed: 12 * (p.speed ?? 1) } }),
    ],
  });
}
(DotGrid as any).displayName = 'DotGrid';

/** Grid lines (vertical and/or horizontal rules, Repeaters) that scroll seamlessly. */
export function LineGrid(p: BackgroundProps & GridOpts & { line?: number; lineOpacity?: number; axis?: 'both' | 'x' | 'y' }) {
  const color = bgPalette(p, ['#ffffff'], 1)[0];
  const def: PseudoEffectDef = { name: 'aec Line Grid', params: [cp('Color', color), sl('Gap', p.gap ?? 80, 2, 1000, 0), sl('Line Width', p.line ?? 2, 0, 100, 1), sl('Line Opacity', p.lineOpacity ?? 14, 0, 100, 0), sl('Speed', 10, -500, 500, 1), sl('Angle', p.angle ?? 0, -360, 360, 1)] };
  const R = rig('Line Grid');
  const G = gridCode(R);
  const axis = p.axis ?? 'both';
  const paint = () => jsx(Fill, { color: expr(`${R}("Color").value;`), opacity: expr(`${R}("Line Opacity").value;`) });
  const groups: AecElement[] = [];
  if (axis !== 'y') groups.push(jsx(Group, {
    name: 'Verticals',
    children: [
      jsx(Rect, { name: 'Line', size: expr(`[${R}("Line Width").value, thisComp.height + 4 * Math.max(${R}("Gap").value, 2)];`), position: expr(G.start(true, false)) }),
      paint(),
      jsx(Repeater, { name: 'Columns', copies: expr(G.cols), position: expr(`[Math.max(${R}("Gap").value, 2), 0];`) }),
    ],
  }));
  if (axis !== 'x') groups.push(jsx(Group, {
    name: 'Horizontals',
    children: [
      jsx(Rect, { name: 'Line', size: expr(`[thisComp.width + 4 * Math.max(${R}("Gap").value, 2), ${R}("Line Width").value];`), position: expr(G.start(false, true)) }),
      paint(),
      jsx(Repeater, { name: 'Rows', copies: expr(G.rows), position: expr(`[0, Math.max(${R}("Gap").value, 2)];`) }),
    ],
  }));
  return jsx(Shape, {
    ...layerProps(p, 'Line Grid'),
    children: [...groups, jsx(RigEffect, { def, name: 'Line Grid', values: { Color: color, Speed: 10 * (p.speed ?? 1) } })],
  });
}
(LineGrid as any).displayName = 'LineGrid';
