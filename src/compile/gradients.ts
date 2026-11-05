// Shape gradients (D15/D47). Gradient stops aren't scriptable and reading the Colors property crashes AE 26.5,
// so: add the G-Fill/G-Stroke, set only Opacity/Type/Start/End (the AEUX-proven setters), then apply a
// generated .ffx preset carrying the stops (templates from google/AEUX, Apache-2.0) to the selected property.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseColor } from '@cc-mcp/core/units.ts';
import type { PropSpec, ValueCtx } from './values.ts';
import { lowerValue, TOL } from './values.ts';

const FFX_DIR = path.join(os.homedir(), '.ae-compose', 'ffx');
let TEMPLATES: Record<string, string> | null = null;

function templates(): Record<string, string> {
  if (!TEMPLATES) TEMPLATES = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'ffx', 'gradient-templates.json'), 'utf8')).templates;
  return TEMPLATES!;
}

export interface Stop { offset: number; color: any; opacity?: number; midpoint?: number }

/** Writes a .ffx preset with these stops; returns its path. Deterministic file name (content hash). */
export function gradientFfx(stopsIn: Stop[], warnings: string[]): string {
  let stops = [...stopsIn].sort((a, b) => a.offset - b.offset);
  if (stops.length < 2) throw new Error('a gradient needs at least 2 stops');
  if (stops.length > 8) {
    warnings.push(`gradient has ${stops.length} stops; AE presets support 8, so it was resampled to 8`);
    const idx = Array.from({ length: 8 }, (_, i) => Math.round((i * (stops.length - 1)) / 7));
    stops = idx.map((i) => stops[i]);
  }
  const tpl = Buffer.from(templates()[stops.length], 'base64').toString('latin1');
  const cols = stops.map((s) => parseColor(s.color));
  const val = (expr: string): number => {
    const m = /points\[(\d+)\]\.(rampPoint|midPoint|opacity|color\[(\d)\])/.exec(expr);
    if (!m) throw new Error(`unexpected gradient placeholder ${expr}`);
    const s = stops[+m[1]];
    if (m[2] === 'rampPoint') return Math.min(1, Math.max(0, s.offset));
    if (m[2] === 'midPoint') return s.midpoint ?? 0.5;
    if (m[2] === 'opacity') return s.opacity ?? cols[+m[1]][3];
    return cols[+m[1]][+m[3]];
  };
  const body = tpl.split('\n').map((line) => (/points\[/.test(line) ? `<float>${val(line.trim()).toFixed(8)}</float>` : line)).join('\n');
  const file = path.join(FFX_DIR, crypto.createHash('sha1').update(body).digest('hex').slice(0, 16) + '.ffx');
  if (!fs.existsSync(file)) { fs.mkdirSync(FFX_DIR, { recursive: true }); fs.writeFileSync(file, Buffer.from(body, 'latin1')); }
  return file.replace(/\\/g, '/');
}

const vec2 = (v: any) => (typeof v === 'number' ? [v, v] : [v[0], v[1] ?? v[0]]);

export function buildGradient(kind: 'gfill' | 'gstroke', p: any, ctx: ValueCtx, warnings: string[]): any {
  const isFill = kind === 'gfill';
  const props: PropSpec[] = [];
  const push = (v: any, path: string, rest: number[], dims: number, conv?: (v: any) => number[], tol = TOL.generic) => { if (v === undefined) return; const s = lowerValue(v, { path, rest, dims, tol, conv }, ctx); if (s) props.push(s); };
  push(p.opacity, isFill ? 'ADBE Vector Fill Opacity' : 'ADBE Vector Stroke Opacity', [100], 1);
  if (!isFill) push(p.width ?? 4, 'ADBE Vector Stroke Width', [4], 1);
  props.push({ p: 'ADBE Vector Grad Type', v: p.type === 'radial' ? 2 : 1 });
  push(p.start ?? [-100, 0], 'ADBE Vector Grad Start Pt', [-100, 0], 2, vec2, TOL.px);
  push(p.end ?? [100, 0], 'ADBE Vector Grad End Pt', [100, 0], 2, vec2, TOL.px);
  // Stops are encoded in the group name so the inspector can report them (AE can't read stops by script).
  const hex = (c: any) => '#' + parseColor(c).slice(0, 3).map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
  const label = `${p.name ?? (isFill ? 'Gradient Fill' : 'Gradient Stroke')} [${[...p.stops].sort((a: any, b: any) => a.offset - b.offset).map((s: any) => `${hex(s.color)}@${+s.offset.toFixed(3)}`).join(' ')}]`;
  return { mn: isFill ? 'ADBE Vector Graphic - G-Fill' : 'ADBE Vector Graphic - G-Stroke', name: label, props, ffx: gradientFfx(p.stops, warnings) };
}
