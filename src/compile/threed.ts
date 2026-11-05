// 3D lowering: cameras, lights, materials, geometry; and feature detection for the renderer table.
import { isAnim } from '../dsl/anim.ts';
import { isControl } from '../dsl/control.ts';
import { parseColor } from '@ae-mcp/core/units.ts';
import type { Feature } from './renderers.ts';
import type { PropSpec, ValueCtx } from './values.ts';
import { lowerValue, TOL } from './values.ts';

const CO = 'ADBE Camera Options Group';
const LO = 'ADBE Light Options Group';
const MO = 'ADBE Material Options Group';
const GO = 'ADBE Extrsn Options Group';
const TG = 'ADBE Transform Group';

function num1(out: PropSpec[], v: any, path: string, rest: number, ctx: ValueCtx, tol = TOL.generic) {
  if (v === undefined) return;
  const s = lowerValue(v, { path, rest: [rest], dims: 1, tol }, ctx);
  if (s) out.push(s);
}
const bool = (b: any) => (b ? 1 : 0);

/** 50 mm on a 36 mm film back → AE zoom in px for the comp width. */
export function lensToZoom(mm: number, compW: number): number {
  return (mm * compW) / 36;
}

/** Layer reference placeholder resolved to thisComp.layer("<name>") after all layers exist. */
export const layerRef = (id: string) => `__AEC_LAYER(${id})__`;

export function cameraProps(p: any, ctx: ValueCtx, compW: number, compH: number): { props: PropSpec[]; restZ: number } {
  const out: PropSpec[] = [];
  const zoom = p.zoom !== undefined && !isAnim(p.zoom) && !isControl(p.zoom) ? Number(p.zoom) : lensToZoom(p.lens ?? 50, compW);
  num1(out, p.zoom !== undefined ? p.zoom : zoom, `${CO}/ADBE Camera Zoom`, zoom, ctx);
  if (p.dof !== undefined || p.focusDistance !== undefined || p.focusOn) out.push({ p: `${CO}/ADBE Camera Depth of Field`, v: bool(p.dof ?? true) });
  if (p.focusOn) out.push({ p: `${CO}/ADBE Camera Focus Distance`, v: zoom, expr: `// focus follows layer\nvar t = ${layerRef(p.focusOn)};\nvar d = sub(t.toWorld(t.anchorPoint), toWorld([0, 0, 0]));\nMath.max(1, dot(d, toWorldVec([0, 0, 1])));` });
  else num1(out, p.focusDistance, `${CO}/ADBE Camera Focus Distance`, zoom, ctx, TOL.px);
  if (p.fStop !== undefined) out.push({ p: `${CO}/ADBE Camera Aperture`, v: zoom / p.fStop });
  else num1(out, p.aperture, `${CO}/ADBE Camera Aperture`, 25, ctx);
  num1(out, p.blurLevel, `${CO}/ADBE Camera Blur Level`, 100, ctx);
  const IRIS = ['fastRectangle', 'triangle', 'square', 'pentagon', 'hexagon', 'heptagon', 'octagon', 'nonagon', 'decagon'];
  if (p.iris) {
    if (p.iris.shape) out.push({ p: `${CO}/ADBE Iris Shape`, v: IRIS.indexOf(p.iris.shape) + 1 });
    const m: Record<string, string> = { rotation: 'ADBE Iris Rotation', roundness: 'ADBE Iris Roundness', aspect: 'ADBE Iris Aspect Ratio', diffraction: 'ADBE Iris Diffraction Fringe', highlightGain: 'ADBE Iris Highlight Gain', highlightThreshold: 'ADBE Iris Highlight Threshold', highlightSaturation: 'ADBE Iris Hightlight Saturation' };
    for (const [k, mn] of Object.entries(m)) if (p.iris[k] !== undefined) out.push({ p: `${CO}/${mn}`, v: p.iris[k] });
  }
  if (!p.oneNode) {
    if (p.lookAt) out.push({ p: `${TG}/ADBE Anchor Point`, v: [compW / 2, compH / 2, 0], expr: `var t = ${layerRef(p.lookAt)};\nt.toWorld(t.anchorPoint);` });
    else if (p.pointOfInterest !== undefined) { const s = lowerValue(p.pointOfInterest, { path: `${TG}/ADBE Anchor Point`, rest: [compW / 2, compH / 2, 0], dims: 3, tol: TOL.px }, ctx); if (s) out.push(s); }
  }
  return { props: out, restZ: -zoom };
}

export function lightProps(p: any, ctx: ValueCtx, compW: number, compH: number): PropSpec[] {
  const out: PropSpec[] = [];
  num1(out, p.intensity, `${LO}/ADBE Light Intensity`, 100, ctx);
  if (p.color !== undefined) { const s = lowerValue(p.color, { path: `${LO}/ADBE Light Color`, rest: [1, 1, 1, 1], dims: 4, tol: TOL.color, conv: (c: any) => parseColor(c) }, ctx); if (s) out.push(s); }
  num1(out, p.coneAngle, `${LO}/ADBE Light Cone Angle`, 90, ctx);
  num1(out, p.coneFeather, `${LO}/ADBE Light Cone Feather 2`, 50, ctx);
  if (p.falloff) out.push({ p: `${LO}/ADBE Light Falloff Type`, v: { none: 1, smooth: 2, inverseSquare: 3 }[p.falloff as string] });
  num1(out, p.radius, `${LO}/ADBE Light Falloff Start`, 500, ctx);
  num1(out, p.falloffDistance, `${LO}/ADBE Light Falloff Distance`, 500, ctx);
  if (p.castsShadows !== undefined) out.push({ p: `${LO}/ADBE Casts Shadows`, v: bool(p.castsShadows) });
  num1(out, p.shadowDarkness, `${LO}/ADBE Light Shadow Darkness`, 100, ctx);
  num1(out, p.shadowDiffusion, `${LO}/ADBE Light Shadow Diffusion`, 0, ctx);
  if (p.backgroundVisible !== undefined) out.push({ p: `${LO}/ADBE Light Backgd Visible`, v: bool(p.backgroundVisible) });
  num1(out, p.backgroundOpacity, `${LO}/ADBE Light Backgd Opacity`, 100, ctx);
  num1(out, p.backgroundBlur, `${LO}/ADBE Light Backgd Blur`, 0, ctx);
  const kind = p.kind ?? 'point';
  if (kind === 'spot' || kind === 'parallel') {
    if (p.lookAt) out.push({ p: `${TG}/ADBE Anchor Point`, v: [compW / 2, compH / 2, 0], expr: `var t = ${layerRef(p.lookAt)};\nt.toWorld(t.anchorPoint);` });
    else if (p.pointOfInterest !== undefined) { const s = lowerValue(p.pointOfInterest, { path: `${TG}/ADBE Anchor Point`, rest: [compW / 2, compH / 2, 0], dims: 3, tol: TOL.px }, ctx); if (s) out.push(s); }
  }
  return out;
}

/** Material Options (Compositing Options on model layers). */
export function materialProps(m: any, ctx: ValueCtx, isModel: boolean): PropSpec[] {
  if (!m) return [];
  const out: PropSpec[] = [];
  const G = isModel ? 'ADBE Compositing Options Group' : MO;
  const tri = (v: any) => (v === 'only' ? 2 : bool(v));
  if (m.castsShadows !== undefined) out.push({ p: `${G}/ADBE Casts Shadows`, v: tri(m.castsShadows) });
  if (m.acceptsShadows !== undefined) out.push({ p: `${G}/ADBE Accepts Shadows`, v: tri(m.acceptsShadows) });
  if (m.acceptsLights !== undefined) out.push({ p: `${G}/ADBE Accepts Lights`, v: bool(m.acceptsLights) });
  if (m.appearsInReflections !== undefined) out.push({ p: `${G}/ADBE Appears in Reflections`, v: bool(m.appearsInReflections) });
  if (m.shadowColor !== undefined) out.push({ p: `${G}/ADBE Shadow Color`, v: parseColor(m.shadowColor) });
  if (isModel) return out;
  const map: [string, string, number][] = [
    ['ambient', 'ADBE Ambient Coefficient', 100], ['diffuse', 'ADBE Diffuse Coefficient', 50], ['specular', 'ADBE Specular Coefficient', 50],
    ['shininess', 'ADBE Shininess Coefficient', 5], ['metal', 'ADBE Metal Coefficient', 100], ['reflection', 'ADBE Reflection Coefficient', 0],
    ['reflectionSharpness', 'ADBE Glossiness Coefficient', 100], ['reflectionRolloff', 'ADBE Fresnel Coefficient', 0],
    ['transparency', 'ADBE Transparency Coefficient', 0], ['transparencyRolloff', 'ADBE Transp Rolloff', 0], ['ior', 'ADBE Index of Refraction', 1],
    ['lightTransmission', 'ADBE Light Transmission', 0],
  ];
  for (const [k, mn, rest] of map) num1(out, m[k], `${MO}/${mn}`, rest, ctx);
  return out;
}

export function geometryProps(g: any, ctx: ValueCtx, kind: string): PropSpec[] {
  if (!g) return [];
  const out: PropSpec[] = [];
  if (kind === 'text' || kind === 'shape') {
    num1(out, g.extrusion, `${GO}/ADBE Extrsn Depth`, 0, ctx, TOL.px);
    if (g.bevel) {
      out.push({ p: `${GO}/ADBE Bevel Styles`, v: { none: 1, angular: 2, concave: 3, convex: 4 }[(g.bevel.style ?? 'angular') as string] });
      num1(out, g.bevel.depth, `${GO}/ADBE Bevel Depth`, 2, ctx, TOL.px);
      if (g.bevel.direction) out.push({ p: `${GO}/ADBE Bevel Direction`, v: { inward: 1, outward: 2, center: 3 }[g.bevel.direction as string] });
    }
    num1(out, g.holeBevelDepth, `${GO}/ADBE Hole Bevel Depth`, 100, ctx);
  } else {
    num1(out, g.curvature, 'ADBE Plane Options Group/ADBE Plane Curvature', 0, ctx);
    if (g.segments !== undefined) out.push({ p: 'ADBE Plane Options Group/ADBE Plane Subdivision', v: g.segments });
  }
  return out;
}

export function featuresOf(kind: string, p: any, threeD: boolean, hasFx: boolean): Feature[] {
  const f: Feature[] = [];
  if (kind === 'model') f.push('models');
  if (kind === 'light' && p.kind === 'environment') f.push('environmentLight');
  if (kind === 'light' && (p.kind === 'point' || p.kind === 'ambient' || !p.kind) && p.castsShadows) f.push('pointLightShadows');
  if (kind === 'camera' && (p.dof || p.focusOn || p.focusDistance !== undefined)) f.push('dof');
  const g = p.geometry;
  if (g && (kind === 'text' || kind === 'shape') && ((g.extrusion !== undefined && g.extrusion !== 0) || (g.bevel && g.bevel.style !== 'none'))) f.push('extrusion');
  if (g && kind === 'footage' && g.curvature) f.push('curvedFootage');
  const m = p.material;
  if (m && (m.reflection || m.transparency || (m.ior !== undefined && m.ior !== 1))) f.push('pbrMaterials');
  if (m && m.lightTransmission) f.push('lightTransmission');
  if (threeD && (kind === 'text' || kind === 'shape' || kind === 'model') && (hasFx || p.matte || (p.blend && p.blend !== 'NORMAL'))) f.push('effectsOn3DVector');
  const mb = p.motionBlur;
  const mbMode = typeof mb === 'string' ? mb : mb && typeof mb === 'object' ? mb.mode ?? 'native' : mb ? 'native' : undefined;
  if (threeD && mbMode === 'native') f.push('motionBlur');
  if (threeD && (mbMode === 'force' || mbMode === 'pixel') && (kind === 'text' || kind === 'shape' || kind === 'model')) f.push('effectsOn3DVector');
  return f;
}
