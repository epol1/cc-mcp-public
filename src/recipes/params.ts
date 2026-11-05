// Recipe params: a schema inferred from a scene's config.params (types from the default values: number, boolean,
// color, file, text, data rows, lists), and the checks that turn the params an agent passes into values to bake
// into a new scene (coerced, validated, file paths made relative to the new scene).
import fs from 'node:fs';
import path from 'node:path';
import { parseColor } from '../shared/units.ts';
import { ASSET_EXT, relRef } from './source.ts';

export type ParamType = 'string' | 'text' | 'number' | 'boolean' | 'color' | 'file' | 'data' | 'list' | 'vec' | 'object';
export const PARAM_TYPES: ParamType[] = ['string', 'text', 'number', 'boolean', 'color', 'file', 'data', 'list', 'vec', 'object'];

export interface ParamSpec {
  type: ParamType;
  default: unknown;
  description?: string;
  min?: number;
  max?: number;
  /** For strings: the allowed values. */
  options?: string[];
  /** May be empty (files: no file → the scene's fallback). */
  optional?: boolean;
}

const COLOR = /^(#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(rgba?|hsla?)\([^)]*\))$/i;
const isColor = (s: string) => COLOR.test(s.trim());

export function inferParam(v: unknown, sceneDir: string): ParamSpec {
  if (typeof v === 'number') return { type: 'number', default: v };
  if (typeof v === 'boolean') return { type: 'boolean', default: v };
  if (typeof v === 'string') {
    if (isColor(v)) return { type: 'color', default: v };
    if (ASSET_EXT.test(v) && fs.existsSync(path.isAbsolute(v) ? v : path.resolve(sceneDir, v))) return { type: 'file', default: v };
    return { type: /[\r\n]/.test(v) ? 'text' : 'string', default: v };
  }
  if (Array.isArray(v)) {
    if (v.length && v.every((x) => x && typeof x === 'object' && !Array.isArray(x))) return { type: 'data', default: v };
    if (v.length >= 2 && v.length <= 4 && v.every((x) => typeof x === 'number')) return { type: 'vec', default: v };
    return { type: 'list', default: v };
  }
  return { type: 'object', default: v ?? null };
}

/** Schema from config.params; `overrides` adds descriptions or fixes types (a string is a description). */
export function inferParams(params: Record<string, unknown> | undefined, sceneDir: string, overrides: Record<string, Partial<ParamSpec> | string> = {}): Record<string, ParamSpec> {
  const out: Record<string, ParamSpec> = {};
  for (const [k, v] of Object.entries(params ?? {})) {
    const o = overrides[k];
    out[k] = { ...inferParam(v, sceneDir), ...(typeof o === 'string' ? { description: o } : o ?? {}), default: v };
  }
  for (const k of Object.keys(overrides)) if (!(k in out)) throw new Error(`param "${k}" is described but the scene's config.params has no "${k}"`);
  return out;
}

export interface CoerceContext {
  /** Base for relative file params the caller passes (default process.cwd()). */
  cwd?: string;
  /** The scene file the values are written into (file params become relative to it). */
  outFile: string;
}

/** Validate and coerce `given` against `schema`. Unknown keys are warnings; bad values are errors. */
export function coerceParams(schema: Record<string, ParamSpec>, given: Record<string, unknown> = {}, ctx: CoerceContext): { values: Record<string, unknown>; warnings: string[]; errors: string[] } {
  const values: Record<string, unknown> = {};
  const warnings: string[] = [], errors: string[] = [];
  for (const [k, raw] of Object.entries(given)) {
    const spec = schema[k] ?? (k === 'seed' ? { type: 'number' as const, default: 1 } : undefined);
    if (!spec) { warnings.push(`"${k}" is not a param of this recipe (params: ${Object.keys(schema).join(', ') || 'none'}); ignored`); continue; }
    const bad = (why: string) => errors.push(`param "${k}" (${spec.type}): ${why}`);
    switch (spec.type) {
      case 'number': {
        const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
        if (!Number.isFinite(n)) { bad(`expected a number, got ${JSON.stringify(raw)}`); break; }
        if (spec.min !== undefined && n < spec.min) warnings.push(`param "${k}" = ${n} is below its usual minimum ${spec.min}`);
        if (spec.max !== undefined && n > spec.max) warnings.push(`param "${k}" = ${n} is above its usual maximum ${spec.max}`);
        values[k] = n; break;
      }
      case 'boolean':
        if (typeof raw === 'boolean') values[k] = raw;
        else if (raw === 'true' || raw === 'false') values[k] = raw === 'true';
        else bad(`expected true or false, got ${JSON.stringify(raw)}`);
        break;
      case 'color':
        if (typeof raw !== 'string') { bad(`expected a color string ("#4683c4"), got ${JSON.stringify(raw)}`); break; }
        try { parseColor(raw); values[k] = raw; } catch (e: any) { bad(e?.message ?? 'not a color'); }
        break;
      case 'file': {
        if (typeof raw !== 'string') { bad(`expected a file path, got ${JSON.stringify(raw)}`); break; }
        if (!raw) { if (!spec.optional) warnings.push(`param "${k}" is empty: the scene uses its fallback`); values[k] = ''; break; }
        const abs = path.resolve(ctx.cwd ?? process.cwd(), raw);
        if (!fs.existsSync(abs)) warnings.push(`param "${k}": file not found (${abs})`);
        values[k] = relRef(ctx.outFile, abs);
        break;
      }
      case 'string': case 'text':
        if (typeof raw === 'string') values[k] = raw;
        else if (typeof raw === 'number' || typeof raw === 'boolean') values[k] = String(raw);
        else { bad(`expected text, got ${JSON.stringify(raw)}`); break; }
        if (spec.options && !spec.options.includes(values[k] as string)) warnings.push(`param "${k}" = "${values[k]}" is not one of ${spec.options.join(', ')}`);
        break;
      case 'data': {
        if (!Array.isArray(raw) || !raw.every((x) => x && typeof x === 'object' && !Array.isArray(x))) { bad('expected an array of row objects'); break; }
        const row0 = Array.isArray(spec.default) && spec.default[0] && typeof spec.default[0] === 'object' ? Object.keys(spec.default[0] as object) : [];
        const missing = row0.filter((c) => raw.some((r: any) => !(c in r)));
        if (missing.length) warnings.push(`param "${k}": some rows lack ${missing.map((m) => `"${m}"`).join(', ')} (the default rows have ${row0.join(', ')})`);
        if (!raw.length) warnings.push(`param "${k}" has no rows`);
        values[k] = raw; break;
      }
      case 'vec': case 'list':
        if (!Array.isArray(raw)) { bad('expected an array'); break; }
        if (spec.type === 'vec' && !raw.every((x) => typeof x === 'number')) { bad('expected numbers'); break; }
        values[k] = raw; break;
      default:
        values[k] = raw;
    }
  }
  return { values, warnings, errors };
}
