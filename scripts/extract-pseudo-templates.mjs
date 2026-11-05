#!/usr/bin/env node
// Extracts the constant chunks a pseudo-effect .ffx needs (D74) from AE's own stock presets: the preset header,
// the per-type property descriptors (tdb4) of expression-control params, the compositing-options group every
// effect carries, and param 0 (the effect's input layer). The generator (src/compile/ffx/pseudo.ts) writes
// everything else (names, definitions, values) itself.
// Usage: node scripts/extract-pseudo-templates.mjs  → src/compile/ffx/pseudo-templates.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRESETS = process.env.AE_PRESETS ?? 'C:/Program Files/Adobe/Adobe After Effects 2026/Support Files/Presets';
const findFile = (name) => {
  const rec = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { const r = rec(p); if (r) return r; } else if (e.name === name) return p; } return null; };
  const f = rec(PRESETS); if (!f) throw new Error(`stock preset not found: ${name}`); return f;
};

function chunks(buf, off, end) {
  const out = [];
  while (off + 8 <= end) {
    const id = buf.toString('latin1', off, off + 4), size = buf.readUInt32BE(off + 4), body = off + 8;
    out.push({ id, size, off, body, type: id === 'LIST' || id === 'RIFX' ? buf.toString('latin1', body, body + 4) : null });
    off = body + size + (size & 1);
  }
  return out;
}
const kidsOf = (buf, c) => chunks(buf, c.body + 4, c.body + c.size);
const mnOf = (buf, c) => buf.toString('latin1', c.body, c.body + c.size).replace(/\0.*$/s, '');
const hex = (buf, c) => buf.subarray(c.off, c.body + c.size).toString('hex'); // whole chunk incl. header

/** The sspc (effect) whose first param matchName starts with `prefix`. */
function sspc(buf, prefix) {
  let hit = null;
  const walk = (off, end) => { for (const c of chunks(buf, off, end)) { if (hit) return; if (c.type === 'sspc') { const parT = kidsOf(buf, c).find((k) => k.type === 'parT'); const first = parT && kidsOf(buf, parT).find((k) => k.id === 'tdmn'); if (first && mnOf(buf, first).startsWith(prefix)) { hit = c; return; } } if (c.type) walk(c.body + 4, c.body + c.size); } };
  walk(0, buf.length);
  if (!hit) throw new Error(`no effect ${prefix}`);
  return hit;
}
/** Value chunk (LIST tdbs/tdgp) that follows the tdmn `mn` inside the effect's value group. */
function valueOf(buf, eff, mn) {
  const tdgp = kidsOf(buf, eff).find((k) => k.type === 'tdgp');
  const ks = kidsOf(buf, tdgp);
  const i = ks.findIndex((k) => k.id === 'tdmn' && mnOf(buf, k) === mn);
  if (i < 0) throw new Error(`no value for ${mn}`);
  return ks[i + 1];
}
const sub = (buf, list, id) => kidsOf(buf, list).find((k) => k.id === id);

const out = { source: 'AE 26.5 stock presets (format constants only)', tdb4: {}, param0: {}, builtIn: '', head: '', beso: '' };
const take = (file, effect, param, key) => {
  const buf = fs.readFileSync(findFile(file));
  const eff = sspc(buf, effect);
  const v = valueOf(buf, eff, `${effect}-${param}`);
  const t = sub(buf, v, 'tdb4');
  out.tdb4[key] = buf.subarray(t.body, t.body + t.size).toString('hex');
  return { buf, eff };
};
{
  const { buf, eff } = take('Lock Anchor Point.ffx', 'ADBE Slider Control', '0001', 'slider');
  const rifx = chunks(buf, 0, buf.length)[0];
  const top = kidsOf(buf, rifx);
  out.head = buf.subarray(top[0].body, top[0].body + top[0].size).toString('hex');
  const besc = top.find((k) => k.type === 'besc');
  const beso = kidsOf(buf, besc).find((k) => k.id === 'beso');
  out.beso = buf.subarray(beso.body, beso.body + beso.size).toString('hex');
  // Param 0 (the input layer) value and the compositing-options group, as whole chunks.
  const v0 = valueOf(buf, eff, 'ADBE Slider Control-0000');
  for (const id of ['tdb4', 'cdat', 'tdpi', 'tdps']) { const c = sub(buf, v0, id); out.param0[id] = buf.subarray(c.body, c.body + c.size).toString('hex'); }
  out.builtIn = hex(buf, valueOf(buf, eff, 'ADBE Effect Built In Params'));
}
take('Stacked Drop Shadows.ffx', 'ADBE Angle Control', '0001', 'angle');
take('Stacked Drop Shadows.ffx', 'ADBE Color Control', '0001', 'color');
take('Trim Paths - at layer out.ffx', 'ADBE Checkbox Control', '0001', 'checkbox');
take('Rounded Bracket - double.ffx', 'ADBE Point Control', '0001', 'point');
take('Bungee In.ffx', 'Pseudo/@@cQXzIgy7R1+uicD4w1BlQw', '0001', 'popup');
take('2D Text Box (Shape).ffx', 'Pseudo/ADBE 2D Text Box', '0003', 'groupStart');
take('2D Text Box (Shape).ffx', 'Pseudo/ADBE 2D Text Box', '0008', 'groupEnd');
const file = path.join(root, 'src/compile/ffx/pseudo-templates.json');
fs.writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
console.log(`wrote ${file}: ${Object.keys(out.tdb4).join(', ')}`);
