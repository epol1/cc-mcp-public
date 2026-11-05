// LightLeakCut: a hard cut hidden under a quick light leak, built-in effects only. A warm Fractal Noise field (Tritone,
// Add blend, a feathered mask) sweeps across and peaks at the cut, with a short white flash; the beats don't overlap:
// the outgoing beat ends and the incoming one starts at the middle of the window.
import { jsx } from '../jsx-runtime.ts';
import { Effect, Mask, Solid } from '../primitives.ts';
import { expr } from '../anim.ts';
import { isControl } from '../control.ts';
import type { ControlRef } from '../control.ts';
import { parseColor } from '../../shared/units.ts';
import type { ColorSpec } from '../../shared/units.ts';
import { controller, ctlName, defineTransition, head, r3, slider, tagsOf } from './core.ts';
import type { TransitionBase, TransitionDef } from './core.ts';

export interface LightLeakCutProps extends TransitionBase {
  /** Leak color (the midtones; highlights go to warm white). Default warm orange. */
  color?: ColorSpec | ControlRef;
  /** Peak opacity of the leak, % (default 85). */
  intensity?: number;
  /** Peak of the white flash at the cut, % (default 50; 0 = none). */
  flash?: number;
  /** Which way the leak sweeps (default 'right'). */
  direction?: 'left' | 'right';
  /** Noise evolution offset (variants). */
  seed?: number;
}

const LABEL = 'Light Leak';
const LIGHT_LEAK: TransitionDef<LightLeakCutProps> = {
  kind: 'light-leak', label: LABEL, defaultDuration: 0.6, cut: 0.5,
  build(p, io) {
    const color = p.color ?? '#ff7a2e';
    const def = isControl(color) ? (typeof color.default === 'string' ? parseColor(color.default) : color.default) : parseColor(color as ColorSpec);
    const ctl = controller(LIGHT_LEAK, p, io, [slider('Intensity', p.intensity ?? 85, 0, 100, { display: 'percent' }), slider('Flash', p.flash ?? 50, 0, 100, { display: 'percent' }), { kind: 'color', name: 'Color', default: def }],
      { Intensity: p.intensity ?? 85, Flash: p.flash ?? 50, Color: color }, { linear: true });
    const LW = Math.round(io.w * 1.8), LH = Math.round(io.h * 1.4);
    const rx = LW * 0.3, ry = LH * 0.42, cx = LW / 2, cy = LH / 2;
    const ellipse = `M${r3(cx - rx)} ${r3(cy)} A${r3(rx)} ${r3(ry)} 0 1 1 ${r3(cx + rx)} ${r3(cy)} A${r3(rx)} ${r3(ry)} 0 1 1 ${r3(cx - rx)} ${r3(cy)} Z`;
    const sweep = (p.direction ?? 'right') === 'right' ? '0.15 + 0.7 * P' : '0.85 - 0.7 * P';
    const name = ctlName(LIGHT_LEAK, p);
    const leak = jsx(Solid, {
      id: `${p.id}.leak`, name: `${name} Leak`, tags: tagsOf(LIGHT_LEAK), color: '#000000', width: LW, height: LH, blend: 'ADD', from: 0, duration: io.dur,
      position: expr(`${head(LIGHT_LEAK, p, 'the leak sweeps across')}\n[thisComp.width * (${sweep}), thisComp.height / 2];`),
      opacity: expr(`${head(LIGHT_LEAK, p, 'peaks at the cut')}\ne("Intensity").value * Math.pow(Math.sin(Math.PI * L.clamp(P, 0, 1)), 1.2);`),
      expressions: { 'ADBE Effect Parade/Leak Color/Midtones': `${head(LIGHT_LEAK, p, 'leak color')}\ne("Color").value;` },
      children: [
        jsx(Effect, { name: 'Fractal Noise', label: 'Leak Noise', params: { 'Noise Type': 'Soft Linear', Contrast: 135, Brightness: -12, 'Uniform Scaling': 0, 'Scale Width': 1500, 'Scale Height': 520, Complexity: 3, Evolution: expr(`time * 150 + ${(p.seed ?? 0) * 97}`) } }),
        jsx(Effect, { name: 'Tritone', label: 'Leak Color', params: { Highlights: '#fff3df', Midtones: isControl(color) ? (color.default as any) : color, Shadows: '#000000' } }),
        jsx(Mask, { path: ellipse, feather: [r3(LW * 0.16), r3(LH * 0.2)] }),
      ],
    });
    const flash = jsx(Solid, {
      id: `${p.id}.flash`, name: `${name} Flash`, tags: tagsOf(LIGHT_LEAK), color: '#ffffff', blend: 'ADD', from: 0, duration: io.dur,
      opacity: expr(`${head(LIGHT_LEAK, p, 'a short flash on the cut')}\ne("Flash").value * L.smooth(0.3, 0.5, P) * (1 - L.smooth(0.5, 0.8, P));`),
    });
    return { outgoing: io.outgoing, incoming: io.incoming, under: [], over: [ctl, leak, flash] };
  },
};
/**
 * Light-leak cut: the beats cut hard at the middle of the window, under a warm Fractal Noise leak (Add) that sweeps
 * across and peaks there, plus a short flash. Built-in effects only.
 */
export const LightLeakCut = defineTransition(LIGHT_LEAK);
