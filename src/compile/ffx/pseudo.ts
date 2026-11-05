// Pseudo effects (F2, D74): one tidy effect per rig ("aec Cloner", "aec Text Reveal") holding exactly its controls.
// AE has no scripting API for pseudo effects, but an animation preset (.ffx) can carry one: the preset holds the
// effect's definition (an `sspc` chunk: display name, `parT` param definitions, values), and applying it registers
// the effect in the project, which then stores the definition itself (so the project opens anywhere).
// Param definitions (`pard`) are the AE SDK's PF_ParamDef: ui flags @4, type @12, name @16 (32 bytes), flags @48,
// the type's value union @56. Constant descriptor chunks come from AE's stock presets (pseudo-templates.json,
// regenerate with scripts/extract-pseudo-templates.mjs).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export type PseudoParam =
  | { kind: 'slider'; name: string; default: number; min?: number; max?: number; validMin?: number; validMax?: number; precision?: number; display?: 'percent' | 'pixel' }
  | { kind: 'angle'; name: string; default: number }
  | { kind: 'checkbox'; name: string; default: boolean }
  | { kind: 'color'; name: string; default: number[] }
  | { kind: 'point'; name: string; default: number[] }
  | { kind: 'popup'; name: string; items: string[]; default?: number }
  | { kind: 'layer'; name: string }
  | { kind: 'group'; name: string; params: PseudoParam[]; collapsed?: boolean };

export interface PseudoEffectDef {
  /** Display name (Effect Controls, expressions: effect("aec Cloner")). At most 31 characters. */
  name: string;
  params: PseudoParam[];
}

export interface PseudoEffect {
  file: string;
  matchName: string;
  name: string;
  /** Flat list of params in AE order (1-based property index = position + 1), groups included. */
  params: { name: string; kind: string; mn: string; index: number }[];
}

const T = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'pseudo-templates.json'), 'utf8'));
const FFX_DIR = path.join(os.homedir(), '.ae-compose', 'ffx');

// ---- RIFX writer ----
const hexb = (h: string) => Buffer.from(h, 'hex');
function chunk(id: string, body: Buffer): Buffer {
  const h = Buffer.alloc(8);
  h.write(id, 0, 'latin1');
  h.writeUInt32BE(body.length, 4);
  return Buffer.concat(body.length & 1 ? [h, body, Buffer.alloc(1)] : [h, body]);
}
const list = (type: string, kids: Buffer[]) => chunk('LIST', Buffer.concat([Buffer.from(type, 'latin1'), ...kids]));
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0, 0); return b; };
const utf8 = (s: string) => chunk('Utf8', Buffer.from(s, 'utf8'));
function tdmn(mn: string): Buffer {
  const b = Buffer.alloc(40);
  if (Buffer.byteLength(mn, 'latin1') > 39) throw new Error(`matchName too long: ${mn}`);
  b.write(mn, 0, 'latin1');
  return chunk('tdmn', b);
}
const dbl = (...vs: number[]) => { const b = Buffer.alloc(Math.max(40, vs.length * 8)); vs.forEach((v, i) => b.writeDoubleBE(v, i * 8)); return b; };
const fixed = (v: number) => Math.round(v * 65536) | 0;
const argb = (c: number[]) => Buffer.from([Math.round((c[3] ?? 1) * 255), ...[0, 1, 2].map((i) => Math.round(Math.max(0, Math.min(1, c[i] ?? 0)) * 255))]);

const PF = { layer: 0, angle: 3, checkbox: 4, color: 5, point: 6, popup: 7, noData: 9, slider: 10, groupStart: 13, groupEnd: 14 } as const;
const CANNOT_TIME_VARY = 2, START_COLLAPSED = 0x20, NO_ECW_UI = 8;

function pardBase(type: number, name: string, flags = 0, uiFlags = 0): Buffer {
  const b = Buffer.alloc(148);
  b.writeUInt32BE(uiFlags, 4);
  b.writeUInt32BE(type, 12);
  if (Buffer.byteLength(name, 'utf8') > 31) throw new Error(`pseudo-effect param name "${name}" is longer than 31 bytes`);
  if (name.includes('/')) throw new Error(`pseudo-effect param name "${name}" can't contain "/"`);
  b.write(name, 16, 'utf8');
  b.writeUInt32BE(flags, 48);
  return b;
}

function pard(p: Exclude<PseudoParam, { kind: 'group' }>): { pard: Buffer; pdnm?: Buffer } {
  switch (p.kind) {
    case 'slider': {
      const b = pardBase(PF.slider, p.name);
      const lo = p.min ?? 0, hi = p.max ?? 100;
      b.writeDoubleBE(p.default, 56);
      b.writeFloatBE(p.validMin ?? Math.min(lo, -1e6), 104);
      b.writeFloatBE(p.validMax ?? Math.max(hi, 1e6), 108);
      b.writeFloatBE(lo, 112);
      b.writeFloatBE(hi, 116);
      b.writeFloatBE(p.default, 120);
      b.writeInt16BE(p.precision ?? 2, 124);
      b.writeInt16BE(p.display === 'percent' ? 1 : p.display === 'pixel' ? 2 : 0, 126);
      return { pard: b };
    }
    case 'angle': { const b = pardBase(PF.angle, p.name); b.writeInt32BE(fixed(p.default), 56); b.writeInt32BE(fixed(p.default), 60); return { pard: b }; }
    case 'checkbox': { const b = pardBase(PF.checkbox, p.name); b.writeInt32BE(p.default ? 1 : 0, 56); b.writeUInt8(p.default ? 1 : 0, 60); return { pard: b, pdnm: utf8('') }; }
    case 'color': { const b = pardBase(PF.color, p.name); argb(p.default).copy(b, 56); argb(p.default).copy(b, 60); return { pard: b }; }
    case 'point': { const b = pardBase(PF.point, p.name); b.writeInt32BE(fixed(p.default[0]), 56); b.writeInt32BE(fixed(p.default[1]), 60); b.writeInt32BE(fixed(50), 68); b.writeInt32BE(fixed(50), 72); return { pard: b }; }
    case 'popup': {
      if (!p.items.length) throw new Error(`popup "${p.name}" needs items`);
      if (p.items.some((s) => s.includes('|'))) throw new Error(`popup "${p.name}": items can't contain "|"`);
      const d = Math.max(1, Math.min(p.items.length, p.default ?? 1));
      const b = pardBase(PF.popup, p.name);
      b.writeInt32BE(d, 56); b.writeInt16BE(p.items.length, 60); b.writeInt16BE(d, 62);
      return { pard: b, pdnm: utf8(p.items.join('|')) };
    }
    case 'layer': { const b = pardBase(PF.layer, p.name, CANNOT_TIME_VARY); b.writeInt32BE(-1, 128); return { pard: b }; }
  }
}

function value(p: { kind: string; name: string; [k: string]: any }): Buffer {
  const kids: Buffer[] = [chunk('tdsb', u32(1)), chunk('tdsn', utf8(p.name))];
  const tdb4 = (k: string) => chunk('tdb4', hexb(T.tdb4[k]));
  switch (p.kind) {
    case 'slider': kids.push(tdb4('slider'), chunk('cdat', dbl(p.default)), chunk('tdum', dbl(p.min ?? 0).subarray(0, 8)), chunk('tduM', dbl(p.max ?? 100).subarray(0, 8))); break;
    case 'angle': kids.push(tdb4('angle'), chunk('cdat', dbl(p.default))); break;
    case 'checkbox': kids.push(tdb4('checkbox'), chunk('cdat', dbl(p.default ? 1 : 0))); break;
    case 'popup': kids.push(tdb4('popup'), chunk('cdat', dbl(Math.max(1, p.default ?? 1)))); break;
    case 'color': { const c = argb(p.default); const b = Buffer.alloc(96); [c[0], c[1], c[2], c[3]].forEach((v, i) => b.writeDoubleBE(v, i * 8)); kids.push(tdb4('color'), chunk('cdat', b)); break; }
    // Stored as fractions of the preset's frame (beso: 1920×1080); AE multiplies them back (verified).
    case 'point': { const b = Buffer.alloc(48); b.writeDoubleBE(p.default[0] / 1920, 0); b.writeDoubleBE(p.default[1] / 1080, 8); kids.push(tdb4('point'), chunk('cdat', b)); break; }
    case 'layer': kids.push(chunk('tdb4', hexb(T.param0.tdb4)), chunk('cdat', dbl(0)), chunk('tdpi', u32(0))); break;
    case 'groupStart': kids.push(tdb4('groupStart'), chunk('cdat', dbl(0))); break;
    case 'groupEnd': kids.push(tdb4('groupEnd'), chunk('cdat', dbl(0))); break;
  }
  return list('tdbs', kids);
}

/** Flattens groups into AE's param order: group start, its params, group end. */
function flatten(params: PseudoParam[]): any[] {
  const out: any[] = [];
  for (const p of params) {
    if (p.kind === 'group') {
      out.push({ kind: 'groupStart', name: p.name, collapsed: p.collapsed });
      out.push(...flatten(p.params));
      out.push({ kind: 'groupEnd', name: '' });
    } else out.push(p);
  }
  return out;
}

/**
 * Stable matchName: "Pseudo/<name> <hash>", the hash of the definition (a changed rig gets a new effect). AE
 * registers a pseudo effect only when its matchName fits 31 bytes (D84), so the name part is cut to 17 characters;
 * the effect's display name keeps the full name.
 */
export function pseudoMatchName(def: PseudoEffectDef): string {
  const h = crypto.createHash('sha1').update(JSON.stringify(def)).digest('hex').slice(0, 6);
  const base = def.name.replace(/[^A-Za-z0-9 ]+/g, '').slice(0, 31 - 'Pseudo/'.length - 7).trimEnd();
  return `Pseudo/${base} ${h}`;
}

/** Builds the .ffx bytes for a pseudo effect. */
export function pseudoFfxBytes(def: PseudoEffectDef): { bytes: Buffer; matchName: string; params: PseudoEffect['params'] } {
  if (Buffer.byteLength(def.name, 'utf8') > 31) throw new Error(`pseudo-effect name "${def.name}" is longer than 31 bytes`);
  if (def.name.includes('/')) throw new Error(`pseudo-effect name "${def.name}" can't contain "/"`);
  const mn = pseudoMatchName(def);
  const flat = flatten(def.params);
  const names = new Set<string>();
  for (const p of flat) if (p.name && p.kind !== 'groupStart') { if (names.has(p.name)) throw new Error(`pseudo effect "${def.name}": duplicate param name "${p.name}"`); names.add(p.name); }
  const pmn = (i: number) => `${mn}-${String(i).padStart(4, '0')}`;
  // Definitions: param 0 (input layer), the params, the built-in compositing options.
  const p0 = pardBase(PF.layer, '', CANNOT_TIME_VARY); p0.writeInt32BE(-1, 128);
  const defs: Buffer[] = [chunk('parn', u32(flat.length + 2)), tdmn(pmn(0)), chunk('pard', p0)];
  flat.forEach((p, i) => {
    defs.push(tdmn(pmn(i + 1)));
    if (p.kind === 'groupStart') defs.push(chunk('pard', pardBase(PF.groupStart, p.name, CANNOT_TIME_VARY | (p.collapsed ? START_COLLAPSED : 0))));
    else if (p.kind === 'groupEnd') defs.push(chunk('pard', pardBase(PF.groupEnd, '', CANNOT_TIME_VARY, NO_ECW_UI)));
    else { const d = pard(p); defs.push(chunk('pard', d.pard)); if (d.pdnm) defs.push(chunk('pdnm', d.pdnm)); }
  });
  defs.push(tdmn('ADBE Effect Built In Params'), chunk('pard', pardBase(PF.noData, '')));
  // Values: the effect instance (param 0, each param, compositing options, end of group).
  const p0v = list('tdbs', [chunk('tdsb', u32(3)), chunk('tdsn', utf8('')), chunk('tdb4', hexb(T.param0.tdb4)), chunk('cdat', hexb(T.param0.cdat)), chunk('tdpi', hexb(T.param0.tdpi)), chunk('tdps', hexb(T.param0.tdps))]);
  const vals: Buffer[] = [chunk('tdsb', u32(1)), chunk('tdsn', utf8(def.name)), tdmn(pmn(0)), p0v];
  flat.forEach((p, i) => { vals.push(tdmn(pmn(i + 1)), value(p)); });
  vals.push(tdmn('ADBE Effect Built In Params'), hexb(T.builtIn), tdmn('ADBE Group End'));
  const sspc = list('sspc', [chunk('fnam', utf8(def.name)), list('parT', defs), list('tdgp', vals), chunk('pgui', Buffer.alloc(16))]);
  const tdsi = (ix: number, m: string) => list('tdsi', [chunk('tdix', u32(ix)), tdmn(m)]);
  const besc = list('besc', [
    chunk('beso', hexb(T.beso)),
    list('tdsp', [chunk('tdot', u32(-1)), chunk('tdpl', u32(2)), tdsi(-1, 'ADBE Effect Parade'), tdsi(0, mn)]),
    chunk('tdsn', utf8(def.name)),
    list('tdsp', [chunk('tdot', u32(-1)), chunk('tdpl', u32(1)), tdsi(-1, 'ADBE End of path sentinel')]),
    sspc,
  ]);
  const body = Buffer.concat([Buffer.from('FaFX', 'latin1'), chunk('head', hexb(T.head)), besc]);
  const bytes = chunk('RIFX', body);
  let index = 1;
  const params = flat.map((p) => ({ name: p.name, kind: p.kind, mn: pmn(index), index: index++ }));
  return { bytes, matchName: mn, params };
}

/** Writes (once) the .ffx for a pseudo effect under ~/.ae-compose/ffx and returns where it is. */
export function pseudoEffect(def: PseudoEffectDef): PseudoEffect {
  const { bytes, matchName, params } = pseudoFfxBytes(def);
  const file = path.join(FFX_DIR, `pseudo_${matchName.replace(/^Pseudo\//, '').replace(/[^A-Za-z0-9]+/g, '_')}.ffx`);
  if (!fs.existsSync(file)) { fs.mkdirSync(FFX_DIR, { recursive: true }); fs.writeFileSync(file, bytes); }
  return { file: file.replace(/\\/g, '/'), matchName, name: def.name, params };
}
