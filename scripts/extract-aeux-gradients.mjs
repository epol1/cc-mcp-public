#!/usr/bin/env node
// One-time extraction of AEUX's gradient .ffx templates (Apache-2.0, google/AEUX) into
// src/compile/ffx/gradient-templates.json (base64). Parses the JS string literals WITHOUT evaluating code.
// Usage: node scripts/extract-aeux-gradients.mjs <path-to-AEUX/Ae/AEUX/src/host/AEFT/host.jsx>
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(process.argv[2], 'utf8');
const out = {};
for (let n = 2; n <= 8; n++) {
  const m = new RegExp(`template_grad${n}: "((?:[^"\\\\]|\\\\.)*)"`).exec(src);
  if (!m) throw new Error(`template_grad${n} not found`);
  const lit = m[1];
  const bytes = [];
  for (let i = 0; i < lit.length; i++) {
    const c = lit[i];
    if (c !== '\\') { bytes.push(lit.charCodeAt(i) & 0xff); continue; }
    const e = lit[++i];
    if (e === 'x') { bytes.push(parseInt(lit.substr(i + 1, 2), 16)); i += 2; }
    else if (e === 'u') { bytes.push(parseInt(lit.substr(i + 1, 4), 16) & 0xff); i += 4; }
    else if (e === 'n') bytes.push(10);
    else if (e === 'r') bytes.push(13);
    else if (e === 't') bytes.push(9);
    else if (e === 'f') bytes.push(12);
    else if (e === 'b') bytes.push(8);
    else if (e === 'v') bytes.push(11);
    else if (e === '0') bytes.push(0);
    else bytes.push(e.charCodeAt(0) & 0xff); // \\ \" \'
  }
  const buf = Buffer.from(bytes);
  if (buf.subarray(0, 4).toString('latin1') !== 'RIFX') throw new Error(`template_grad${n} is not RIFX`);
  out[n] = buf.toString('base64');
}
const dest = path.resolve('src/compile/ffx/gradient-templates.json');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify({ source: 'google/AEUX (Apache-2.0) Ae/AEUX/src/host/AEFT/host.jsx', templates: out }, null, 1));
console.log(`wrote ${Object.keys(out).length} templates → ${dest}`);
