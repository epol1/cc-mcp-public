// Particle systems as DSL components (built from Solid/Adjustment/Precomp/Effect + expressions).
// Calibrated in AE 26.5: CC Particle World producer units = host layer width (x, y, z), +y down; it follows
// the comp camera automatically when one exists (D41). Seeds are always explicit (default: hash of id).
import { Fragment, jsx, childrenOf, isElement } from './jsx-runtime.ts';
import type { AecElement } from './jsx-runtime.ts';
import { Adjustment, Effect, Precomp, Solid } from './primitives.ts';
import type { LayerProps } from './primitives.ts';
import { control } from './control.ts';
import type { ControlRef } from './control.ts';
import { expr, keys } from './anim.ts';
import type { Time } from '../shared/units.ts';
import { parseColor } from '../shared/units.ts';

// Default ids: the first ParticleWorld is "particles", the next "particles-2", ... (reset per compile), so two
// systems without explicit ids don't collide. Give ids anyway when you want stable seeds across edits.
const autoIds = new Map<string, number>();
export function resetAutoIds(): void { autoIds.clear(); }
function autoId(base: string): string {
  const n = (autoIds.get(base) ?? 0) + 1;
  autoIds.set(base, n);
  return n === 1 ? base : `${base}-${n}`;
}

export function seedFrom(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h) % 10000;
}

export interface ParticleProps extends Omit<LayerProps, 'children'> {
  id?: string;
  /** Effect params by display name ("Birth Rate") or matchName ("CC Particle World-0004"). Overrides the preset. */
  params?: Record<string, any>;
  /** Random seed (default: derived from id) — make it a variant param for reproducible alternates. */
  seed?: number;
  /** Use a layer (id) or an element (wrapped in a hidden precomp) as the particle texture. */
  texture?: string | AecElement;
  /** Size of the texture precomp when `texture` is an element. */
  textureSize?: [number, number];
  /** Producer follows another layer (its anchor in world space), e.g. an animated null or a logo. */
  emitter?: { follow: string };
  /**
   * Emit only in a burst: birth rate jumps to `rate` at `at` for `duration`. `at: { marker: 'hit' }` fires at the
   * comp marker with that comment (an expression reads it, so moving the marker in AE, or a ripple edit, retimes
   * the burst; named <Sequence>s and <Composition markers> create markers).
   */
  burst?: { at: Time | { marker: string }; duration?: Time; rate?: number };
  /** Expose the preset's key parameters as live controls (default true). */
  controls?: boolean;
}

const PW = 'CC Particle World';

function controlsFor(name: string, defs: Record<string, number | string>, on: boolean): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(defs)) out[k] = on ? control(`${name} ${k.replace(/ \(sec\)/, '')}`, v as any) : v;
  return out;
}

/** CC Particle World presets: params + which ones become live controls. */
export const particlePresets = {
  dustBokeh: { live: { 'Birth Rate': 0.25, 'Velocity': 0.04, 'Birth Size': 0.035 }, fixed: { 'Longevity (sec)': 6, 'Animation': 5, 'Gravity': -0.004, 'Extra': 0.3, 'Radius X': 0.6, 'Radius Y': 0.32, 'Radius Z': 0.6, 'Particle Type': 5, 'Death Size': 0.05, 'Size Variation': 80, 'Max Opacity': 45, 'Birth Color': '#ffe9c8', 'Death Color': '#9ec2ff', 'Transfer Mode': 3, 'Resistance': 2 } },
  sparks: { live: { 'Birth Rate': 2.5, 'Velocity': 1.3, 'Gravity': 0.7 }, fixed: { 'Longevity (sec)': 0.9, 'Animation': 1, 'Radius X': 0.01, 'Radius Y': 0.01, 'Radius Z': 0.01, 'Particle Type': 9, 'Birth Size': 0.05, 'Death Size': 0, 'Size Variation': 60, 'Max Opacity': 100, 'Birth Color': '#fff3b0', 'Death Color': '#ff5a1f', 'Transfer Mode': 3, 'Resistance': 1.5 } },
  confettiBurst: { live: { 'Birth Rate': 12, 'Velocity': 1.6, 'Gravity': 0.9 }, fixed: { 'Longevity (sec)': 3, 'Animation': 1, 'Radius X': 0.02, 'Radius Y': 0.02, 'Radius Z': 0.02, 'Particle Type': 12, 'Birth Size': 0.045, 'Death Size': 0.045, 'Size Variation': 60, 'Max Opacity': 100, 'Rotation Speed': 360, 'Initial Rotation': 360, 'Resistance': 3, 'Birth Color': '#ffd23f', 'Death Color': '#ee4266', 'Transfer Mode': 1 } },
  energyTrail: { live: { 'Birth Rate': 3, 'Velocity': 0.08, 'Birth Size': 0.06 }, fixed: { 'Longevity (sec)': 1.2, 'Animation': 5, 'Gravity': 0, 'Radius X': 0.005, 'Radius Y': 0.005, 'Radius Z': 0.005, 'Particle Type': 5, 'Death Size': 0, 'Size Variation': 40, 'Max Opacity': 90, 'Birth Color': '#7df9ff', 'Death Color': '#7a3cff', 'Transfer Mode': 3, 'Inherit Velocity %': 20 } },
  magicSparkle: { live: { 'Birth Rate': 1.2, 'Velocity': 0.25, 'Birth Size': 0.05 }, fixed: { 'Longevity (sec)': 1.4, 'Animation': 1, 'Gravity': 0.05, 'Radius X': 0.03, 'Radius Y': 0.03, 'Radius Z': 0.03, 'Particle Type': 2, 'Death Size': 0, 'Size Variation': 70, 'Max Opacity': 100, 'Birth Color': '#ffffff', 'Death Color': '#ffcc66', 'Transfer Mode': 3, 'Rotation Speed': 120 } },
  logoDisintegrate: { live: { 'Birth Rate': 6, 'Velocity': 0.6, 'Gravity': -0.15 }, fixed: { 'Longevity (sec)': 1.6, 'Animation': 13, 'Radius X': 0.2, 'Radius Y': 0.06, 'Radius Z': 0.05, 'Particle Type': 14, 'Birth Size': 0.03, 'Death Size': 0.005, 'Size Variation': 50, 'Max Opacity': 100, 'Transfer Mode': 1, 'Texture Time': 1, 'Scatter': 1 } },
  snowfall: { live: { 'Birth Rate': 0.8, 'Velocity': 0.05, 'Gravity': 0.06 }, fixed: { 'Longevity (sec)': 8, 'Animation': 5, 'Radius X': 1.2, 'Radius Y': 0.02, 'Radius Z': 0.8, 'Position Y': -0.6, 'Particle Type': 5, 'Birth Size': 0.02, 'Death Size': 0.02, 'Size Variation': 60, 'Max Opacity': 80, 'Birth Color': '#ffffff', 'Death Color': '#dfe9ff', 'Transfer Mode': 3, 'Resistance': 3 } },
} as const;
export type ParticlePreset = keyof typeof particlePresets;


/**
 * CC Particle World on a comp-size solid (the solid's pixels are replaced by particles).
 * `preset` gives a polished starting point whose key params are live controls named "<name> Birth Rate", etc.
 */
export function ParticleWorld(p: ParticleProps & { preset?: ParticlePreset; width?: number; height?: number }) {
  const id = p.id ?? autoId('particles');
  const name = p.name ?? (p.preset ? p.preset.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()) : 'Particle World');
  const preset = p.preset ? particlePresets[p.preset] : undefined;
  const params: Record<string, any> = { ...(preset ? controlsFor(name, preset.live as any, p.controls !== false) : {}), ...(preset ? preset.fixed : {}) };
  for (const [k, v] of Object.entries(params)) if (typeof v === 'string' && /^#/.test(v)) params[k] = v; // colors stay strings (parsed by compiler)
  Object.assign(params, p.params ?? {});
  params['Random Seed'] = p.seed ?? seedFrom(id);
  const out: AecElement[] = [];
  if (p.texture !== undefined) {
    let texId: string;
    if (typeof p.texture === 'string') texId = p.texture;
    else {
      texId = `${id}.texture`;
      const [tw, th] = p.textureSize ?? [256, 256];
      out.push(jsx(Precomp, { id: texId, name: `${name} Texture`, width: tw, height: th, hidden: true, children: p.texture }));
    }
    params['Texture Layer'] = { layer: texId };
    if (params['Particle Type'] === undefined || ![13, 14, 18, 19, 20, 21, 22].includes(params['Particle Type'])) params['Particle Type'] = 14; // Textured QuadPolygon
  }
  const exprs: Record<string, string> = {};
  if (p.emitter) {
    const t = `__AEC_LAYER(${p.emitter.follow})__`;
    exprs['Position X'] = `var t = ${t}; var w = t.toWorld(t.anchorPoint); (w[0] - thisComp.width / 2) / thisLayer.width;`;
    exprs['Position Y'] = `var t = ${t}; var w = t.toWorld(t.anchorPoint); (w[1] - thisComp.height / 2) / thisLayer.width;`;
    exprs['Position Z'] = `var t = ${t}; var w = t.toWorld(t.anchorPoint); (w.length > 2 ? w[2] : 0) / thisLayer.width;`;
  }
  if (p.burst) {
    const br = params['Birth Rate'];
    const rate = p.burst.rate ?? (typeof br === 'number' ? br : br && typeof br === 'object' && typeof br.default === 'number' ? br.default : 8);
    const at = p.burst.at, dur = p.burst.duration ?? '0.15s';
    if (typeof at === 'object' && at !== null && 'marker' in at) {
      const d = typeof dur === 'number' ? String(dur) : /f$/.test(String(dur).trim()) ? `framesToTime(${parseFloat(String(dur))})` : /ms$/.test(String(dur).trim()) ? String(parseFloat(String(dur)) / 1000) : String(parseFloat(String(dur)));
      exprs['Birth Rate'] = `// ae-compose rig: burst at marker "${at.marker}" (reads the marker live; ripple edits move the marker, not this)
var m = thisComp.marker.key(${JSON.stringify(at.marker)}).time;
(time >= m && time < m + ${d}) ? ${rate} : 0;`;
      delete params['Birth Rate'];
    } else params['Birth Rate'] = keys({ t: 0, v: 0, hold: true }, { t: at, v: rate, hold: true }, { t: addTime(at, dur), v: 0, hold: true });
  }
  const fxParams: Record<string, any> = {};
  for (const [k, v] of Object.entries(params)) fxParams[k] = exprs[k] ? expr(exprs[k]) : v;
  for (const [k, e] of Object.entries(exprs)) if (!(k in fxParams)) fxParams[k] = expr(e);
  const { params: _pp, preset: _pr, texture: _t, textureSize: _ts, emitter: _e, burst: _b, seed: _s, controls: _c, width, height, ...layer } = p as any;
  out.push(jsx(Solid, { ...layer, id, name, color: '#000000', width: width, height: height, children: jsx(Effect, { name: PW, params: fxParams }) }));
  return jsx(Fragment, { children: out });
}

/** a + b without knowing the fps: numbers add; anything else becomes a sum string parseTime understands ("12f+6f"). */
function addTime(a: Time, b: Time): Time {
  if (typeof a === 'number' && typeof b === 'number') return a + b;
  return `${a}+${b}`;
}

const SYSTEM_NAMES: Record<string, string> = { 'ADBE Playgnd': 'Particle Playground', CSRainfall: 'Rainfall', CSSnowfall: 'Snowfall' };

function hostLayer(system: string, defaults: Record<string, any>, kind: 'solid' | 'adjustment') {
  return (p: ParticleProps & { width?: number; height?: number }) => {
    const id = p.id ?? autoId(system.replace(/\W+/g, '').toLowerCase());
    const params = { ...defaults, ...(p.params ?? {}) };
    if ('Random Seed' in defaults || p.seed !== undefined) params['Random Seed'] = p.seed ?? seedFrom(id);
    const { params: _pp, seed: _s, controls: _c, texture: _t, emitter: _e, burst: _b, ...layer } = p as any;
    return jsx(kind === 'solid' ? Solid : Adjustment, { ...layer, id, name: p.name ?? SYSTEM_NAMES[system] ?? system.replace(/^(CC |CS|APC |ADBE )/, ''), color: '#000000', children: jsx(Effect, { name: system, params }) });
  };
}

/** CC Particle Systems II (2D particle fountain) on a solid. */
export const ParticleSystemsII = hostLayer('CC Particle Systems II', { 'Random Seed': 0 }, 'solid');
/** CC Star Burst (star field flying toward camera) on a solid. */
export const StarBurst = hostLayer('CC Star Burst', {}, 'solid');
/** CC Rainfall over everything below (adjustment layer). */
export const Rainfall = hostLayer('CSRainfall', { 'Random Seed': 0 }, 'adjustment');
/** CC Snowfall over everything below (adjustment layer). */
export const Snowfall = hostLayer('CSSnowfall', { 'Random Seed': 0 }, 'adjustment');
/** Particle Playground (cannon/grid/layer exploder + physics) on a solid. Use params like { "Explode Layer": { layer: "logo" } }. */
export const ParticlePlayground = hostLayer('ADBE Playgnd', {}, 'solid');

/** Applies an effect to its single layer child (or to a precomp of several children): PixelPolly, Shatter, CardDance. */
function onContent(system: string) {
  return (p: { id?: string; name?: string; params?: Record<string, any>; children?: any; width?: number; height?: number }) => {
    const kids = childrenOf(p.children).filter(isElement) as AecElement[];
    const fx = jsx(Effect, { name: system, params: p.params ?? {} });
    const k = kids[0];
    if (kids.length === 1 && k.type?.aec && !['sequence', 'series', 'composition', 'precomp'].includes(k.type.aec)) {
      return { ...k, props: { ...k.props, children: [...childrenOf(k.props.children), fx] } };
    }
    return jsx(Precomp, { id: p.id, name: p.name ?? system.replace(/^(CC |APC )/, ''), width: p.width, height: p.height, children: kids, effects: [fx] });
  };
}

/** CC Pixel Polly: shatters its child layer into polygons. */
export const PixelPolly = onContent('CC Pixel Polly');
/** Shatter: physical shatter of its child layer (Camera System: Comp Camera recommended in 3D scenes). */
export const Shatter = onContent('APC Shatter');
/** Card Dance: grid of cards driven by gradient layers. */
export const CardDance = onContent('APC CardDanceCam');

export function colorParam(c: string): number[] { return parseColor(c); }
export type { ControlRef };
